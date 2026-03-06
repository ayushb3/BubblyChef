"""OCR service abstraction."""

from abc import ABC, abstractmethod
from pathlib import Path
import io


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


class TesseractOCR(OCRService):
    """Tesseract OCR implementation (local, free)."""

    def __init__(self):
        self._available: bool | None = None

    def is_available(self) -> bool:
        """Check if Tesseract is installed."""
        if self._available is not None:
            return self._available

        try:
            import pytesseract
            # Try to get version to verify it's working
            pytesseract.get_tesseract_version()
            self._available = True
        except Exception:
            self._available = False

        return self._available

    async def extract_text(self, image_data: bytes) -> str:
        """Extract text using Tesseract."""
        if not self.is_available():
            raise RuntimeError("Tesseract is not available")

        import pytesseract
        from PIL import Image

        # Load image from bytes
        image = Image.open(io.BytesIO(image_data))

        # Convert to RGB if necessary (Tesseract works best with RGB)
        if image.mode != "RGB":
            image = image.convert("RGB")

        # Extract text
        # Use --psm 6 for uniform block of text (good for receipts)
        # Use -l eng for English
        text = pytesseract.image_to_string(
            image,
            config="--psm 6 -l eng"
        )

        return text.strip()


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
        _ocr_service = TesseractOCR()
    return _ocr_service


def set_ocr_service(service: OCRService) -> None:
    """Set a custom OCR service (for testing)."""
    global _ocr_service
    _ocr_service = service
