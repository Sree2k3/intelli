-- ============================================================
-- IntelliHire Portal - Local PostgreSQL Setup
-- Replaces Supabase managed schema for local development
-- Run: psql -U postgres -d intellihire -f setup_db.sql
-- ============================================================

-- Create the database (run as superuser if needed)
-- CREATE DATABASE intellihire;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS TABLE (replaces Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  avatar_url  TEXT,
  role        TEXT NOT NULL DEFAULT 'recruiter' CHECK (role IN ('candidate', 'recruiter', 'hiring_manager', 'admin')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INTERVIEWS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.interviews (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  candidate_name       TEXT NOT NULL DEFAULT '',
  candidate_email      TEXT,
  candidate_experience TEXT DEFAULT '',
  job_role             TEXT NOT NULL DEFAULT 'Software Engineer',
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'in_progress', 'completed', 'flagged', 'scheduled')),
  current_round        TEXT NOT NULL DEFAULT 'technical'
                         CHECK (current_round IN ('technical', 'coding', 'behavioral')),
  overall_score        INTEGER,
  technical_score      INTEGER,
  coding_score         INTEGER,
  behavioral_score     INTEGER,
  ai_recommendation    TEXT,
  duration_seconds     INTEGER DEFAULT 0,
  invite_token         TEXT UNIQUE,
  jd_file_path         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interviews_invite_token ON public.interviews(invite_token);
CREATE INDEX IF NOT EXISTS idx_interviews_user_id      ON public.interviews(user_id);

-- ============================================================
-- INTERVIEW MESSAGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.interview_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('ai', 'user', 'system')),
  content      TEXT NOT NULL,
  round        TEXT NOT NULL CHECK (round IN ('technical', 'coding', 'behavioral')),
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_messages_interview_id ON public.interview_messages(interview_id);

-- ============================================================
-- CODE SUBMISSIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.code_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id     UUID NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
  language         TEXT NOT NULL DEFAULT 'javascript',
  code             TEXT NOT NULL,
  output           TEXT,
  passed_tests     INTEGER DEFAULT 0,
  total_tests      INTEGER DEFAULT 0,
  execution_time_ms INTEGER,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'running', 'completed', 'error')),
  ai_feedback      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_code_submissions_interview_id ON public.code_submissions(interview_id);

-- ============================================================
-- INTERVIEW QUESTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.interview_questions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id     UUID NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
  question_text    TEXT NOT NULL,
  question_type    TEXT NOT NULL CHECK (question_type IN ('technical', 'coding', 'behavioral')),
  difficulty       TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  selected         BOOLEAN NOT NULL DEFAULT false,
  candidate_answer TEXT,
  ai_score         INTEGER,
  ai_feedback      TEXT,
  order_index      INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_questions_interview_id ON public.interview_questions(interview_id);

-- ============================================================
-- AUTO UPDATE updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_users_updated_at     ON public.users;
DROP TRIGGER IF EXISTS update_profiles_updated_at  ON public.profiles;
DROP TRIGGER IF EXISTS update_interviews_updated_at ON public.interviews;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_interviews_updated_at
  BEFORE UPDATE ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- DONE
-- ============================================================
\echo 'IntelliHire schema created successfully.'
