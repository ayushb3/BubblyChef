"""Application configuration using pydantic-settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Application
    app_name: str = "BubblyChef"
    app_version: str = "0.1.0"
    debug: bool = False

    # API
    api_v1_prefix: str = "/v1"

    # Ollama LLM
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"  # Good balance of speed and quality
    ollama_timeout_seconds: float = 60.0
    ollama_max_retries: int = 3

    # Database
    database_url: str = "sqlite+aiosqlite:///./bubbly_chef.db"

    # Confidence thresholds
    auto_apply_confidence_threshold: float = 0.95  # Above this, can auto-apply
    review_confidence_threshold: float = 0.7  # Below this, requires review

    # Schema version for proposals
    schema_version: str = "1.0.0"

    class Config:
        env_prefix = "BUBBLY_"
        env_file = ".env"
        case_sensitive = False


settings = Settings()
