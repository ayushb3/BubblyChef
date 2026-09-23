"""Synthetic tests for scripts/art/kitchen.py: no real art needed.

    python -m pytest scripts/art -q
"""
from __future__ import annotations

from pathlib import Path

import kitchen
import numpy as np
import pytest
from kitchen import Asset, CutError
from PIL import Image, ImageDraw

SLOTS_TS = """
export const SLOTS: Slot[] = [
  { key: 'window_sill', label: 'Window sill', x: 51, y: 2, w: 21, h: 26 },
  { key: 'lights', label: 'Lights', x: 75.5, y: 13, w: 22.5, h: 15 },
  { key: 'stove_top', label: 'Stove top', x: 2, y: 66, w: 21, h: 28 },
]
"""
CATALOG_TS = """
export const CATALOG: Decoration[] = [
  { id: 'sill_herbs', name: 'Herb pots', slot: 'window_sill', emoji: '🌿' },
  { id: 'lights_string', name: 'String lights', slot: 'lights', emoji: '✨' },
  { id: 'fridge_drawing', name: "Kid's drawing", slot: 'window_sill', emoji: '🖍️' },
  { id: 'stove_pan', name: 'Frying pan', slot: 'stove_top', emoji: '🍳' },
]
"""

LEAF = (124, 179, 66)      # leafy green: survives a magenta key, not a green one
PINK = (255, 181, 197)     # --pastel-pink


def model_assets() -> dict[str, Asset]:
    slots = kitchen.parse_slots(SLOTS_TS)
    assets = kitchen.build_assets(slots, kitchen.parse_catalog(CATALOG_TS),
                                  kitchen.parse_themes(None))
    return {a.id: a for a in assets}


