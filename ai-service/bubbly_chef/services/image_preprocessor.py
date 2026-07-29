"""Image preprocessing service for optimal OCR performance."""

import io
import logging
from typing import ClassVar, Literal

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

logger = logging.getLogger(__name__)


PreprocessMode = Literal["auto", "light", "aggressive"]


class ImagePreprocessor:
    """
    Preprocesses receipt images for optimal Tesseract OCR performance.

    Applies various image enhancement techniques:
    - Grayscale conversion
    - Contrast enhancement
    - Noise reduction
    - Sharpening
    - Deskewing (rotation correction)
    - Binarization (thresholding)
    """

    def __init__(self, mode: PreprocessMode = "auto"):
        """
        Initialize the image preprocessor.

        Args:
            mode: Preprocessing mode
                - "auto": Automatic preprocessing based on image quality
                - "light": Minimal preprocessing (contrast + grayscale)
                - "aggressive": Full preprocessing pipeline
        """
        self.mode = mode
        logger.debug(f"ImagePreprocessor initialized with mode: {mode}")

    async def preprocess(
        self, image_data: bytes, return_format: Literal["bytes", "image"] = "bytes"
    ) -> bytes | Image.Image:
        """
        Preprocess an image for OCR.

        Args:
            image_data: Raw image bytes (PNG, JPEG, etc.)
            return_format: Return format ("bytes" or "image")

        Returns:
            Preprocessed image as bytes or PIL Image

        Raises:
            ValueError: If image cannot be loaded or is invalid
        """
        try:
            # Load image from bytes
            image = Image.open(io.BytesIO(image_data))
            logger.info(
                f"Loaded image: size={image.size}, mode={image.mode}, format={image.format}"
            )

            # Apply preprocessing based on mode
            if self.mode == "auto":
                preprocessed = await self._preprocess_auto(image)
            elif self.mode == "light":
                preprocessed = await self._preprocess_light(image)
            elif self.mode == "aggressive":
                preprocessed = await self._preprocess_aggressive(image)
            else:
                raise ValueError(f"Invalid preprocessing mode: {self.mode}")

            logger.info(
                f"Preprocessing complete: mode={self.mode}, "
                f"output_size={preprocessed.size}, output_mode={preprocessed.mode}"
            )

            # Return in requested format
            if return_format == "image":
                return preprocessed
            else:
                return self._image_to_bytes(preprocessed)

        except Exception as e:
            logger.error(f"Image preprocessing failed: {e}")
            raise ValueError(f"Failed to preprocess image: {str(e)}") from e

    def _crop_receipt(self, image: Image.Image) -> Image.Image:
        """
        Detect and crop the receipt from the background.

        Looks for the largest bright rectangular region (the receipt paper)
        and crops to it. Falls back to the original image if detection fails.
        """
        try:
            # Work at reduced resolution for speed
            scale = 0.25
            small = image.convert("L").resize(
                (int(image.width * scale), int(image.height * scale)),
                Image.Resampling.LANCZOS,
            )
            np_small = np.array(small)

            # Threshold to isolate bright regions (the receipt paper)
            bright_threshold = np.percentile(np_small, 60)
            binary = (np_small > bright_threshold).astype(np.uint8) * 255

            # Find bounding box of the largest bright connected region via row/col projections
            row_sums = binary.sum(axis=1)
            col_sums = binary.sum(axis=0)

            # Find rows/cols with significant bright content (>30% of max)
            row_thresh = row_sums.max() * 0.30
            col_thresh = col_sums.max() * 0.30

            bright_rows = np.where(row_sums > row_thresh)[0]
            bright_cols = np.where(col_sums > col_thresh)[0]

            if len(bright_rows) == 0 or len(bright_cols) == 0:
                return image

            # Scale back to original coordinates with a small margin
            inv_scale = 1.0 / scale
            top = max(0, int(bright_rows[0] * inv_scale) - 20)
            bottom = min(image.height, int(bright_rows[-1] * inv_scale) + 20)
            left = max(0, int(bright_cols[0] * inv_scale) - 20)
            right = min(image.width, int(bright_cols[-1] * inv_scale) + 20)

            # Only crop if the result covers at least 30% of the original
            crop_area = (right - left) * (bottom - top)
            orig_area = image.width * image.height
            if crop_area < orig_area * 0.30:
                logger.debug("Receipt crop area too small, skipping crop")
                return image

            cropped = image.crop((left, top, right, bottom))
            logger.info(
                f"Cropped receipt: original={image.size} → cropped=({left},{top},{right},{bottom})"
            )
            return cropped

        except Exception as e:
            logger.warning(f"Receipt crop failed: {e}, using full image")
            return image

    async def _preprocess_auto(self, image: Image.Image) -> Image.Image:
        """
        Automatic preprocessing based on image characteristics.

        Analyzes the image and applies appropriate enhancements.
        """
        # Convert to RGB for analysis
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")

        # Always attempt to crop the receipt from the background first
        image = self._crop_receipt(image)

        # Calculate image statistics
        grayscale = image.convert("L")
        np_image = np.array(grayscale)
        mean_brightness = np.mean(np_image)
        std_brightness = np.std(np_image)

        logger.debug(
            f"Image stats: mean_brightness={mean_brightness:.1f}, "
            f"std_brightness={std_brightness:.1f}"
        )

        # Decide preprocessing level based on image quality
        if std_brightness < 40:
            # Low contrast image - needs aggressive processing
            logger.info("Auto mode: Low contrast detected, using aggressive preprocessing")
            return await self._preprocess_aggressive(image)
        elif mean_brightness < 80 or mean_brightness > 200:
            # Poor lighting - needs moderate processing
            logger.info("Auto mode: Poor lighting detected, using aggressive preprocessing")
            return await self._preprocess_aggressive(image)
        else:
            # Good quality image - light processing
            logger.info("Auto mode: Good quality image, using light preprocessing")
            return await self._preprocess_light(image)

    async def _preprocess_light(self, image: Image.Image) -> Image.Image:
        """
        Light preprocessing: grayscale + contrast enhancement.

        Suitable for high-quality images that are already well-lit and clear.
        """
        # Convert to grayscale
        if image.mode != "L":
            image = image.convert("L")

        # Enhance contrast moderately
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(1.5)

        # Slight sharpening
        image = image.filter(ImageFilter.SHARPEN)

        return image

    async def _preprocess_aggressive(self, image: Image.Image) -> Image.Image:
        """
        Aggressive preprocessing: full pipeline for challenging images.

        Applies:
        1. Grayscale conversion
        2. Contrast enhancement
        3. Noise reduction
        4. Sharpening
        5. Deskewing (rotation correction)
        6. Binarization (adaptive thresholding)
        """
        # Crop receipt from background before other processing
        image = self._crop_receipt(image)

        # Convert to grayscale
        if image.mode != "L":
            image = image.convert("L")

        # Auto-contrast to normalize brightness
        image = ImageOps.autocontrast(image, cutoff=2)

        # Denoise with median filter
        image = image.filter(ImageFilter.MedianFilter(size=3))

        # Enhance contrast
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.0)

        # Sharpen to improve edge definition
        image = image.filter(ImageFilter.SHARPEN)
        image = image.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))

        # Deskew (correct rotation)
        image = self._deskew_image(image)

        # Binarization (convert to pure black and white)
        image = self._binarize_image(image)

        return image

    # ------------------------------------------------------------------ #
    # Deskew constants                                                    #
    # ------------------------------------------------------------------ #
    _DESKEW_MAX_ANGLE: ClassVar[float] = 15.0  # degrees — clamp correction to ±15°
    _DESKEW_ANGLE_STEP: ClassVar[float] = 0.5  # degrees — sweep resolution
    # Minimum relative variance improvement to commit a rotation.
    # A value of 0.02 means the best angle must improve row-sum variance by
    # at least 2 % over the 0° baseline — protects already-straight images.
    _DESKEW_MIN_IMPROVEMENT: ClassVar[float] = 0.02

    def detect_skew_angle(self, image: Image.Image) -> float:
        """
        Estimate the skew angle of a document image using horizontal
        projection-profile analysis (pure Pillow + NumPy, no OpenCV).

        Algorithm
        ---------
        1. Down-scale to a working resolution (≤800 px wide) for speed.
        2. Convert to binary (Otsu-like global threshold).
        3. Sweep candidate angles from –MAX to +MAX degrees.
        4. For each candidate, rotate the binary image and compute the
           variance of its horizontal projection profile (row sums of dark
           pixels).  Well-aligned text produces sharp, high-variance row
           peaks; misaligned text smears those peaks horizontally.
        5. Return the angle that maximises row-sum variance.
           Return 0.0 if the improvement over the 0° baseline is below
           ``_DESKEW_MIN_IMPROVEMENT`` (confidence guard).

        Args:
            image: Grayscale (L-mode) PIL Image.

        Returns:
            Detected skew angle in degrees.  Positive → clockwise tilt;
            negative → counter-clockwise tilt.  0.0 means "no correction".
        """
        # --- 1. Resize to a fast working size (≤ 800 px wide) ----------
        max_width = 800
        scale = min(1.0, max_width / max(image.width, 1))
        work_w = max(1, int(image.width * scale))
        work_h = max(1, int(image.height * scale))
        small = image.resize((work_w, work_h), Image.Resampling.LANCZOS)

        # --- 2. Binarise (invert so text pixels = 1, background = 0) ---
        arr = np.array(small, dtype=np.float32)
        threshold = float(np.mean(arr))
        # text is dark → below threshold
        binary = (arr < threshold).astype(np.float32)

        # --- 3. Sweep angles and record row-sum variance ----------------
        best_angle = 0.0
        best_variance = -1.0

        angles = np.arange(
            -self._DESKEW_MAX_ANGLE,
            self._DESKEW_MAX_ANGLE + self._DESKEW_ANGLE_STEP,
            self._DESKEW_ANGLE_STEP,
        )

        binary_img = Image.fromarray((binary * 255).astype(np.uint8), mode="L")

        for angle in angles:
            # PIL.Image.rotate: positive angle = counter-clockwise. This is the
            # candidate *correction* applied to the skewed image; the angle that
            # maximises row-sum variance best straightens the text. The reported
            # tilt is the negative of this (see the return statement).
            rotated = binary_img.rotate(
                float(angle), resample=Image.Resampling.BILINEAR, expand=False
            )
            rot_arr = np.array(rotated, dtype=np.float32)
            row_sums = rot_arr.sum(axis=1)
            variance = float(np.var(row_sums))
            if variance > best_variance:
                best_variance = variance
                best_angle = float(angle)

        # --- 4. Confidence guard: compare best against 0° baseline -----
        baseline_sums = np.array(binary_img, dtype=np.float32).sum(axis=1)
        baseline_variance = float(np.var(baseline_sums))

        if baseline_variance <= 0:
            logger.debug("Deskew: baseline variance is zero, skipping correction")
            return 0.0

        improvement = (best_variance - baseline_variance) / baseline_variance
        logger.debug(
            f"Deskew: best_angle={best_angle:.1f}°, "
            f"baseline_var={baseline_variance:.1f}, best_var={best_variance:.1f}, "
            f"improvement={improvement:.4f}"
        )

        if abs(best_angle) < self._DESKEW_ANGLE_STEP / 2:
            # The 0° candidate already won — no rotation needed.
            return 0.0

        if improvement < self._DESKEW_MIN_IMPROVEMENT:
            logger.debug(
                f"Deskew: improvement {improvement:.4f} below threshold "
                f"{self._DESKEW_MIN_IMPROVEMENT}, skipping correction"
            )
            return 0.0

        # The sweep's ``best_angle`` is the rotation that, applied to the
        # skewed image, maximises alignment — i.e. it is the *correction*
        # rotation.  The reported skew of the document is the negative of that
        # (a document tilted +θ CCW is straightened by rotating −θ).  Return the
        # tilt; ``_deskew_image`` negates it again to derive the correction.
        return -best_angle

    def _deskew_image(self, image: Image.Image) -> Image.Image:
        """
        Correct image rotation (deskewing).

        Detects the skew angle using horizontal projection-profile analysis
        (pure Pillow + NumPy) and rotates the image to horizontal.  Correction
        is clamped to ±``_DESKEW_MAX_ANGLE`` degrees and skipped when
        confidence is too low to avoid harming already-straight images.

        Args:
            image: Grayscale (L-mode) PIL Image.

        Returns:
            Deskewed PIL Image (same mode as input).

        Raises:
            ValueError: Re-raised as a warning — caller falls back to original.
        """
        try:
            angle = self.detect_skew_angle(image)

            if angle == 0.0:
                logger.debug("Deskew: no correction needed")
                return image

            # Clamp (redundant given the sweep range, but defensive)
            angle = max(-self._DESKEW_MAX_ANGLE, min(self._DESKEW_MAX_ANGLE, angle))

            # PIL.Image.rotate with a positive angle rotates counter-clockwise.
            # Our detected angle is the CCW angle that maximises alignment, so
            # we rotate by *negative* that angle to undo the tilt.
            correction = -angle
            deskewed = image.rotate(
                correction,
                resample=Image.Resampling.BILINEAR,
                expand=False,
                fillcolor=255,  # fill new corners with white (background)
            )
            logger.info(f"Deskew: corrected {angle:.1f}° → applied {correction:.1f}° rotation")
            return deskewed

        except Exception as e:
            logger.warning(f"Deskewing failed: {e}, returning original image")
            return image

    def _binarize_image(self, image: Image.Image) -> Image.Image:
        """
        Convert grayscale image to pure black and white using adaptive thresholding.

        This improves OCR accuracy by making text stand out clearly.
        """
        # Convert to numpy array
        np_image = np.array(image)

        # Calculate adaptive threshold
        # Use Otsu's method approximation: threshold at mean - 0.5 * std
        threshold = np.mean(np_image) - 0.3 * np.std(np_image)
        threshold = max(128, min(200, threshold))  # Clamp between 128-200

        logger.debug(f"Binarization threshold: {threshold:.1f}")

        # Apply threshold
        binary = np.where(np_image > threshold, 255, 0).astype(np.uint8)

        # Convert back to PIL Image
        return Image.fromarray(binary, mode="L")

    def _image_to_bytes(self, image: Image.Image, format: str = "PNG") -> bytes:
        """
        Convert PIL Image to bytes.

        Args:
            image: PIL Image
            format: Output format (PNG, JPEG, etc.)

        Returns:
            Image as bytes
        """
        buffer = io.BytesIO()
        image.save(buffer, format=format, optimize=True)
        return buffer.getvalue()


# Singleton instance
_preprocessor: ImagePreprocessor | None = None


def get_image_preprocessor(mode: PreprocessMode = "auto") -> ImagePreprocessor:
    """
    Get the image preprocessor instance.

    Args:
        mode: Preprocessing mode (auto, light, aggressive)

    Returns:
        ImagePreprocessor instance
    """
    global _preprocessor
    if _preprocessor is None or _preprocessor.mode != mode:
        _preprocessor = ImagePreprocessor(mode=mode)
    return _preprocessor


def set_image_preprocessor(preprocessor: ImagePreprocessor) -> None:
    """Set a custom image preprocessor (for testing)."""
    global _preprocessor
    _preprocessor = preprocessor
