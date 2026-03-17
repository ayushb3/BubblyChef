"""
Quick Reference: Adding Logging to Your Module
================================================

Copy-paste templates for common logging scenarios.
"""

# =============================================================================
# 1. BASIC SETUP - Add to top of any module
# =============================================================================

from bubbly_chef.logger import get_logger

logger = get_logger(__name__)  # Always use __name__


# =============================================================================
# 2. API ENDPOINT TEMPLATE
# =============================================================================

from fastapi import APIRouter, HTTPException

from bubbly_chef.logger import get_logger, log_db_operation, log_error

logger = get_logger(__name__)
router = APIRouter()


@router.post("/items")
async def create_item(data: ItemCreate):
    """Create a new item."""
    try:
        # 1. Log what you're doing
        logger.debug(f"Creating item: {data.name}")

        # 2. Do the work
        item = await process_item(data)
        await repo.add_item(item)

        # 3. Log database operation
        log_db_operation(logger, "insert", "items", 1, item_id=item.id)

        # 4. Log success with emoji
        logger.info(f"➕ Created item: {item.name} (id={item.id})")

        return item

    except ValidationError as e:
        logger.warning(f"Validation failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log_error(logger, f"Failed to create item '{data.name}'", e)
        raise


# =============================================================================
# 3. REPOSITORY/DATABASE TEMPLATE
# =============================================================================

from bubbly_chef.logger import get_logger

logger = get_logger(__name__)


class MyRepository:
    """Repository for managing items."""

    async def add_item(self, item: Item) -> Item:
        """Add an item to the database."""
        logger.debug(f"Inserting item: {item.name}")

        result = await self.db.execute(...)
        log_db_operation(logger, "insert", "items", 1, item_id=result.id)

        return result

    async def get_items(self, category: str | None = None) -> list[Item]:
        """Get items with optional filter."""
        items = await self.db.query(...)
        log_db_operation(
            logger, "select", "items", len(items),
            category=category
        )
        return items


# =============================================================================
# 4. WORKFLOW/SERVICE TEMPLATE
# =============================================================================

from bubbly_chef.logger import get_logger, log_ai_call

logger = get_logger(__name__)


async def process_receipt(image: bytes) -> ParsedReceipt:
    """Process a receipt image."""
    logger.info("🔄 Starting receipt processing")

    try:
        # Step 1: OCR
        logger.debug("Step 1: Running OCR")
        text = await ocr_service.extract_text(image)
        logger.debug(f"Extracted {len(text)} characters")

        # Step 2: AI parsing
        logger.debug("Step 2: Parsing with AI")
        start_time = time.time()
        response = await ai_client.parse(text)
        duration_ms = (time.time() - start_time) * 1000

        log_ai_call(
            logger,
            provider="gemini",
            model="gemini-2.0-flash",
            prompt_tokens=len(text) // 4,
            completion_tokens=100,
            duration_ms=duration_ms,
        )

        # Step 3: Validate
        logger.debug("Step 3: Validating results")
        validated = validate_items(response.items)

        logger.info(f"✅ Receipt processing complete: {len(validated)} items")
        return ParsedReceipt(items=validated)

    except OCRError as e:
        logger.error(f"OCR failed: {e}")
        raise
    except Exception as e:
        log_error(logger, "Receipt processing failed", e)
        raise


# =============================================================================
# 5. AI PROVIDER TEMPLATE
# =============================================================================

from bubbly_chef.logger import get_logger

logger = get_logger(__name__)


class AIClient:
    """Client for AI provider."""

    async def generate(self, prompt: str) -> str:
        """Generate text from prompt."""
        logger.debug(f"Calling AI with {len(prompt)} char prompt")

        try:
            start_time = time.time()
            response = await self.client.generate(prompt)
            duration_ms = (time.time() - start_time) * 1000

            # Log the AI call
            log_ai_call(
                logger,
                provider=self.provider_name,
                model=self.model_name,
                prompt_tokens=response.usage.prompt_tokens,
                completion_tokens=response.usage.completion_tokens,
                duration_ms=duration_ms,
            )

            return response.text

        except APIError as e:
            log_error(logger, "AI call failed", e, model=self.model_name)
            raise


# =============================================================================
# 6. ERROR HANDLING TEMPLATE
# =============================================================================

from bubbly_chef.logger import get_logger

logger = get_logger(__name__)


async def risky_operation(item_id: str):
    """An operation that might fail."""
    try:
        result = await dangerous_function(item_id)
        return result

    except ValueError as e:
        # Expected error - log as warning
        logger.warning(f"Invalid input for {item_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    except ExternalAPIError as e:
        # External service error - log with context
        log_error(
            logger,
            "External API failed",
            e,
            item_id=item_id,
            service="external_api"
        )
        raise HTTPException(status_code=503, detail="Service unavailable")

    except Exception as e:
        # Unexpected error - log with full context
        log_error(logger, f"Unexpected error processing {item_id}", e)
        raise


# =============================================================================
# 7. EMOJIS FOR CONSISTENCY
# =============================================================================

# Use these emojis for consistent logging:

logger.info("➡️  Incoming request")      # HTTP request
logger.info("✅ Request succeeded")       # HTTP success
logger.info("❌ Request failed")          # HTTP error

logger.info("➕ Added item")              # Create
logger.info("✏️  Updated item")           # Update
logger.info("🗑️  Deleted item")          # Delete
logger.info("📦 Listed items")            # List/Read

logger.info("💾 Database operation")     # DB ops (via helper)
logger.info("🤖 AI call")                # AI calls (via helper)

logger.info("🔄 Starting workflow")      # Process start
logger.info("✅ Workflow complete")      # Process success
logger.error("❌ Workflow failed")       # Process failure

logger.info("📸 Receipt scanned")        # Scanning
logger.info("🍕 Recipe generated")       # Recipes
logger.info("👤 User action")            # User events


# =============================================================================
# 8. LOG LEVEL GUIDE
# =============================================================================

# DEBUG - Internal details (only in debug mode)
logger.debug("Variable value: x=5")
logger.debug("Entering function foo()")
logger.debug(f"Processing {len(items)} items")

# INFO - Business events (always visible)
logger.info("User logged in")
logger.info("Item added to pantry")
logger.info("Workflow completed")

# WARNING - Unexpected but handled
logger.warning("API key missing, using fallback")
logger.warning("Rate limit approaching")
logger.warning("Invalid input, using default")

# ERROR - Errors that need attention
logger.error("Database query failed")
log_error(logger, "Operation failed", exception)

# CRITICAL - System failures (rarely used)
logger.critical("Database connection lost!")
logger.critical("All AI providers unavailable!")