def shape_in_frame(asset: Asset, bg: tuple[int, int, int], fill: tuple[int, int, int],
                   side: int = 2000, spill: bool = False) -> Image.Image:
    """A flat-background square with an ellipse inside the asset's frame, sitting on
    the frame's bottom edge (like an item on a sill)."""
    im = Image.new("RGB", (side, side), bg)
    x0, y0, x1, y1 = kitchen.frame_for(asset.size, canvas=side)
    w, h = x1 - x0, y1 - y0
    box = [x0 + w * 0.2, y0 + h * 0.25, x1 - w * 0.2, y1 - 1]
    if spill:
        box = [x0 - w * 0.3, y0 + h * 0.25, x1 - w * 0.2, y1 - 1]
    ImageDraw.Draw(im).ellipse(box, fill=fill, outline=kitchen.OUTLINE, width=side // 150)
    return im


# ── Reading the app code ──────────────────────────────────────────────────────
def test_parses_slots_catalog_and_sizes_at_3x_of_375() -> None:
    assets = model_assets()
    # 21% x 26% of a 1125 x 843.75 scene
    assert assets["sill_herbs"].size == (236, 219)
    assert assets["lights_string"].size == (253, 127)
    assert assets["stove_pan"].size == (236, 236)
    assert assets["fridge_drawing"].label == "Kid's drawing"      # double-quoted name
    assert assets["pastel"].size == (1125, 844)                   # fallback themes (#523)
    assert assets["sill_herbs"].key == "magenta"                  # green subject
    assert assets["stove_pan"].key == "green"
    assert assets["lights_string"].anchor == "top"
    assert assets["sill_herbs"].out_rel == "decorations/sill_herbs.png"


def test_new_catalog_entry_becomes_a_manifest_row() -> None:
    slots = kitchen.parse_slots(SLOTS_TS)
    extra = CATALOG_TS.replace(
        "]", "  { id: 'sill_cactus', name: 'Cactus', slot: 'window_sill', emoji: '🌵' },\n]")
    model = kitchen.Model(slots, kitchen.build_assets(slots, kitchen.parse_catalog(extra),
                                                      kitchen.FALLBACK_THEMES), [], False)
    text = kitchen.render_manifest(model)
    assert "| `sill_cactus` | Cactus | `window_sill` | 236x219 |" in text


def test_unknown_slot_in_catalog_is_an_error() -> None:
    slots = kitchen.parse_slots(SLOTS_TS)
    bad = [("x", "X", "nowhere")]
    with pytest.raises(SystemExit):
        kitchen.build_assets(slots, bad, [])


def test_frame_has_the_slot_aspect() -> None:
    x0, y0, x1, y1 = kitchen.frame_for((253, 127))
    assert (x1 - x0) == 1600
    assert abs((x1 - x0) / (y1 - y0) - 253 / 127) < 0.01
    assert kitchen.frame_for((236, 236)) == (200, 200, 1800, 1800)


# ── Cut-out ───────────────────────────────────────────────────────────────────
def test_magenta_cutout_is_transparent_sized_and_keeps_the_green_shape(tmp_path: Path) -> None:
    asset = model_assets()["sill_herbs"]
    src = tmp_path / "sill_herbs.png"
    shape_in_frame(asset, kitchen.MAGENTA, LEAF).save(src)

    dst, warnings = kitchen.cut_asset(asset, src, out_root=tmp_path / "export")

    assert dst == tmp_path / "export" / "decorations" / "sill_herbs.png"
    out = Image.open(dst)
    assert out.mode == "RGBA"
    assert out.size == (236, 219)
    a = np.asarray(out)
    for y, x in [(0, 0), (0, -1), (-1, 0), (-1, -1)]:
        assert a[y, x, 3] == 0, "corners must be transparent"
    cy, cx = int(219 * 0.62), 236 // 2
    assert a[cy, cx, 3] == 255, "the shape must stay opaque"
    assert np.abs(a[cy, cx, :3].astype(int) - LEAF).max() < 12, "green must not be dulled"
    # bottom-anchored: the shape reaches the last rows, where the sill is
    assert a[-3:, :, 3].max() == 255
    assert warnings == []


def test_same_frame_for_any_source_resolution(tmp_path: Path) -> None:
    asset = model_assets()["stove_pan"]
    outs = []
    for side in (2000, 1024):
        src = tmp_path / f"pan-{side}.png"
        shape_in_frame(asset, kitchen.GREEN, PINK, side=side).save(src)
        dst, _ = kitchen.cut_asset(asset, src, out_root=tmp_path / str(side))
        outs.append(np.asarray(Image.open(dst))[..., 3] > 128)
    # the subject lands in the same place in the slot either way
    assert (outs[0] != outs[1]).mean() < 0.02


def test_wrong_background_colour_is_refused(tmp_path: Path) -> None:
    asset = model_assets()["sill_herbs"]            # keyed on magenta
    src = tmp_path / "wrong.png"
    shape_in_frame(asset, kitchen.GREEN, PINK).save(src)
    with pytest.raises(CutError, match="background"):
        kitchen.cut_asset(asset, src, out_root=tmp_path)


def test_spill_outside_the_frame_warns(tmp_path: Path) -> None:
    asset = model_assets()["sill_herbs"]
    src = tmp_path / "spill.png"
    shape_in_frame(asset, kitchen.MAGENTA, LEAF, spill=True).save(src)
    _, warnings = kitchen.cut_asset(asset, src, out_root=tmp_path)
    assert any("outside the frame" in w for w in warnings)


def test_leftover_guide_line_warns(tmp_path: Path) -> None:
    asset = model_assets()["stove_pan"]
    im = shape_in_frame(asset, kitchen.GREEN, PINK)
    x0, y0, x1, y1 = kitchen.frame_for(asset.size)
    ImageDraw.Draw(im).rectangle([x0, y0, x1, y1], outline=kitchen.OUTLINE, width=6)
    src = tmp_path / "guide-left-in.png"
    im.save(src)
    _, warnings = kitchen.cut_asset(asset, src, out_root=tmp_path)
    assert any("guide line" in w for w in warnings)


def test_fit_mode_trims_scales_and_anchors(tmp_path: Path) -> None:
    asset = model_assets()["lights_string"]          # 253 x 127, hangs from the top
    im = Image.new("RGB", (1024, 1536), kitchen.GREEN)   # not square: forces --fit
    ImageDraw.Draw(im).rectangle([300, 900, 700, 1000], fill=PINK)
    src = tmp_path / "lights.png"
    im.save(src)
    dst, warnings = kitchen.cut_asset(asset, src, out_root=tmp_path)
    a = np.asarray(Image.open(dst))[..., 3]
    assert a.shape == (127, 253)
    assert any("not square" in w for w in warnings)
    rows = np.nonzero(a.max(axis=1) > 128)[0]
    cols = np.nonzero(a.max(axis=0) > 128)[0]
    assert rows.min() == 0, "top-anchored item starts at the top edge"
    assert cols.max() - cols.min() + 1 >= 253 * 0.9, "scaled up to fill the width"


def test_theme_background_is_cropped_to_4_3_and_sized(tmp_path: Path) -> None:
    asset = model_assets()["pastel"]
    src = tmp_path / "pastel.jpg"
    Image.new("RGB", (1792, 1024), (255, 249, 245)).save(src)   # 16:9-ish
    dst, _ = kitchen.cut_asset(asset, src, out_root=tmp_path)
    out = Image.open(dst)
    assert dst.name == "pastel.png" and dst.parent.name == "themes"
    assert out.size == (1125, 844) and out.mode == "RGB"


# ── Guides ────────────────────────────────────────────────────────────────────
def test_guides_use_the_key_colour_and_the_scene_is_4_3() -> None:
    assets = model_assets()
    g = kitchen.slot_guide(assets["sill_herbs"])
    assert g.size == (2000, 2000) and g.getpixel((5, 5)) == kitchen.MAGENTA
    assert kitchen.slot_guide(assets["stove_pan"]).getpixel((5, 5)) == kitchen.GREEN
    scene = kitchen.scene_guide(kitchen.parse_slots(SLOTS_TS))
    assert scene.size == (2000, 1500)
