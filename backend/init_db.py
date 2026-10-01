"""
init_db.py — Run this once to create the IntelliHire database and all tables.

Usage:
    python init_db.py

It reads DATABASE_URL from the .env file in the same directory.
If the database doesn't exist yet, it connects to 'postgres' first to create it.
"""
import asyncio
import re
import os
import sys

# Ensure we load from the backend's own .env
from pathlib import Path
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path, override=True)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/intellihire",
)

# ── Parse DB URL ──────────────────────────────────────────────────────────────
# Extract components from  postgresql://user:pass@host:port/dbname
def parse_url(url: str):
    # Strip asyncpg prefix if present
    url = url.replace("postgresql+asyncpg://", "postgresql://").replace("postgres://", "postgresql://")
    m = re.match(
        r"postgresql://(?P<user>[^:@]+)(?::(?P<password>[^@]*))?@(?P<host>[^:/]+)(?::(?P<port>\d+))?/(?P<dbname>.+)",
        url,
    )
    if not m:
        raise ValueError(f"Cannot parse DATABASE_URL: {url}")
    return m.groupdict()


async def create_database_if_needed():
    """Connect to `postgres` system DB and CREATE DATABASE intellihire if missing."""
    import asyncpg

    parts = parse_url(DATABASE_URL)
    dbname = parts["dbname"]
    host   = parts["host"]
    port   = int(parts["port"] or 5432)
    user   = parts["user"]
    passwd = parts["password"] or ""

    print(f"Connecting to postgres@{host}:{port} as {user} ...")
    try:
        conn = await asyncpg.connect(
            host=host, port=port, user=user, password=passwd, database="postgres"
        )
    except Exception as e:
        print(f"\n❌  Could not connect to PostgreSQL: {e}")
        print("\nPlease ensure PostgreSQL is running and update backend/.env with correct credentials.")
        sys.exit(1)

    exists = await conn.fetchval(
        "SELECT 1 FROM pg_database WHERE datname = $1", dbname
    )
    if not exists:
        print(f"Creating database '{dbname}' ...")
        await conn.execute(f'CREATE DATABASE "{dbname}"')
        print(f"✅  Database '{dbname}' created.")
    else:
        print(f"✅  Database '{dbname}' already exists.")
    await conn.close()


async def create_tables():
    """Create all tables using SQLAlchemy ORM metadata."""
    from sqlalchemy.ext.asyncio import create_async_engine
    from models import Base

    async_url = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://").replace(
        "postgres://", "postgresql+asyncpg://"
    )

    print(f"\nConnecting to {async_url.split('@')[-1]} ...")
    engine = create_async_engine(async_url, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print("✅  All tables created (or already exist).")


async def main():
    print("=" * 55)
    print("  IntelliHire — Database Initialisation")
    print("=" * 55)
    await create_database_if_needed()
    await create_tables()
    print("\n🎉  Database ready!  You can now start the backend:")
    print("    uvicorn main:app --host 0.0.0.0 --port 8000 --reload")
    print("=" * 55)


if __name__ == "__main__":
    asyncio.run(main())
