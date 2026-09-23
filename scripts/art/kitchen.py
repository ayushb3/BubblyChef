"""Kitchen-scene art pipeline: manifest, guides, cut-out and preview (issue #526).

Wraps scripts/art/cutout.py (the chroma key that worked for Bubbles) with the kitchen
scene's geometry, read from the app code so the art can't drift from it:

  nextjs/src/lib/kitchen/slots.ts    the 12 slots, x/y/w/h as % of the 4:3 scene box
  nextjs/src/lib/kitchen/catalog.ts  decorations (id, name, slot)
  nextjs/src/lib/kitchen/themes.ts   kitchen themes (issue #523; a fallback list until it lands)

When a file isn't in the working tree (this art branch predates the kitchen code), it is
read from git at --ref (default origin/main).

    python scripts/art/kitchen.py manifest [--write]   every asset (art/kitchen/MANIFEST.md)
    python scripts/art/kitchen.py guides               guide images -> art/guides/kitchen/
    python scripts/art/kitchen.py cut [ID ...] [--fit] source/<ID>.* -> export/<kind>/<ID>.png
    python scripts/art/kitchen.py preview [--theme KEY] [--boxes] [--pick ID ...]
    python scripts/art/kitchen.py check                prompts cover every asset; manifest current

Sizes: the scene is designed at 375 CSS px wide (4:3 -> 375 x 281.25) and rendered at 3x,
so the scene is 1125 x 844 px and each slot is its % of that. 3x of a 375px scene also
covers the 480px desktop column at 2x (960px).

Frames: every slot item is drawn inside a dashed box on a 2000px square guide whose
aspect equals the slot's. `cut` crops every item of a slot to that SAME box (like Bubbles'
expressions/FRAME.txt), so all candidates for a slot share one scale and anchor.
`--fit` is the fallback when the model ignored the box: trim, scale to fit, anchor.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cutout import key as chroma_key  # noqa: E402  (sibling script, not a package)

REPO = Path(__file__).resolve().parents[2]
ART = REPO / "art" / "kitchen"
SOURCE_DIR = ART / "source"
EXPORT_DIR = ART / "export"
PREVIEW_DIR = ART / "preview"
GUIDE_DIR = REPO / "art" / "guides" / "kitchen"
MANIFEST_MD = ART / "MANIFEST.md"
PROMPTS_MD = ART / "PROMPTS.md"

SLOTS_TS = "nextjs/src/lib/kitchen/slots.ts"
CATALOG_TS = "nextjs/src/lib/kitchen/catalog.ts"
THEMES_TS = "nextjs/src/lib/kitchen/themes.ts"
MASCOT_TSX = "nextjs/src/components/ui/BubblesMascot.tsx"

# ── Geometry ──────────────────────────────────────────────────────────────────
SCENE_CSS_W = 375          # design width of the scene box (CSS px)
SCALE = 3                  # device pixel ratio the art is made for
SCENE_W = SCENE_CSS_W * SCALE                  # 1125
SCENE_H_EXACT = SCENE_W * 3 / 4                # 843.75 (the box is always 4:3)
SCENE_H = round(SCENE_H_EXACT)                 # 844

GUIDE = 2000               # side of the square guide / expected model output
FRAME_MAX = 1600           # longest side of a slot's box inside the guide
SCENE_GUIDE = (2000, 1500)  # 4:3 layout guide for the backgrounds

GREEN = (0, 255, 0)
MAGENTA = (255, 0, 255)
OUTLINE = (74, 58, 51)     # #4a3a33, Bubbles' outline

# Where an item sits inside its slot box. "bottom": stands on a surface drawn in the
# background at the slot's bottom edge. "top": hangs from the slot's top edge.
SLOT_ANCHOR = {
    "wall_shelf": "bottom", "wall_art": "center", "window_sill": "bottom", "lights": "top",
    "hanging_plant": "top", "fridge_door": "center", "counter_left": "bottom",
    "counter_right": "bottom", "stove_top": "bottom", "table": "bottom", "rug": "bottom",
    "floor_corner": "bottom",
}

# Subjects with real green in them (leaves, stems) go on magenta; everything else on
# green. Pastel pinks survive a green key; leafy greens do not (art/PROMPTS.md).
MAGENTA_IDS = {
    "sill_succulent", "sill_herbs", "counter_fruit_bowl", "plant_pothos", "plant_ivy",
    "table_flowers",
}

# The 🫧 balance pill in the scene's top-right corner (KitchenScene.tsx). Optional art:
# a small bubble icon to replace the emoji. text-xs pill -> ~14 CSS px icon; 64px leaves
# room for larger text settings at 3x.
UI_ASSETS = [("bubbles_balance_icon", "🫧 balance-pill icon", (64, 64), "green")]

# Kitchen themes from issue #523 until nextjs/src/lib/kitchen/themes.ts exists.
FALLBACK_THEMES = [
    ("pastel", "Pastel kitchen (default)"),
    ("cozy_cottage", "Cozy cottage"),
    ("night_kitchen", "Night kitchen"),
    ("seasonal", "Seasonal"),
]

SOURCE_EXTS = (".png", ".jpg", ".jpeg", ".webp")


class CutError(Exception):
    """A source image can't be turned into an asset."""


