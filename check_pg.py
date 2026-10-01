import asyncio
import asyncpg

async def main():
    conn = await asyncpg.connect('postgresql://postgres:rohan321@localhost:5432/intellihire')
    rows = await conn.fetch("SELECT id, candidate_email, video_url FROM interviews ORDER BY created_at DESC LIMIT 5")
    for r in rows:
        print(r)
    await conn.close()

asyncio.run(main())
