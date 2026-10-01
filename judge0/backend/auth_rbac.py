from enum import Enum
from typing import List, Optional, Set
from uuid import UUID
from fastapi import HTTPException, status, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from models import User, Membership, Tenant
from database import get_db
from auth import get_current_user, get_optional_user

class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN       = "admin"
    MANAGER     = "manager"
    RECRUITER   = "recruiter"

class Permission(str, Enum):
    CREATE_TENANT          = "create_tenant"
    ADD_ADMIN              = "add_admin"
    ADD_STAFF              = "add_staff" # manager/recruiter
    CREATE_INTERVIEW       = "create_interview"
    VIEW_TENANT_INTERVIEWS = "view_tenant_interviews"
    VIEW_OWN_INTERVIEWS    = "view_own_interviews"
    VIEW_REPORTS           = "view_reports"
    MANAGE_TENANT_SETTINGS = "manage_tenant_settings"

# Permissions mapping exactly per matrix
ROLE_PERMISSIONS = {
    Role.SUPER_ADMIN: {
        Permission.CREATE_TENANT,
        Permission.ADD_ADMIN,
        Permission.MANAGE_TENANT_SETTINGS,
    },
    Role.ADMIN: {
        Permission.ADD_ADMIN,
        Permission.ADD_STAFF,
        Permission.CREATE_INTERVIEW,
        Permission.VIEW_TENANT_INTERVIEWS,
        Permission.VIEW_OWN_INTERVIEWS,
        Permission.VIEW_REPORTS,
        Permission.MANAGE_TENANT_SETTINGS,
    },
    Role.MANAGER: {
        Permission.ADD_STAFF,
        Permission.CREATE_INTERVIEW,
        Permission.VIEW_TENANT_INTERVIEWS,
        Permission.VIEW_OWN_INTERVIEWS,
        Permission.VIEW_REPORTS,
    },
    Role.RECRUITER: {
        Permission.CREATE_INTERVIEW,
        Permission.VIEW_OWN_INTERVIEWS,
        Permission.VIEW_REPORTS,
    }
}

class UserContext:
    """Helper to carry user, their primary tenant, and role."""
    def __init__(self, user: User, tenant_id: Optional[UUID], role: Optional[str], manager_id: Optional[UUID] = None):
        self.user = user
        self.tenant_id = tenant_id
        self.role = role
        self.manager_id = manager_id

    def has_permission(self, permission: Permission) -> bool:
        if getattr(self.user, "email", None) == "sso-admin@scaloz.com" or self.role == Role.SUPER_ADMIN or self.role == "super_admin":
            return True
        if not self.role:
            return False
        try:
            role_enum = self.role if isinstance(self.role, Role) else Role(self.role)
            return permission in ROLE_PERMISSIONS.get(role_enum, set())
        except ValueError:
            return False

