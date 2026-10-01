import asyncio
import uuid
import asyncpg
from typing import Optional
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from logging_config import logger as log

from config import settings
from models import User, Membership, Tenant
from auth import hash_password

def get_scaloz_dsn() -> str:
    dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://").replace("postgres://", "postgresql://")
    if "/" in dsn:
        parts = dsn.rsplit("/", 1)
        db_part = parts[1]
        if "?" in db_part:
            db_name_parts = db_part.split("?", 1)
            scaloz_db_part = "scaloz_super_admin?" + db_name_parts[1]
        else:
            scaloz_db_part = "scaloz_super_admin"
        return parts[0] + "/" + scaloz_db_part
    return dsn

def map_scaloz_role(role_val: Optional[str], is_sub_admin: bool) -> str:
    if is_sub_admin:
        return "admin"
    raw_role = (role_val or "").strip().lower().replace("_", " ").replace("-", " ")
    if "admin" in raw_role or "subadmin" in raw_role or "sub admin" in raw_role:
        return "admin"
    elif "manager" in raw_role or "manger" in raw_role or "program manager" in raw_role:
        return "manager"
    elif "recruiter" in raw_role:
        return "recruiter"
    else:
        return "recruiter" # Default safe fallback per specification

async def sync_user_by_email(db: AsyncSession, email: str) -> bool:
    """
    Synchronizes a specific user's status, role, tenant, and membership from the
    Scaloz master database. Disables the local user if they are deleted, disabled,
    or lack product access in Scaloz.
    """
    if not email:
        return False
        
    old_info = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        dsn = get_scaloz_dsn()
        conn = None
        try:
            conn = await asyncpg.connect(dsn)
            query = """
                SELECT u.id AS scaloz_id, u.email, u.first_name, u.last_name, u.role, 
                       u.is_sub_admin, u.status, u.assigned_products, t.tenant_code, t.tenant_name
                FROM tenant_users u
                JOIN tenants t ON u.tenant_id = t.id
                WHERE LOWER(u.email) = LOWER($1) LIMIT 1;
            """
            row = await conn.fetchrow(query, email.strip())
        except Exception as e:
            log.error(f"[SSO Sync] Failed to query Scaloz database: {e}")
            return False
        finally:
            if conn:
                await conn.close()

        # 1. User not found in Scaloz
        if not row:
            # Check if they exist locally
            res = await db.execute(select(User).where(User.email == email.strip()))
            local_user = res.scalar_one_or_none()
            if local_user:
                if local_user.status != "disabled":
                    local_user.status = "disabled"
                    await db.commit()
                    log.info(f"[SSO Sync] User {email} not found in Scaloz (deleted). Disabling local account.")
            return True

        scaloz_id = str(row['scaloz_id'])
        scaloz_email = row['email'].strip()
        first_name = row['first_name'] or ""
        last_name = row['last_name'] or ""
        full_name = f"{first_name} {last_name}".strip() or "Scaloz User"
        scaloz_role = row['role']
        is_sub_admin = bool(row['is_sub_admin'])
        scaloz_status = row['status']
        assigned_products = row['assigned_products'] or ""
        tenant_code = row['tenant_code']
        tenant_name = row['tenant_name']

        is_active = (scaloz_status == "Active")
        has_ai_access = ("AI_INTERVIEW" in assigned_products) or ("INTERVIEW" in assigned_products) or (scaloz_role == "Admin") or is_sub_admin

        # 2. User disabled or revoked access in Scaloz
        if not is_active or not has_ai_access:
            u_res = await db.execute(select(User).where(User.email == scaloz_email))
            local_user = u_res.scalar_one_or_none()
            if local_user and local_user.status != "disabled":
                local_user.status = "disabled"
                await db.commit()
                log.info(f"[SSO Sync] User {scaloz_email} is disabled or lacks AI_INTERVIEW access in Scaloz. Disabling local account.")
            return True

        # 3. User is active and has access -> Sync Tenant, User, and Membership
        # 3a. Resolve/Create Tenant
        t_res = await db.execute(select(Tenant).where(Tenant.name == tenant_code))
        tenant = t_res.scalar_one_or_none()
        if not tenant:
            tenant = Tenant(
                id=uuid.uuid4(),
                name=tenant_code,
                settings={"company_name": tenant_name}
            )
            db.add(tenant)
            await db.flush()
            log.info(f"[SSO Sync] Created missing local Tenant {tenant_code} ({tenant_name})")

        # 3b. Resolve/Create/Update User
        u_res = await db.execute(select(User).where(User.email == scaloz_email))
        local_user = u_res.scalar_one_or_none()
        if not local_user:
            local_user = User(
                id=uuid.uuid4(),
                email=scaloz_email,
                password_hash=hash_password(uuid.uuid4().hex),
                full_name=full_name,
                status="active",
                scaloz_user_id=scaloz_id
            )
            db.add(local_user)
            await db.flush()
            log.info(f"[SSO Sync] Dynamic provisioned new User {scaloz_email} from Scaloz.")
        else:
            # Update existing user info
            local_user.full_name = full_name
            local_user.status = "active"
            local_user.scaloz_user_id = scaloz_id
            db.add(local_user)

        # 3c. Map Role and Resolve/Update Membership
        mapped_role = map_scaloz_role(scaloz_role, is_sub_admin)
        m_res = await db.execute(
            select(Membership)
            .where(and_(Membership.user_id == local_user.id, Membership.tenant_id == tenant.id))
        )
        membership = m_res.scalar_one_or_none()
        if not membership:
            membership = Membership(
                id=uuid.uuid4(),
                user_id=local_user.id,
                tenant_id=tenant.id,
                role=mapped_role,
                scaloz_role=scaloz_role,
                override_role=None
            )
            db.add(membership)
            log.info(f"[SSO Sync] Created Membership for {scaloz_email} in {tenant_code} with role {mapped_role}.")
        else:
            # Check if role changed in Scaloz
            role_changed_in_scaloz = (membership.scaloz_role != scaloz_role)
            no_override_but_out_of_sync = (not membership.override_role and membership.role != mapped_role)
            
            if role_changed_in_scaloz:
                log.info(f"[SSO Sync] Role changed in Scaloz for {scaloz_email} from {membership.scaloz_role} to {scaloz_role}. Updating local role to {mapped_role} and clearing override.")
                membership.scaloz_role = scaloz_role
                membership.role = mapped_role
                membership.override_role = None
                db.add(membership)
            elif no_override_but_out_of_sync:
                log.info(f"[SSO Sync] Role out of sync for {scaloz_email} (no local override). Updating local role to {mapped_role}.")
                membership.role = mapped_role
                db.add(membership)

        await db.commit()
        return True
    finally:
        db.info["tenant_id"] = old_info

