"""AI microservice configuration."""

import os

from pydantic import Field
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
    gemini_model: str = "gemini-3.1-flash-lite"

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"
    ollama_timeout_seconds: int = 120
    ollama_max_retries: int = 2

    # Gemini vision (receipt OCR) — issue #476. The Next.js scan client aborts
    # at a fixed 45s (nextjs/src/lib/api/scan.ts, not owned here) and the
    # server's own per-attempt timeout must fit a retry inside that budget
    # rather than race it: 18s/attempt + one retry + a short backoff is
    # ~37s worst case for the vision call alone, leaving headroom for OCR/
    # parse overhead and the downstream ingest-dispatch step in the same
    # request. Network-layer failures (timeout, connection error) and Gemini
    # 5xx responses are retried; 4xx responses (auth, malformed request,
    # rate limit) are not — retrying them can't help.
    gemini_vision_timeout_seconds: float = Field(default=18.0, gt=0)
    gemini_vision_max_retries: int = Field(default=1, ge=0)
    gemini_vision_retry_backoff_seconds: float = Field(default=1.0, ge=0)

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

    # Deployed commit SHA (#step3 of the autonomous-agent-loop plan). Set at
    # build/deploy time via BUBBLY_GIT_SHA (see Dockerfile's GIT_SHA build
    # arg). Empty by default so a plain `docker build`/local run never fails.
    git_sha: str = ""

    model_config = {"env_prefix": "BUBBLY_", "env_file": ".env"}

    @property
    def resolved_git_sha(self) -> str:
        """Deployed commit SHA for health checks.

        Priority: BUBBLY_GIT_SHA (set explicitly at build/deploy time) ->
        Railway's own injected RAILWAY_GIT_COMMIT_SHA -> "unknown". Never
        raises — an unresolved SHA must still let /health return 200.
        """
        if self.git_sha:
            return self.git_sha
        railway_sha = os.environ.get("RAILWAY_GIT_COMMIT_SHA", "")
        if railway_sha:
            return railway_sha
        return "unknown"


settings = Settings()