@dataclass(frozen=True)
class Slot:
    key: str
    label: str
    x: float
    y: float
    w: float
    h: float

    @property
    def size(self) -> tuple[int, int]:
        return round(SCENE_W * self.w / 100), round(SCENE_H_EXACT * self.h / 100)

    @property
    def anchor(self) -> str:
        return SLOT_ANCHOR.get(self.key, "center")


@dataclass(frozen=True)
class Asset:
    id: str
    kind: str                  # "theme" | "decoration" | "ui"
    label: str
    size: tuple[int, int]
    key: str | None            # "green" | "magenta" | None (backgrounds aren't keyed)
    slot: str | None = None
    anchor: str = "center"

    @property
    def out_rel(self) -> str:
        folder = {"theme": "themes", "decoration": "decorations", "ui": "ui"}[self.kind]
        return f"{folder}/{self.id}.png"

    @property
    def public_path(self) -> str:
        return f"/kitchen/{self.out_rel}"

    @property
    def guide_name(self) -> str:
        if self.kind == "theme":
            return "scene-layout.png"
        base = f"slot-{self.slot}" if self.slot else f"ui-{self.id}"
        return f"{base}-{self.key}.png"

    @property
    def frame(self) -> tuple[int, int, int, int] | None:
        return None if self.kind == "theme" else frame_for(self.size)


def frame_for(size: tuple[int, int], canvas: int = GUIDE) -> tuple[int, int, int, int]:
    """The box, in a square guide `canvas` px wide, that an item of `size` is drawn in."""
    w, h = size
    fmax = FRAME_MAX * canvas / GUIDE
    bw, bh = (fmax, fmax * h / w) if w >= h else (fmax * w / h, fmax)
    x0, y0 = round((canvas - bw) / 2), round((canvas - bh) / 2)
    return x0, y0, x0 + round(bw), y0 + round(bh)


# ── Reading the app code ──────────────────────────────────────────────────────
def read_code(rel: str, ref: str) -> str | None:
    path = REPO / rel
    if path.exists():
        return path.read_text(encoding="utf-8")
    res = subprocess.run(
        ["git", "-C", str(REPO), "show", f"{ref}:{rel}"],
        capture_output=True, text=True, encoding="utf-8", check=False,
    )
    return res.stdout if res.returncode == 0 else None


SLOT_RE = re.compile(
    r"\{\s*key:\s*'(\w+)',\s*label:\s*'([^']*)',\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),"
    r"\s*w:\s*([\d.]+),\s*h:\s*([\d.]+)\s*\}"
)
CATALOG_RE = re.compile(r"\{\s*id:\s*'(\w+)',\s*name:\s*(['\"])(.*?)\2,\s*slot:\s*'(\w+)'")
THEME_RE = re.compile(r"key:\s*'(\w+)',\s*name:\s*(['\"])(.*?)\2")
MASCOT_RE = re.compile(r"(\w+):\s*'/mascot/bubbles-([\w-]+)\.png'")


def parse_slots(ts: str) -> list[Slot]:
    return [Slot(k, lbl, float(x), float(y), float(w), float(h))
            for k, lbl, x, y, w, h in SLOT_RE.findall(ts)]


def parse_catalog(ts: str) -> list[tuple[str, str, str]]:
    return [(i, name, slot) for i, _q, name, slot in CATALOG_RE.findall(ts)]


