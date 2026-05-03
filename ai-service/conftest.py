def pytest_configure(config):  # type: ignore[no-untyped-def]
    config.addinivalue_line(
        "markers",
        "live: marks tests that call real AI APIs (skip with -m 'not live')",
    )
