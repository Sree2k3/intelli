"""
models.py - SQLAlchemy ORM + Pydantic schemas for IntelliHire backend.
Tables mirror the Supabase schema 1:1.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional, Union
import uuid

from sqlalchemy import (
    Boolean, CheckConstraint, Column, ForeignKey, Index, Integer,
    String, Text, DateTime, func, Float
)
from sqlalchemy.dialects.postgresql import JSONB, UUID, ENUM
from sqlalchemy.orm import DeclarativeBase, relationship

from pydantic import BaseModel, EmailStr, Field, model_validator, field_validator


# ─────────────────────────────────────────────
# SQLAlchemy ORM Models
# ─────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


class Tenant(Base):
    __tablename__ = "tenants"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name       = Column(String, nullable=False, unique=True)
    settings      = Column(JSONB, default={})
    plan_type     = Column(String, default="basic") # basic, professional, enterprise
    duration_days = Column(Integer, default=30)
    start_date    = Column(DateTime(timezone=True), server_default=func.now())
    expiry_date   = Column(DateTime(timezone=True))
    interview_limit = Column(Integer, default=99999999)
    status        = Column(String, default="active") # active, expired, suspended
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    memberships = relationship("Membership", back_populates="tenant", cascade="all, delete-orphan")
    interviews  = relationship("Interview",  back_populates="tenant",  cascade="all, delete-orphan")


class Membership(Base):
    __tablename__ = "memberships"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id    = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tenant_id  = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    manager_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True) # Who this member reports to
    role       = Column(String, nullable=False) # super_admin, admin, manager, recruiter
    scaloz_role = Column(String, nullable=True)
    override_role = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user    = relationship("User",    back_populates="memberships", foreign_keys=[user_id])
    tenant  = relationship("Tenant",  back_populates="memberships")
    manager = relationship("User",    back_populates="managed_members", foreign_keys=[manager_id])

    __table_args__ = (
        CheckConstraint("role IN ('super_admin', 'admin', 'manager', 'recruiter')", name="membership_role_check"),
        Index("idx_membership_user_tenant", "user_id", "tenant_id", unique=True),
    )


class User(Base):
    __tablename__ = "users"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email         = Column(String, nullable=False, unique=True)
    password_hash = Column(Text, nullable=False)
    full_name     = Column(Text)
    status        = Column(String, default="active") # active, disabled
    scaloz_user_id = Column(String, nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    profile         = relationship("Profile",    back_populates="user", uselist=False, cascade="all, delete-orphan")
    interviews      = relationship("Interview",  back_populates="user", foreign_keys="[Interview.user_id]", cascade="all, delete-orphan")
    memberships     = relationship("Membership", back_populates="user", foreign_keys=[Membership.user_id], cascade="all, delete-orphan")
    managed_members = relationship("Membership", back_populates="manager", foreign_keys=[Membership.manager_id])


class Profile(Base):
    __tablename__ = "profiles"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id    = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    full_name  = Column(Text)
    avatar_url = Column(Text)
    role       = Column(
        String, nullable=False, default="recruiter",
        info={"check": "role IN ('candidate','recruiter','hiring_manager','admin')"}
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="profile")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id    = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token      = Column(String, unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class RoleMaster(Base):
    __tablename__ = "roles_master"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id  = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name       = Column(String, nullable=False)
    department = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_roles_master_name", "name"),
        Index("idx_roles_master_tenant", "tenant_id"),
    )


class DepartmentMaster(Base):
    __tablename__ = "departments_master"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id  = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name       = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_departments_master_name", "name"),
        Index("idx_departments_master_tenant", "tenant_id"),
    )


class Interview(Base):
    __tablename__ = "interviews"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id              = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tenant_id            = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True) # Nullable for legacy or super_admin global actions if any
    interview_name       = Column(Text, nullable=True)
    interviewer_name     = Column(Text, nullable=True)
    candidate_name       = Column(Text, nullable=False, default="")
    candidate_email      = Column(Text)
    candidate_experience = Column(Text, default="")
    job_role             = Column(Text, nullable=False, default="Software Engineer")
    job_role_id          = Column(UUID(as_uuid=True), ForeignKey("roles_master.id", ondelete="SET NULL"), nullable=True)
    department_id        = Column(UUID(as_uuid=True), ForeignKey("departments_master.id", ondelete="SET NULL"), nullable=True)
    department           = Column(Text, nullable=True)
    skill_tags           = Column(JSONB, default=[])
    difficulty_level     = Column(String, nullable=False, default="Medium")
    question_count       = Column(Integer, nullable=False, default=5)
    coding_count         = Column(Integer, nullable=False, default=2)
    interview_stage      = Column(String, nullable=False, default="Screening")
    seniority_level      = Column(String, nullable=False, default="Mid")
    experience_min       = Column(Integer, nullable=False, default=2)
    experience_max       = Column(Integer, nullable=False, default=5)
    interview_language   = Column(String, nullable=False, default="English")
    link_expiry_days     = Column(Integer, nullable=False, default=7)
    require_camera       = Column(Boolean, nullable=False, default=True)
    detect_tab_switch    = Column(Boolean, nullable=False, default=True)
    block_copy_paste     = Column(Boolean, nullable=False, default=True)
    max_retake_attempts  = Column(Integer, nullable=False, default=1)
    status               = Column(String, nullable=False, default="pending")
    current_round        = Column(String, nullable=False, default="technical")
    overall_score        = Column(Integer)
    technical_score      = Column(Integer)
    coding_score         = Column(Integer)
    behavioral_score     = Column(Integer)
    ai_recommendation    = Column(Text)
    duration_seconds     = Column(Integer, default=0)
    invite_token         = Column(Text, unique=True)
    short_code           = Column(String, unique=True, index=True, nullable=True)
    jd_file_path         = Column(Text)
    jd_text              = Column(Text)                # Extracted JD text stored for conversational grounding
    structured_memory    = Column(JSONB, default={})     # Stores skill_scores, weak_areas, current_focus, etc.
    video_url            = Column(Text, nullable=True)  # Placeholder for recording features
    recording_status     = Column(String, nullable=True) # Placeholder for recording features
    s3_upload_id         = Column(Text, nullable=True)  # AWS S3 Multipart Upload ID for video recording
    compliance_accepted  = Column(Boolean, nullable=False, default=False) # Consent to proctoring/rules
    candidate_id_url     = Column(Text, nullable=True)  # URL to captured ID image for verification
    started_at           = Column(DateTime(timezone=True), nullable=True) # When the interview actually began
    invite_expires_at    = Column(DateTime(timezone=True), nullable=True) # When the invite link expires
    proctoring_strikes   = Column(JSONB, default={"mobile": 0, "multi_person": 0, "gaze": 0})
    violation_screenshot = Column(Text, nullable=True)
    save_video_recording = Column(Boolean, nullable=False, default=False)
    show_candidate_video = Column(Boolean, nullable=False, default=True)
    duration_minutes     = Column(Integer, nullable=False, default=30)
    is_multi_candidate   = Column(Boolean, nullable=False, default=False)
    proctoring_enabled   = Column(Boolean, nullable=False, default=True)
    proctoring_max_strikes = Column(Integer, nullable=False, default=3)
    proctoring_score_cutoff = Column(Integer, nullable=False, default=70)
    proctoring_max_strikes_action = Column(String, nullable=False, default="flag_review")
    proctoring_cutoff_action = Column(String, nullable=False, default="manual_review")
    evaluation_score_cutoff = Column(Integer, nullable=False, default=60)
    evaluation_cutoff_action = Column(String, nullable=False, default="manual_review")
    evaluation_rubric    = Column(JSONB, nullable=True) # Custom enterprise evaluation parameters & weights
    available_from       = Column(DateTime(timezone=True), nullable=True)
    available_until      = Column(DateTime(timezone=True), nullable=True)
    timezone             = Column(String, nullable=False, default="Asia/Kolkata")
    grace_period_minutes = Column(Integer, nullable=True, default=0)
    actual_started_at    = Column(DateTime(timezone=True), nullable=True)

    
    # Ownership Tracking
    manager_id           = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    recruiter_id         = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    candidate_id         = Column(UUID(as_uuid=True), default=uuid.uuid4, nullable=True)
    created_by           = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user            = relationship("User",               back_populates="interviews", foreign_keys=[user_id])
    manager         = relationship("User",               foreign_keys=[manager_id])
    recruiter       = relationship("User",               foreign_keys=[recruiter_id])
    creator         = relationship("User",               foreign_keys=[created_by])
    tenant          = relationship("Tenant",             back_populates="interviews")
    messages        = relationship("InterviewMessage",   back_populates="interview", cascade="all, delete-orphan")
    questions       = relationship("InterviewQuestion",  back_populates="interview", cascade="all, delete-orphan")
    code_subs       = relationship("CodeSubmission",     back_populates="interview", cascade="all, delete-orphan")
    coding_questions = relationship("CodingQuestion",    back_populates="interview", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','in_progress','completed','flagged','scheduled','selected','rejected')",
            name="interviews_status_check"
        ),
        CheckConstraint(
            "current_round IN ('technical','coding','behavioral')",
            name="interviews_round_check"
        ),
        CheckConstraint(
            "overall_score BETWEEN 0 AND 100",
            name="interviews_overall_score_bounds"
        ),
        CheckConstraint(
            "technical_score BETWEEN 0 AND 100",
            name="interviews_technical_score_bounds"
        ),
        CheckConstraint(
            "coding_score BETWEEN 0 AND 100",
            name="interviews_coding_score_bounds"
        ),
        CheckConstraint(
            "behavioral_score BETWEEN 0 AND 100",
            name="interviews_behavioral_score_bounds"
        ),
        Index("idx_interviews_invite_token", "invite_token"),
        Index("idx_interviews_user_id",      "user_id"),
        Index("idx_interviews_tenant_id",    "tenant_id"),
        Index("idx_interviews_created_at",   "created_at"),
        Index("idx_interviews_status",       "status"),
        Index("idx_interviews_interview_name", "interview_name"),
        Index("idx_interviews_interviewer_name", "interviewer_name"),
        Index("idx_interviews_job_role_id", "job_role_id"),
        Index("idx_interviews_department_id", "department_id"),
    )


class InterviewCandidate(Base):
    __tablename__ = "interview_candidates"

    id                 = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id       = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False)
    candidate_email    = Column(Text, nullable=False)
    candidate_name     = Column(Text, nullable=True)
    invitation_status  = Column(String, nullable=False, default="pending")
    email_verified     = Column(Boolean, nullable=False, default=False)
    verification_time  = Column(DateTime(timezone=True), nullable=True)
    last_invited_at    = Column(DateTime(timezone=True), nullable=True)
    invite_count       = Column(Integer, nullable=False, default=0)
    is_revoked         = Column(Boolean, nullable=False, default=False)
    session_id         = Column(UUID(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="SET NULL"), nullable=True)
    invited_at         = Column(DateTime(timezone=True), server_default=func.now())
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
    updated_at         = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    interview = relationship("Interview")

    __table_args__ = (
        Index("idx_interview_candidates_interview_id", "interview_id"),
        Index("idx_interview_candidates_email", "candidate_email"),
        Index("idx_interview_candidates_uq", "interview_id", "candidate_email", unique=True),
    )


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id                     = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id           = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False)
    candidate_id           = Column(UUID(as_uuid=True), ForeignKey("interview_candidates.id", ondelete="CASCADE"), nullable=False)
    session_token          = Column(String(255), unique=True, index=True, nullable=False)
    status                 = Column(String, nullable=False, default="pending")
    current_round          = Column(String, nullable=False, default="technical")
    current_question_index = Column(Integer, nullable=False, default=0)
    chat_history           = Column(JSONB, default=[])
    structured_memory      = Column(JSONB, default={})
    answers                = Column(JSONB, default={})
    coding_answers         = Column(JSONB, default={})
    video_url              = Column(Text, nullable=True)
    audio_url              = Column(Text, nullable=True)
    candidate_id_url       = Column(Text, nullable=True)
    violation_screenshot   = Column(Text, nullable=True)
    s3_upload_id           = Column(Text, nullable=True)
    proctoring_alerts      = Column(JSONB, default={})
    overall_score          = Column(Float, nullable=True)
    technical_score        = Column(Float, nullable=True)
    coding_score           = Column(Integer, nullable=True)
    behavioral_score       = Column(Integer, nullable=True)
    communication_score    = Column(Float, nullable=True)
    ai_recommendation      = Column(Text, nullable=True)
    interview_duration     = Column(String, nullable=True)
    started_at             = Column(DateTime(timezone=True), nullable=True)
    completed_at           = Column(DateTime(timezone=True), nullable=True)
    last_active_at         = Column(DateTime(timezone=True), nullable=True)
    created_at             = Column(DateTime(timezone=True), server_default=func.now())
    updated_at             = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    interview = relationship("Interview")
    candidate = relationship("InterviewCandidate", foreign_keys=[candidate_id])

    __table_args__ = (
        Index("idx_interview_sessions_interview_id", "interview_id"),
        Index("idx_interview_sessions_candidate_id", "candidate_id"),
        Index("idx_interview_sessions_status", "status"),
    )


class InterviewMessage(Base):
    __tablename__ = "interview_messages"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False)
    tenant_id    = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    question_id  = Column(UUID(as_uuid=True), ForeignKey("interview_questions.id", ondelete="SET NULL"), nullable=True)
    role         = Column(String, nullable=False)
    content      = Column(Text, nullable=False)
    round        = Column(String, nullable=False)
    metadata_    = Column("metadata", JSONB, default={})
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    interview = relationship("Interview", back_populates="messages")

    __table_args__ = (
        CheckConstraint("role  IN ('ai','user','system')",              name="messages_role_check"),
        CheckConstraint("round IN ('technical','coding','behavioral')", name="messages_round_check"),
        Index("idx_interview_messages_interview_id", "interview_id"),
        Index("idx_interview_messages_tenant_id", "tenant_id"),
    )


class CodeSubmission(Base):
    __tablename__ = "code_submissions"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id      = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False)
    session_id        = Column(UUID(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="SET NULL"), nullable=True)
    tenant_id         = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    question_id       = Column(UUID(as_uuid=True), ForeignKey("coding_questions.id", ondelete="CASCADE"), nullable=True)
    language          = Column(String, nullable=False, default="python")
    code              = Column(Text, nullable=False)
    output            = Column(Text)
    passed_tests      = Column(Integer, default=0)
    total_tests       = Column(Integer, default=0)
    execution_time_ms = Column(Integer)
    status            = Column(String, nullable=False, default="pending")
    ai_feedback       = Column(Text)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    interview = relationship("Interview", back_populates="code_subs")
    question  = relationship("CodingQuestion")

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','completed','error')",
            name="code_submissions_status_check"
        ),
        Index("idx_code_submissions_interview_id", "interview_id"),
        Index("idx_code_submissions_question_id",  "question_id"),
        Index("idx_code_submissions_tenant_id", "tenant_id"),
    )


class CodingQuestion(Base):
    """Structured coding problem attached to an interview."""
    __tablename__ = "coding_questions"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id   = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False)
    tenant_id      = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    title          = Column(Text, nullable=False)
    difficulty     = Column(String, nullable=False, default="medium")
    description    = Column(Text, nullable=False)
    examples       = Column(JSONB, default=[])          # [{input, output, explanation}]
    constraints    = Column(JSONB, default=[])           # ["1 <= n <= 10^5", ...]
    hints          = Column(JSONB, default=[])           # ["Think about ...", ...]
    starter_code   = Column(JSONB, default={})           # {python: "...", javascript: "...", ...}
    test_cases     = Column(JSONB, default=[])           # [{input, expected_output, is_hidden}]
    order_index    = Column(Integer, nullable=False, default=0)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())

    interview = relationship("Interview", back_populates="coding_questions")

    __table_args__ = (
        CheckConstraint(
            "difficulty IN ('easy','medium','hard')",
            name="coding_q_difficulty_check"
        ),
        Index("idx_coding_questions_interview_id", "interview_id"),
        Index("idx_coding_questions_tenant_id", "tenant_id"),
    )


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id     = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False)
    tenant_id        = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    question_text    = Column(Text, nullable=False)
    question_type    = Column(String, nullable=False)
    difficulty       = Column(String, nullable=False, default="medium")
    selected         = Column(Boolean, nullable=False, default=False)
    candidate_answer = Column(Text)
    ai_score         = Column(Integer)
    ai_feedback      = Column(Text)
    ideal_answer     = Column(Text)           # Gold-standard answer for comparison
    rubric           = Column(JSONB)           # Scoring rubric JSON
    order_index      = Column(Integer, nullable=False, default=0)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    # ── Question Editing / Customization (additive — all backward-compatible) ──
    source           = Column(String, nullable=False, default="generated")
        # "generated" = AI-created, untouched
        # "edited"    = AI-created, HR modified the text
        # "custom"    = HR wrote from scratch
    original_text    = Column(Text, nullable=True)
        # Stores the ORIGINAL AI-generated text before any edit (for "Revert")
    edited_at        = Column(DateTime(timezone=True), nullable=True)
        # Timestamp of last edit; NULL = never edited

    interview = relationship("Interview", back_populates="questions")

    __table_args__ = (
        CheckConstraint(
            "question_type IN ('technical','coding','behavioral')",
            name="questions_type_check"
        ),
        CheckConstraint(
            "difficulty IN ('easy','medium','hard')",
            name="questions_difficulty_check"
        ),
        CheckConstraint(
            "ai_score BETWEEN 0 AND 100",
            name="questions_score_bounds"
        ),
        # NOTE: source check constraint is added via startup migration
        # to avoid create_all conflicts on existing tables
        Index("idx_interview_questions_interview_id", "interview_id"),
        Index("idx_interview_questions_tenant_id", "tenant_id"),
    )


# ─────────────────────────────────────────────
# Pydantic Schemas (Request / Response)
# ─────────────────────────────────────────────

class UserRegister(BaseModel):
    email:     EmailStr
    password:  str = Field(min_length=6)
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    email:    EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user_id:      str
    email:        str
    full_name:    Optional[str] = None
    role:         Optional[str] = None
    tenant_id:    Optional[str] = None
    tenant_name:  Optional[str] = None


# --- Interview ---

class RoleMasterOut(BaseModel):
    id: str
    name: str
    department: Optional[str] = None

class DepartmentMasterOut(BaseModel):
    id: str
    name: str

class InterviewCreate(BaseModel):
    job_role:         str
    job_role_id:      Optional[str] = None
    department_id:    Optional[str] = None
    department:       Optional[str] = None
    skill_tags:       Optional[List[str]] = None
    difficulty_level: Optional[str] = "Medium"
    question_count:   Optional[int] = 5
    coding_count:     Optional[int] = 2
    interview_stage:  Optional[str] = "Screening"
    seniority_level:  Optional[str] = "Mid"
    experience_min:   Optional[int] = 2
    experience_max:   Optional[int] = 5
    interview_language: Optional[str] = "English"
    link_expiry_days: Optional[int] = 7
    require_camera:   Optional[bool] = True
    detect_tab_switch: Optional[bool] = True
    block_copy_paste: Optional[bool] = True
    max_retake_attempts: Optional[int] = 1
    interview_name:   Optional[str] = None
    interviewer_name: Optional[str] = None
    candidate_name:   Optional[str] = ""
    candidate_email:  Optional[str] = None
    candidate_experience: Optional[str] = None
    invite_token:     Optional[str] = None
    jd_file_path:     Optional[str] = None
    save_video_recording: Optional[bool] = False
    show_candidate_video: Optional[bool] = True
    duration_minutes: Optional[int] = 30
    is_multi_candidate: Optional[bool] = False
    proctoring_enabled: Optional[bool] = True
    proctoring_max_strikes: Optional[int] = 3
    proctoring_score_cutoff: Optional[int] = 70
    proctoring_max_strikes_action: Optional[str] = "flag_review"
    proctoring_cutoff_action: Optional[str] = "manual_review"
    evaluation_score_cutoff: Optional[int] = 60
    evaluation_cutoff_action: Optional[str] = "manual_review"
    evaluation_rubric: Optional[List[Dict[str, Any]]] = None
    available_from: Optional[datetime] = None
    available_until: Optional[datetime] = None
    timezone: Optional[str] = "Asia/Kolkata"
    grace_period_minutes: Optional[int] = 0

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return "Asia/Kolkata"
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(v)
            return v
        except Exception:
            raise ValueError(f"Invalid timezone identifier: {v}")

    @field_validator("grace_period_minutes")
    @classmethod
    def validate_grace_period(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("Grace period minutes must be >= 0")
        return v

    @model_validator(mode="after")
    def validate_dates(self) -> "InterviewCreate":
        start = self.available_from
        end = self.available_until
        from datetime import datetime, timezone, timedelta
        now_utc = datetime.now(timezone.utc)
        
        # Start cannot be in the past (allow 2-minute skew buffer for network transfer)
        if start is not None:
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if start < (now_utc - timedelta(minutes=2)):
                raise ValueError("Interview start time (available_from) cannot be in the past")

        # End cannot be in the past
        if end is not None:
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            if end <= now_utc:
                raise ValueError("Interview end time (available_until) cannot be in the past")

        # End must be strictly later than start
        if start and end and end <= start:
            raise ValueError("available_until must be strictly later than available_from")
        return self



class InterviewUpdate(BaseModel):
    interview_name:       Optional[str] = None
    interviewer_name:     Optional[str] = None
    status:               Optional[str] = None
    current_round:        Optional[str] = None
    candidate_name:       Optional[str] = None
    candidate_email:      Optional[str] = None
    candidate_experience: Optional[str] = None
    job_role:             Optional[str] = None
    job_role_id:          Optional[str] = None
    department_id:        Optional[str] = None
    department:           Optional[str] = None
    skill_tags:           Optional[List[str]] = None
    difficulty_level:     Optional[str] = None
    question_count:       Optional[int] = None
    coding_count:         Optional[int] = None
    interview_stage:      Optional[str] = None
    seniority_level:      Optional[str] = None
    experience_min:       Optional[int] = None
    experience_max:       Optional[int] = None
    interview_language:   Optional[str] = None
    link_expiry_days:     Optional[int] = None
    require_camera:       Optional[bool] = None
    detect_tab_switch:    Optional[bool] = None
    block_copy_paste:     Optional[bool] = None
    max_retake_attempts:  Optional[int] = None
    overall_score:        Optional[int] = None
    technical_score:      Optional[int] = None
    coding_score:         Optional[int] = None
    behavioral_score:     Optional[int] = None
    ai_recommendation:    Optional[str] = None
    jd_text:              Optional[str] = None
    is_multi_candidate:   Optional[bool] = None
    structured_memory:    Optional[Dict[str, Any]] = None
    video_url:            Optional[str] = None
    recording_status:     Optional[str] = None
    candidate_id_url:     Optional[str] = None
    started_at:           Optional[datetime] = None
    proctoring_strikes:   Optional[Dict[str, int]] = None
    violation_screenshot: Optional[str] = None
    save_video_recording: Optional[bool] = None
    show_candidate_video: Optional[bool] = None
    duration_minutes:     Optional[int] = None
    proctoring_enabled:   Optional[bool] = None
    proctoring_max_strikes: Optional[int] = None
    proctoring_score_cutoff: Optional[int] = None
    proctoring_max_strikes_action: Optional[str] = None
    proctoring_cutoff_action: Optional[str] = None
    evaluation_score_cutoff: Optional[int] = None
    evaluation_cutoff_action: Optional[str] = None
    evaluation_rubric: Optional[List[Dict[str, Any]]] = None
    manager_id:           Optional[str] = None
    recruiter_id:         Optional[str] = None
    candidate_id:         Optional[str] = None
    created_by:           Optional[str] = None
    available_from:       Optional[datetime] = None
    available_until:      Optional[datetime] = None
    timezone:             Optional[str] = None
    grace_period_minutes: Optional[int] = None
    actual_started_at:    Optional[datetime] = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(v)
            return v
        except Exception:
            raise ValueError(f"Invalid timezone identifier: {v}")

    @field_validator("grace_period_minutes")
    @classmethod
    def validate_grace_period(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("Grace period minutes must be >= 0")
        return v

    @model_validator(mode="after")
    def validate_dates_update(self) -> "InterviewUpdate":
        start = self.available_from
        end = self.available_until
        from datetime import datetime, timezone, timedelta
        now_utc = datetime.now(timezone.utc)

        # If available_from is being updated, ensure it's not set in the past
        if start is not None:
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if start < (now_utc - timedelta(minutes=2)):
                raise ValueError("Interview start time (available_from) cannot be in the past")

        # If available_until is being updated, ensure it's not set in the past
        if end is not None:
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            if end <= now_utc:
                raise ValueError("Interview end time (available_until) cannot be in the past")

        if start and end and end <= start:
            raise ValueError("available_until must be strictly later than available_from")
        return self


class InterviewOut(BaseModel):
    id:                   str
    user_id:              str
    tenant_id:            Optional[str] = None
    interview_name:       Optional[str] = None
    interviewer_name:     Optional[str] = None
    candidate_name:       str
    candidate_email:      Optional[str]
    candidate_experience: Optional[str]
    job_role:             str
    status:               str
    current_round:        str
    overall_score:        Optional[int]
    technical_score:      Optional[int]
    coding_score:         Optional[int]
    behavioral_score:     Optional[int]
    ai_recommendation:    Optional[str]
    duration_seconds:     Optional[int]
    invite_token:         Optional[str]
    short_code:           Optional[str] = None
    jd_file_path:         Optional[str]
    jd_text:              Optional[str]
    structured_memory:    Optional[Dict[str, Any]]
    video_url:            Optional[str]
    recording_status:     Optional[str]
    candidate_id_url:     Optional[str]
    started_at:           Optional[str]
    proctoring_strikes:   Optional[Dict[str, int]]
    violation_screenshot: Optional[str] = None
    save_video_recording: Optional[bool] = False
    show_candidate_video: Optional[bool] = True
    duration_minutes: Optional[int] = 30
    is_multi_candidate: Optional[bool] = False
    proctoring_enabled: Optional[bool] = True
    proctoring_max_strikes: Optional[int] = 3
    proctoring_score_cutoff: Optional[int] = 70
    proctoring_max_strikes_action: Optional[str] = "flag_review"
    proctoring_cutoff_action: Optional[str] = "manual_review"
    evaluation_score_cutoff: Optional[int] = 60
    evaluation_cutoff_action: Optional[str] = "manual_review"
    available_from:       Optional[datetime] = None
    available_until:      Optional[datetime] = None
    timezone:             Optional[str] = "Asia/Kolkata"
    grace_period_minutes: Optional[int] = 0
    actual_started_at:    Optional[datetime] = None
    created_at:           str
    updated_at:           str

    model_config = {"from_attributes": True}


class CandidateInput(BaseModel):
    email: str
    name: Optional[str] = None

class UpdateCandidatesRequest(BaseModel):
    candidates: List[CandidateInput]

class InterviewCandidateOut(BaseModel):
    id: str
    interview_id: str
    candidate_email: str
    candidate_name: Optional[str]
    invitation_status: str
    email_verified: bool
    verification_time: Optional[str]
    last_invited_at: Optional[str]
    invite_count: int
    is_revoked: bool
    session_id: Optional[str]
    invited_at: Optional[str]
    created_at: str
    updated_at: str
    
    # We may inject session details directly in GET response
    session_status: Optional[str] = None
    session_score: Optional[float] = None
    session_started_at: Optional[str] = None
    session_completed_at: Optional[str] = None
    session_token: Optional[str] = None

    model_config = {"from_attributes": True}


class InterviewSessionOut(BaseModel):
    id: str
    interview_id: str
    candidate_id: str
    session_token: str
    status: str
    current_question_index: int
    overall_score: Optional[float]
    technical_score: Optional[float]
    communication_score: Optional[float]
    ai_recommendation: Optional[str]
    interview_duration: Optional[str]
    started_at: Optional[str]
    completed_at: Optional[str]
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}



# --- Messages ---

class MessageOut(BaseModel):
    id:           str
    interview_id: str
    role:         str
    content:      str
    round:        str
    metadata_:    Optional[Dict[str, Any]] = Field(None, alias="metadata")
    created_at:   str

    model_config = {"from_attributes": True, "populate_by_name": True}


# --- Questions ---

class QuestionOut(BaseModel):
    id:               str
    interview_id:     str
    question_text:    str
    question_type:    str
    difficulty:       str
    selected:         bool
    candidate_answer: Optional[str]
    ai_score:         Optional[int]
    ai_feedback:      Optional[str]
    order_index:      int
    source:           str = "generated"
    original_text:    Optional[str] = None
    edited_at:        Optional[str] = None
    created_at:       str

    model_config = {"from_attributes": True}


class QuestionSelectionUpdate(BaseModel):
    id:       str
    selected: bool


class QuestionCreateRequest(BaseModel):
    """Request body for HR adding a custom question."""
    interview_id:  str
    question_text: str
    question_type: str = "technical"   # technical | behavioral
    difficulty:    str = "medium"      # easy | medium | hard
    selected:      bool = True         # Auto-select custom questions


class AnswerUpdate(BaseModel):
    candidate_answer: str


# --- Code ---

class CodeExecuteRequest(BaseModel):
    interview_id: str
    code:         str
    language:     str = "python"
    test_cases:   Optional[List[Dict[str, str]]] = None
    question_id:  Optional[str] = None  # coding question id for structured evaluation


class CodeExecuteResponse(BaseModel):
    output:        str
    passedTests:   int
    totalTests:    int
    executionTime: int
    status:        str


class CodeSubmitRequest(BaseModel):
    """Final coding round submission."""
    interview_id: str
    question_id:  str
    code:         str
    language:     str = "python"


# --- Coding Question Schemas ---

class CodingQuestionOut(BaseModel):
    id:           str
    interview_id: str
    title:        str
    difficulty:   str
    description:  str
    examples:     List[Dict[str, Any]] = []
    constraints:  List[str] = []
    hints:        List[str] = []
    starter_code: Dict[str, str] = {}
    test_cases:   List[Dict[str, Any]] = []
    order_index:  int
    created_at:   str

    model_config = {"from_attributes": True}


# --- AI ---

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None


class AIInterviewRequest(BaseModel):
    interview_id: str
    message:      Optional[str] = None
    round:        str
    job_role:     str


class GenerateQuestionsRequest(BaseModel):
    interview_id:        str
    jd_text:             str
    experience_level:    Optional[str] = None  # e.g. "fresher", "junior", "mid", "senior"
    custom_instructions: Optional[str] = None  # natural-language recruiter guidance


class GenerateCodingQuestionsRequest(BaseModel):
    source_text:         str
    difficulty:          Optional[str] = "medium"  # "easy" | "medium" | "hard" | "mixed"
    count:               Optional[int] = 2          # 1 to 3
    custom_instructions: Optional[str] = None
    challenge_types:     Optional[List[str]] = None
    is_raw_problem:      Optional[bool] = False


class RecommendCodingTypesRequest(BaseModel):
    content:             str
    job_role:            Optional[str] = None
    skills:              Optional[List[str]] = None
    seniority:           Optional[str] = None
    min_exp:             Optional[Union[int, str]] = None
    max_exp:             Optional[Union[int, str]] = None
    custom_instructions: Optional[str] = None


class ScoreAnswersRequest(BaseModel):
    interview_id: str

    full_name: Optional[str] = None


class EvaluateInterviewRequest(BaseModel):
    interview_id: str


class UserLogin(BaseModel):
    email:    EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user_id:      str
    email:        str
    full_name:    Optional[str] = None
    role:         Optional[str] = None
    tenant_id:    Optional[str] = None
    tenant_name:  Optional[str] = None


# --- RBAC Schemas ---

class TenantCreate(BaseModel):
    name: str
    admin_email: Optional[str] = None

class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    plan_type: str = "basic"
    duration_days: int = 30
    start_date: datetime
    expiry_date: Optional[datetime] = None
    status: str = "active"
    created_at: datetime
    model_config = {"from_attributes": True}


# --- Candidate (token-based, no auth) ---

class CandidateDetailsUpdate(BaseModel):
    name:       str
    email:      str

class UserMembershipUpdate(BaseModel):
    user_id: str
    tenant_id: str
    role: str # super_admin, admin, manager, recruiter


class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


# ─────────────────────────────────────────────
# Email Invitation Logging
# ─────────────────────────────────────────────

class EmailLog(Base):
    """Tracks every interview invitation email sent by recruiters."""
    __tablename__ = "email_logs"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_id = Column(UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False)
    to_email     = Column(Text, nullable=False)
    cc           = Column(Text, nullable=True)   # comma-separated
    bcc          = Column(Text, nullable=True)   # comma-separated
    subject      = Column(Text, nullable=False)
    sent_by      = Column(Text, nullable=True)   # recruiter email from JWT
    sent_at      = Column(DateTime(timezone=True), server_default=func.now())
    status       = Column(String, nullable=False, default="sent")  # "sent" | "failed"
    error_message = Column(Text, nullable=True)

    __table_args__ = (
        Index("idx_email_logs_interview_id", "interview_id"),
    )


class SendEmailRequest(BaseModel):
    to: str
    cc:  Optional[List[str]] = []
    bcc: Optional[List[str]] = []
    subject: str
    body: str


class SendEmailResponse(BaseModel):
    success: bool
    message: str

