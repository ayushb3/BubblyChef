"""Drift guard for the e2e smoke suite's AI-unavailable detector (issue #773).

``nextjs/e2e/support/ai-unavailable.ts`` lists the canned replies the
ai-service sends when its model is down (provider.py, PR #736) so the smoke
test can fail on them. The TypeScript side cannot import Python, so this pins
the two lists together: edit the copy in ``provider.py`` without updating the
helper and this fails, instead of the smoke test going blind to the new text.
"""

from __future__ import annotations

import re
from pathlib import Path

from bubbly_chef.ai.provider import FAILURE_MESSAGES, NOT_CONFIGURED_MESSAGE

HELPER = Path(__file__).resolve().parents[2] / "nextjs" / "e2e" / "support" / "ai-unavailable.ts"

# One string literal per array line: either '...' (with \' escapes) or "...".
_LITERAL = re.compile(r"""^\s*(?:'((?:[^'\\]|\\.)*)'|"([^"]*)"),\s*$""")


def _helper_copy() -> set[str]:
    source = HELPER.read_text(encoding="utf-8")
    match = re.search(r"AI_UNAVAILABLE_COPY[^=]*=\s*\[\n(.*?)\n\];", source, re.DOTALL)
    assert match, "AI_UNAVAILABLE_COPY array not found in ai-unavailable.ts"
    copy: set[str] = set()
    for line in match.group(1).splitlines():
        literal = _LITERAL.match(line)
        assert literal, f"unparseable AI_UNAVAILABLE_COPY line: {line!r}"
        single, double = literal.groups()
        copy.add(single.replace("\\'", "'") if single is not None else double)
    return copy


def test_smoke_helper_lists_every_ai_unavailable_message() -> None:
    expected = set(FAILURE_MESSAGES.values()) | {NOT_CONFIGURED_MESSAGE}
    assert _helper_copy() == expected
