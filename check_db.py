from sqlalchemy import select, create_engine
from sqlalchemy.orm import sessionmaker
import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'backend'))
from database import engine, get_db
import asyncio

async def test():
    async for db in get_db():
        from models import Interview
        query = select(Interview).order_by(Interview.created_at.desc()).limit(3)
        res = await db.execute(query)
        rows = res.scalars().all()
        for r in rows:
            print(f"Interview {r.id}: video_url={r.video_url}")
        break

asyncio.run(test())
