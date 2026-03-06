"""BubblyChef API package."""

# Lazy imports to avoid circular dependencies
__all__ = ["create_app", "app"]


def __getattr__(name):
    if name in ("create_app", "app"):
        from bubbly_chef.api.app import create_app, app
        return create_app if name == "create_app" else app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
