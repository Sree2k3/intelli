import asyncio
import httpx

async def trigger():
    interview_id = "dec94306-accd-4482-957c-75942888d782"
    invite_token = "e8231ea7-1519-4810-b11e-249c3e70554a" # Latest interview from database
    
    url = "http://localhost:8000/api/functions/v1/score-answers"
    payload = {"interview_id": interview_id}
    headers = {"x-invite-token": invite_token}
    
    async with httpx.AsyncClient() as client:
        print(f"Triggering scoring for {interview_id}...")
        resp = await client.post(url, json=payload, headers=headers)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            print("Success!")
            print(resp.json())
        else:
            print(f"Error: {resp.text}")

if __name__ == "__main__":
    asyncio.run(trigger())
