"""LLM prompt text for the BubblyChef AI microservice.

This package holds prompt *text* only — module-level string constants
grouped by domain (router, chat, recipe, pantry, ingest, cook, recipe_url,
dashboard). The code that builds/sends prompts stays where it always lived
(workflows/, services/); it imports the constants from here.

CODEOWNERS-gated: this is the one path in ai-service/ where a change is
reviewed as a behavior change, not a refactor. mypy/ruff/pytest all pass on a
prompt edit that quietly makes the model worse — human review is the only
gate that catches that.
"""

from bubbly_chef.prompts.ingest import (
    PRODUCT_PARSE_SYSTEM_PROMPT,
    PRODUCT_PARSE_USER_PROMPT_TEMPLATE,
    RECEIPT_PARSE_PROMPT,
    RECEIPT_PARSE_SYSTEM_PROMPT,
    RECEIPT_PARSE_USER_PROMPT_TEMPLATE,
)
from bubbly_chef.prompts.chat import (
    GENERAL_CHAT_SYSTEM_PROMPT,
    GENERAL_CHAT_USER_PROMPT,
    MODE_SYSTEM_PROMPTS,
)
from bubbly_chef.prompts.pantry import (
    PANTRY_PARSE_SYSTEM_PROMPT,
    PANTRY_PARSE_USER_PROMPT,
    SUGGEST_SPECIFICS_SYSTEM_PROMPT,
    SUGGEST_SPECIFICS_USER_PROMPT,
)
from bubbly_chef.prompts.recipe import (
    BRAINSTORM_SYSTEM_PROMPT,
    BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY,
    GROUNDED_RECIPE_SYSTEM_PROMPT,
    RECIPE_CONSTRAINTS_SYSTEM_PROMPT,
    RECIPE_FOLLOWUP_PROMPT,
    RECIPE_GENERATION_PROMPT,
)
from bubbly_chef.prompts.router import (
    INTENT_CLASSIFICATION_SYSTEM_PROMPT,
    INTENT_CLASSIFICATION_USER_PROMPT,
)

__all__ = [
    "BRAINSTORM_SYSTEM_PROMPT",
    "BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY",
    "GENERAL_CHAT_SYSTEM_PROMPT",
    "GENERAL_CHAT_USER_PROMPT",
    "GROUNDED_RECIPE_SYSTEM_PROMPT",
    "INTENT_CLASSIFICATION_SYSTEM_PROMPT",
    "INTENT_CLASSIFICATION_USER_PROMPT",
    "MODE_SYSTEM_PROMPTS",
    "PANTRY_PARSE_SYSTEM_PROMPT",
    "PANTRY_PARSE_USER_PROMPT",
    "PRODUCT_PARSE_SYSTEM_PROMPT",
    "PRODUCT_PARSE_USER_PROMPT_TEMPLATE",
    "RECEIPT_PARSE_PROMPT",
    "RECEIPT_PARSE_SYSTEM_PROMPT",
    "RECEIPT_PARSE_USER_PROMPT_TEMPLATE",
    "RECIPE_CONSTRAINTS_SYSTEM_PROMPT",
    "RECIPE_FOLLOWUP_PROMPT",
    "RECIPE_GENERATION_PROMPT",
    "SUGGEST_SPECIFICS_SYSTEM_PROMPT",
    "SUGGEST_SPECIFICS_USER_PROMPT",
]