def parse_themes(ts: str | None) -> list[tuple[str, str]]:
    found = [(k, n) for k, _q, n in THEME_RE.findall(ts or "")]
    return found or FALLBACK_THEMES


def build_assets(slots: list[Slot], catalog: list[tuple[str, str, str]],
                 themes: list[tuple[str, str]]) -> list[Asset]:
    by_key = {s.key: s for s in slots}
    assets = [Asset(k, "theme", name, (SCENE_W, SCENE_H), None) for k, name in themes]
    order = {s.key: n for n, s in enumerate(slots)}
    for did, name, slot_key in sorted(catalog, key=lambda c: order.get(c[2], 99)):
        slot = by_key.get(slot_key)
        if slot is None:
            raise SystemExit(f"catalog entry {did!r} names unknown slot {slot_key!r}")
        key = "magenta" if did in MAGENTA_IDS else "green"
        assets.append(Asset(did, "decoration", name, slot.size, key, slot.key, slot.anchor))
    for uid, label, size, key in UI_ASSETS:
        assets.append(Asset(uid, "ui", label, size, key))
    return assets


@dataclass
class Model:
    slots: list[Slot]
    assets: list[Asset]
    mascot_code_states: list[str]
    themes_from_code: bool


def load(ref: str) -> Model:
    slots_ts, catalog_ts = read_code(SLOTS_TS, ref), read_code(CATALOG_TS, ref)
    if not slots_ts or not catalog_ts:
        raise SystemExit(f"can't read {SLOTS_TS} / {CATALOG_TS} from the working tree or {ref}")
    slots = parse_slots(slots_ts)
    themes_ts = read_code(THEMES_TS, ref)
    assets = build_assets(slots, parse_catalog(catalog_ts), parse_themes(themes_ts))
    mascot = [s for _k, s in MASCOT_RE.findall(read_code(MASCOT_TSX, ref) or "")]
    return Model(slots, assets, mascot, bool(themes_ts and THEME_RE.search(themes_ts)))


# ── Files ─────────────────────────────────────────────────────────────────────
def find_source(asset_id: str, folder: Path = SOURCE_DIR) -> Path | None:
    for ext in SOURCE_EXTS:
        p = folder / f"{asset_id}{ext}"
        if p.exists():
            return p
    return None


def status(asset: Asset) -> str:
    if (EXPORT_DIR / asset.out_rel).exists():
        return "cut"
    return "raw" if find_source(asset.id) else "todo"


# ── Guides ────────────────────────────────────────────────────────────────────
def dashed_line(d: ImageDraw.ImageDraw, a: tuple[int, int], b: tuple[int, int],
                width: int = 8, dash: int = 36) -> None:
    (x0, y0), (x1, y1) = a, b
    length = max(abs(x1 - x0), abs(y1 - y0))
    for s in range(0, length, dash * 2):
        e = min(s + dash, length)
        f0, f1 = s / length, e / length
        d.line([(x0 + (x1 - x0) * f0, y0 + (y1 - y0) * f0),
                (x0 + (x1 - x0) * f1, y0 + (y1 - y0) * f1)], fill=OUTLINE, width=width)


def slot_guide(asset: Asset) -> Image.Image:
    """Key-colour square with the asset's box: dashed edges, the anchor edge solid."""
    bg = MAGENTA if asset.key == "magenta" else GREEN
    im = Image.new("RGB", (GUIDE, GUIDE), bg)
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = frame_for(asset.size)
    edges = {"top": ((x0, y0), (x1, y0)), "bottom": ((x0, y1), (x1, y1)),
             "left": ((x0, y0), (x0, y1)), "right": ((x1, y0), (x1, y1))}
    for name, (a, b) in edges.items():
        if name == asset.anchor:
            d.line([a, b], fill=OUTLINE, width=14)
        else:
            dashed_line(d, a, b)
    if asset.anchor == "top":      # the hook the item hangs from
        cx = (x0 + x1) // 2
        d.ellipse([cx - 22, y0 - 22, cx + 22, y0 + 22], outline=OUTLINE, width=10)
    return im


def pct_box(slot: Slot, size: tuple[int, int]) -> tuple[int, int, int, int]:
    w, h = size
    return (round(slot.x / 100 * w), round(slot.y / 100 * h),
            round((slot.x + slot.w) / 100 * w), round((slot.y + slot.h) / 100 * h))


