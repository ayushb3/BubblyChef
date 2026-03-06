"""Centralized logging configuration for BubblyChef."""

import logging
import sys
from typing import Any

from bubbly_chef.config import settings


class ColoredFormatter(logging.Formatter):
    """Custom formatter with colors for different log levels."""

    # ANSI color codes
    COLORS = {
        "DEBUG": "\033[36m",  # Cyan
        "INFO": "\033[32m",  # Green
        "WARNING": "\033[33m",  # Yellow
        "ERROR": "\033[31m",  # Red
        "CRITICAL": "\033[35m",  # Magenta
    }
    RESET = "\033[0m"
    BOLD = "\033[1m"

    def format(self, record: logging.LogRecord) -> str:
        """Format log record with colors."""
        # Add color to level name
        levelname = record.levelname
        if levelname in self.COLORS:
            record.levelname = (
                f"{self.COLORS[levelname]}{self.BOLD}{levelname}{self.RESET}"
            )

        # Add color to logger name
        record.name = f"\033[90m{record.name}{self.RESET}"

        return super().format(record)


def setup_logging() -> None:
    """
    Configure application-wide logging.

    Sets up:
    - Console handler with colored output
    - File handler for persistent logs (if configured)
    - Different log levels based on debug mode
    """
    # Root logger configuration
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG if settings.debug else logging.INFO)

    # Remove existing handlers
    root_logger.handlers.clear()

    # Console handler with colors
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG if settings.debug else logging.INFO)

    # Format: timestamp - logger - level - message
    console_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    if settings.debug:
        # More verbose in debug mode
        console_format = (
            "%(asctime)s - %(name)s - %(levelname)s - "
            "[%(filename)s:%(lineno)d] - %(message)s"
        )

    console_formatter = ColoredFormatter(
        console_format, datefmt="%Y-%m-%d %H:%M:%S"
    )
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)

    # File handler (optional)
    if hasattr(settings, "log_file") and settings.log_file:
        file_handler = logging.FileHandler(settings.log_file)
        file_handler.setLevel(logging.INFO)
        file_formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        file_handler.setFormatter(file_formatter)
        root_logger.addHandler(file_handler)

    # Reduce noise from third-party libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("anthropic").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for a module.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Configured logger instance
    """
    return logging.getLogger(name)


def log_request(logger: logging.Logger, method: str, path: str, **kwargs: Any) -> None:
    """
    Log an incoming HTTP request.

    Args:
        logger: Logger instance
        method: HTTP method (GET, POST, etc.)
        path: Request path
        **kwargs: Additional context (user_id, query_params, etc.)
    """
    context = " ".join(f"{k}={v}" for k, v in kwargs.items() if v is not None)
    logger.info(f"➡️  {method} {path} {context}".strip())


def log_response(
    logger: logging.Logger, method: str, path: str, status_code: int, duration_ms: float
) -> None:
    """
    Log an HTTP response.

    Args:
        logger: Logger instance
        method: HTTP method
        path: Request path
        status_code: HTTP status code
        duration_ms: Request duration in milliseconds
    """
    emoji = "✅" if status_code < 400 else "❌"
    logger.info(
        f"{emoji} {method} {path} - {status_code} ({duration_ms:.2f}ms)"
    )


def log_error(
    logger: logging.Logger, message: str, error: Exception, **kwargs: Any
) -> None:
    """
    Log an error with context.

    Args:
        logger: Logger instance
        message: Error message
        error: Exception instance
        **kwargs: Additional context
    """
    context = " ".join(f"{k}={v}" for k, v in kwargs.items() if v is not None)
    logger.error(f"{message}: {error.__class__.__name__}: {error} {context}".strip())


def log_ai_call(
    logger: logging.Logger,
    provider: str,
    model: str,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    duration_ms: float | None = None,
) -> None:
    """
    Log an AI provider call.

    Args:
        logger: Logger instance
        provider: Provider name (gemini, ollama)
        model: Model name
        prompt_tokens: Number of prompt tokens
        completion_tokens: Number of completion tokens
        duration_ms: Call duration in milliseconds
    """
    tokens_info = ""
    if prompt_tokens and completion_tokens:
        tokens_info = f"({prompt_tokens}+{completion_tokens} tokens)"

    duration_info = f" in {duration_ms:.2f}ms" if duration_ms else ""

    logger.info(f"🤖 AI call: {provider}/{model} {tokens_info}{duration_info}".strip())


def log_db_operation(
    logger: logging.Logger, operation: str, table: str, count: int = 1, **kwargs: Any
) -> None:
    """
    Log a database operation.

    Args:
        logger: Logger instance
        operation: Operation type (insert, update, delete, select)
        table: Table name
        count: Number of affected rows
        **kwargs: Additional context (item_id, filters, etc.)
    """
    context = " ".join(f"{k}={v}" for k, v in kwargs.items() if v is not None)
    logger.debug(
        f"💾 DB: {operation.upper()} {table} (count={count}) {context}".strip()
    )
