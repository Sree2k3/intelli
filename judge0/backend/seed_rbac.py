import asyncio
import uuid
from sqlalchemy import text
from database import engine, AsyncSessionLocal
from models import Base, User, Tenant, Membership
from auth import hash_password

async def seed():
    print("Resetting database (CASCADE)...")
    async with engine.begin() as conn:
        # Drop everything in the public schema and recreate it
        await conn.execute(text("DROP SCHEMA public CASCADE;"))
        await conn.execute(text("CREATE SCHEMA public;"))
        await conn.execute(text("GRANT ALL ON SCHEMA public TO public;"))
        print("Creating all tables...")
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        print("Seeding super admin...")
        # 1. Create System Tenant
        # This acts as the global administrative tenant
        system_tenant = Tenant(
            id=uuid.uuid4(),
            name="Xevyte System",
            settings={"plan": "enterprise"}
        )
        db.add(system_tenant)
        await db.flush()

        # 2. Create Super Admin User
        admin_email = "admin@gmail.com"
        admin_pass = "Admin@123"
        user = User(
            id=uuid.uuid4(),
            email=admin_email,
            password_hash=hash_password(admin_pass),
            full_name="System Admin"
        )
        db.add(user)
        await db.flush()

        # 3. Create Membership
        # Roles: super_admin, admin, manager, recruiter
        membership = Membership(
            user_id=user.id,
            tenant_id=system_tenant.id,
            role="super_admin"
        )
        db.add(membership)
        
        await db.commit()
        print(f"\n" + "="*50)
        print(f"RBAC SYSTEM INITIALIZED SUCCESSFULY")
        print(f"="*50)
        print(f"Super Admin Email: {admin_email}")
        print(f"Super Admin Pass:  {admin_pass}")
        print(f"Tenant Name:       {system_tenant.name}")
        print(f"="*50 + "\n")

if __name__ == "__main__":
    asyncio.run(seed())
