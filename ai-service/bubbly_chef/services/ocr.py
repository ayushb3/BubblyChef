"""OCR service abstraction."""

from abc import ABC, abstractmethod


class OCRService(ABC):
    """Base class for OCR services."""

    @abstractmethod
    async def extract_text(self, image_data: bytes) -> str:
        """
        Extract text from image.

        Args:
            image_data: Raw image bytes (PNG, JPEG, etc.)

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

    async def extract_text(self, image_data: bytes) -> str:
        from bubbly_chef.api.deps import get_ai_manager

        manager = get_ai_manager()
        result = await manager.vision_complete(
            prompt=(
                "Extract all text from this receipt image exactly as it appears. "
                "Preserve line breaks. Return only the raw text, no commentary."
            ),
            image_bytes=image_data,
            mime_type="image/jpeg",
        )
        return str(result).strip()


class MockOCR(OCRService):
    """Mock OCR for testing."""

    def __init__(self, mock_text: str = ""):
        self.mock_text = mock_text

    def is_available(self) -> bool:
        return True

    async def extract_text(self, image_data: bytes) -> str:
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
