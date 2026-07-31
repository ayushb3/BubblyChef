"""Tests for ImagePreprocessor deskewing logic (issue #181).

All tests are pure-Python / PIL + NumPy — no real images, no AI calls,
no network access required.

Synthetic images
----------------
* A "receipt-like" image is created by drawing horizontal bands of dark
  pixels on a white background (mimicking lines of text).  When that image
  is rotated by a known angle, `detect_skew_angle` should return an angle
  close to the applied tilt, and `_deskew_image` should produce output that
  is measurably more horizontal (higher row-sum variance) than the
  deliberately skewed input.

* A flat, featureless image (uniform grey) is used to verify that the
  confidence guard returns 0.0 and no rotation is applied.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from bubbly_chef.services.image_preprocessor import ImagePreprocessor, get_image_preprocessor


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #


def _make_lined_image(
    width: int = 400,
    height: int = 600,
    n_lines: int = 20,
    line_thickness: int = 3,
    bg: int = 255,
    fg: int = 30,
) -> Image.Image:
    """Create a grayscale image with evenly-spaced horizontal dark bands.

    This simulates the horizontal text lines on a receipt; it gives the
    projection-profile algorithm a clear signal to work with.
    """
    arr = np.full((height, width), bg, dtype=np.uint8)
    step = height // (n_lines + 1)
    for i in range(1, n_lines + 1):
        y = i * step
        arr[y : y + line_thickness, :] = fg
    return Image.fromarray(arr, mode="L")


def _rotate_image(image: Image.Image, angle: float) -> Image.Image:
    """Rotate image by *angle* degrees (CCW in PIL convention), white fill."""
    return image.rotate(angle, resample=Image.Resampling.BILINEAR, expand=False, fillcolor=255)


def _row_sum_variance(image: Image.Image) -> float:
    """Return variance of horizontal projection profile (row sums of dark pixels)."""
    arr = np.array(image, dtype=np.float32)
    # invert so dark = 1
    dark = 255.0 - arr
    return float(np.var(dark.sum(axis=1)))


# --------------------------------------------------------------------------- #
# detect_skew_angle                                                            #
# --------------------------------------------------------------------------- #


class TestDetectSkewAngle:
    """Unit tests for ImagePreprocessor.detect_skew_angle()."""

    preprocessor: ImagePreprocessor

    def setup_method(self) -> None:
        self.preprocessor = ImagePreprocessor(mode="aggressive")

    def test_straight_image_returns_near_zero(self) -> None:
        """A perfectly horizontal image should not trigger any correction."""
        img = _make_lined_image()
        angle = self.preprocessor.detect_skew_angle(img)
        # The confidence guard should prevent spurious small corrections.
        assert abs(angle) < 1.0, f"Expected ~0°, got {angle:.2f}°"

    def test_detects_positive_skew(self) -> None:
        """Rotating the reference image by +8° should yield a detected angle near +8°."""
        applied = 8.0
        img = _rotate_image(_make_lined_image(), applied)
        detected = self.preprocessor.detect_skew_angle(img)
        # Allow ±2.0° tolerance (sweep step is 0.5°; PIL rotation introduces
        # minor aliasing that can shift the optimum by a step or two).
        assert abs(detected - applied) <= 2.0, (
            f"Applied {applied}°, detected {detected:.1f}° — too far off"
        )

    def test_detects_negative_skew(self) -> None:
        """Rotating by –7° should yield a detected angle near –7°."""
        applied = -7.0
        img = _rotate_image(_make_lined_image(), applied)
        detected = self.preprocessor.detect_skew_angle(img)
        assert abs(detected - applied) <= 2.0, (
            f"Applied {applied}°, detected {detected:.1f}° — too far off"
        )

    def test_uniform_image_returns_zero(self) -> None:
        """A blank/uniform image has no projection signal — should return 0.0."""
        uniform = Image.fromarray(np.full((200, 300), 200, dtype=np.uint8), mode="L")
        angle = self.preprocessor.detect_skew_angle(uniform)
        assert angle == 0.0, f"Expected 0.0 for featureless image, got {angle}"

    def test_large_skew_clamped_to_max_angle(self) -> None:
        """Skew beyond ±15° is outside the sweep range; detected angle must stay ≤ MAX."""
        # Rotate by 20° — beyond _DESKEW_MAX_ANGLE; the sweep can only return up to 15°.
        img = _rotate_image(_make_lined_image(), 20.0)
        detected = self.preprocessor.detect_skew_angle(img)
        assert abs(detected) <= ImagePreprocessor._DESKEW_MAX_ANGLE + 0.01, (
            f"Detected angle {detected:.1f}° exceeds clamped maximum"
        )


# --------------------------------------------------------------------------- #
# _deskew_image                                                                #
# --------------------------------------------------------------------------- #


class TestDeskewImage:
    """Unit tests for ImagePreprocessor._deskew_image()."""

    preprocessor: ImagePreprocessor

    def setup_method(self) -> None:
        self.preprocessor = ImagePreprocessor(mode="aggressive")

    def test_deskewed_output_is_more_horizontal_than_input(self) -> None:
        """After deskewing a 10°-tilted image the row-sum variance should increase."""
        original = _make_lined_image()
        skewed = _rotate_image(original, 10.0)

        before_variance = _row_sum_variance(skewed)
        deskewed = self.preprocessor._deskew_image(skewed)
        after_variance = _row_sum_variance(deskewed)

        assert after_variance > before_variance, (
            f"Deskewing did not improve alignment: "
            f"before={before_variance:.1f}, after={after_variance:.1f}"
        )

    def test_straight_image_unchanged(self) -> None:
        """A straight image should come out pixel-identical (no rotation applied)."""
        img = _make_lined_image()
        result = self.preprocessor._deskew_image(img)
        # If no rotation was applied, the returned object is the same instance.
        assert result is img, "Straight image should not be rotated (identity return expected)"

    def test_deskew_returns_l_mode_image(self) -> None:
        """Output must remain in grayscale L mode."""
        skewed = _rotate_image(_make_lined_image(), 5.0)
        deskewed = self.preprocessor._deskew_image(skewed)
        assert deskewed.mode == "L", f"Expected L mode, got {deskewed.mode}"

    def test_deskew_does_not_change_image_dimensions(self) -> None:
        """Output must have the same WxH as input (expand=False)."""
        skewed = _rotate_image(_make_lined_image(400, 600), 8.0)
        deskewed = self.preprocessor._deskew_image(skewed)
        assert deskewed.size == skewed.size, (
            f"Dimensions changed: {skewed.size} → {deskewed.size}"
        )


# --------------------------------------------------------------------------- #
# Integration: aggressive pipeline includes deskew                            #
# --------------------------------------------------------------------------- #


class TestAggressivePipelineIncludesDeskew:
    """Smoke-test that the aggressive preprocessing pipeline runs end-to-end
    without error when given a skewed image, and that the output is a valid
    single-channel image of the same dimensions.
    """

    @pytest.mark.asyncio
    async def test_aggressive_preprocess_runs_without_error(self) -> None:
        """preprocess(mode='aggressive') must complete without raising."""
        preprocessor = ImagePreprocessor(mode="aggressive")

        # Build a skewed receipt-like image and encode to PNG bytes
        skewed = _rotate_image(_make_lined_image(300, 500), 7.0)
        buf = io.BytesIO()
        skewed.save(buf, format="PNG")
        image_bytes = buf.getvalue()

        result = await preprocessor.preprocess(image_bytes, return_format="image")
        assert isinstance(result, Image.Image)
        # Output is grayscale (binarized at end of aggressive pipeline)
        assert result.mode == "L"

    @pytest.mark.asyncio
    async def test_aggressive_preprocess_returns_bytes_by_default(self) -> None:
        """preprocess() with return_format='bytes' returns raw bytes."""
        preprocessor = ImagePreprocessor(mode="aggressive")

        straight = _make_lined_image(200, 300)
        buf = io.BytesIO()
        straight.save(buf, format="PNG")
        image_bytes = buf.getvalue()

        result = await preprocessor.preprocess(image_bytes, return_format="bytes")
        assert isinstance(result, bytes)
        assert len(result) > 0


# --------------------------------------------------------------------------- #
# Singleton / factory helper                                                   #
# --------------------------------------------------------------------------- #


def test_get_image_preprocessor_returns_instance() -> None:
    p = get_image_preprocessor(mode="aggressive")
    assert isinstance(p, ImagePreprocessor)
    assert p.mode == "aggressive"


def test_get_image_preprocessor_caches_by_mode() -> None:
    p1 = get_image_preprocessor(mode="light")
    p2 = get_image_preprocessor(mode="light")
    assert p1 is p2, "Should return the same cached instance for the same mode"


def test_get_image_preprocessor_different_modes_are_different_instances() -> None:
    p_light = get_image_preprocessor(mode="light")
    p_agg = get_image_preprocessor(mode="aggressive")
    assert p_light is not p_agg
