#!/usr/bin/env python3
"""
migrate_s3_upload_id.py - Standalone async migration script to add s3_upload_id column to interviews table.

This script adds the missing s3_upload_id column to the interviews table in PostgreSQL.
The column is nullable to support existing records and matches the SQLAlchemy model definition.
"""

import asyncio
import sys
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from config import settings


async def migrate_s3_upload_id():
    """Add s3_upload_id column to interviews table if it doesn't exist."""
    
    # Convert sync URL to async (same logic as database.py)
    database_url = settings.DATABASE_URL.replace(
        "postgresql://", "postgresql+asyncpg://"
    ).replace(
        "postgres://", "postgresql+asyncpg://"
    )
    
    # Create async engine
    engine = create_async_engine(
        database_url,
        echo=False,
        pool_pre_ping=True,
        connect_args={"server_settings": {"jit": "off"}}
    )
    
    try:
        # Connect to database
        async with engine.begin() as conn:
            print("Connected to PostgreSQL database...")
            
            # Check if column already exists
            result = await conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'interviews' 
                AND column_name = 's3_upload_id'
            """))
            
            column_exists = result.fetchone() is not None
            
            if column_exists:
                print("s3_upload_id column already exists in interviews table. Migration not needed.")
                return
            
            print("Adding s3_upload_id column to interviews table...")
            
            # Add the column (nullable to match model definition)
            await conn.execute(text("""
                ALTER TABLE interviews 
                ADD COLUMN s3_upload_id TEXT NULL
            """))
            
            print("Successfully added s3_upload_id column to interviews table!")
            
    except Exception as e:
        print(f"Migration failed: {e}")
        sys.exit(1)
    
    finally:
        await engine.dispose()


if __name__ == "__main__":
    print("Starting s3_upload_id migration...")
    asyncio.run(migrate_s3_upload_id())
    print("Migration completed!")
