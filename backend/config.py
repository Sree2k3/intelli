"""
config.py - Environment-driven settings for IntelliHire backend.
"""
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

# Load .env into os.environ before Settings is initialized
load_dotenv()


class Settings(BaseSettings):
    # Storage Mode (s3 or local)
    STORAGE_MODE: str = "local"

    # Database (loaded from environment / .env)
    DATABASE_URL: str = ""

    # JWT
    JWT_SECRET: str = "CHANGE_ME_IN_PRODUCTION_supersecret_key_for_intellihire_local"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 30  # 30 days

    # Ollama
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.1:8b"

    # OpenAI
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_QUESTION_MODEL: str = "gpt-4o-mini"
    OPENAI_EVALUATION_MODEL: str = "gpt-4o"
    OPENAI_WHISPER_MODEL: str = "whisper-1"

    # Voice / TTS Pipeline
    DEEPGRAM_API_KEY: Optional[str] = None
    DEEPGRAM_TTS_MODEL: str = "aura-asteria-en"
    TTS_PROVIDER: str = "deepgram"

    # Piston (code execution) - local or public
    PISTON_URL: str = "https://emkc.org/api/v2/piston"

    # Judge0 (code execution) - self-hosted sandboxed executor
    JUDGE0_URL: str = "http://judge0:2358"
    JUDGE0_AUTH_TOKEN: Optional[str] = None

    # ATS Integration
    ATS_API_KEY: str = "test_ats_secret_token"

    # ATS Webhook Secret
    AI_WEBHOOK_SECRET: str = "test_ai_webhook_secret"

    # CORS
    FRONTEND_ORIGIN: str = "http://localhost:8080"
    CORS_ORIGIN_REGEX: Optional[str] = None

    # Integration URLs
    XEVHIRE_BASE_URL: str = "http://localhost:8080"
    AI_INTERVIEW_BASE_URL: str = "http://localhost:8080"
    RESULTS_BASE_URL: str = "http://localhost:8080"
    WEBHOOK_CALLBACK_URL: str = "http://localhost:8080/api/webhook"

    # AWS S3
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_REGION: Optional[str] = None
    S3_BUCKET_NAME: Optional[str] = None
    AWS_S3_BUCKET_NAME: Optional[str] = None
    S3_PRESIGNED_EXPIRY: int = 3600  # 1 hour

    @property
    def is_s3_enabled(self) -> bool:
        has_static_creds = bool(
            self.AWS_ACCESS_KEY_ID and self.AWS_SECRET_ACCESS_KEY 
            and not self.AWS_ACCESS_KEY_ID.startswith("your_")
        )
        bucket = self.S3_BUCKET_NAME or self.AWS_S3_BUCKET_NAME
        return bool(bucket) and (has_static_creds or self.STORAGE_MODE == "s3")

    # SMTP Settings
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASS: Optional[str] = None
    SMTP_FROM: Optional[str] = None

    # Payload Encryption (AES-256-GCM)
    ENCRYPTION_KEY: Optional[str] = "Xc5qurndq22SuKwKg1mnIY1a43BBODmFVTA2o1N17JQ="
    REQUIRE_ENCRYPTION: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
if not settings.S3_BUCKET_NAME and settings.AWS_S3_BUCKET_NAME:
    settings.S3_BUCKET_NAME = settings.AWS_S3_BUCKET_NAME


