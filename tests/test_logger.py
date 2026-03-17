"""Tests for logging utilities and middleware."""

import logging

from bubbly_chef.logger import (
    get_logger,
    log_ai_call,
    log_db_operation,
    log_error,
    log_request,
    log_response,
)


class TestGetLogger:
    def test_returns_logger(self):
        lgr = get_logger("test_module")
        assert isinstance(lgr, logging.Logger)
        assert lgr.name == "test_module"


class TestLogRequest:
    def test_basic_request(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.INFO, logger="test"):
            log_request(lgr, "GET", "/api/pantry")
        assert "GET" in caplog.text
        assert "/api/pantry" in caplog.text

    def test_request_with_query(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.INFO, logger="test"):
            log_request(lgr, "GET", "/api/pantry", query="days=3")
        assert "query=days=3" in caplog.text

    def test_request_with_none_kwargs(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.INFO, logger="test"):
            log_request(lgr, "POST", "/api/chat", user_id=None)
        # None values are filtered out
        assert "user_id" not in caplog.text


class TestLogResponse:
    def test_success_response(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.INFO, logger="test"):
            log_response(lgr, "GET", "/health", 200, 5.0)
        assert "200" in caplog.text
        assert "5.00ms" in caplog.text

    def test_error_response(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.INFO, logger="test"):
            log_response(lgr, "POST", "/apply", 500, 100.5)
        assert "500" in caplog.text


class TestLogError:
    def test_basic_error(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.ERROR, logger="test"):
            log_error(lgr, "Failed to process", ValueError("bad input"))
        assert "ValueError" in caplog.text
        assert "bad input" in caplog.text

    def test_error_with_context(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.ERROR, logger="test"):
            log_error(lgr, "DB error", RuntimeError("timeout"), table="pantry_items")
        assert "table=pantry_items" in caplog.text


class TestLogAiCall:
    def test_with_tokens_and_duration(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.INFO, logger="test"):
            log_ai_call(lgr, "gemini", "gemini-flash", prompt_tokens=100, completion_tokens=50, duration_ms=250.0)
        assert "gemini/gemini-flash" in caplog.text
        assert "(100+50 tokens)" in caplog.text
        assert "250.00ms" in caplog.text

    def test_without_tokens(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.INFO, logger="test"):
            log_ai_call(lgr, "ollama", "llama3")
        assert "ollama/llama3" in caplog.text


class TestLogDbOperation:
    def test_basic_operation(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.DEBUG, logger="test"):
            log_db_operation(lgr, "insert", "pantry_items", count=3)
        assert "INSERT" in caplog.text
        assert "pantry_items" in caplog.text
        assert "count=3" in caplog.text

    def test_with_context(self, caplog):
        lgr = get_logger("test")
        with caplog.at_level(logging.DEBUG, logger="test"):
            log_db_operation(lgr, "delete", "pantry_items", item_id="abc")
        assert "item_id=abc" in caplog.text