async def get_user_context(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> UserContext:
    """Dependency to get user with their membership info.
    """
    from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
    bearer = HTTPBearer(auto_error=False)
    credentials = await bearer(request)
    user = await get_current_user(request, credentials, db)

    # Standard auth succeeded — load memberships
    if getattr(user, "email", None) == "sso-admin@scaloz.com":
        return UserContext(user, getattr(user, "tenant_id", None), Role.SUPER_ADMIN)

    session_tenant_id = db.info.get("tenant_id")

    # Always bypass the ORM tenant filter when loading the authenticated user's memberships.
    # The user is already verified via JWT — row-level tenant security does NOT apply here.
    # Without this bypass, a mismatch between session_tenant_id and the membership's tenant_id
    # (common on first SSO login) returns zero memberships → context.role=None → 403 errors.
    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        result = await db.execute(
            select(Membership).where(Membership.user_id == user.id).options(selectinload(Membership.tenant))
        )
        memberships = result.scalars().all()
    finally:
        db.info["tenant_id"] = _old_tenant

    if not memberships:
        # Fallback: decode the JWT directly to extract role and tenant.
        # This handles the case where the membership hasn't been created yet
        # (race condition on first SSO login) or DB sync hasn't completed.
        try:
            from auth import decode_token as _decode
            from fastapi.security import HTTPBearer as _Bearer
            _creds = await _Bearer(auto_error=False)(request)
            if _creds:
                _payload = _decode(_creds.credentials)
                _raw_role = str(_payload.get("role") or _payload.get("userRole") or "").strip().lower().replace("_", " ").replace("-", " ")
                if "admin" in _raw_role or "subadmin" in _raw_role:
                    _jwt_role = "admin"
                elif "manager" in _raw_role:
                    _jwt_role = "manager"
                elif _raw_role:
                    _jwt_role = "recruiter"
                else:
                    _jwt_role = None

                _tenant_claim = _payload.get("tenant") or _payload.get("tenantId") or _payload.get("tenant_id")
                _jwt_tenant_id = None
                if _tenant_claim:
                    from database import resolve_tenant_id as _resolve
                    _jwt_tenant_id = await _resolve(db, str(_tenant_claim))

                if _jwt_role:
                    print(f"DEBUG [get_user_context]: No DB membership found — using JWT fallback role='{_jwt_role}' for {user.email}")
                    return UserContext(user, _jwt_tenant_id, _jwt_role)
        except Exception as _e:
            print(f"DEBUG [get_user_context]: JWT fallback failed: {_e}")

        print(f"DEBUG [get_user_context]: No membership and no JWT role for {user.email} — role=None")
        return UserContext(user, None, None)

    # If multiple memberships, prefer the one matching the session tenant
    primary = memberships[0]
    if len(memberships) > 1 and session_tenant_id:
        try:
            from uuid import UUID as _UUID
            _stid = _UUID(str(session_tenant_id))
            matched = [m for m in memberships if m.tenant_id == _stid]
            if matched:
                primary = matched[0]
        except (ValueError, AttributeError):
            pass

    return UserContext(user, primary.tenant_id, primary.role, primary.manager_id)


async def get_optional_user_context(
    request: Request,
    user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db)
) -> Optional[UserContext]:
    """Dependency to get user context if they are logged in, otherwise return None."""
    if not user:
        return None
        
    if getattr(user, "email", None) == "sso-admin@scaloz.com":
        return UserContext(user, getattr(user, "tenant_id", None), Role.SUPER_ADMIN)

    session_tenant_id = db.info.get("tenant_id")
    
    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        result = await db.execute(
            select(Membership).where(Membership.user_id == user.id).options(selectinload(Membership.tenant))
        )
        memberships = result.scalars().all()
    finally:
        db.info["tenant_id"] = _old_tenant

    if not memberships:
        # Fallback: decode the JWT directly to extract role and tenant.
        try:
            from auth import decode_token as _decode
            from fastapi.security import HTTPBearer as _Bearer
            _creds = await _Bearer(auto_error=False)(request)
            if _creds:
                _payload = _decode(_creds.credentials)
                _raw_role = str(_payload.get("role") or _payload.get("userRole") or "").strip().lower().replace("_", " ").replace("-", " ")
                if "admin" in _raw_role or "subadmin" in _raw_role:
                    _jwt_role = "admin"
                elif "manager" in _raw_role:
                    _jwt_role = "manager"
                elif _raw_role:
                    _jwt_role = "recruiter"
                else:
                    _jwt_role = None

                _tenant_claim = _payload.get("tenant") or _payload.get("tenantId") or _payload.get("tenant_id")
                _jwt_tenant_id = None
                if _tenant_claim:
                    from database import resolve_tenant_id as _resolve
                    _jwt_tenant_id = await _resolve(db, str(_tenant_claim))

                if _jwt_role:
                    return UserContext(user, _jwt_tenant_id, _jwt_role)
        except Exception as _e:
            pass

        return UserContext(user, None, None)
    
    primary = memberships[0]
    if len(memberships) > 1 and session_tenant_id:
        try:
            from uuid import UUID as _UUID
            _stid = _UUID(str(session_tenant_id))
            matched = [m for m in memberships if m.tenant_id == _stid]
            if matched:
                primary = matched[0]
        except (ValueError, AttributeError):
            pass

    return UserContext(user, primary.tenant_id, primary.role, primary.manager_id)


def require_permission(permission: Permission):
    """Decorator-like dependency to enforce permissions."""
    def decorator(context: UserContext = Depends(get_user_context)):
        if context.role == Role.SUPER_ADMIN or context.role == "super_admin":
            return context
        if not context.has_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission.value}"
            )
        return context
    return decorator

def require_role(roles: List[Role]):
    """Enforce specific roles."""
    def decorator(context: UserContext = Depends(get_user_context)):
        if context.role == Role.SUPER_ADMIN or context.role == "super_admin":
            return context
        if context.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Action requires one of roles: {[r.value for r in roles]}"
            )
        return context
    return decorator
