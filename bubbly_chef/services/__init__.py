"""Services module."""

from .ocr import OCRService, TesseractOCR, MockOCR, get_ocr_service, set_ocr_service
from .receipt_parser import parse_receipt, ParsedReceiptItem, ReceiptParseResult

__all__ = [
    "OCRService",
    "TesseractOCR",
    "MockOCR",
    "get_ocr_service",
    "set_ocr_service",
    "parse_receipt",
    "ParsedReceiptItem",
    "ReceiptParseResult",
]
