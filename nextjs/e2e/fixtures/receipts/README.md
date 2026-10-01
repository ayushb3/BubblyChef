# Receipt fixtures

Shared by two consumers: the Playwright receipt-ingestion e2e (`nextjs/e2e/`) and
the scan quality harness (`ai-service/tests/scan_quality/`, issue #255).

A fixture is `<name>.png|jpg|jpeg` plus `<name>.expected.json`. An image with no
expected file (`grocery-mart-stub.png`) is ignored by the harness.

To add a receipt, see `ai-service/tests/scan_quality/README.md`.
