-- ============================================================
-- Migration: Add ideal_answer and rubric to interview_questions
-- Run: psql -U postgres -d intellihire -f migrate_add_ideal_answer.sql
-- ============================================================

ALTER TABLE public.interview_questions
  ADD COLUMN IF NOT EXISTS ideal_answer TEXT,
  ADD COLUMN IF NOT EXISTS rubric JSONB;

\echo 'Migration complete: ideal_answer + rubric columns added to interview_questions.'
