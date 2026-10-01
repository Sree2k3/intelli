from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from datetime import datetime, timedelta, timezone

from database import get_db
from models import Tenant, Membership, User, Interview, Profile
from auth_rbac import require_role, UserContext, Role
from auth import hash_password
from logging_config import logger as log
from pydantic import BaseModel, EmailStr, field_validator

router = APIRouter(prefix="/api/super-admin", tags=["Super Admin Platform Management"])

class TenantCreateExtended(BaseModel):
    name: str
    admin_name: str
    admin_email: EmailStr
    password: str
    company_name: Optional[str] = None
    plan_type: str = "basic"
    duration_days: int = 30
    start_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    status: str = "active"
    interview_limit: int = 99999999
    phone: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("expiry_date", "start_date", mode="before")
    @classmethod
    def empty_string_to_none(cls, v):
        if v == "":
            return None
        return v

class TenantUpdateExtended(BaseModel):
    name: Optional[str] = None
    admin_email: Optional[str] = None
    plan_type: Optional[str] = None
    duration_days: Optional[int] = None
    expiry_date: Optional[datetime] = None
    status: Optional[str] = None
    interview_limit: Optional[int] = None
    phone: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("expiry_date", mode="before")
    @classmethod
    def empty_string_to_none(cls, v):
        if v == "":
            return None
        return v

