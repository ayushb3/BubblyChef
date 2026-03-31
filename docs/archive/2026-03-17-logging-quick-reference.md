# Logging Quick Reference

## Best Practices (Copy These)

### Entry Log with Structured Context
```python
from datetime import datetime
from bubbly_chef.logger import get_logger

logger = get_logger(__name__)

@router.post("/some-endpoint")
async def some_handler(request: SomeRequest) -> SomeResponse:
    start_time = datetime.now()
    
    logger.info(
        "Some operation requested",
        extra={
            "field1": request.field1,
            "field2": request.field2[:100] if request.field2 else None,
            "has_optional": request.optional is not None,
        },
    )
    
    try:
        # ... business logic ...
        
        elapsed = (datetime.now() - start_time).total_seconds()
        logger.info(
            "Operation completed",
            extra={
                "result_key": result_value,
                "count": len(items),
                "elapsed_seconds": elapsed,
            },
        )
        return result
        
    except Exception as e:
        elapsed = (datetime.now() - start_time).total_seconds()
        logger.error(
            "Operation failed",
            extra={
                "error": str(e),
                "error_type": type(e).__name__,
                "elapsed_seconds": elapsed,
            },
            exc_info=True,  # Include stack trace
        )
        raise HTTPException(status_code=500, detail=str(e))
```

### Simple Error Log with Context
```python
try:
    result = await repo.add_item(item)
except Exception as e:
    logger.error(f"Failed to add item {item.name}: {e}")
    raise HTTPException(status_code=500, detail=f"Failed to add item: {str(e)}")
```

### Using Helper Functions
```python
from bubbly_chef.logger import log_error, log_request, log_response

# In request handler
logger.info(f"Processing {request.id}")

# On error
log_error(logger, "Failed to process item", exception, item_id=request.id)

# Or manually
try:
    ...
except Exception as e:
    logger.error(f"Failed to process: {e}", exc_info=True)
    raise
```

---

## Common Patterns by Route

### Mutation Endpoints (POST/PUT/DELETE)
```python
logger.info(f"[OPERATION] for {identifier}: {description}")
# ... do work ...
logger.info(f"[OPERATION] completed: {identifier}")
# Error: logger.error(f"[OPERATION] failed: {e}", exc_info=True)
```

### Query Endpoints (GET)
```python
# Simple GETs: minimal logging (unless reading large datasets)
# Complex GETs with calculations: log entry + result summary
logger.info(f"Fetching [resource] with filters...")
logger.info(f"Found {count} results, applying {filter_count} filters")
```

### Async Workflows
```python
start_time = datetime.now()
logger.info("Workflow started", extra={"workflow_id": ..., "intent": ...})
try:
    result = await workflow(...)
    elapsed = (datetime.now() - start_time).total_seconds()
    logger.info("Workflow completed", extra={"elapsed_seconds": elapsed, ...})
except Exception as e:
    elapsed = (datetime.now() - start_time).total_seconds()
    logger.error("Workflow failed", extra={"error": str(e), "elapsed_seconds": elapsed}, exc_info=True)
```

---

## What NOT to Do

❌ **Bare except without logging**
```python
try:
    process()
except Exception as e:
    failed_list.append(str(e))  # WRONG: silent failure
```

❌ **Logging sensitive data**
```python
logger.info(f"Processing with API key: {api_key}")  # WRONG: exposes secrets
```
INSTEAD:
```python
logger.info("Processing with API key: [REDACTED]")
```

❌ **No timing on slow operations**
```python
logger.info("Query started")
# ... 30 seconds later ...
logger.info("Query done")  # No duration info
```

❌ **Mixing logging styles**
```python
logger.info(f"Result: {result}")  # f-string
logger.info(
    "Result",  # extra dict
    extra={"count": count}
)
# Use one consistently!
```

---

## Quick Checklist

- [ ] Logger imported: `logger = get_logger(__name__)` or `logger = logging.getLogger(__name__)`
- [ ] Request entry logged with key context
- [ ] Success logged with result summary and timing
- [ ] Errors logged with `exc_info=True` to capture stack trace
- [ ] No bare `except Exception:` without logger call
- [ ] Sensitive data truncated or redacted
- [ ] Using `extra={}` dict for structured context (on complex operations)
- [ ] HTTPException raised after logging errors
- [ ] Idempotent operations log item IDs
- [ ] Time measurements on workflows

---

## Logger Usage by File

| File | Import | Usage |
|---|---|---|
| health.py | ❌ | N/A (simple) |
| pantry.py | `import logging` | `logger = logging.getLogger(__name__)` |
| scan.py | `from bubbly_chef.logger import get_logger` | `logger = get_logger(__name__)` |
| recipes.py | `from bubbly_chef.logger import get_logger` | `logger = get_logger(__name__)` |
| profile.py | `import logging` | `logger = logging.getLogger(__name__)` |
| chat.py | `import logging` | `logger = logging.getLogger(__name__)` |
| ingest.py | `import logging` | `logger = logging.getLogger(__name__)` |
| apply.py | `import logging` | `logger = logging.getLogger(__name__)` |

Both `import logging` + `logging.getLogger(__name__)` and `from bubbly_chef.logger import get_logger` are equivalent and correct.

---

## Helper Functions

Located in `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/logger.py`:

```python
log_request(logger, method, path, query=None)
# ➡️  GET /pantry query=None

log_response(logger, method, path, status_code, duration_ms)
# ✅ GET /pantry - 200 (12.34ms)
# ❌ POST /pantry - 500 (5.67ms)

log_error(logger, message, error, **kwargs)
# ❌ Error: Failed to add item: ValueError: Item not found

log_ai_call(logger, provider, model, prompt_tokens, completion_tokens, duration_ms)
# 🤖 AI call: gemini/gemini-2.0-pro (123+456 tokens) in 1234.56ms

log_db_operation(logger, operation, table, count=1, **kwargs)
# 💾 DB: SELECT pantry_items (count=42)
```

---

## Debugging Tips

**Show all logs (no filtering):**
```bash
export BUBBLY_LOG_LEVEL=DEBUG
python -m uvicorn bubbly_chef.api.app:app --reload --port 8888
```

**Show request/response logs:**
- Set `log_requests=true` in config
- Check `LoggingMiddleware` is registered in app.py

**Find errors:**
```bash
grep "ERROR\|FAILED" logs.txt
```

**Track a workflow:**
```bash
grep "workflow_id=abc123" logs.txt
```

---

*Last updated: 2026-03-17*
