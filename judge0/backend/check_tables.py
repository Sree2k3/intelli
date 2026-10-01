import asyncio
from database import engine
from sqlalchemy import text

async def check():
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'"))
        tables = [r[0] for r in res.fetchall()]
        print(f"Tables found: {tables}")
        if 'password_reset_tokens' in tables:
            print("✅ password_reset_tokens table exists")
        else:
            print("❌ password_reset_tokens table is MISSING")

if __name__ == "__main__":
    asyncio.run(check())
