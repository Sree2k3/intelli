"""
database.py - SQLAlchemy async engine + session factory.
"""
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from config import settings

# Convert sync URL to async
# e.g. postgresql://... → postgresql+asyncpg://...
DATABASE_URL = settings.DATABASE_URL.replace(
    "postgresql://", "postgresql+asyncpg://"
).replace(
    "postgres://", "postgresql+asyncpg://"
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=50,
    max_overflow=100,
    connect_args={"server_settings": {"jit": "off"}} # Improves query latency for simple ORM queries
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


from fastapi import Request
from sqlalchemy import text, event
from sqlalchemy.orm import with_loader_criteria

import models

async def fetch_company_name_from_scaloz(tenant_code: str) -> Optional[str]:
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from config import settings
    
    if not tenant_code:
        return None

    try:
        async def _fetch():
            base_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://").replace("postgres://", "postgresql+asyncpg://")
            if "/" in base_url:
                parts = base_url.rsplit("/", 1)
                db_part = parts[1]
                if "?" in db_part:
                    db_name_parts = db_part.split("?", 1)
                    scaloz_db_part = "scaloz_super_admin?" + db_name_parts[1]
                else:
                    scaloz_db_part = "scaloz_super_admin"
                scaloz_url = parts[0] + "/" + scaloz_db_part
            else:
                return None

            temp_engine = create_async_engine(scaloz_url, echo=False, connect_args={"connect_timeout": 2})
            async_session = sessionmaker(temp_engine, class_=AsyncSession, expire_on_commit=False)
            try:
                async with async_session() as session:
                    from sqlalchemy import text
                    stmt = text("SELECT tenant_name FROM tenants WHERE tenant_code = :code LIMIT 1;")
                    res = await session.execute(stmt, {"code": tenant_code})
                    row = res.fetchone()
                    if row:
                        return row[0]
            finally:
                await temp_engine.dispose()
            return None

        return await asyncio.wait_for(_fetch(), timeout=2.0)
    except Exception as e:
        print(f"DEBUG: fetch_company_name_from_scaloz exception: {e}")
        return None

from uuid import UUID
from sqlalchemy import select, func, or_, cast, String
from urllib.parse import urlparse

async def resolve_tenant_id(session: AsyncSession, tenant_identifier: str) -> UUID:
    if not tenant_identifier:
        return UUID("00000000-0000-0000-0000-000000000000")
        
    clean_str = str(tenant_identifier).strip()
    if not clean_str:
        return UUID("00000000-0000-0000-0000-000000000000")

    from models import Tenant
    import uuid

    # 1. Check if the identifier is already a valid UUID that exists in the database
    is_uuid = False
    u_id = None
    try:
        if isinstance(tenant_identifier, UUID):
            u_id = tenant_identifier
            is_uuid = True
        else:
            u_id = UUID(clean_str)
            is_uuid = True
    except (ValueError, AttributeError):
        is_uuid = False

    if is_uuid and u_id:
        try:
            stmt = select(Tenant.id).where(Tenant.id == u_id)
            res = await session.execute(stmt)
            if res.scalar_one_or_none():
                return u_id
        except Exception as e:
            print(f"DEBUG: resolve_tenant_id UUID check exception: {e}")

    # 2. Case-insensitive lookup by Tenant.name or id as string
    tenant = None
    try:
        lower_ident = clean_str.lower()
        candidates = [
            lower_ident,
            lower_ident.replace("-", " "),
            lower_ident.replace(" ", "-"),
        ]
        for suffix in ("-dev", "_dev", "-local", "_local", "-local-dev", "_local_dev"):
            if lower_ident.endswith(suffix):
                stripped = lower_ident[:-len(suffix)]
                candidates.extend([stripped, stripped.replace("-", " "), stripped.replace(" ", "-")])

        seen_cand = set()
        uniq_candidates = []
        for c in candidates:
            if c and c not in seen_cand:
                seen_cand.add(c)
                uniq_candidates.append(c)

        conds = [func.lower(Tenant.name) == c for c in uniq_candidates]
        conds.append(cast(Tenant.id, String) == clean_str)
        stmt = select(Tenant).where(or_(*conds))
        result = await session.execute(stmt)
        tenant = result.scalar_one_or_none()

        # Check company_name in settings if not found by name
        if not tenant:
            all_tenants = (await session.execute(select(Tenant))).scalars().all()
            for t_cand in all_tenants:
                s = t_cand.settings or {}
                c_name = str(s.get("company_name", "")).strip().lower()
                if c_name and any(c_name == c or c_name.replace(" ", "-") == c or c_name.replace("-", " ") == c for c in uniq_candidates):
                    tenant = t_cand
                    break
    except Exception as e:
        print(f"DEBUG: resolve_tenant_id query exception: {e}")

    # If the tenant exists, sync settings if company_name is missing
    if tenant:
        try:
            settings_dict = dict(tenant.settings or {})
            existing_company_name = settings_dict.get("company_name")
            if not existing_company_name or existing_company_name == tenant.name:
                company_name = await fetch_company_name_from_scaloz(tenant.name)
                if company_name:
                    settings_dict["company_name"] = company_name
                    tenant.settings = settings_dict
                    session.add(tenant)
                    await session.commit()
            return tenant.id
        except Exception as e:
            print(f"DEBUG: Failed to update existing tenant settings: {e}")
            return tenant.id

    # 3. If identifier was a valid UUID and no local tenant matched, return that UUID as fallback
    if is_uuid and u_id:
        return u_id

    # 4. If slug does NOT exist, explicitly insert a new Tenant record safely
    try:
        new_id = uuid.uuid4()
        company_name = await fetch_company_name_from_scaloz(clean_str)
        settings_dict = {}
        if company_name:
            settings_dict["company_name"] = company_name
            
        new_tenant = Tenant(
            id=new_id,
            name=clean_str,
            settings=settings_dict,
            status="active",
            plan_type="basic",
            duration_days=30
        )
        session.add(new_tenant)
        await session.commit()
        return new_id
    except Exception as e:
        await session.rollback()
        # In case concurrent request already inserted it, retry query once
        try:
            stmt = select(Tenant).where(func.lower(Tenant.name) == clean_str.lower())
            res = await session.execute(stmt)
            t = res.scalar_one_or_none()
            if t:
                return t.id
        except Exception:
            pass
        print(f"ERROR: Failed to dynamically create tenant {clean_str}: {e}")
        return None

async def get_db(request: Request = None) -> AsyncSession:
    async with AsyncSessionLocal() as session:
        # If no request object (e.g. background task), yield unfiltered session
        if request is None:
            yield session
            return

        # Check bypass header for super-admins
        bypass_header = request.headers.get("X-Bypass-Tenant") == "true"
        if bypass_header:
            auth_header = request.headers.get("Authorization")
            is_super_admin = False
            if auth_header and auth_header.lower().startswith("bearer "):
                token = auth_header.split(" ", 1)[1]
                try:
                    from auth import decode_token
                    payload = decode_token(token)
                    role = str(payload.get("role", "")).lower()
                    sub = payload.get("sub")
                    if role == "super_admin" or sub == "sso-admin@scaloz.com":
                        is_super_admin = True
                except Exception:
                    pass
            if is_super_admin:
                yield session
                return
            else:
                print("WARNING: Unauthorized attempt to bypass tenant isolation with X-Bypass-Tenant header.")

        # Bypass tenant isolation for public candidate endpoints and global master catalogs
        if (
            request.headers.get("x-invite-token") or 
            "/by-token/" in request.url.path or 
            "/by-short-code/" in request.url.path or 
            "/i/" in request.url.path or 
            "/upload-video" in request.url.path or
            "/roles-master" in request.url.path or
            "/departments-master" in request.url.path
        ):
            yield session
            return

        # 1. Resolve tenant UUID from X-Tenant-ID header
        tenant_id = None
        tenant_header = request.headers.get("X-Tenant-ID")
        if tenant_header:
            resolved = await resolve_tenant_id(session, tenant_header)
            if resolved and str(resolved) != "00000000-0000-0000-0000-000000000000":
                tenant_id = str(resolved)

        # 2. Check Origin / Referer headers (for cross-domain frontend API calls)
        if not tenant_id:
            origin_val = request.headers.get("origin") or request.headers.get("referer") or ""
            if origin_val:
                try:
                    parsed_orig = urlparse(origin_val)
                    orig_host = (parsed_orig.netloc or "").split(":")[0]
                    orig_parts = orig_host.split(".")
                    cand_sub = None
                    if len(orig_parts) == 2 and orig_parts[1] == "localhost" and orig_parts[0] not in ("www", "localhost"):
                        cand_sub = orig_parts[0]
                    elif len(orig_parts) >= 3 and orig_parts[0] not in ("www", "aiinterview", "aiinterviewtest", "localhost", "127") and not orig_parts[0].isdigit():
                        cand_sub = orig_parts[0]
                    if cand_sub:
                        resolved = await resolve_tenant_id(session, cand_sub)
                        if resolved and str(resolved) != "00000000-0000-0000-0000-000000000000":
                            tenant_id = str(resolved)
                except Exception as e:
                    print(f"DEBUG: origin parsing failed: {e}")

        # 3. Check Host header
        if not tenant_id:
            host = request.headers.get("host", "").split(":")[0]
            parts = host.split('.')
            cand_sub = None
            if len(parts) == 2 and parts[1] == "localhost" and parts[0] not in ("www", "localhost"):
                cand_sub = parts[0]
            elif len(parts) >= 3 and parts[0] not in ("www", "aiinterview", "aiinterviewtest", "localhost", "127") and not parts[0].isdigit():
                cand_sub = parts[0]
            if cand_sub:
                resolved = await resolve_tenant_id(session, cand_sub)
                if resolved and str(resolved) != "00000000-0000-0000-0000-000000000000":
                    tenant_id = str(resolved)

        # 4. Fallback: check JWT Bearer token claim or user's membership in DB
        if not tenant_id:
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.lower().startswith("bearer "):
                token = auth_header.split(" ", 1)[1]
                try:
                    from auth import decode_token
                    payload = decode_token(token)
                    token_tenant = payload.get("tenant") or payload.get("tenantId") or payload.get("tenant_id")
                    if token_tenant:
                        resolved = await resolve_tenant_id(session, str(token_tenant))
                        if resolved and str(resolved) != "00000000-0000-0000-0000-000000000000":
                            tenant_id = str(resolved)

                    if not tenant_id:
                        user_sub = payload.get("sub") or payload.get("email")
                        if user_sub:
                            from models import User, Membership
                            u_stmt = select(User.id).where(or_(User.email == str(user_sub), cast(User.id, String) == str(user_sub)))
                            u_res = await session.execute(u_stmt)
                            found_uid = u_res.scalar_one_or_none()
                            if found_uid:
                                m_stmt = select(Membership.tenant_id).where(Membership.user_id == found_uid)
                                m_res = await session.execute(m_stmt)
                                found_tid = m_res.scalars().first()
                                if found_tid:
                                    tenant_id = str(found_tid)
                except Exception as e:
                    print(f"DEBUG: JWT tenant fallback exception: {e}")

        # 5. Attach to session info
        if tenant_id:
            session.info["tenant_id"] = tenant_id
        else:
            # If no tenant can be resolved and it's not bypassed, enforce a dummy UUID to prevent cross-tenant data leaks
            session.info["tenant_id"] = "00000000-0000-0000-0000-000000000000"

        yield session

@event.listens_for(Session, "do_orm_execute")
def _add_tenant_filter(execute_state):
    tenant_id = execute_state.session.info.get("tenant_id")
    if tenant_id:
        def _filter(cls):
            if not hasattr(cls, "tenant_id"):
                return True
            if cls in (models.RoleMaster, models.DepartmentMaster):
                return or_(cls.tenant_id == tenant_id, cls.tenant_id.is_(None))
            return cls.tenant_id == tenant_id

        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                models.Base,
                _filter,
                include_aliases=True,
                track_closure_variables=False
            )
        )
