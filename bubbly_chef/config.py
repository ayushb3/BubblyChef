"""Application configuration using pydantic-settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Application
    app_name: str = "BubblyChef"
    app_version: str = "0.2.0"
    debug: bool = False

    # API
    api_v1_prefix: str = "/api"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # AI Providers
    # Gemini (primary - free tier)
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"
    gemini_timeout_seconds: float = 60.0

    # Ollama (fallback - self-hosted)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"
    ollama_timeout_seconds: float = 120.0

    # Database
    database_url: str = "sqlite+aiosqlite:///./bubbly_chef.db"

    # Receipt scanning
    auto_add_confidence_threshold: float = 0.8  # Above this, auto-add
    review_confidence_threshold: float = 0.5  # Below this, likely noise

    # Logging
    log_file: str | None = None  # Optional log file path
    log_requests: bool = True  # Log HTTP requests/responses

    class Config:
        env_prefix = "BUBBLY_"
        env_file = ".env"
        case_sensitive = False


settings = Settings()
