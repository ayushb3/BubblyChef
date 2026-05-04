# Logging Guide for BubblyChef

This document explains how to use the logging system in BubblyChef.

## Overview

BubblyChef uses a centralized logging system with:
- **Colored console output** for better readability
- **Structured logging helpers** for common operations
- **Request/response middleware** for automatic HTTP logging
- **Configurable log levels** based on debug mode
- **Optional file logging** for production

## Configuration

### Environment Variables

```bash
# Enable debug mode for verbose logging
BUBBLY_DEBUG=true

# Optional: Log to file (creates file if it doesn't exist)
BUBBLY_LOG_FILE=./logs/bubbly_chef.log

# Enable/disable HTTP request logging
BUBBLY_LOG_REQUESTS=true
```

### Log Levels

- **DEBUG mode** (`BUBBLY_DEBUG=true`): Shows all logs including DEBUG level
- **INFO mode** (default): Shows INFO, WARNING, ERROR, CRITICAL
- Third-party libraries (httpx, urllib3, etc.) are set to WARNING to reduce noise

## Basic Usage

### 1. Import the Logger

```python
from bubbly_chef.logger import get_logger

logger = get_logger(__name__)  # Use __name__ for automatic module naming
```

### 2. Basic Logging

```python
# Info level - general operations
logger.info("Starting process")

# Debug level - detailed information
logger.debug(f"Processing item: {item_id}")

# Warning level - unexpected but handled situations
logger.warning("API key not configured, using fallback")

# Error level - errors that need attention
logger.error(f"Failed to process item: {error}")

# Critical level - system failures
logger.critical("Database connection lost!")
```

## Structured Logging Helpers

The logger module provides specialized functions for common operations:

### 1. HTTP Request/Response Logging

**Automatic via middleware** - already configured, no code needed!

All HTTP requests are automatically logged with:
- Request: `➡️  GET /api/pantry query=search=milk`
- Response: `✅ GET /api/pantry - 200 (45.23ms)`

To disable: Set `BUBBLY_LOG_REQUESTS=false`

### 2. Database Operations

```python
from bubbly_chef.logger import log_db_operation

# Insert operation
await repo.add_pantry_item(item)
log_db_operation(logger, "insert", "pantry_items", 1, item_id=item.id)
# Output: 💾 DB: INSERT pantry_items (count=1) item_id=abc123

# Update operation
await repo.update_pantry_item(item_id, data)
log_db_operation(logger, "update", "pantry_items", 1, item_id=item_id)

# Select with filters
items = await repo.get_pantry_items(category="dairy")
log_db_operation(logger, "select", "pantry_items", len(items), category="dairy")

# Bulk operation
deleted = await repo.delete_many(item_ids)
log_db_operation(logger, "delete", "pantry_items", len(deleted))
```

### 3. Error Logging

```python
from bubbly_chef.logger import log_error

try:
    result = await some_operation()
except Exception as e:
    log_error(logger, "Operation failed", e, item_id=item_id, user="john")
    # Output: Operation failed: ValueError: Invalid input item_id=abc123 user=john
    raise
```

### 4. AI Provider Calls

```python
from bubbly_chef.logger import log_ai_call

# Log AI call with token usage
response = await ai_client.generate(prompt)
log_ai_call(
    logger,
    provider="gemini",
    model="gemini-2.0-flash",
    prompt_tokens=150,
    completion_tokens=320,
    duration_ms=1234.5
)
# Output: 🤖 AI call: gemini/gemini-2.0-flash (150+320 tokens) in 1234.50ms
```

## Common Patterns

### API Endpoint Pattern

```python
from bubbly_chef.logger import get_logger, log_db_operation, log_error

logger = get_logger(__name__)

@router.post("/items")
async def create_item(data: ItemCreate):
    try:
        # Debug: Show input
        logger.debug(f"Creating item: {data.name}")

        # Perform operation
        item = await process_item(data)

        # Log database operation
        log_db_operation(logger, "insert", "items", 1, item_id=item.id)

        # Info: Show result
        logger.info(f"➕ Created item: {item.name} (id={item.id})")

        return item

    except ValidationError as e:
        logger.warning(f"Validation failed for item '{data.name}': {e}")
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        log_error(logger, f"Failed to create item '{data.name}'", e)
        raise
```

### Workflow Pattern

