import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import update
from database import AsyncSessionLocal
from models import Tenant

async def update_limit():
    async with AsyncSessionLocal() as session:
        await session.execute(update(Tenant).values(interview_limit=99999999))
        await session.commit()
    print('Updated existing tenant limits to 99999999 (infinite)')

asyncio.run(update_limit())
