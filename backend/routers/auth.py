from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import User, UserRegister, UserLogin, Profile, TokenResponse, Membership, Tenant, PasswordResetToken, ForgotPasswordRequest, ResetPasswordRequest
from auth import create_access_token, hash_password, verify_password, get_current_user
from sqlalchemy.orm import selectinload
from logging_config import logger as log
from datetime import datetime, timezone, timedelta
import secrets
import uuid
from utils import send_password_reset_email
from typing import Any, Optional

def is_uuid_str(val: Any) -> bool:
    if not val:
        return False
    try:
        from uuid import UUID
        UUID(str(val).strip())
        return True
    except ValueError:
        return False

def get_clean_company_name(tenant: Any) -> str:
    if not tenant:
        return "Our Company"
    # Check settings first
    company_name = (tenant.settings or {}).get("company_name")
    if company_name and not is_uuid_str(company_name):
        return company_name
    
    # Fallback to formatting tenant.name if it's not a UUID
    if tenant.name and not is_uuid_str(tenant.name):
        cleaned = tenant.name.replace("-", " ").replace("_", " ")
        return " ".join([w.capitalize() for w in cleaned.split()])
        
    return "Our Company"


router = APIRouter(prefix="/api/auth/v1", tags=["Authentication"])

@router.post("/signup")
async def signup(body: UserRegister, db: AsyncSession = Depends(get_db)):
    """User registration flow (DISABLED)."""
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, 
        detail="Public registration is disabled. Please contact your administrator for an account."
    )


@router.post("/token", response_model=TokenResponse)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    """User login flow."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        log.warning(f"Failed login attempt for: {body.email}")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    log.info(f"User logged in: {user.email}")
    token = create_access_token(str(user.id), user.email)

    # Fetch primary membership (bypass tenant filter — no X-Tenant-ID during login)
    old_info = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        m_res = await db.execute(
            select(Membership).where(Membership.user_id == user.id).options(selectinload(Membership.tenant))
        )
        memberships = m_res.scalars().all()
    finally:
        db.info["tenant_id"] = old_info
    
    membership = None
    if memberships:
        if old_info:
            from uuid import UUID
            try:
                target_tid = UUID(str(old_info))
                membership = next((m for m in memberships if m.tenant_id == target_tid), memberships[0])
            except (ValueError, AttributeError):
                membership = memberships[0]
        else:
            membership = memberships[0]
    
    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        role=membership.role if membership else None,
        tenant_id=str(membership.tenant_id) if membership else None,
        tenant_name=get_clean_company_name(membership.tenant) if membership and membership.tenant else None
    )


@router.get("/user")
async def get_user_endpoint(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get current authenticated user info with role and tenant details."""
    if getattr(current_user, "email", None) == "sso-admin@scaloz.com":
        return {
            "id":          str(current_user.id),
            "email":       current_user.email,
            "name":        "SSO Admin",
            "full_name":   "SSO Admin",
            "role":        "super_admin",
            "tenant_id":   None,
            "tenant_name": None,
            "plan_type":   "enterprise"
        }

    # Query bypassing tenant_id filter to get the user's primary membership
    old_info = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        result = await db.execute(
            select(Membership)
            .where(Membership.user_id == current_user.id)
            .options(selectinload(Membership.tenant))
        )
        memberships = result.scalars().all()
    finally:
        db.info["tenant_id"] = old_info
        
    primary = None
    if memberships:
        if old_info:
            from uuid import UUID
            try:
                target_tid = UUID(str(old_info))
                primary = next((m for m in memberships if m.tenant_id == target_tid), memberships[0])
            except (ValueError, AttributeError):
                primary = memberships[0]
        else:
            primary = memberships[0]

    return {
        "id":          str(current_user.id),
        "email":       current_user.email,
        "name":        current_user.full_name or "",
        "full_name":   current_user.full_name or "",
        "role":        primary.role if primary else None,
        "tenant_id":   str(primary.tenant_id) if primary else None,
        "tenant_name": get_clean_company_name(primary.tenant) if primary and primary.tenant else None,
        "plan_type":   primary.tenant.plan_type if primary and primary.tenant else "basic"
    }


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Generate a reset token and send email."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    
    # We always return 200 to prevent email enumeration
    if not user:
        log.info(f"Forgot password requested for non-existent email: {body.email}")
        return {"detail": "If this email is registered, a reset link has been sent."}

    # Generate token
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    
    # Save token
    reset_entry = PasswordResetToken(
        user_id=user.id,
        token=token,
        expires_at=expires_at
    )
    db.add(reset_entry)
    await db.commit()
    
    # Send email
    send_password_reset_email(user.email, token)
    
    return {"detail": "If this email is registered, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Verify token and update password."""
    # Find token
    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token == body.token)
    )
    token_record = result.scalar_one_or_none()
    
    if not token_record:
        raise HTTPException(400, "Invalid or expired reset token.")
        
    if token_record.expires_at < datetime.now(timezone.utc):
        await db.delete(token_record)
        await db.commit()
        raise HTTPException(400, "Reset token has expired.")
        
    # Update user
    user_res = await db.execute(select(User).where(User.id == token_record.user_id))
    user = user_res.scalar_one()
    
    user.password_hash = hash_password(body.new_password)
    
    # Clean up token
    await db.delete(token_record)
    await db.commit()
    
    log.info(f"Password reset successful for user: {user.email}")
    return {"detail": "Password has been reset successfully."}


