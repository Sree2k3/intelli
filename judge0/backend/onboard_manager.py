"""
Helper script to onboard a new manager in local development.
Usage:
    python onboard_manager.py <email> <full_name> [tenant_code]

Example:
    python onboard_manager.py manager2@xevyte.com "Sarah Connor"
"""
import sys
import asyncio
import asyncpg
from database import AsyncSessionLocal
from sync import get_scaloz_dsn, sync_user_by_email

async def onboard_manager(email: str, full_name: str, tenant_code: str = "rohan"):
    clean_email = email.strip().lower()
    names = full_name.strip().split(" ", 1)
    first_name = names[0]
    last_name = names[1] if len(names) > 1 else ""

    scaloz_dsn = get_scaloz_dsn()
    conn = await asyncpg.connect(scaloz_dsn)
    try:
        # 1. Look up tenant in scaloz_super_admin
        t_row = await conn.fetchrow(
            "SELECT id, tenant_code FROM tenants WHERE LOWER(tenant_code) = LOWER($1) LIMIT 1",
            tenant_code
        )
        if not t_row:
            print(f"[!] Scaloz tenant '{tenant_code}' not found.")
            return

        tenant_id = t_row["id"]

        # 2. Check if user already exists in scaloz_super_admin
        u_row = await conn.fetchrow(
            "SELECT id FROM tenant_users WHERE LOWER(email) = LOWER($1) LIMIT 1",
            clean_email
        )
        if u_row:
            # Update role and assigned_products
            await conn.execute(
                """
                UPDATE tenant_users 
                SET role = 'Manager', status = 'Active', 
                    assigned_products = 'HRMS:Active,INTERVIEW:Active',
                    first_name = $2, last_name = $3, tenant_id = $4
                WHERE id = $1
                """,
                u_row["id"], first_name, last_name, tenant_id
            )
            print(f"[OK] Updated existing Scaloz user {clean_email} as Manager.")
        else:
            # Copy template row structure
            template = await conn.fetchrow("SELECT * FROM tenant_users WHERE role = 'Manager' LIMIT 1")
            template_dict = dict(template) if template else {}
            # Override specifics
            template_dict.pop("id", None)
            template_dict["email"] = clean_email
            template_dict["first_name"] = first_name
            template_dict["last_name"] = last_name
            template_dict["role"] = "Manager"
            template_dict["status"] = "Active"
            template_dict["assigned_products"] = "HRMS:Active,INTERVIEW:Active"
            template_dict["tenant_id"] = tenant_id
            template_dict["account_locked"] = False

            cols = list(template_dict.keys())
            placeholders = [f"${i+1}" for i in range(len(cols))]
            insert_sql = f"INSERT INTO tenant_users ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
            await conn.execute(insert_sql, *[template_dict[c] for c in cols])
            print(f"[OK] Created new Manager in Scaloz: {clean_email} ({full_name}).")
    finally:
        await conn.close()

    # 3. Synchronize user into IntelliHire
    async with AsyncSessionLocal() as db_session:
        success = await sync_user_by_email(db_session, clean_email)
        if success:
            print(f"[OK] Successfully synchronized {clean_email} into IntelliHire as Manager!")
        else:
            print(f"[!] Failed to synchronize {clean_email} into IntelliHire.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python onboard_manager.py <email> <full_name> [tenant_code]")
        sys.exit(1)
    
    email_arg = sys.argv[1]
    name_arg = sys.argv[2]
    code_arg = sys.argv[3] if len(sys.argv) > 3 else "rohan"
    asyncio.run(onboard_manager(email_arg, name_arg, code_arg))
