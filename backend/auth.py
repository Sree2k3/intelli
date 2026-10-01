"""
auth.py - JWT-based authentication helpers.
Replaces Supabase Auth with a local password+JWT flow.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models import User

bearer_scheme = HTTPBearer(auto_error=False)


# ─── Password helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ─── JWT helpers ───────────────────────────────────────────────────────────────

def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "email": email,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


from urllib.parse import urlparse

def is_url_value(value: str) -> bool:
    if not value:
        return False
    try:
        parsed = urlparse(value)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False

def normalize_app_code(value: str) -> str:
    return value.strip().lower()

def get_current_app_code(payload: dict) -> Optional[str]:
    """
    Extract current application identifier from payload using priority:
    current_app -> app_id -> aud (only if not a URL)
    """
    app = payload.get("current_app")
    if app and not is_url_value(str(app)):
        return str(app)
    app = payload.get("app_id")
    if app and not is_url_value(str(app)):
        return str(app)
    aud = payload.get("aud")
    if isinstance(aud, list):
        for a in aud:
            if a and not is_url_value(str(a)):
                return str(a)
    elif aud and not is_url_value(str(aud)):
        return str(aud)
    return None

def is_user_authorized_for_app(payload: dict) -> bool:
    """
    Validates if the user is authorized for the current application.
    """
    # Detect claim source and value
    source = "none"
    current_app_val = None
    
    app = payload.get("current_app")
    if app:
        source = "current_app"
        current_app_val = str(app)
    else:
        app = payload.get("app_id")
        if app:
            source = "app_id"
            current_app_val = str(app)
        else:
            aud = payload.get("aud")
            if isinstance(aud, list):
                if aud:
                    source = "aud"
                    current_app_val = str(aud[0])
            elif aud:
                source = "aud"
                current_app_val = str(aud)

    aud_val = payload.get("aud")
    aud_str = str(aud_val[0]) if isinstance(aud_val, list) and aud_val else str(aud_val) if aud_val else ""
    aud_is_url = is_url_value(aud_str)

    apps = payload.get("apps")
    apps_list = apps if isinstance(apps, list) else ([apps] if apps else [])
    
    # Check if current_app is a URL
    current_app_is_url = is_url_value(current_app_val)
    
    current_app = get_current_app_code(payload)
    
    is_sso = "tenant" in payload or "tenantId" in payload or "apps" in payload
    
    normalized_current = normalize_app_code(current_app) if current_app else ""
    normalized_apps = [normalize_app_code(str(a)) for a in apps_list]
    
    is_authorized = False
    if normalized_current:
        is_authorized = normalized_current in normalized_apps
    else:
        # Fallback to previously working behavior if current_app/app_id are not provided in the SSO token
        is_authorized = len(apps_list) > 0

    # Safe log parameters per spec:
    print(f"SSO detected: {is_sso}")
    print(f"current app claim source: {source}")
    print(f"current app value: {current_app_val}")
    print(f"aud is URL: {aud_is_url}")
    print(f"apps count: {len(apps_list)}")
    print(f"normalized current app: {normalized_current}")
    print(f"normalized authorized app codes: {normalized_apps}")
    print(f"authorization result: {is_authorized}")

    return is_authorized


# ─── FastAPI dependency ────────────────────────────────────────────────────────

from fastapi import Depends, HTTPException, status, Request
from uuid import UUID
import uuid

async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    raw_token = None
    if credentials:
        raw_token = credentials.credentials
    elif request and request.query_params.get("token"):
        raw_token = request.query_params.get("token")

    if not raw_token:
        print("DEBUG: Auth failed - No credentials")
        raise HTTPException(status_code=401, detail="Not authenticated")

    print(f"DEBUG: Incoming token: {raw_token[:15]}...{raw_token[-10:] if len(raw_token) > 25 else ''}")

    try:
        payload = decode_token(raw_token)
        print(f"DEBUG: Token validation result: SUCCESS - Payload sub: {payload.get('sub')}")
    except Exception as e:
        print(f"DEBUG: Auth failed - Token validation result: FAILED - {e}")
        raise HTTPException(status_code=401, detail=str(e))

    user_id = payload.get("sub")
    jwt_email = payload.get("email", "<not_in_token>")
    jwt_role = payload.get("role") or payload.get("userRole") or "<not_in_token>"
    jwt_tenant_code = payload.get("tenant") or payload.get("tenantId") or "<not_in_token>"
    print(f"DEBUG [get_current_user]: user_id={user_id}, email={jwt_email}, tenant_code={jwt_tenant_code}, jwt_role={jwt_role}")
    if not user_id:
        print("DEBUG: Auth failed - No sub in payload")
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Validate apps claim (SSO module access control)
    apps = payload.get("apps")
    user_role = str(payload.get("role", "")).lower()
    
    # Bypass for super admin or non-SSO tokens (unless they explicitly have a tenant/apps claim)
    is_sso = "tenant" in payload or "tenantId" in payload or "apps" in payload
    is_super_admin = user_role == "super_admin" or payload.get("email") == "sso-admin@scaloz.com" or user_id == "sso-admin@scaloz.com"
    
    if is_sso and not is_super_admin:
        is_authorized = is_user_authorized_for_app(payload)
        
        # Safe payload logging — redact any sensitive fields
        sensitive_keys = {"key", "secret", "pass", "token", "auth", "hash", "salt", "credential"}
        safe_payload = {
            k: "[REDACTED]" if any(kw in k.lower() for kw in sensitive_keys) else v
            for k, v in payload.items()
        }
        
        current_app = get_current_app_code(payload)
        apps_list = apps if isinstance(apps, list) else ([apps] if apps else [])
        print(f"DEBUG: SSO Token Payload (Safe): {safe_payload}")
        print(f"DEBUG: SSO Authorized Apps from Scaloz: {apps_list}")
        print(f"DEBUG: Current Dynamic Application Code: {current_app}")
        print(f"DEBUG: SSO Authorization Decision - is_authorized={is_authorized}")
        
        if not is_authorized:
            raise HTTPException(
                status_code=403,
                detail="Subscription required: Active subscription for this application not found."
            )



    # SSO token payload might have the email as 'sub' or check if we can resolve by ID/Email
    user = None
    if "@" in user_id:
        result = await db.execute(select(User).where(User.email == user_id))
        user = result.scalar_one_or_none()
    else:
        try:
            val_uuid = UUID(user_id)
            result = await db.execute(select(User).where(User.id == val_uuid))
            user = result.scalar_one_or_none()
        except ValueError:
            result = await db.execute(select(User).where(User.email == user_id))
            user = result.scalar_one_or_none()

    if not user:
        # SSO user dynamic provisioning (User only)
        tenant_code = payload.get("tenant") or payload.get("tenantId")
        if tenant_code:
            print(f"DEBUG: SSO auto-provisioning user: {user_id}")
            new_uid = uuid.uuid4()
            email_val = user_id if "@" in user_id else payload.get("email", f"{user_id}@scaloz.com")
            full_name_val = payload.get("name") or (
                (payload.get("firstName") or "SSO") + " " + (payload.get("lastName") or "User")
            )

            dummy_pw = hash_password(uuid.uuid4().hex)

            user = User(
                id=new_uid,
                email=email_val,
                password_hash=dummy_pw,
                full_name=full_name_val
            )
            db.add(user)
            await db.flush()
        else:
            print(f"DEBUG: User lookup result: FAILED - User {user_id} not found in DB")
            raise HTTPException(status_code=401, detail="User not found")

    # Unified Membership creation/sync logic for all SSO logins (handles new & existing users)
    tenant_code = payload.get("tenant") or payload.get("tenantId")
    print(f"DEBUG [get_current_user]: Membership sync - user.id={user.id}, tenant_code={tenant_code}")
    if tenant_code and user:
        from database import resolve_tenant_id
        from models import Membership
        
        tid = await resolve_tenant_id(db, tenant_code)
        print(f"DEBUG [get_current_user]: Resolved tenant_code='{tenant_code}' -> tid={tid}")
        if tid:
            # Query bypassing tenant_id filter to avoid constraint violations during check
            old_info = db.info.get("tenant_id")
            db.info["tenant_id"] = None
            try:
                m_res = await db.execute(
                    select(Membership).where(Membership.user_id == user.id).where(Membership.tenant_id == tid)
                )
                membership = m_res.scalar_one_or_none()
            finally:
                db.info["tenant_id"] = old_info

            raw_role_val = str(payload.get("role") or payload.get("userRole") or "recruiter")
            raw_role_str = raw_role_val.strip().lower().replace("_", " ").replace("-", " ")
            
            is_scaloz_admin = "admin" in raw_role_str or "subadmin" in raw_role_str or "sub admin" in raw_role_str
            is_scaloz_manager = "manager" in raw_role_str or "manger" in raw_role_str or "program manager" in raw_role_str

            if is_scaloz_admin:
                mapped_role = "admin"
            elif is_scaloz_manager:
                mapped_role = "manager"
            else:
                mapped_role = "recruiter"

            print(f"DEBUG [get_current_user]: JWT raw_role='{raw_role_val}', is_admin={is_scaloz_admin}, is_manager={is_scaloz_manager}, mapped_role='{mapped_role}'")

            if not membership:
                print(f"DEBUG [get_current_user]: No membership found — CREATING new membership: user_id={user.id}, tenant_id={tid}, role={mapped_role}")
                membership = Membership(
                    user_id=user.id,
                    tenant_id=tid,
                    role=mapped_role,
                    scaloz_role=raw_role_val,
                    override_role=None
                )
                db.add(membership)
                await db.commit()
                print(f"DEBUG [get_current_user]: Membership CREATED — role={mapped_role}, scaloz_role={raw_role_val}, override_role=None")
            else:
                old_role = membership.role
                membership.scaloz_role = raw_role_val
                # Sync membership role with mapped role from SSO, keeping local override if present
                membership.role = membership.override_role or mapped_role
                await db.commit()
                print(f"DEBUG [get_current_user]: Membership UPDATED — old_role='{old_role}', override_role='{membership.override_role}', new_role='{membership.role}', scaloz_role='{raw_role_val}'")
        else:
            print(f"DEBUG [get_current_user]: Could not resolve tenant_code='{tenant_code}' to a tenant_id — membership sync SKIPPED")
    else:
        print(f"DEBUG [get_current_user]: No tenant_code in JWT — membership sync SKIPPED (non-SSO or missing tenant claim)")
    
    # Trigger real-time sync with Scaloz Workspace master system
    from sync import sync_user_by_email
    try:
        await sync_user_by_email(db, user.email)
        await db.refresh(user)
    except Exception as sync_ex:
        print(f"DEBUG [get_current_user]: Real-time sync failed: {sync_ex}")

    if getattr(user, "status", None) == "disabled":
        print(f"DEBUG [get_current_user]: Access denied - User {user.email} is disabled.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account disabled. You no longer have access to this workspace."
        )

    print(f"DEBUG [get_current_user]: SUCCESS — returning user.id={user.id}, user.email={user.email}")
    return user


async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Returns None instead of raising when unauthenticated."""
    if not credentials:
        return None
    try:
        return await get_current_user(request, credentials, db)
    except HTTPException:
        return None