# ─── SSO Synchronization Router ───────────────────────────────────────────────
from pydantic import BaseModel
from fastapi import Request
from sync import sync_user_by_email

sso_router = APIRouter(prefix="/api/sso", tags=["SSO Sync"])

class SyncTenantRequest(BaseModel):
    tenantId: str
    tenantName: str

class SyncUserRequest(BaseModel):
    employeeId: str
    firstName: str
    lastName: str
    email: str
    role: str
    tenantId: str
    tenantName: str
    tenantCode: str
    workLocation: Optional[str] = None
    personalEmail: Optional[str] = None
    gender: Optional[str] = None
    dateOfBirth: Optional[str] = None
    aadharNo: Optional[str] = None
    panNo: Optional[str] = None
    presentAddress: Optional[str] = None
    permanentAddress: Optional[str] = None
    contactNo: Optional[str] = None
    bloodGroup: Optional[str] = None
    joiningDate: Optional[str] = None
    password: Optional[str] = None

def verify_sso_sync_request(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = auth_header.split(" ")[1]
    try:
        from auth import decode_token
        payload = decode_token(token)
        if payload.get("sub") != "system_sync":
            raise HTTPException(status_code=403, detail="Forbidden: Invalid sync subject")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {e}")

@sso_router.post("/sync-tenant")
async def sync_tenant_endpoint(
    body: SyncTenantRequest,
    db: AsyncSession = Depends(get_db),
    _ = Depends(verify_sso_sync_request)
):
    """Callback endpoint for Scaloz to push tenant onboarding/updates."""
    log.info(f"[SSO Webhook] Received sync request for tenant {body.tenantId} ({body.tenantName})")
    
    t_res = await db.execute(select(Tenant).where(Tenant.name == body.tenantId))
    tenant = t_res.scalar_one_or_none()
    if not tenant:
        tenant = Tenant(
            id=uuid.uuid4(),
            name=body.tenantId,
            settings={"company_name": body.tenantName}
        )
        db.add(tenant)
        log.info(f"[SSO Webhook] Created new Tenant {body.tenantId}")
    else:
        tenant.settings = dict(tenant.settings or {})
        tenant.settings["company_name"] = body.tenantName
        db.add(tenant)
        log.info(f"[SSO Webhook] Updated Tenant settings for {body.tenantId}")
        
    await db.commit()
    return {"status": "success"}

@sso_router.post("/sync-user")
async def sync_user_endpoint(
    body: SyncUserRequest,
    db: AsyncSession = Depends(get_db),
    _ = Depends(verify_sso_sync_request)
):
    """Callback endpoint for Scaloz to push user/membership onboarding/updates."""
    log.info(f"[SSO Webhook] Received sync request for user {body.email} in tenant {body.tenantCode}")
    success = await sync_user_by_email(db, body.email)
    if success:
        return {"status": "success"}
    else:
        raise HTTPException(status_code=400, detail="User synchronization failed")

