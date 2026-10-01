from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from database import get_db
from models import Tenant, Membership, User, TenantCreate, TenantOut, UserMembershipUpdate
from auth_rbac import get_user_context, UserContext, Role, Permission, require_permission, require_role
from logging_config import logger as log
from auth import hash_password
from utils import send_onboarding_email

router = APIRouter(prefix="/api/admin/v1", tags=["Admin & RBAC"])

@router.post("/tenants", response_model=TenantOut)
async def create_tenant(
    body: TenantCreate,
    ctx: UserContext = Depends(require_permission(Permission.CREATE_TENANT)),
    db: AsyncSession = Depends(get_db)
):
    """Super Admin only: Create a new tenant and optionally onboard its first admin."""
    # Check duplicate
    existing = await db.execute(select(Tenant).where(Tenant.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Tenant with name '{body.name}' already exists.")

    new_tenant = Tenant(name=body.name)
    db.add(new_tenant)
    await db.commit()
    await db.refresh(new_tenant)

    if body.admin_email:
        # Check if user exists
        user_res = await db.execute(select(User).where(User.email == body.admin_email))
        target_user = user_res.scalar_one_or_none()
        
        default_pass = "Admin@123"
        if not target_user:
            # Create user
            target_user = User(
                email=body.admin_email,
                password_hash=hash_password(default_pass),
                full_name=body.name + " Admin"
            )
            db.add(target_user)
            await db.commit()
            await db.refresh(target_user)
        
        # Assign membership
        new_mem = Membership(
            user_id=target_user.id,
            tenant_id=new_tenant.id,
            role="admin"
        )
        db.add(new_mem)
        await db.commit()
        
        try:
            await send_onboarding_email(body.admin_email, "admin", body.name, default_pass)
        except Exception as e:
            log.error(f"Failed to send onboarding email: {e}")

    return new_tenant

@router.get("/tenants", response_model=List[TenantOut])
async def list_tenants(
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Super Admin only: List all tenants."""
    result = await db.execute(select(Tenant))
    return result.scalars().all()

from pydantic import BaseModel

class MembershipRoleUpdate(BaseModel):
    override_role: Optional[str] = None
    manager_id: Optional[str] = None

@router.post("/memberships", status_code=status.HTTP_201_CREATED)
async def assign_membership(
    body: dict,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db)
):
    """Assign a user to a tenant by email (DISABLED)."""
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="All user onboarding and memberships must be managed exclusively through the Scaloz Workspace SSO system."
    )

@router.get("/memberships")
async def list_memberships(
    tenant_id: Optional[str] = None,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db)
):
    """List memberships within a tenant."""
    query = select(Membership).join(User, Membership.user_id == User.id).where(User.status != "disabled").options(selectinload(Membership.user), selectinload(Membership.manager))
    
    if ctx.role == Role.SUPER_ADMIN:
        if tenant_id:
            from database import resolve_tenant_id
            resolved_tid = await resolve_tenant_id(db, tenant_id)
            query = query.where(Membership.tenant_id == resolved_tid)
    else:
        query = query.where(Membership.tenant_id == ctx.tenant_id)
        
    result = await db.execute(query)
    memberships = result.scalars().all()
    
    return [
        {
            "id": str(m.id),
            "user_id": str(m.user_id),
            "user_email": m.user.email,
            "role": m.role,
            "scaloz_role": m.scaloz_role,
            "override_role": m.override_role,
            "manager_id": str(m.manager_id) if m.manager_id else None,
            "manager_email": m.manager.email if m.manager else None,
            "tenant_id": str(m.tenant_id)
        } for m in memberships
    ]

@router.delete("/memberships/{membership_id}")
async def delete_membership(
    membership_id: UUID,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db)
):
    """Remove a membership (DISABLED)."""
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="User deletion is disabled. Scaloz is the single source of truth for all users."
    )

@router.patch("/memberships/{membership_id}/role")
async def update_membership_role(
    membership_id: UUID,
    body: MembershipRoleUpdate,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db)
):
    """Modify the AI Interview Access Role (override_role) and manager for a membership."""
    result = await db.execute(select(Membership).options(selectinload(Membership.manager)).where(Membership.id == membership_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Membership not found")
        
    if ctx.role != Role.SUPER_ADMIN:
        if ctx.role != Role.ADMIN:
            raise HTTPException(status_code=403, detail="Only Admins can modify member access roles.")
        if str(m.tenant_id) != str(ctx.tenant_id):
            raise HTTPException(status_code=403, detail="You can only manage members in your own tenant.")
            
    new_override = body.override_role
    if new_override:
        new_override = new_override.strip().lower()
        if new_override not in ("admin", "manager", "recruiter"):
            raise HTTPException(status_code=400, detail="Invalid override role. Must be 'admin', 'manager', or 'recruiter'.")
    else:
        new_override = None
        
    scaloz_role_val = m.scaloz_role or "recruiter"
    raw_role_str = scaloz_role_val.strip().lower().replace("_", " ").replace("-", " ")
    is_scaloz_admin = "admin" in raw_role_str or "subadmin" in raw_role_str or "sub admin" in raw_role_str
    is_scaloz_manager = "manager" in raw_role_str or "manger" in raw_role_str or "program manager" in raw_role_str

    if is_scaloz_admin:
        mapped_role = "admin"
    elif is_scaloz_manager:
        mapped_role = "manager"
    else:
        mapped_role = "recruiter"

    potential_new_role = new_override if new_override else mapped_role
    current_role = m.role

    if (current_role == "admin" and potential_new_role != "admin") or (current_role != "admin" and potential_new_role == "admin"):
        raise HTTPException(
            status_code=403,
            detail="Admin roles cannot be modified inside AI Interview. They must be managed through Scaloz."
        )
        
    m.override_role = new_override
    m.role = potential_new_role
        
    # Update manager_id if passed
    if "manager_id" in body.model_fields_set:
        if body.manager_id:
            m.manager_id = UUID(body.manager_id)
        else:
            m.manager_id = None
            
    # Clear manager if role is not recruiter
    if m.role != "recruiter":
        m.manager_id = None
        
    await db.commit()
    await db.refresh(m)
    
    return {
        "detail": "AI Interview access role updated successfully",
        "role": m.role,
        "scaloz_role": m.scaloz_role,
        "override_role": m.override_role,
        "manager_id": str(m.manager_id) if m.manager_id else None,
        "manager_email": m.manager.email if m.manager else None
    }

@router.get("/users/search")
async def search_users(
    email: str,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER])),
    db: AsyncSession = Depends(get_db)
):
    """Find a user by email to invite/add to tenant."""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(user.id), "email": user.email, "full_name": user.full_name}

@router.get("/tenants/{tenant_id}/settings")
async def get_tenant_settings(
    tenant_id: UUID,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db)
):
    """Get settings for a specific tenant."""
    if ctx.role != Role.SUPER_ADMIN and str(tenant_id) != str(ctx.tenant_id):
        raise HTTPException(403, "Not authorized to view these settings")
    
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    
    return tenant.settings or {}

@router.put("/tenants/{tenant_id}/settings")
async def update_tenant_settings(
    tenant_id: UUID,
    settings: dict,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Update settings for a specific tenant."""
    if ctx.role != Role.SUPER_ADMIN and str(tenant_id) != str(ctx.tenant_id):
        raise HTTPException(403, "Not authorized to update these settings")
    
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    
    # Merge existing settings
    current_settings = tenant.settings or {}
    current_settings.update(settings)
    tenant.settings = current_settings
    
    await db.commit()
    return tenant.settings
