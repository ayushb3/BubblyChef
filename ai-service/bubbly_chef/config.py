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

    # Gemini video (YouTube recipe import) — issue #528. Gemini watches the
    # video from its URL, which takes noticeably longer than a text or image
    # call, so it gets its own per-call timeout. One attempt only: a retry
    # would double a slow, billed call. The recipe import modal gives up at
    # 90s (nextjs RecipeImportModal), so this stays comfortably under it.
    gemini_video_timeout_seconds: float = Field(default=60.0, gt=0)

    # Whole-request budget for POST /v1/scan/receipt — issue #481. A scan is
    # two AI calls in one HTTP request: the vision/OCR leg above, then a
    # structured text parse of the OCR output. #476 bounded only the first
    # leg; the parse still ran on the provider's general ~60s text timeout
    # times AIManager.complete's own structured-output retries (up to 2) and
    # the Gemini -> Ollama fallback (120s), so the client's 45s abort always
    # won and the server kept spending on a result nobody would receive.
    #
    # The route starts this clock before preprocessing/OCR and hands the parse
    # leg whatever is left as ONE wall-clock cap around AIManager.complete
    # (asyncio.wait_for in workflows/receipt_ingest.py). The cap encloses the
    # internal retries and any provider fallback rather than multiplying
    # them. Worst case arithmetic:
    #   vision: (1 + 1 retry) * 18s + 1s backoff              = 37s
    #   parse:  min(remaining, 40 - 37)                        <= 3s
    #   server-side AI time                                    <= 40s
    #   + transport/proxy headroom (upload, Vercel -> Railway) <= 5s
    #   = 45s = SCAN_TIMEOUT_MS in nextjs/src/lib/api/scan.ts (not owned here).
    # A fast OCR leaves the parse most of the 40s; only a slow OCR squeezes it.
    scan_request_budget_seconds: float = 40.0

    # /health/ai generation probe — issue #576. Gemini's is_available() is a
    # model-metadata GET: it still answers 200 when the key is spend-capped, so
    # /health/ai read green through an outage where every generation 429'd. The
    # probe runs one tiny real generation through AIManager and caches the
    # result for this many seconds so health checks do not burn quota (each
    # probe that isn't served from the cache is a real provider call; 3600s is
    # at most 24 successful probes a day). 0 disables the probe and keeps the
    # old reachability-only behaviour. The token cap keeps each probe nearly
    # free. Tradeoff (approved by Ayush 2026-10-01): an outage that starts
    # after a successful probe can read healthy for up to an hour. A FAILED probe is cached for the shorter failure TTL so /health/ai
    # recovers soon after an outage ends (a 429/error isn't billed, so probing
    # a down provider more often costs nothing); 0 re-probes on every call.
    health_generation_probe_ttl_seconds: int = Field(default=3600, ge=0)
    health_generation_probe_failure_ttl_seconds: int = Field(default=60, ge=0)
    # 16, not 1-5: on a thinking model (gemini-3.1-flash-lite) thinking tokens
    # count against maxOutputTokens, so a 4-token cap can be spent before any
    # text is emitted. We do not send a thinkingConfig to avoid that: the knob
    # is model-specific (thinkingBudget on 2.5, thinkingLevel on 3.x, and
    # thinkingBudget=0 is rejected by models that can't disable thinking), and
    # an unsupported field would 400 and read as a false outage. 16 leaves room
    # for a little thinking plus the one-word reply at a cost that is still
    # negligible, and a MAX_TOKENS reply with no text is treated as healthy
    # anyway (see AIManager._run_generation_probe).
    health_generation_probe_max_output_tokens: int = Field(default=16, ge=1)

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
    # Minimum confidence to auto-act on modify-vs-new-dish decisions in
    # RECIPE_EXPLORING mode.  Below this threshold the workflow emits a
    # CONFIRM_CHOICE next_action instead of acting immediately (#416 Q5).
    confirm_band_confidence_threshold: float = 0.85

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