def scene_guide(slots: list[Slot], size: tuple[int, int] = SCENE_GUIDE) -> Image.Image:
    """A colour blockout of the empty kitchen, built from the slot map.

    Every surface an item stands on sits at its slot's bottom edge; hooks sit at the
    top edge of hanging slots. The top-right corner (the 🫧 pill) is left plain.
    """
    w, h = size
    im = Image.new("RGB", size, (255, 249, 245))            # cream wall
    d = ImageDraw.Draw(im)
    s = {sl.key: sl for sl in slots}

    def px(xp: float, yp: float) -> tuple[int, int]:
        return round(xp / 100 * w), round(yp / 100 * h)

    def rect(x0: float, y0: float, x1: float, y1: float, fill: tuple[int, int, int]) -> None:
        d.rounded_rectangle([px(x0, y0), px(x1, y1)], radius=10, fill=fill,
                            outline=OUTLINE, width=6)

    d.rectangle([px(0, 76), px(100, 100)], fill=(255, 218, 179))   # peach floor
    d.line([px(0, 76), px(100, 76)], fill=OUTLINE, width=6)
    if "wall_shelf" in s:
        sl = s["wall_shelf"]
        rect(sl.x + 1, sl.y + sl.h, sl.x + sl.w - 1, sl.y + sl.h + 2.5, (232, 168, 124))
    if "window_sill" in s:
        sl = s["window_sill"]
        rect(sl.x + 2, sl.y + 1, sl.x + sl.w - 2, sl.y + sl.h, (201, 181, 232))   # glass
        rect(sl.x, sl.y + sl.h, sl.x + sl.w, sl.y + sl.h + 2.5, (181, 234, 215))  # sill
    if "lights" in s:
        sl = s["lights"]
        rect(sl.x, sl.y - 1.2, sl.x + sl.w, sl.y, (232, 168, 124))   # rail the lights hang from
    if "hanging_plant" in s:
        sl = s["hanging_plant"]
        cx, cy = px(sl.x + sl.w / 2, sl.y)
        d.line([px(sl.x, sl.y - 2), (cx, cy - 12)], fill=OUTLINE, width=8)       # bracket
        d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], outline=OUTLINE, width=6)  # hook
    if "fridge_door" in s:
        sl = s["fridge_door"]
        rect(sl.x - 0.5, sl.y - 2, sl.x + sl.w + 0.5, 80, (181, 234, 215))        # fridge
        d.line([px(sl.x - 0.5, sl.y + sl.h + 1), px(sl.x + sl.w + 0.5, sl.y + sl.h + 1)],
               fill=OUTLINE, width=6)                                            # door split
    if "counter_left" in s and "counter_right" in s:
        a, b = s["counter_left"], s["counter_right"]
        top = a.y + a.h
        rect(a.x - 1, top + 2.5, b.x + b.w + 1.5, 79, (255, 181, 197))   # cabinets
        rect(a.x - 1.5, top, b.x + b.w + 2, top + 2.5, (232, 168, 124))  # worktop
    return im


def write_guides(model: Model) -> list[Path]:
    GUIDE_DIR.mkdir(parents=True, exist_ok=True)
    written: dict[str, Image.Image] = {"scene-layout.png": scene_guide(model.slots)}
    for a in model.assets:
        if a.kind != "theme":
            written.setdefault(a.guide_name, slot_guide(a))
    paths = []
    for name, im in written.items():
        p = GUIDE_DIR / name
        im.save(p)
        paths.append(p)
    return paths


# ── Cut-out ───────────────────────────────────────────────────────────────────
def opaque_bbox(im: Image.Image) -> tuple[int, int, int, int] | None:
    return im.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox()


