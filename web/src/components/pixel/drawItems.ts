import { Graphics } from 'pixi.js';
import type { Category } from '../../types';

type PixelRow = [number, number, number, number[]]; // x, y, w, colors per pixel (0 = skip)

function px(g: Graphics, bx: number, by: number, pixels: PixelRow[]) {
  for (const [x, y, w, colors] of pixels) {
    for (let i = 0; i < colors.length; i++) {
      if (colors[i] !== 0) {
        g.rect(bx + (x + i) * w, by + y * w, w, w).fill(colors[i]);
      }
    }
  }
}

function drawApple(g: Graphics, x: number, y: number) {
  // Red apple with green leaf
  const r = 0xff6b6b;
  const d = 0xe05555;
  const l = 0x4caf50;
  const s = 0x8b5e3c; // stem
  px(g, x, y, [
    [6, 1, 1, [s]],
    [5, 2, 1, [l, l]],
    [4, 3, 1, [0, l]],
    [4, 4, 1, [r, r, r, r, r, r, r, r]],
    [3, 5, 1, [r, r, r, r, r, r, r, r, r, r]],
    [3, 6, 1, [r, r, r, r, r, r, r, r, r, r]],
    [3, 7, 1, [r, d, r, r, r, r, r, r, d, r]],
    [3, 8, 1, [r, r, r, r, r, r, r, r, r, r]],
    [3, 9, 1, [d, r, r, r, r, r, r, r, r, d]],
    [3, 10, 1, [r, r, r, r, r, r, r, r, r, r]],
    [4, 11, 1, [d, r, r, r, r, r, r, d]],
    [5, 12, 1, [r, r, r, r, r, r]],
    [6, 13, 1, [d, d, d, d]],
  ]);
}

function drawMilkBottle(g: Graphics, x: number, y: number) {
  const w = 0xeeeeee;
  const b = 0x5b9bd5;
  const o = 0xcccccc;
  px(g, x, y, [
    [6, 1, 1, [b, b, b, b]],
    [6, 2, 1, [b, b, b, b]],
    [6, 3, 1, [o, w, w, o]],
    [5, 4, 1, [o, w, w, w, w, o]],
    [4, 5, 1, [o, w, w, w, w, w, w, o]],
    [4, 6, 1, [o, w, w, w, w, w, w, o]],
    [4, 7, 1, [o, w, w, w, w, w, w, o]],
    [4, 8, 1, [o, w, w, w, w, w, w, o]],
    [4, 9, 1, [o, w, b, b, b, w, w, o]],
    [4, 10, 1, [o, w, b, b, b, w, w, o]],
    [4, 11, 1, [o, w, w, w, w, w, w, o]],
    [4, 12, 1, [o, w, w, w, w, w, w, o]],
    [4, 13, 1, [o, o, o, o, o, o, o, o]],
  ]);
}

function drawDrumstick(g: Graphics, x: number, y: number) {
  const m = 0xc67c4e;
  const d = 0xa56238;
  const b = 0xf5deb3; // bone
  px(g, x, y, [
    [9, 2, 1, [b, b, b]],
    [9, 3, 1, [b, b, b]],
    [8, 4, 1, [b, b, b]],
    [7, 5, 1, [m, m, m, m]],
    [6, 6, 1, [m, m, m, m, m]],
    [5, 7, 1, [m, m, m, m, m]],
    [4, 8, 1, [d, m, m, m, m]],
    [3, 9, 1, [d, m, m, m, m]],
    [2, 10, 1, [d, d, m, m, m]],
    [2, 11, 1, [d, d, m, m]],
    [1, 12, 1, [d, d, d]],
  ]);
}

function drawFish(g: Graphics, x: number, y: number) {
  const f = 0x7bb3d3;
  const d = 0x5a8faa;
  const e = 0x2c3e50;
  px(g, x, y, [
    [5, 4, 1, [f, f, f, f]],
    [3, 5, 1, [d, f, f, f, f, f, f, d]],
    [1, 6, 1, [d, d, f, f, f, e, f, f, f, f, d]],
    [0, 7, 1, [d, d, f, f, f, f, f, f, f, f, f, f, d, d]],
    [1, 8, 1, [d, d, f, f, f, f, f, f, f, f, d]],
    [3, 9, 1, [d, f, f, f, f, f, f, d]],
    [5, 10, 1, [f, f, f, f]],
  ]);
}