async def sync_all_users_from_scaloz(db: AsyncSession):
    """
    Background worker task to reconcile all users, roles, memberships, and status
    with the Scaloz master database.
    """
    old_info = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        dsn = get_scaloz_dsn()
        conn = None
        try:
            conn = await asyncpg.connect(dsn)
            query = """
                SELECT u.id AS scaloz_id, u.email, u.first_name, u.last_name, u.role, 
                       u.is_sub_admin, u.status, u.assigned_products, t.tenant_code, t.tenant_name
                FROM tenant_users u
                JOIN tenants t ON u.tenant_id = t.id;
            """
            rows = await conn.fetch(query)
        except Exception as e:
            log.error(f"[SSO Sync] Background scheduler failed to fetch from Scaloz: {e}")
            return
        finally:
            if conn:
                await conn.close()

        active_emails = set()
        for row in rows:
            scaloz_email = row['email'].strip()
            scaloz_status = row['status']
            assigned_products = row['assigned_products'] or ""
            scaloz_role = row['role']
            is_sub_admin = bool(row['is_sub_admin'])
            is_active = (scaloz_status == "Active")
            has_ai_access = ("AI_INTERVIEW" in assigned_products) or ("INTERVIEW" in assigned_products) or (scaloz_role == "Admin") or is_sub_admin

            if is_active and has_ai_access:
                active_emails.add(scaloz_email.lower())
                # Synchronize each active user
                try:
                    await sync_user_by_email(db, scaloz_email)
                except Exception as ex:
                    log.error(f"[SSO Sync] Error syncing user {scaloz_email}: {ex}")

        # Identify local users not active or deleted from Scaloz
        u_res = await db.execute(select(User).where(User.status != "disabled"))
        local_users = u_res.scalars().all()
        for user in local_users:
            if user.email.lower() not in active_emails:
                # Exclude platform super admin / sso-admin
                if user.email in ("sso-admin@scaloz.com", "admin1@gmail.com"):
                    continue
                log.info(f"[SSO Sync] Disabling local user {user.email} not present/active in Scaloz.")
                user.status = "disabled"
                db.add(user)

        await db.commit()
    finally:
        db.info["tenant_id"] = old_info