def fit_to_canvas(im: Image.Image, size: tuple[int, int], anchor: str,
                  pad_frac: float = 0.04) -> Image.Image:
    """Trim to the subject, scale it to fit `size`, and anchor it (bottom/top/center)."""
    bbox = opaque_bbox(im)
    if bbox is None:
        raise CutError("nothing opaque left after keying")
    sub = im.crop(bbox)
    tw, th = size
    pad = round(min(tw, th) * pad_frac)
    scale = min((tw - 2 * pad) / sub.width, (th - 2 * pad) / sub.height)
    sub = sub.resize((max(1, round(sub.width * scale)), max(1, round(sub.height * scale))),
                     Image.Resampling.LANCZOS)
    x = (tw - sub.width) // 2
    y = {"bottom": th - sub.height, "top": 0}.get(anchor, (th - sub.height) // 2)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(sub, (x, y))
    return canvas


def cut_item(src: Image.Image, asset: Asset, fit: bool = False) -> tuple[Image.Image, list[str]]:
    """Chroma-key a slot item / icon and crop it to its shared frame (or --fit)."""
    warnings: list[str] = []
    keyed = chroma_key(src, magenta=asset.key == "magenta")
    alpha = np.asarray(keyed.getchannel("A")) > 128
    if not alpha.any():
        raise CutError("nothing opaque left after keying")
    corners = [alpha[0, 0], alpha[0, -1], alpha[-1, 0], alpha[-1, -1]]
    if sum(corners) >= 3:
        raise CutError(f"corners are still opaque: the background isn't {asset.key} "
                       f"(this asset is keyed on {asset.key}; see MANIFEST.md)")
    w, h = keyed.size
    if not fit and abs(w / h - 1) > 0.02:
        warnings.append(f"source is {w}x{h}, not square like the guide: used --fit instead")
        fit = True
    if fit:
        return fit_to_canvas(keyed, asset.size, asset.anchor), warnings

    fx0, fy0, fx1, fy1 = frame_for(asset.size, canvas=w)
    total = int(alpha.sum())
    inside = alpha[fy0:fy1, fx0:fx1]
    outside = total - int(inside.sum())
    if outside > 0.01 * total:
        warnings.append(f"{outside / total:.0%} of the subject is outside the frame and gets "
                        "clipped: re-roll, or cut this one with --fit")
    band = 4
    for side, strip in {"top": inside[:band], "bottom": inside[-band:],
                        "left": inside[:, :band], "right": inside[:, -band:]}.items():
        # share of the edge's length covered by opaque pixels within `band` px of it
        coverage = strip.any(axis=0 if side in ("top", "bottom") else 1).mean()
        # items legitimately touch their anchor edge, so only an unbroken line counts there
        if coverage > (0.95 if side == asset.anchor else 0.6):
            warnings.append(f"a line runs along the frame's {side} edge: guide line left in?")
    ys, xs = np.nonzero(inside)
    if len(xs):
        cw = (xs.max() - xs.min() + 1) / inside.shape[1]
        ch = (ys.max() - ys.min() + 1) / inside.shape[0]
        if cw < 0.6 and ch < 0.6:
            warnings.append(f"subject fills only {cw:.0%} x {ch:.0%} of the frame: it will look "
                            "small in the slot")
    out = keyed.crop((fx0, fy0, fx1, fy1)).resize(asset.size, Image.Resampling.LANCZOS)
    return out, warnings


def cut_theme(src: Image.Image, asset: Asset) -> Image.Image:
    """Centre-crop a background to 4:3 and size it to the scene."""
    im = src.convert("RGB")
    w, h = im.size
    tw, th = asset.size
    if w / h > tw / th:
        nw = round(h * tw / th)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w * th / tw)
        im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return im.resize(asset.size, Image.Resampling.LANCZOS)


def cut_asset(asset: Asset, src_path: Path, out_root: Path = EXPORT_DIR,
              fit: bool = False) -> tuple[Path, list[str]]:
    src = Image.open(src_path)
    warnings: list[str] = []
    if asset.kind == "theme":
        out = cut_theme(src, asset)
    else:
        out, warnings = cut_item(src, asset, fit=fit)
    dst = out_root / asset.out_rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, optimize=True)
    return dst, warnings