function drawIceCube(g: Graphics, x: number, y: number) {
  const c = 0xb5d8eb;
  const l = 0xd0ebf5;
  const s = 0xffffff;
  const o = 0x8ab8d0;
  px(g, x, y, [
    [3, 3, 1, [o, o, o, o, o, o, o, o, o, o]],
    [3, 4, 1, [o, c, c, c, s, s, c, c, c, o]],
    [3, 5, 1, [o, c, c, s, s, c, c, c, c, o]],
    [3, 6, 1, [o, c, c, c, c, c, c, l, c, o]],
    [3, 7, 1, [o, c, c, c, c, c, l, l, c, o]],
    [3, 8, 1, [o, c, l, c, c, c, c, c, c, o]],
    [3, 9, 1, [o, c, l, l, c, c, c, c, c, o]],
    [3, 10, 1, [o, c, c, c, c, c, c, c, c, o]],
    [3, 11, 1, [o, c, c, c, c, c, s, c, c, o]],
    [3, 12, 1, [o, o, o, o, o, o, o, o, o, o]],
  ]);
}

function drawCan(g: Graphics, x: number, y: number) {
  const m = 0x9e9e9e;
  const l = 0xff9aa2;
  const d = 0x888888;
  px(g, x, y, [
    [4, 2, 1, [d, d, d, d, d, d, d, d]],
    [4, 3, 1, [m, m, m, m, m, m, m, m]],
    [4, 4, 1, [m, m, m, m, m, m, m, m]],
    [4, 5, 1, [l, l, l, l, l, l, l, l]],
    [4, 6, 1, [l, l, l, l, l, l, l, l]],
    [4, 7, 1, [l, l, l, l, l, l, l, l]],
    [4, 8, 1, [l, l, l, l, l, l, l, l]],
    [4, 9, 1, [m, m, m, m, m, m, m, m]],
    [4, 10, 1, [m, m, m, m, m, m, m, m]],
    [4, 11, 1, [m, m, m, m, m, m, m, m]],
    [4, 12, 1, [d, d, d, d, d, d, d, d]],
  ]);
}

function drawBox(g: Graphics, x: number, y: number) {
  const b = 0xd4a96a;
  const d = 0xb8904e;
  const f = 0xc8956c;
  px(g, x, y, [
    [3, 3, 1, [d, d, d, d, d, d, d, d, d, d]],
    [3, 4, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 5, 1, [d, b, f, f, f, f, f, f, b, d]],
    [3, 6, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 7, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 8, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 9, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 10, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 11, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 12, 1, [d, d, d, d, d, d, d, d, d, d]],
  ]);
}

function drawBottle(g: Graphics, x: number, y: number) {
  const b = 0xd4d4d4;
  const c = 0xe74c3c; // red cap
  const o = 0xbbbbbb;
  px(g, x, y, [
    [7, 1, 1, [c, c]],
    [7, 2, 1, [c, c]],
    [7, 3, 1, [o, o]],
    [6, 4, 1, [o, b, b, o]],
    [6, 5, 1, [o, b, b, o]],
    [6, 6, 1, [o, b, b, o]],
    [6, 7, 1, [o, b, b, o]],
    [6, 8, 1, [o, b, b, o]],
    [5, 9, 1, [o, b, b, b, b, o]],
    [5, 10, 1, [o, b, b, b, b, o]],
    [5, 11, 1, [o, b, b, b, b, o]],
    [5, 12, 1, [o, b, b, b, b, o]],
    [5, 13, 1, [o, o, o, o, o, o]],
  ]);
}

