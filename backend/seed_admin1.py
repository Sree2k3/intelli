import asyncio
from database import AsyncSessionLocal
from sqlalchemy import select
from models import User, Membership, Tenant
from auth import hash_password

async def setup():
    async with AsyncSessionLocal() as db:
        # Get the first tenant
        t_res = await db.execute(select(Tenant).limit(1))
        t = t_res.scalar()
        if not t:
            print("No tenants found! Run seed_rbac.py first.")
            return

        # Check if user exists
        u_res = await db.execute(select(User).where(User.email == 'admin1@gmail.com'))
        u = u_res.scalar_one_or_none()
        
        if not u:
            u = User(
                email='admin1@gmail.com', 
                password_hash=hash_password('Admin@123'), 
                full_name='Default Admin'
            )
            db.add(u)
            await db.flush()
        
        # Check membership
        m_res = await db.execute(select(Membership).where(Membership.user_id == u.id, Membership.tenant_id == t.id))
        m = m_res.scalar_one_or_none()
        
        if not m:
            m = Membership(user_id=u.id, tenant_id=t.id, role='super_admin')
            db.add(m)
        else:
            m.role = 'super_admin'
            
        await db.commit()
        print(f"User admin1@gmail.com is now a SUPER ADMIN in tenant: {t.name}")

if __name__ == "__main__":
    asyncio.run(setup())
