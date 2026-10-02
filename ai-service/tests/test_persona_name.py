"""Issue #894: the chat assistant's name is Bubbly (BubblyChef is the app).

The persona lines are the only place the assistant is told who it is; the UI
calls the mascot Bubbly, so the model must not answer to another name.
"""

import inspect

from bubbly_chef.prompts.chat import (
    _COOKING_REACT_SYSTEM_PROMPT,
    _COOKING_SYSTEM_PROMPT,
    GENERAL_CHAT_SYSTEM_PROMPT,
)
from bubbly_chef.workflows import router


def test_chat_persona_prompts_name_the_assistant_bubbly() -> None:
    for prompt in (
        GENERAL_CHAT_SYSTEM_PROMPT,
        _COOKING_SYSTEM_PROMPT,
        _COOKING_REACT_SYSTEM_PROMPT,
    ):
        assert prompt.lstrip().startswith("You are Bubbly,")
        assert "Bubbles" not in prompt


def test_cooking_help_prompt_in_router_names_bubbly() -> None:
    source = inspect.getsource(router)
    assert "You are Bubbly, a friendly cooking assistant for BubblyChef" in source