function drawCup(g: Graphics, x: number, y: number) {
  const c = 0x7ec8e3;
  const d = 0x5ea8c3;
  px(g, x, y, [
    [3, 3, 1, [d, c, c, c, c, c, c, c, c, d]],
    [3, 4, 1, [d, c, c, c, c, c, c, c, c, d]],
    [3, 5, 1, [d, c, c, c, c, c, c, c, c, d]],
    [4, 6, 1, [d, c, c, c, c, c, c, c, d]],
    [4, 7, 1, [d, c, c, c, c, c, c, c, d]],
    [4, 8, 1, [d, c, c, c, c, c, c, c, d]],
    [5, 9, 1, [d, c, c, c, c, c, d]],
    [5, 10, 1, [d, c, c, c, c, c, d]],
    [5, 11, 1, [d, c, c, c, c, c, d]],
    [6, 12, 1, [d, d, d, d, d]],
  ]);
}

function drawPopcorn(g: Graphics, x: number, y: number) {
  const y1 = 0xfff1b5;
  const r = 0xff6b6b;
  const w = 0xffffff;
  px(g, x, y, [
    [7, 2, 1, [w, w]],
    [6, 3, 1, [w, y1, w, w]],
    [5, 4, 1, [w, w, y1, w, w, w]],
    [5, 5, 1, [r, y1, r, y1, r, y1]],
    [5, 6, 1, [r, y1, r, y1, r, y1]],
    [5, 7, 1, [r, y1, r, y1, r, y1]],
    [6, 8, 1, [r, y1, r, y1]],
    [6, 9, 1, [r, y1, r, y1]],
    [6, 10, 1, [r, y1, r, y1]],
    [7, 11, 1, [r, y1]],
    [7, 12, 1, [r, y1]],
  ]);
}

function drawBread(g: Graphics, x: number, y: number) {
  const b = 0xd4a96a;
  const d = 0xc8956c;
  const t = 0xbf8040; // top crust
  px(g, x, y, [
    [5, 4, 1, [t, t, t, t, t, t]],
    [4, 5, 1, [t, b, b, b, b, b, b, t]],
    [3, 6, 1, [t, b, b, b, b, b, b, b, b, t]],
    [3, 7, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 8, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 9, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 10, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 11, 1, [d, d, d, d, d, d, d, d, d, d]],
  ]);
}

function drawMysteryBox(g: Graphics, x: number, y: number) {
  const b = 0xcccccc;
  const d = 0xaaaaaa;
  const q = 0x888888;
  px(g, x, y, [
    [3, 3, 1, [d, d, d, d, d, d, d, d, d, d]],
    [3, 4, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 5, 1, [d, b, b, q, q, q, q, b, b, d]],
    [3, 6, 1, [d, b, b, b, b, b, q, b, b, d]],
    [3, 7, 1, [d, b, b, b, b, q, b, b, b, d]],
    [3, 8, 1, [d, b, b, b, q, b, b, b, b, d]],
    [3, 9, 1, [d, b, b, b, q, b, b, b, b, d]],
    [3, 10, 1, [d, b, b, b, b, b, b, b, b, d]],
    [3, 11, 1, [d, b, b, b, q, b, b, b, b, d]],
    [3, 12, 1, [d, d, d, d, d, d, d, d, d, d]],
  ]);
}

const SPRITE_DRAWERS: Record<Category, (g: Graphics, x: number, y: number) => void> = {
  produce: drawApple,
  dairy: drawMilkBottle,
  meat: drawDrumstick,
  seafood: drawFish,
  frozen: drawIceCube,
  canned: drawCan,
  dry_goods: drawBox,
  condiments: drawBottle,
  beverages: drawCup,
  snacks: drawPopcorn,
  bakery: drawBread,
  other: drawMysteryBox,
};

export function drawItemSprite(g: Graphics, category: Category, x: number, y: number): void {
  const drawer = SPRITE_DRAWERS[category] ?? drawMysteryBox;
  drawer(g, x, y);
}

export function getExpiryColor(days: number | null): number {
  if (days === null) return 0x999999;
  if (days < 0) return 0xff6b6b;
  if (days <= 2) return 0xffc107;
  return 0x4caf50;
}
