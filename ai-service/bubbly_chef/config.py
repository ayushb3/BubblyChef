"""AI microservice configuration."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Settings for the BubblyChef AI microservice."""

    app_name: str = "BubblyChef AI Service"

    # Supabase
    supabase_url: str = ""
    supabase_secret_key: str = ""
    supabase_jwt_secret: str = ""

    # AI providers
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"
    ollama_timeout_seconds: int = 120
    ollama_max_retries: int = 2

    # Anthropic / SAP proxy (dev only — leave use_anthropic_proxy=false in prod/CI)
    anthropic_base_url: str = "http://localhost:6655/anthropic"
    anthropic_api_key: str = ""
    anthropic_model: str = "anthropic--claude-4.6-sonnet"
    anthropic_max_tokens: int = 4096
    use_anthropic_proxy: bool = False

    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "capacitor://localhost"]

    # Confidence thresholds
    auto_add_confidence_threshold: float = 0.8
    review_confidence_threshold: float = 0.5

    # Testing
    run_live_tests: bool = False

    # Dashboard daily tip + suggestion (#225, #168) — deterministic ranking weights.
    # score = w_expiry*expiry_urgency + w_pantry*pantry_coverage + w_mealtime*meal_type_match
    dashboard_weight_expiry: float = 0.6
    dashboard_weight_pantry: float = 0.3
    dashboard_weight_mealtime: float = 0.1
    # Expiry-urgency thresholds (days until expiry) feeding expiry_urgency above.
    # <= urgent_days -> urgency 1.0, <= soon_days -> urgency 0.5. Tunable for the
    # same reason the weights are: they carry real behavioural weight (they
    # decide what counts as "expiring soon" for ranking purposes).
    dashboard_expiry_urgent_days: int = 3
    dashboard_expiry_soon_days: int = 7

    @property
    def auto_apply_confidence_threshold(self) -> float:
        """Alias used by ingest workflows."""
        return self.auto_add_confidence_threshold

    # Schema
    schema_version: str = "1.0.0"

    model_config = {"env_prefix": "BUBBLY_", "env_file": ".env"}


settings = Settings()
