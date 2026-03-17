"""Tests for the /v1/chat and /v1/workflows endpoints."""

from unittest.mock import AsyncMock, patch

import pytest

from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus


class TestChatEndpoint:
    @pytest.mark.asyncio
    async def test_basic_chat_returns_envelope(self, client) -> None:
        """POST /v1/chat returns a ProposalEnvelope."""
        mock_manager = AsyncMock()
        mock_manager.complete.return_value = "Here are some meal ideas!"

        repo_mock = AsyncMock()
        repo_mock.get_all_pantry_items.return_value = []
        repo_mock.get_conversation_history.return_value = []

        with (
            patch("bubbly_chef.workflows.chat_ingest.get_ai_manager", return_value=mock_manager),
            patch("bubbly_chef.workflows.chat_ingest.get_repository", return_value=repo_mock),
            patch("bubbly_chef.api.routes.chat.get_repository", return_value=repo_mock),
        ):
            response = await client.post(
                "/v1/chat",
                json={"message": "What can I cook tonight?"},
            )

        assert response.status_code == 200
        data = response.json()
        assert "intent" in data
        assert "assistant_message" in data
        assert "next_action" in data
        assert "requires_review" in data

    @pytest.mark.asyncio
    async def test_chat_returns_receipt_handoff(self, client) -> None:
        """Chat with receipt keyword returns receipt handoff intent."""
        repo_mock = AsyncMock()
        repo_mock.get_all_pantry_items.return_value = []
        repo_mock.get_conversation_history.return_value = []

        with (
            patch("bubbly_chef.workflows.chat_ingest.get_repository", return_value=repo_mock),
            patch("bubbly_chef.api.routes.chat.get_repository", return_value=repo_mock),
        ):
            response = await client.post(
                "/v1/chat",
                json={"message": "I want to scan a receipt"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["intent"] == Intent.RECEIPT_INGEST.value

    @pytest.mark.asyncio
    async def test_chat_empty_message_returns_422(self, client) -> None:
        """Empty message is rejected with 422 validation error."""
        response = await client.post("/v1/chat", json={"message": ""})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_chat_with_workflow_id(self, client) -> None:
        """Chat accepts optional workflow_id for conversation continuity."""
        import uuid
        mock_manager = AsyncMock()
        mock_manager.complete.return_value = "Continuing our conversation!"

        repo_mock = AsyncMock()
        repo_mock.get_all_pantry_items.return_value = []
        repo_mock.get_conversation_history.return_value = []

        with (
            patch("bubbly_chef.workflows.chat_ingest.get_ai_manager", return_value=mock_manager),
            patch("bubbly_chef.workflows.chat_ingest.get_repository", return_value=repo_mock),
            patch("bubbly_chef.api.routes.chat.get_repository", return_value=repo_mock),
        ):
            response = await client.post(
                "/v1/chat",
                json={
                    "message": "What can I cook?",
                    "workflow_id": str(uuid.uuid4()),
                },
            )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_chat_response_has_schema_version(self, client) -> None:
        """Response envelope includes schema_version."""
        mock_manager = AsyncMock()
        mock_manager.complete.return_value = "Sure!"

        repo_mock = AsyncMock()
        repo_mock.get_all_pantry_items.return_value = []
        repo_mock.get_conversation_history.return_value = []

        with (
            patch("bubbly_chef.workflows.chat_ingest.get_ai_manager", return_value=mock_manager),
            patch("bubbly_chef.workflows.chat_ingest.get_repository", return_value=repo_mock),
            patch("bubbly_chef.api.routes.chat.get_repository", return_value=repo_mock),
        ):
            response = await client.post("/v1/chat", json={"message": "Hello"})

        data = response.json()
        assert "schema_version" in data
        assert data["schema_version"] == "1.0.0"