```python
from bubbly_chef.logger import get_logger, log_ai_call

logger = get_logger(__name__)

async def process_workflow(input_data):
    logger.info(f"🔄 Starting workflow: {workflow_name}")

    try:
        # Step 1
        logger.debug("Step 1: Parsing input")
        parsed = await parse_input(input_data)

        # Step 2
        logger.debug("Step 2: Calling AI")
        response = await ai_client.generate(parsed)
        log_ai_call(logger, "gemini", "gemini-2.0-flash",
                   prompt_tokens=100, completion_tokens=200)

        # Step 3
        logger.debug("Step 3: Saving results")
        result = await save_results(response)

        logger.info(f"✅ Workflow completed: {workflow_name}")
        return result

    except Exception as e:
        log_error(logger, f"Workflow '{workflow_name}' failed", e,
                 step=current_step)
        raise
```

### Repository Pattern

```python
from bubbly_chef.logger import get_logger, log_db_operation

logger = get_logger(__name__)

class PantryRepository:
    async def add_item(self, item: PantryItem) -> PantryItem:
        logger.debug(f"Adding item to database: {item.name}")

        # Database operation
        result = await self._db.execute(...)

        log_db_operation(logger, "insert", "pantry_items", 1,
                        item_id=result.id, name=item.name)

        return result
```

## Output Examples

### Console Output (with colors in terminal)

```
2026-03-06 10:15:23 - bubbly_chef.api.app - INFO - Starting BubblyChef v0.2.0
2026-03-06 10:15:23 - bubbly_chef.api.app - INFO - Database initialized
2026-03-06 10:15:24 - bubbly_chef.api.app - INFO - AI providers available: ['gemini']
2026-03-06 10:15:30 - bubbly_chef.api.middleware - INFO - ➡️  POST /api/pantry
2026-03-06 10:15:30 - bubbly_chef.api.routes.pantry - DEBUG - Normalized 'Whole Milk' -> 'milk'
2026-03-06 10:15:30 - bubbly_chef.api.routes.pantry - DEBUG - Auto-detected category: dairy
2026-03-06 10:15:30 - bubbly_chef.api.routes.pantry - DEBUG - Default location for dairy: fridge
2026-03-06 10:15:30 - bubbly_chef.api.routes.pantry - DEBUG - Estimated expiry: 2026-03-13 (7 days)
2026-03-06 10:15:30 - bubbly_chef.api.routes.pantry - DEBUG - 💾 DB: INSERT pantry_items (count=1) item_id=abc123
2026-03-06 10:15:30 - bubbly_chef.api.routes.pantry - INFO - ➕ Added pantry item: Whole Milk (1.0 gallon, dairy)
2026-03-06 10:15:30 - bubbly_chef.api.middleware - INFO - ✅ POST /api/pantry - 201 (45.23ms)
```

### File Output (no colors)

```
2026-03-06 10:15:23 - bubbly_chef.api.app - INFO - Starting BubblyChef v0.2.0
2026-03-06 10:15:30 - bubbly_chef.api.routes.pantry - INFO - Added pantry item: Whole Milk (1.0 gallon, dairy)
```

## Best Practices

1. **Use `__name__` for logger names**: `get_logger(__name__)` automatically names the logger after the module

2. **Log at appropriate levels**:
   - DEBUG: Internal state, variable values, detailed flow
   - INFO: High-level operations, business events (item added, workflow completed)
   - WARNING: Unexpected but handled (missing config, API fallback)
   - ERROR: Errors that need attention (failed operations, exceptions)
   - CRITICAL: System failures (database down, critical service unavailable)

3. **Use structured logging helpers**: They provide consistent formatting and emojis

4. **Include context**: Use keyword arguments to add relevant context
   ```python
   log_error(logger, "Upload failed", e, user_id=user.id, file_name=file.name)
   ```

5. **Don't log sensitive data**: Avoid logging passwords, API keys, personal info

6. **Log before and after important operations**:
   ```python
   logger.info("Starting import")
   result = await import_data()
   logger.info(f"Import completed: {result.count} items")
   ```

## Disabling Logging

### Disable HTTP request logging
```bash
BUBBLY_LOG_REQUESTS=false
```

### Reduce log level in production
```bash
BUBBLY_DEBUG=false  # Only INFO and above
```

### Disable specific loggers in code
```python
import logging
logging.getLogger("specific.module").setLevel(logging.WARNING)
```

## Troubleshooting

### Not seeing debug logs?
- Check `BUBBLY_DEBUG=true` is set
- Verify the logger level: `logger.level` should be `DEBUG` (10)

### Too many logs from libraries?
- Third-party libraries are already set to WARNING level
- To silence more: Edit `bubbly_chef/logger.py` and add:
  ```python
  logging.getLogger("annoying_library").setLevel(logging.ERROR)
  ```

### Want JSON logs for production?
- Update `setup_logging()` in `logger.py` to use `JSONFormatter`
- Or integrate with external logging service (Sentry, DataDog, etc.)
