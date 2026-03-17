"""Application configuration using pydantic-settings."""

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="BUBBLY_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "BubblyChef"
    app_version: str = "0.1.0"
    debug: bool = False

    # API
    api_v1_prefix: str = "/v1"

    # Gemini LLM
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash-exp"
    gemini_timeout_seconds: float = 60.0

    # Ollama LLM
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"
    ollama_timeout_seconds: float = 60.0
    ollama_max_retries: int = 3

    # Database
    database_url: str = "sqlite+aiosqlite:///./bubbly_chef.db"

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Confidence thresholds
    auto_add_confidence_threshold: float = 0.8
    auto_apply_confidence_threshold: float = 0.95  # legacy alias
    review_confidence_threshold: float = 0.5

    # Logging
    log_file: str | None = None
    log_requests: bool = True

    # Schema version for proposals
    schema_version: str = "1.0.0"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: object) -> object:
        if isinstance(v, str):
            import json

            return json.loads(v)
        return v


settings = Settings()
