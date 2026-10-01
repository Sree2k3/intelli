import asyncio
from sqlalchemy import select
from database import get_db
from models import User, Interview, InterviewSession, InterviewCandidate, Membership

async def check():
    async for db in get_db():
        # Users
        res_u = await db.execute(select(User))
        users = res_u.scalars().all()
        print('--- USERS (Employees/Admins/Recruiters/Managers) ---')
        for u in users:
            print(f'User ID: {u.id}, Email: {u.email}, Name: {u.full_name}')
        
        # Memberships
        res_m = await db.execute(select(Membership))
        mems = res_m.scalars().all()
        print('\n--- MEMBERSHIPS ---')
        for m in mems:
            print(f'Member ID: {m.id}, User ID: {m.user_id}, Role: {m.role}')

        # Single Interviews
        res_i = await db.execute(select(Interview))
        interviews = res_i.scalars().all()
        print('\n--- INTERVIEWS ---')
        for i in interviews:
            print(f'Interview ID: {i.id}, Candidate Name: "{i.candidate_name}", Email: {i.candidate_email}, Role: {i.job_role}, is_multi: {i.is_multi_candidate}, recruiter_id: {i.recruiter_id}')
        
        # Candidates
        res_c = await db.execute(select(InterviewCandidate))
        cands = res_c.scalars().all()
        print('\n--- INTERVIEW CANDIDATES ---')
        for c in cands:
            print(f'Candidate ID: {c.id}, Name: {c.candidate_name}, Email: {c.candidate_email}')
        break

if __name__ == "__main__":
    asyncio.run(check())