@router.post("/tenant/create")
async def create_tenant_full(
    body: TenantCreateExtended,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Full tenant creation: Tenant + Admin User + Membership."""
    # 1. Check if email exists
    email_check = await db.execute(select(User).where(User.email == body.admin_email))
    if email_check.scalar_one_or_none():
        raise HTTPException(400, "Admin email already exists")

    # 2. Check if tenant name exists
    tenant_check = await db.execute(select(Tenant).where(Tenant.name == body.name))
    if tenant_check.scalar_one_or_none():
        raise HTTPException(400, "Tenant name already exists")

    # 3. Create Tenant
    start_dt = body.start_date or datetime.now()
    exp_dt = body.expiry_date
    if not exp_dt:
        exp_dt = start_dt + timedelta(days=body.duration_days)

    new_tenant = Tenant(
        name=body.name,
        plan_type=body.plan_type,
        duration_days=body.duration_days,
        start_date=start_dt,
        expiry_date=exp_dt,
        interview_limit=body.interview_limit,
        status=body.status,
        settings={
            "phone": body.phone,
            "notes": body.notes,
            "company_name": body.company_name or body.name
        }
    )
    db.add(new_tenant)
    await db.flush() # Get ID

    # 4. Create Admin User
    new_user = User(
        email=body.admin_email,
        password_hash=hash_password(body.password),
        full_name=body.admin_name
    )
    db.add(new_user)
    await db.flush()

    # 5. Create Profile
    new_profile = Profile(
        user_id=new_user.id,
        full_name=body.admin_name,
        role="admin"
    )
    db.add(new_profile)

    # 6. Create Membership
    new_membership = Membership(
        user_id=new_user.id,
        tenant_id=new_tenant.id,
        role="admin"
    )
    db.add(new_membership)

    await db.commit()
    log.info(f"Super Admin created tenant: {body.name} with admin: {body.admin_email}")
    return {"id": str(new_tenant.id), "detail": "Tenant created successfully"}

@router.get("/tenant/{tenant_id}")
async def get_tenant_details(
    tenant_id: UUID,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Detailed view of a single tenant."""
    # Base tenant info
    res = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Tenant not found")

    # Admin info
    admin_res = await db.execute(
        select(User.email, User.full_name)
        .join(Membership, Membership.user_id == User.id)
        .where(and_(Membership.tenant_id == tenant_id, Membership.role == "admin"))
    )
    admin = admin_res.first()

    # Usage counts
    int_count = (await db.execute(select(func.count(Interview.id)).where(Interview.tenant_id == tenant_id))).scalar() or 0
    passed_count = (await db.execute(select(func.count(Interview.id)).where(and_(Interview.tenant_id == tenant_id, Interview.overall_score >= 70)))).scalar() or 0
    
    # Member counts
    recruiters = (await db.execute(select(func.count(Membership.id)).where(and_(Membership.tenant_id == tenant_id, Membership.role == "recruiter")))).scalar() or 0
    managers = (await db.execute(select(func.count(Membership.id)).where(and_(Membership.tenant_id == tenant_id, Membership.role == "manager")))).scalar() or 0

    return {
        "id": str(t.id),
        "name": t.name,
        "admin_email": admin.email if admin else "N/A",
        "admin_name": admin.full_name if admin else "N/A",
        "plan_type": t.plan_type,
        "duration_days": t.duration_days,
        "start_date": t.start_date.isoformat(),
        "expiry_date": t.expiry_date.isoformat() if t.expiry_date else None,
        "interview_limit": t.interview_limit,
        "status": t.status,
        "phone": t.settings.get("phone", ""),
        "notes": t.settings.get("notes", ""),
        "company_name": t.settings.get("company_name", ""),
        "interview_count": int_count,
        "passed_count": passed_count,
        "active_recruiters": recruiters,
        "active_managers": managers
    }

@router.get("/dashboard/stats")
async def get_platform_stats(
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Platform owner overview: Aggregated SaaS metrics."""
    total_tenants = (await db.execute(select(func.count(Tenant.id)))).scalar() or 0
    total_interviews = (await db.execute(select(func.count(Interview.id)))).scalar() or 0
    
    # Cleared candidates (score >= 70)
    total_selected = (await db.execute(
        select(func.count(Interview.id)).where(Interview.overall_score >= 70)
    )).scalar() or 0
    
    active_tenants = (await db.execute(
        select(func.count(Tenant.id)).where(Tenant.status == "active")
    )).scalar() or 0
    
    expired_tenants = (await db.execute(
        select(func.count(Tenant.id)).where(
            or_(
                Tenant.status == "expired",
                and_(Tenant.expiry_date != None, Tenant.expiry_date < datetime.now(timezone.utc))
            )
        )
    )).scalar() or 0

    return {
        "total_tenants": total_tenants,
        "total_interviews": total_interviews,
        "total_selected": total_selected,
        "active_tenants": active_tenants,
        "expired_tenants": expired_tenants
    }

@router.get("/tenants")
async def list_tenants_enterprise(
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Professional tenant management list for SaaS owner."""
    # We need to join with Membership to get the Admin email
    # and aggregate interview counts per tenant
    
    # Subquery for interview counts
    int_counts_sub = select(
        Interview.tenant_id,
        func.count(Interview.id).label("total_int"),
        func.count(Interview.id).filter(Interview.overall_score >= 70).label("total_selected")
    ).group_by(Interview.tenant_id).subquery()

    # Subquery for tenant admin
    admin_sub = select(
        Membership.tenant_id,
        User.email.label("admin_email")
    ).join(User, User.id == Membership.user_id).where(Membership.role == "admin").subquery()

    query = select(
        Tenant,
        admin_sub.c.admin_email,
        func.coalesce(int_counts_sub.c.total_int, 0).label("interview_count"),
        func.coalesce(int_counts_sub.c.total_selected, 0).label("selected_count")
    ).outerjoin(admin_sub, admin_sub.c.tenant_id == Tenant.id)\
     .outerjoin(int_counts_sub, int_counts_sub.c.tenant_id == Tenant.id)

    result = await db.execute(query)
    rows = result.all()

    tenants_list = []
    now = datetime.now(timezone.utc)
    
    for row in rows:
        t = row[0]
        admin_email = row[1]
        int_count = row[2]
        sel_count = row[3]
        
        # Calculate remaining days
        remaining_days = 0
        expiry_dt = t.expiry_date
        
        if not expiry_dt and t.start_date:
            expiry_dt = t.start_date + timedelta(days=t.duration_days or 30)
            
        if expiry_dt:
            delta = expiry_dt - now
            remaining_days = max(0, delta.days)
            
        # Auto-update status if expired
        if expiry_dt and expiry_dt < now and t.status == "active":
            t.status = "expired"
            # We would commit this later or just report it
            
        tenants_list.append({
            "id": str(t.id),
            "name": t.name,
            "admin_email": admin_email or "N/A",
            "plan_type": t.plan_type,
            "duration_days": t.duration_days,
            "start_date": t.start_date.isoformat() if t.start_date else None,
            "expiry_date": expiry_dt.isoformat() if expiry_dt else None,
            "interview_limit": t.interview_limit,
            "status": t.status,
            "total_interviews": int_count,
            "total_selected": sel_count,
            "remaining_days": remaining_days
        })
        
    return tenants_list

@router.put("/tenant/{tenant_id}")
async def update_tenant_full(
    tenant_id: UUID,
    body: TenantUpdateExtended,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Update tenant profile, subscription, or status."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
        
    if body.name:
        tenant.name = body.name
    if body.plan_type:
        tenant.plan_type = body.plan_type
    if body.duration_days is not None:
        tenant.duration_days = body.duration_days
        # If updating duration, we might want to recalculate expiry from now or from start_date
        # Let's assume from start_date for consistency
        if tenant.start_date:
            tenant.expiry_date = tenant.start_date + timedelta(days=body.duration_days)
    if body.expiry_date:
        tenant.expiry_date = body.expiry_date
    if body.interview_limit is not None:
        tenant.interview_limit = body.interview_limit
    if body.status:
        tenant.status = body.status
    
    # Update settings
    settings = dict(tenant.settings or {})
    if body.phone is not None:
        settings["phone"] = body.phone
    if body.notes is not None:
        settings["notes"] = body.notes
    tenant.settings = settings

    # Update Admin email if changed
    if body.admin_email:
        admin_res = await db.execute(
            select(User).join(Membership, Membership.user_id == User.id)
            .where(and_(Membership.tenant_id == tenant_id, Membership.role == "admin"))
        )
        admin = admin_res.scalar_one_or_none()
        if admin:
            # Check if new email is taken
            email_check = await db.execute(select(User).where(and_(User.email == body.admin_email, User.id != admin.id)))
            if email_check.scalar_one_or_none():
                raise HTTPException(400, "New admin email already taken by another user")
            admin.email = body.admin_email
        
    await db.commit()
    return {"detail": "Tenant updated successfully"}

@router.delete("/tenant/{tenant_id}")
async def delete_tenant_full(
    tenant_id: UUID,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Permanent deletion of a tenant workspace."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
        
    await db.delete(tenant)
    await db.commit()
    return {"detail": "Tenant deleted successfully"}