# ── Preview ───────────────────────────────────────────────────────────────────
def preview(model: Model, theme: str, picks: list[str], boxes: bool) -> Image.Image:
    bg_path = EXPORT_DIR / "themes" / f"{theme}.png"
    if bg_path.exists():
        scene = Image.open(bg_path).convert("RGBA").resize((SCENE_W, SCENE_H))
    else:
        scene = scene_guide(model.slots, (SCENE_W, SCENE_H)).convert("RGBA")
    decos = [a for a in model.assets if a.kind == "decoration"]
    chosen: dict[str, Asset] = {}
    for a in decos:
        if a.slot and a.slot not in chosen and (EXPORT_DIR / a.out_rel).exists():
            chosen[a.slot] = a
    for a in decos:
        if a.id in picks and a.slot:
            chosen[a.slot] = a
    d = ImageDraw.Draw(scene)
    for slot in model.slots:
        box = pct_box(slot, (SCENE_W, SCENE_H))
        pick = chosen.get(slot.key)
        if pick is not None and (EXPORT_DIR / pick.out_rel).exists():
            art = Image.open(EXPORT_DIR / pick.out_rel).convert("RGBA")
            art = art.resize((box[2] - box[0], box[3] - box[1]), Image.Resampling.LANCZOS)
            scene.alpha_composite(art, (box[0], box[1]))
        if boxes:
            d.rectangle(box, outline=(255, 0, 128), width=3)
    # The 🫧 pill: top-1.5 right-1.5 (6 CSS px), about 58 x 24 CSS px.
    pw, ph, m = 58 * SCALE, 24 * SCALE, 6 * SCALE
    pill = (SCENE_W - m - pw, m, SCENE_W - m, m + ph)
    d.rounded_rectangle(pill, radius=ph // 2, fill=(255, 250, 252), outline=(240, 200, 210),
                        width=3)
    icon = next((a for a in model.assets if a.kind == "ui"), None)
    if icon and (EXPORT_DIR / icon.out_rel).exists():
        ic = Image.open(EXPORT_DIR / icon.out_rel).convert("RGBA").resize((ph - 24, ph - 24))
        scene.alpha_composite(ic, (pill[0] + 18, pill[1] + 12))
    return scene


# ── Manifest ──────────────────────────────────────────────────────────────────
def _ratio(size: tuple[int, int]) -> str:
    w, h = size
    return f"{w / h:.2f}:1"


