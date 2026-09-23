"""OCR service abstraction."""

from abc import ABC, abstractmethod
from collections.abc import Callable


class OCRService(ABC):
    """Base class for OCR services."""

    @abstractmethod
    async def extract_text(
        self, image_data: bytes, *, time_remaining: Callable[[], float] | None = None
    ) -> str:
        """
        Extract text from image.

        Args:
            image_data: Raw image bytes (PNG, JPEG, etc.)
            time_remaining: Optional seconds-left callback for the caller's
                request budget (issue #481), forwarded to the vision call.

        Returns:
            Extracted text from the image
        """
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Check if the OCR service is available."""
        ...


class GeminiOCR(OCRService):
    """OCR via Gemini vision — no system dependencies required."""

    def is_available(self) -> bool:
        from bubbly_chef.api.deps import get_ai_manager

        manager = get_ai_manager()
        return any(p.supports_vision for p in manager.providers)

    async def extract_text(
        self, image_data: bytes, *, time_remaining: Callable[[], float] | None = None
    ) -> str:
        from bubbly_chef.api.deps import get_ai_manager

        # Detect MIME type from magic bytes
        if image_data[:8] == b'\x89PNG\r\n\x1a\n':
            mime_type = "image/png"
        elif image_data[:4] == b'RIFF' or image_data[:4] == b'WEBP':
            mime_type = "image/webp"
        else:
            mime_type = "image/jpeg"

        manager = get_ai_manager()
        result = await manager.vision_complete(
            prompt=(
                "Extract all text from this receipt image exactly as it appears. "
                "Preserve line breaks. Return only the raw text, no commentary."
            ),
            image_bytes=image_data,
            mime_type=mime_type,
            time_remaining=time_remaining,
        )
        return str(result).strip()


class MockOCR(OCRService):
    """Mock OCR for testing."""

    def __init__(self, mock_text: str = ""):
        self.mock_text = mock_text

    def is_available(self) -> bool:
        return True

    async def extract_text(
        self, image_data: bytes, *, time_remaining: Callable[[], float] | None = None
    ) -> str:
        return self.mock_text


# Singleton instance
_ocr_service: OCRService | None = None


def get_ocr_service() -> OCRService:
    """Get the OCR service instance."""
    global _ocr_service
    if _ocr_service is None:
        _ocr_service = GeminiOCR()
    return _ocr_service


def set_ocr_service(service: OCRService) -> None:
    """Set a custom OCR service (for testing)."""
    global _ocr_service
    _ocr_service = service
