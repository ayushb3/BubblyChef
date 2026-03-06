#!/usr/bin/env python3
"""Demo script to test the logging system."""

from bubbly_chef.logger import (
    setup_logging,
    get_logger,
    log_request,
    log_response,
    log_db_operation,
    log_ai_call,
    log_error,
)

# Setup logging
setup_logging()

# Get a logger
logger = get_logger("demo")

def main():
    """Demonstrate different logging features."""
    logger.info("=== BubblyChef Logging Demo ===")
    logger.info("")

    # Basic logging
    logger.info("🎯 Basic Logging Examples")
    logger.debug("This is a debug message (only visible in debug mode)")
    logger.info("This is an info message")
    logger.warning("This is a warning message")
    logger.error("This is an error message")
    logger.info("")

    # HTTP request/response logging
    logger.info("🌐 HTTP Request/Response Logging")
    log_request(logger, "GET", "/api/pantry", query="category=dairy")
    log_response(logger, "GET", "/api/pantry", 200, 45.23)
    log_request(logger, "POST", "/api/pantry")
    log_response(logger, "POST", "/api/pantry", 201, 123.45)
    logger.info("")

    # Database operations
    logger.info("💾 Database Operation Logging")
    log_db_operation(logger, "insert", "pantry_items", 1, item_id="abc123")
    log_db_operation(logger, "select", "pantry_items", 15, category="dairy")
    log_db_operation(logger, "update", "pantry_items", 1, item_id="xyz789")
    log_db_operation(logger, "delete", "pantry_items", 3)
    logger.info("")

    # AI calls
    logger.info("🤖 AI Provider Call Logging")
    log_ai_call(logger, "gemini", "gemini-2.0-flash", 150, 320, 1234.56)
    log_ai_call(logger, "ollama", "llama3.2:3b", duration_ms=2345.67)
    logger.info("")

    # Error logging
    logger.info("❌ Error Logging")
    try:
        raise ValueError("Something went wrong!")
    except Exception as e:
        log_error(logger, "Operation failed", e, item_id="test123", user="demo")
    logger.info("")

    # Business events
    logger.info("📦 Business Event Logging")
    logger.info("➕ Added pantry item: Whole Milk (1.0 gallon, dairy)")
    logger.info("✏️  Updated pantry item: Greek Yogurt (id=abc123)")
    logger.info("🗑️  Deleted pantry item: Expired Cheese (id=xyz789)")
    logger.info("📦 Listed 42 items (expiring: 5, expired: 2)")
    logger.info("")

    logger.info("=== Demo Complete ===")

if __name__ == "__main__":
    main()
