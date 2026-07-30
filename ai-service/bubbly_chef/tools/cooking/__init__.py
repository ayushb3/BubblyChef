"""Cooking tools package.

Importing this package registers all cooking-specific tools with the
tool registry. Import it explicitly in any node or route that needs the
cooking tools — there is no import-time magic elsewhere.

    import bubbly_chef.tools.cooking  # registers check_pantry, etc.
"""

from bubbly_chef.tools.cooking import pantry_tools as pantry_tools  # noqa: F401

__all__ = ["pantry_tools"]