def render_manifest(model: Model, with_status: bool = False) -> str:
    def st(a: Asset) -> str:
        return status(a) if with_status else "todo"

    themes = [a for a in model.assets if a.kind == "theme"]
    decos = [a for a in model.assets if a.kind == "decoration"]
    ui = [a for a in model.assets if a.kind == "ui"]
    theme_src = (f"`{THEMES_TS}`" if model.themes_from_code
                 else "issue #523's spec (`themes.ts` isn't built yet; the list updates "
                      "itself once it lands)")
    lines: list[str] = []
    lines += [
        "# Kitchen scene: asset manifest",
        "",
        "<!-- GENERATED by `python scripts/art/kitchen.py manifest --write`. Don't edit by",
        "     hand: change the app code or scripts/art/kitchen.py and regenerate. -->",
        "",
        f"Generated from `{SLOTS_TS}` and `{CATALOG_TS}` (issue #521), and the kitchen themes "
        f"from {theme_src}. Adding a catalog entry adds a row here on the next run.",
        "",
        f"**Size assumption.** The scene box is always 4:3 (`KitchenScene.tsx`). Art is made for "
        f"a scene **{SCENE_CSS_W} CSS px wide at {SCALE}x**, i.e. **{SCENE_W} x {SCENE_H} px**; "
        "each slot is its `slots.ts` percentage of that. 3x a 375px phone also covers the "
        f"480px desktop column at 2x (960px) and is within 6% of the widest phones "
        "(430px viewport, ~398px scene, at 3x).",
        "",
        "**Status** is `todo` (nothing saved), `raw` (a source image is in `art/kitchen/source/`) "
        "or `cut` (the finished PNG is in `art/kitchen/export/`). Refresh it with "
        "`python scripts/art/kitchen.py manifest --write`.",
        "",
        f"**Totals:** {len(themes)} backgrounds, {len(decos)} decorations, {len(ui)} "
        f"counter-corner icon = {len(model.assets)} assets to generate, plus the style anchor.",
        "",
        "## Style anchor (not shipped)",
        "",
        "| Asset ID | Size | Background | Save as | Status |",
        "|---|---|---|---|---|",
        "| `style_anchor` | model default (square) | cream #fff9f5 | "
        "`art/kitchen/style-anchor.png` | todo |",
        "",
        "## Scene backgrounds (one per kitchen theme)",
        "",
        "Full-bleed, no keying. Each is drawn over `art/guides/kitchen/scene-layout.png` so the "
        "furniture lines up with the slots. Themes after `pastel` are EDITS of the approved "
        "`pastel` source.",
        "",
        "| Asset ID | Theme | Target px | Aspect | Key bg | Save raw as "
        "| Output (`art/kitchen/export/`) | Ships to | Status |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for a in themes:
        lines.append(f"| `{a.id}` | {a.label} | {a.size[0]}x{a.size[1]} | 4:3 | none | "
                 f"`source/{a.id}.png` | `{a.out_rel}` | `nextjs/public{a.public_path}` "
                 f"| {st(a)} |")
    lines += [
        "",
        "## Decorations (all 12 slots, every catalog candidate)",
        "",
        "Transparent PNGs at exactly the slot's pixel size, so `object-contain` fills the slot "
        "box and the item's anchor lines up with the background. **Theme variants: none**: "
        "decorations render identically in every theme (issue #523).",
        "",
        "| Asset ID | Name | Slot | Target px | Aspect | Anchor | Key bg | Save raw as "
        "| Output (`art/kitchen/export/`) | Ships to | Status |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for a in decos:
        lines.append(f"| `{a.id}` | {a.label} | `{a.slot}` | {a.size[0]}x{a.size[1]} "
                     f"| {_ratio(a.size)} | {a.anchor} | {a.key} | `source/{a.id}.png` "
                     f"| `{a.out_rel}` | `nextjs/public{a.public_path}` | {st(a)} |")
    lines += [
        "",
        "## Counter corner",
        "",
        "The 🫧 balance pill sits in the scene's top-right corner, over the `lights` slot's "
        "column (`KitchenScene.tsx`, `data-testid=\"kitchen-bubbles-balance\"`). It needs "
        "(1) every background to keep the top-right corner (roughly x 74-100%, y 0-12%) as "
        "plain wall, and (2) optionally, a bubble icon to replace the emoji. The icon is "
        "optional: the emoji already works.",
        "",
        "| Asset ID | For | Target px | Aspect | Anchor | Key bg | Save raw as | Output | Ships to "
        "| Status |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for a in ui:
        lines.append(f"| `{a.id}` | {a.label} | {a.size[0]}x{a.size[1]} | 1:1 | center | {a.key} "
                 f"| `source/{a.id}.png` | `{a.out_rel}` | `nextjs/public{a.public_path}` "
                 f"| {st(a)} (optional) |")
    lines += [
        "",
        "## Slot frames and guides",
        "",
        f"Each slot item is drawn inside a box on a {GUIDE}px square guide. The box has the "
        f"slot's aspect, its longest side is {FRAME_MAX}px, and it's centred. `cut` crops every "
        "candidate for a slot to the same box (the kitchen version of Bubbles' "
        "`art/bubbles/expressions/FRAME.txt`), so candidates share one scale and anchor. For a "
        "source that isn't 2000px the box scales with it.",
        "",
        "| Slot | Box (% of scene: x, y, w, h) | Target px | Anchor | Frame in 2000px guide "
        "(x0,y0,x1,y1) | Guide files |",
        "|---|---|---|---|---|---|",
    ]
    for sl in model.slots:
        keys = sorted({a.key or "" for a in decos if a.slot == sl.key})
        guides = ", ".join(f"`slot-{sl.key}-{k}.png`" for k in keys)
        f = frame_for(sl.size)
        lines.append(f"| `{sl.key}` | {sl.x:g}, {sl.y:g}, {sl.w:g}, {sl.h:g} | "
                 f"{sl.size[0]}x{sl.size[1]} | {sl.anchor} | {','.join(map(str, f))} | {guides} |")
    for a in ui:
        f = frame_for(a.size)
        lines.append(f"| (icon) `{a.id}` | pill | {a.size[0]}x{a.size[1]} | center | "
                 f"{','.join(map(str, f))} | `{a.guide_name}` |")
    lines += [
        "",
        "## Bubbles (already done on `art/v1-assets`)",
        "",
        "Listed so the manifest covers every image the app loads. These were made with "
        "`art/PROMPTS.md` and cut with one shared frame (`art/bubbles/expressions/FRAME.txt`). "
        "No new prompts here.",
        "",
        "| State | Art | Ships to | Used by code today | Status |",
        "|---|---|---|---|---|",
    ]
    done = sorted(p.stem for p in (REPO / "art/bubbles/expressions").glob("*.png"))
    for state in sorted(set(done) | set(model.mascot_code_states)):
        art = f"`art/bubbles/expressions/{state}.png`" if state in done else "none yet"
        used = "yes (`BubblesMascot.tsx`)" if state in model.mascot_code_states else "no (#525)"
        stat = "done" if state in done else "todo (see #525)"
        lines.append(f"| `{state}` | {art} | `nextjs/public/mascot/bubbles-{state}.png` | {used} "
                 f"| {stat} |")
    lines.append("")
    return "\n".join(lines)


PROMPT_HEAD_RE = re.compile(r"^###\s+`(\w+)`", re.M)


def check(model: Model) -> list[str]:
    problems = []
    prompts = set(PROMPT_HEAD_RE.findall(PROMPTS_MD.read_text(encoding="utf-8"))) \
        if PROMPTS_MD.exists() else set()
    for a in model.assets:
        if a.id not in prompts:
            problems.append(f"no prompt in {PROMPTS_MD.relative_to(REPO)} for `{a.id}` "
                            f"(add a '### `{a.id}`' section)")
    if "style_anchor" not in prompts:
        problems.append("no '### `style_anchor`' prompt")
    current = MANIFEST_MD.read_text(encoding="utf-8") if MANIFEST_MD.exists() else ""
    if current != render_manifest(model):
        problems.append("MANIFEST.md is stale: run "
                        "`python scripts/art/kitchen.py manifest --write`")
    return problems


# ── CLI ───────────────────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ref", default="origin/main",
                   help="git ref to read the kitchen code from when it isn't checked out")
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("manifest", help="print (or --write) the asset manifest")
    m.add_argument("--write", action="store_true")
    m.add_argument("--status", action="store_true",
                   help="fill the status column from art/kitchen/source and export")
    sub.add_parser("guides", help="write the guide images to attach in Gemini")
    c = sub.add_parser("cut", help="cut sources into sized, transparent exports")
    c.add_argument("ids", nargs="*", help="asset IDs (default: every asset with a source)")
    c.add_argument("--fit", action="store_true",
                   help="trim + fit + anchor instead of the shared frame")
    c.add_argument("--src", help="use this file as the source (with exactly one ID)")
    v = sub.add_parser("preview", help="compose the scene from the exports")
    v.add_argument("--theme", default="pastel")
    v.add_argument("--boxes", action="store_true", help="outline the slot boxes")
    v.add_argument("--pick", nargs="*", default=[], help="decoration IDs to show")
    sub.add_parser("check", help="prompts cover the manifest; MANIFEST.md is current")
    args = p.parse_args(argv)

    model = load(args.ref)
    by_id = {a.id: a for a in model.assets}

    if args.cmd == "manifest":
        text = render_manifest(model, with_status=args.status)
        if args.write:
            MANIFEST_MD.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {MANIFEST_MD.relative_to(REPO)} ({len(model.assets)} assets)")
        else:
            print(text)
    elif args.cmd == "guides":
        for path in write_guides(model):
            print(path.relative_to(REPO))
    elif args.cmd == "cut":
        ids = args.ids or [a.id for a in model.assets if find_source(a.id)]
        if args.src and len(ids) != 1:
            p.error("--src needs exactly one ID")
        if not ids:
            print(f"no sources in {SOURCE_DIR.relative_to(REPO)}/ yet")
        failed = 0
        for aid in ids:
            found = by_id.get(aid)
            if found is None:
                print(f"{aid}: not in the manifest")
                failed += 1
                continue
            asset = found
            src = Path(args.src) if args.src else find_source(aid)
            if src is None:
                print(f"{aid}: no source (save it as art/kitchen/source/{aid}.png)")
                failed += 1
                continue
            try:
                dst, warnings = cut_asset(asset, src, fit=args.fit)
            except CutError as e:
                print(f"{aid}: FAILED: {e}")
                failed += 1
                continue
            print(f"{aid}: {src.name} -> {dst.relative_to(REPO)} {asset.size[0]}x{asset.size[1]}")
            for w in warnings:
                print(f"    warning: {w}")
        return 1 if failed else 0
    elif args.cmd == "preview":
        PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
        out = PREVIEW_DIR / f"{args.theme}.png"
        preview(model, args.theme, args.pick, args.boxes).save(out)
        print(out.relative_to(REPO))
    elif args.cmd == "check":
        problems = check(model)
        for pr in problems:
            print(pr)
        print("ok" if not problems else f"{len(problems)} problem(s)")
        return 1 if problems else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
