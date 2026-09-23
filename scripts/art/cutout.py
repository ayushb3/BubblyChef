"""Cut BubblyChef art out of its flat chroma background into transparent PNGs.

Art is generated (Nano Banana) on a flat pure-green (#00ff00) background, or flat
magenta (#ff00ff) when the subject itself is green (herbs, vegetables, plants).

    python scripts/art/cutout.py in.jpg out.png                  # trim to the subject
    python scripts/art/cutout.py --magenta basil.jpg basil.png   # magenta background
    python scripts/art/cutout.py --frame 440,280,1560,1720 happy.jpg sad.jpg ... -o outdir/
        # fixed frame: every image cropped to the SAME box, so a set of expressions
        # that are edits of one base keep Bubbles at the same size and position
        # (per-image trimming would shrink Bubbles whenever confetti/sparkles widen it).

Notes from testing (2026-09-23):
- Spill cleanup (pulling the chroma colour out of fringe pixels) is applied ONLY to
  semi-transparent edge pixels. Applying it everywhere dulled solid green leaves.
- Background ghosting/smudges that image models leave in the flat colour key out fine.
- Faint alpha below 40/255 is dropped so specks don't survive.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

LOW, HIGH = 40.0, 120.0   # chroma "excess" range mapped to opaque -> fully transparent


def key(im: Image.Image, magenta: bool = False) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    if magenta:
        excess = np.minimum(r, b) - g           # how much more magenta than green
    else:
        excess = g - np.maximum(r, b)           # how much greener than red/blue
    alpha = np.clip(1.0 - (excess - LOW) / (HIGH - LOW), 0.0, 1.0)
    edge = (alpha > 0) & (alpha < 0.98) & (excess > 0)
    if magenta:
        cap = g + np.clip(excess, 0, None) * 0.15
        r = np.where(edge, np.minimum(r, cap), r)
        b = np.where(edge, np.minimum(b, cap), b)
    else:
        g = np.where(edge, np.maximum(r, b) + np.clip(excess, 0, None) * 0.15, g)
    alpha = np.where(alpha * 255 < 40, 0, alpha * 255)
    out = np.dstack([r, g, b, alpha]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def trim(im: Image.Image, pad: int = 16) -> Image.Image:
    bbox = im.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox()
    im = im.crop(bbox)
    canvas = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    canvas.paste(im, (pad, pad), im)
    return canvas


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("inputs", nargs="+", help="input image(s); with a single input and no -o, the last arg is the output")
    p.add_argument("-o", "--outdir", help="output directory (keeps input stem, .png)")
    p.add_argument("--magenta", action="store_true", help="background is magenta, not green")
    p.add_argument("--frame", help="x0,y0,x1,y1 fixed crop box applied to every input instead of trimming")
    args = p.parse_args()

    if args.outdir:
        pairs = [(Path(i), Path(args.outdir) / (Path(i).stem + ".png")) for i in args.inputs]
        Path(args.outdir).mkdir(parents=True, exist_ok=True)
    else:
        if len(args.inputs) != 2:
            p.error("give IN OUT, or several inputs with -o DIR")
        pairs = [(Path(args.inputs[0]), Path(args.inputs[1]))]

    frame = tuple(int(v) for v in args.frame.split(",")) if args.frame else None
    for src, dst in pairs:
        out = key(Image.open(src), magenta=args.magenta)
        out = out.crop(frame) if frame else trim(out)
        out.save(dst)
        print(f"{src.name} -> {dst} {out.size}")


if __name__ == "__main__":
    main()
