"""Middleware for logging and monitoring."""

import time
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from bubbly_chef.config import settings
from bubbly_chef.logger import get_logger, log_request, log_response

logger = get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """Middleware to log all HTTP requests and responses."""

    async def dispatch(
        self, request: Request, call_next: Callable
    ) -> Response:
        """Log request and response details."""
        if not settings.log_requests:
            return await call_next(request)

        # Extract request info
        method = request.method
        path = request.url.path
        query_params = str(request.query_params) if request.query_params else None

        # Log incoming request
        log_request(logger, method, path, query=query_params)

        # Process request and measure time
        start_time = time.time()
        try:
            response = await call_next(request)
            duration_ms = (time.time() - start_time) * 1000

            # Log response
            log_response(logger, method, path, response.status_code, duration_ms)

            return response

        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            logger.error(
                f"❌ {method} {path} - Exception after {duration_ms:.2f}ms: {e}"
            )
            raise
