
import asyncio
from database import engine
from sqlalchemy import text
from utils import generate_base62_short_code

async def main():
    async with engine.connect() as conn:
        try:
            await conn.execute(text('ALTER TABLE interviews ADD COLUMN short_code VARCHAR UNIQUE;'))
            await conn.commit()
            print('Added short_code column')
        except Exception as e:
            await conn.rollback()
            print('Column already exists')
            
        try:
            await conn.execute(text('CREATE UNIQUE INDEX idx_interviews_short_code ON interviews (short_code);'))
            await conn.commit()
            print('Added index')
        except Exception as e:
            await conn.rollback()
            print('Index already exists')

        # Backfill
        res = await conn.execute(text('SELECT id FROM interviews WHERE short_code IS NULL;'))
        rows = res.fetchall()
        print(f'Found {len(rows)} interviews to backfill.')
        for r in rows:
            code = generate_base62_short_code()
            await conn.execute(text('UPDATE interviews SET short_code = :code WHERE id = :id'), {'code': code, 'id': r[0]})
        await conn.commit()
        print('Backfill complete.')

asyncio.run(main())

