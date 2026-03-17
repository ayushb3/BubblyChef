import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Location } from '../../types';
import {
  drawWallpaper,
  drawFloorTiles,
  drawWindow,
  drawMolding,
  drawBaseboard,
  drawBacksplash,
  drawPottedPlant,
  drawWallClock,
  drawAmbientLight,
} from './drawEnvironment';

export const COLORS = {
  wall: 0xfff9f5,
  floor: 0xf5edd9,
  fridge: 0xb5d8eb,
  freezer: 0xc9b5e8,
  pantry: 0xffdab3,
  counter: 0xd4c4a8,
  shadow: 0x4a4a4a,
  handle: 0x8fa8b8,
  outline: 0x4a4a4a,
  white: 0xffffff,
  frost: 0xe8d5f5,
} as const;

// Extended palette for enhanced appliances
const AP = {
  // Fridge
  fridgeBody: 0xb5d8eb,
  fridgeDoor: 0xc5e4f3,
  fridgeDoorDark: 0xa8d2e8,
  fridgeSide: 0x9cc5db,
  fridgeSideDark: 0x88b5cc,
  fridgeDivider: 0x95bdd0,
  fridgeHandleBase: 0xc8c8c8,
  fridgeHandleHighlight: 0xe8e8e8,
  fridgeHandleShadow: 0xa0a0a0,
  fridgeSeal: 0x8aafca,
  fridgeTop: 0xc8e5f5,
  fridgeMagnet1: 0xff9aa2,
  fridgeMagnet2: 0xb5ead7,
  fridgeMagnet3: 0xffd8b5,

  // Pantry
  pantryFrame: 0xb87a4a,
  pantryFrameLight: 0xd4996a,
  pantrySide: 0xa06830,
  pantryBack: 0xffecd0,
  shelfTop: 0xd4996a,
  shelfFront: 0xc8864e,
  shelfShadow: 0xb07840,
  silhouette: 0xc8956c,

  // Freezer
  freezerBody: 0xc0aad8,
  freezerDoor: 0xd5c5e8,
  freezerSide: 0xb098c8,
  freezerFrost: 0xe8dff2,
  freezerIce: 0xdad0ea,
  freezerHandleBase: 0xb8b8b8,
  freezerLED: 0x5ce0d0,
  freezerLEDGlow: 0xa0f0e8,

  // Counter
  counterTop: 0xd4c4a8,
  counterTopLight: 0xe0d0b8,
  counterFront: 0xc0b090,
  counterFrontDark: 0xb0a080,
  counterEdge: 0xc8b898,
  counterGrain: 0xc4b498,
  counterKnob: 0xb8b0a0,
  counterDoor: 0xccc0a8,
  counterDoorLine: 0xb8ac94,
  cuttingBoard: 0xe0c88c,
  cuttingBoardDark: 0xd0b87c,
  bowlBase: 0xe8d8c0,
  bowlInner: 0xf0e8d0,
  fruitRed: 0xff7a7a,
  fruitGreen: 0x7ec87e,
  fruitYellow: 0xffd866,
} as const;

const BADGE_STYLE = new TextStyle({
  fontFamily: 'Nunito, sans-serif',
  fontSize: 11,
  fontWeight: 'bold',
  fill: 0xffffff,
});

export interface ApplianceZone {
  location: Location;
  container: Container;
  x: number;
  y: number;
  width: number;
  height: number;
}

function drawFridge(container: Container, x: number, y: number): void {
  const g = new Graphics();
  const w = 110;
  const h = 170;
  const sideW = 10;

  // Shadow behind fridge
  g.rect(x + 4, y + h - 8, w + sideW - 4, 10).fill({ color: COLORS.shadow, alpha: 0.1 });
  g.ellipse(x + (w + sideW) / 2, y + h + 2, (w + sideW) / 2 + 4, 6).fill({
    color: COLORS.shadow,
    alpha: 0.06,
  });

  // Side panel (3D depth effect)
  g.rect(x + w, y + 3, sideW, h - 3).fill(AP.fridgeSide);
  g.rect(x + w + sideW - 2, y + 3, 2, h - 3).fill(AP.fridgeSideDark);
  // Side gradient lines
  for (let i = 0; i < h - 3; i += 8) {
    g.rect(x + w, y + 3 + i, sideW, 1).fill({ color: AP.fridgeSideDark, alpha: 0.15 });
  }

  // Main body
  g.rect(x, y, w, h).fill(AP.fridgeBody);
  g.rect(x, y, w, h).stroke({ width: 2, color: COLORS.outline, alpha: 0.5 });

  // Top face (slight 3D)
  g.rect(x, y, w, 4).fill(AP.fridgeTop);

  // Upper door (freezer compartment)
  const doorPad = 5;
  const upperH = 52;
  g.rect(x + doorPad, y + doorPad, w - doorPad * 2, upperH).fill(AP.fridgeDoor);
  g.rect(x + doorPad, y + doorPad, w - doorPad * 2, 2).fill({
    color: COLORS.white,
    alpha: 0.3,
  });
  g.rect(x + doorPad, y + doorPad + upperH - 2, w - doorPad * 2, 2).fill({
    color: AP.fridgeDoorDark,
    alpha: 0.5,
  });

  // Door seal (rubber gasket line)
  g.rect(x + doorPad + 1, y + doorPad + 1, w - doorPad * 2 - 2, upperH - 2).stroke({
    width: 1,
    color: AP.fridgeSeal,
    alpha: 0.3,
  });

  // Divider between compartments
  g.rect(x + 3, y + doorPad + upperH + 2, w - 6, 5).fill(AP.fridgeDivider);
  g.rect(x + 3, y + doorPad + upperH + 2, w - 6, 1).fill({
    color: COLORS.white,
    alpha: 0.2,
  });

  // Lower door (main fridge)
  const lowerY = y + doorPad + upperH + 9;
  const lowerH = h - doorPad - upperH - 14;
  g.rect(x + doorPad, lowerY, w - doorPad * 2, lowerH).fill(AP.fridgeDoor);
  g.rect(x + doorPad, lowerY, w - doorPad * 2, 2).fill({
    color: COLORS.white,
    alpha: 0.3,
  });
  g.rect(x + doorPad, lowerY + lowerH - 2, w - doorPad * 2, 2).fill({
    color: AP.fridgeDoorDark,
    alpha: 0.5,
  });
  // Lower door seal
  g.rect(x + doorPad + 1, lowerY + 1, w - doorPad * 2 - 2, lowerH - 2).stroke({
    width: 1,
    color: AP.fridgeSeal,
    alpha: 0.3,
  });

  // Handles (chrome style with highlight)
  // Upper handle
  const hx = x + w - doorPad - 12;
  const hy1 = y + doorPad + 16;
  g.rect(hx, hy1, 6, 20).fill(AP.fridgeHandleBase);
  g.rect(hx, hy1, 2, 20).fill(AP.fridgeHandleHighlight);
  g.rect(hx + 4, hy1, 2, 20).fill(AP.fridgeHandleShadow);
  // Handle caps
  g.rect(hx - 1, hy1 - 1, 8, 3).fill(AP.fridgeHandleBase);
  g.rect(hx - 1, hy1 + 18, 8, 3).fill(AP.fridgeHandleBase);

  // Lower handle
  const hy2 = lowerY + 30;
  g.rect(hx, hy2, 6, 24).fill(AP.fridgeHandleBase);
  g.rect(hx, hy2, 2, 24).fill(AP.fridgeHandleHighlight);
  g.rect(hx + 4, hy2, 2, 24).fill(AP.fridgeHandleShadow);
  g.rect(hx - 1, hy2 - 1, 8, 3).fill(AP.fridgeHandleBase);
  g.rect(hx - 1, hy2 + 22, 8, 3).fill(AP.fridgeHandleBase);

  // Magnets on lower door
  g.roundRect(x + 15, lowerY + 10, 10, 10, 2).fill(AP.fridgeMagnet1);
  g.roundRect(x + 30, lowerY + 16, 8, 8, 2).fill(AP.fridgeMagnet2);
  g.roundRect(x + 20, lowerY + 30, 12, 8, 2).fill(AP.fridgeMagnet3);

  // Photo/note on fridge (tiny rectangle)
  g.rect(x + 40, lowerY + 8, 16, 20).fill(COLORS.white);
  g.rect(x + 40, lowerY + 8, 16, 20).stroke({ width: 1, color: 0xdddddd });
  // Tiny "lines" on the note
  g.rect(x + 43, lowerY + 13, 10, 1).fill({ color: COLORS.shadow, alpha: 0.2 });
  g.rect(x + 43, lowerY + 16, 8, 1).fill({ color: COLORS.shadow, alpha: 0.2 });
  g.rect(x + 43, lowerY + 19, 10, 1).fill({ color: COLORS.shadow, alpha: 0.2 });

  // Snowflake icon on upper door
  const sx = x + 24;
  const sy = y + doorPad + 20;
  g.rect(sx, sy - 3, 2, 10).fill({ color: COLORS.white, alpha: 0.5 });
  g.rect(sx - 3, sy + 1, 10, 2).fill({ color: COLORS.white, alpha: 0.5 });
  g.rect(sx - 2, sy - 2, 2, 2).fill({ color: COLORS.white, alpha: 0.3 });
  g.rect(sx + 2, sy + 4, 2, 2).fill({ color: COLORS.white, alpha: 0.3 });

  // Feet
  g.rect(x + 8, y + h, 8, 4).fill(COLORS.shadow);
  g.rect(x + w - 16, y + h, 8, 4).fill(COLORS.shadow);

  container.addChild(g);
}

function drawPantryShelf(container: Container, x: number, y: number): void {
  const g = new Graphics();
  const w = 180;
  const h = 140;
  const sideW = 8;
  const shelfCount = 4;
  const shelfThick = 5;

  // Shadow
  g.ellipse(x + w / 2, y + h + 2, w / 2 + 4, 5).fill({
    color: COLORS.shadow,
    alpha: 0.06,
  });

  // Back panel
  g.rect(x + sideW, y, w - sideW * 2, h).fill(AP.pantryBack);

  // Left side frame
  g.rect(x, y - 4, sideW, h + 8).fill(AP.pantryFrame);
  g.rect(x, y - 4, 2, h + 8).fill(AP.pantryFrameLight);
  g.rect(x + sideW - 2, y - 4, 2, h + 8).fill(AP.pantrySide);

  // Right side frame
  g.rect(x + w - sideW, y - 4, sideW, h + 8).fill(AP.pantryFrame);
  g.rect(x + w - sideW, y - 4, 2, h + 8).fill(AP.pantrySide);
  g.rect(x + w - 2, y - 4, 2, h + 8).fill(AP.pantryFrameLight);

  // Top cap
  g.rect(x - 2, y - 6, w + 4, 6).fill(AP.pantryFrame);
  g.rect(x - 2, y - 6, w + 4, 2).fill(AP.pantryFrameLight);

  // Shelves with 3D depth
  const shelfSpacing = (h - 8) / shelfCount;
  for (let i = 1; i <= shelfCount; i++) {
    const sy = y + i * shelfSpacing;
    // Shelf top surface
    g.rect(x + sideW - 2, sy, w - sideW * 2 + 4, shelfThick).fill(AP.shelfTop);
    // Shelf front face (depth)
    g.rect(x + sideW - 2, sy + shelfThick, w - sideW * 2 + 4, 3).fill(AP.shelfFront);
    // Shadow under shelf
    g.rect(x + sideW, sy + shelfThick + 3, w - sideW * 2, 2).fill({
      color: AP.shelfShadow,
      alpha: 0.15,
    });
    // Highlight on top edge
    g.rect(x + sideW - 2, sy, w - sideW * 2 + 4, 1).fill({
      color: COLORS.white,
      alpha: 0.2,
    });
  }

  // Item silhouettes on shelves (varied shapes — jars, boxes, cans)
  const items = [
    // Shelf 1 — tall bottles/jars
    { sx: 18, sy: 14, w: 8, h: 16, shape: 'jar' },
    { sx: 34, sy: 16, w: 6, h: 14, shape: 'bottle' },
    { sx: 54, sy: 12, w: 10, h: 18, shape: 'box' },
    { sx: 80, sy: 16, w: 8, h: 14, shape: 'jar' },
    { sx: 110, sy: 14, w: 6, h: 16, shape: 'bottle' },
    { sx: 140, sy: 16, w: 8, h: 14, shape: 'jar' },
    // Shelf 2 — cans and boxes
    { sx: 20, sy: 48, w: 8, h: 12, shape: 'can' },
    { sx: 38, sy: 46, w: 12, h: 14, shape: 'box' },
    { sx: 68, sy: 48, w: 8, h: 12, shape: 'can' },
    { sx: 100, sy: 46, w: 10, h: 14, shape: 'box' },
    { sx: 130, sy: 48, w: 8, h: 12, shape: 'can' },
    // Shelf 3 — smaller items
    { sx: 22, sy: 80, w: 6, h: 10, shape: 'jar' },
    { sx: 50, sy: 78, w: 14, h: 12, shape: 'box' },
    { sx: 90, sy: 80, w: 8, h: 10, shape: 'can' },
    { sx: 120, sy: 78, w: 10, h: 12, shape: 'box' },
    // Shelf 4 — bags and misc
    { sx: 25, sy: 112, w: 12, h: 10, shape: 'bag' },
    { sx: 60, sy: 110, w: 8, h: 12, shape: 'jar' },
    { sx: 100, sy: 112, w: 14, h: 10, shape: 'bag' },
    { sx: 140, sy: 110, w: 8, h: 12, shape: 'jar' },
  ];

  for (const item of items) {
    const ix = x + sideW + item.sx;
    const iy = y + item.sy;
    // Slightly varied colors per shape type
    const colors: Record<string, number> = {
      jar: 0xd8c0a0,
      bottle: 0xc0b098,
      box: 0xd0b880,
      can: 0xc0c0c0,
      bag: 0xe0d0b8,
    };
    const color = colors[item.shape] ?? AP.silhouette;
    g.rect(ix, iy, item.w, item.h).fill({ color, alpha: 0.5 });
    // Subtle highlight on top
    g.rect(ix, iy, item.w, 1).fill({ color: COLORS.white, alpha: 0.2 });
  }

  container.addChild(g);
}

function drawFreezer(container: Container, x: number, y: number): void {
  const g = new Graphics();
  const w = 100;
  const h = 160;
  const sideW = 8;

  // Shadow
  g.ellipse(x + (w + sideW) / 2, y + h + 2, (w + sideW) / 2 + 4, 5).fill({
    color: COLORS.shadow,
    alpha: 0.06,
  });

  // Side panel (3D)
  g.rect(x + w, y + 3, sideW, h - 3).fill(AP.freezerSide);
  for (let i = 0; i < h - 3; i += 8) {
    g.rect(x + w, y + 3 + i, sideW, 1).fill({ color: 0x9880b0, alpha: 0.15 });
  }

  // Main body
  g.rect(x, y, w, h).fill(AP.freezerBody);
  g.rect(x, y, w, h).stroke({ width: 2, color: COLORS.outline, alpha: 0.5 });

  // Top face
  g.rect(x, y, w, 4).fill(AP.freezerDoor);

  // Door panel
  const doorPad = 5;
  g.rect(x + doorPad, y + doorPad, w - doorPad * 2, h - doorPad * 2).fill(AP.freezerDoor);
  // Door edges
  g.rect(x + doorPad, y + doorPad, w - doorPad * 2, 2).fill({
    color: COLORS.white,
    alpha: 0.25,
  });
  g.rect(x + doorPad, y + h - doorPad - 2, w - doorPad * 2, 2).fill({
    color: AP.freezerSide,
    alpha: 0.5,
  });

  // Frost buildup on edges (irregular pixel clusters)
  const frostPoints = [
    { fx: 8, fy: 8, fw: 12, fh: 3 },
    { fx: 6, fy: 14, fw: 8, fh: 2 },
    { fx: w - 20, fy: 10, fw: 14, fh: 3 },
    { fx: w - 16, fy: 16, fw: 10, fh: 2 },
    { fx: 10, fy: h - 20, fw: 16, fh: 3 },
    { fx: w - 24, fy: h - 18, fw: 14, fh: 3 },
    { fx: 8, fy: h - 12, fw: 10, fh: 2 },
    { fx: w - 18, fy: h - 10, fw: 12, fh: 2 },
  ];
  for (const f of frostPoints) {
    g.rect(x + f.fx, y + f.fy, f.fw, f.fh).fill({ color: AP.freezerFrost, alpha: 0.7 });
    // Crystal shimmer
    g.rect(x + f.fx + 2, y + f.fy, 2, 1).fill({ color: COLORS.white, alpha: 0.5 });
  }

  // Decorative frost pattern (diagonal ice crystals)
  for (let i = 0; i < 8; i++) {
    const fx = x + 15 + i * 10;
    const fy = y + 30 + (i % 3) * 20;
    // Small cross crystal
    g.rect(fx, fy, 4, 1).fill({ color: COLORS.white, alpha: 0.3 });
    g.rect(fx + 1, fy - 1, 1, 3).fill({ color: COLORS.white, alpha: 0.3 });
  }

  // Handle (chrome)
  const hx = x + w - doorPad - 10;
  const hy = y + h / 2 - 14;
  g.rect(hx, hy, 5, 28).fill(AP.freezerHandleBase);
  g.rect(hx, hy, 2, 28).fill({ color: COLORS.white, alpha: 0.3 });
  g.rect(hx + 3, hy, 2, 28).fill({ color: COLORS.shadow, alpha: 0.15 });
  g.rect(hx - 1, hy - 1, 7, 3).fill(AP.freezerHandleBase);
  g.rect(hx - 1, hy + 26, 7, 3).fill(AP.freezerHandleBase);

  // Temperature LED
  g.rect(x + 14, y + h - 30, 4, 4).fill(AP.freezerLED);
  g.rect(x + 13, y + h - 31, 6, 6).fill({ color: AP.freezerLEDGlow, alpha: 0.3 });

  // Temperature display text area
  g.rect(x + 22, y + h - 32, 24, 10).fill({ color: 0x2a2040, alpha: 0.8 });
  g.rect(x + 24, y + h - 30, 4, 6).fill({ color: AP.freezerLED, alpha: 0.8 });
  g.rect(x + 30, y + h - 30, 4, 6).fill({ color: AP.freezerLED, alpha: 0.8 });
  // Degree symbol
  g.rect(x + 36, y + h - 30, 2, 2).fill({ color: AP.freezerLED, alpha: 0.6 });

  // Snowflake icon (larger, more detailed)
  const sx = x + 42;
  const sy = y + 45;
  // Vertical
  g.rect(sx + 3, sy, 2, 14).fill({ color: COLORS.white, alpha: 0.45 });
  // Horizontal
  g.rect(sx - 1, sy + 5, 14, 2).fill({ color: COLORS.white, alpha: 0.45 });
  // Diagonals
  g.rect(sx, sy + 1, 2, 2).fill({ color: COLORS.white, alpha: 0.3 });
  g.rect(sx + 6, sy + 1, 2, 2).fill({ color: COLORS.white, alpha: 0.3 });
  g.rect(sx, sy + 9, 2, 2).fill({ color: COLORS.white, alpha: 0.3 });
  g.rect(sx + 6, sy + 9, 2, 2).fill({ color: COLORS.white, alpha: 0.3 });

  // Feet
  g.rect(x + 8, y + h, 8, 4).fill(COLORS.shadow);
  g.rect(x + w - 16, y + h, 8, 4).fill(COLORS.shadow);

  container.addChild(g);
}

function drawCounter(container: Container, x: number, y: number, width: number): void {
  const g = new Graphics();
  const h = 80;
  const topH = 8;
  const frontH = h - topH;

  // Shadow
  g.rect(x + 4, y + h - 2, width, 6).fill({ color: COLORS.shadow, alpha: 0.08 });

  // Counter front face (cabinet doors)
  g.rect(x, y + topH, width, frontH).fill(AP.counterFront);
  g.rect(x, y + topH, width, frontH).stroke({ width: 1, color: COLORS.outline, alpha: 0.3 });

  // Cabinet door panels (evenly spaced)
  const doorCount = 5;
  const doorGap = 6;
  const doorW = (width - doorGap * (doorCount + 1)) / doorCount;
  for (let i = 0; i < doorCount; i++) {
    const dx = x + doorGap + i * (doorW + doorGap);
    const dy = y + topH + 6;
    const dh = frontH - 12;

    // Door panel
    g.rect(dx, dy, doorW, dh).fill(AP.counterDoor);
    // Inset effect
    g.rect(dx + 2, dy + 2, doorW - 4, dh - 4).fill(AP.counterDoorLine);
    g.rect(dx + 3, dy + 3, doorW - 6, dh - 6).fill(AP.counterDoor);
    // Top highlight
    g.rect(dx + 3, dy + 3, doorW - 6, 1).fill({ color: COLORS.white, alpha: 0.15 });

    // Knob
    g.circle(dx + doorW / 2, dy + dh / 2 + 6, 3).fill(AP.counterKnob);
    g.circle(dx + doorW / 2 - 1, dy + dh / 2 + 5, 1).fill({
      color: COLORS.white,
      alpha: 0.3,
    });
  }

  // Counter top surface
  g.rect(x - 4, y, width + 8, topH).fill(AP.counterTop);
  // Top highlight
  g.rect(x - 4, y, width + 8, 2).fill(AP.counterTopLight);
  // Front edge
  g.rect(x - 4, y + topH - 2, width + 8, 2).fill(AP.counterEdge);

  // Wood grain on countertop
  for (let i = 1; i <= 3; i++) {
    g.rect(x + 8, y + i * 2, width - 16, 1).fill({ color: AP.counterGrain, alpha: 0.3 });
  }

  // Decorative: cutting board
  const cbx = x + width - 80;
  const cby = y - 2;
  g.rect(cbx, cby, 30, 5).fill(AP.cuttingBoard);
  g.rect(cbx, cby, 30, 1).fill(AP.cuttingBoardDark);
  g.rect(cbx, cby + 4, 30, 1).fill(AP.cuttingBoardDark);

  // Decorative: fruit bowl
  const fbx = x + 60;
  const fby = y - 8;
  // Bowl shape
  g.rect(fbx, fby + 4, 24, 6).fill(AP.bowlBase);
  g.rect(fbx + 2, fby + 2, 20, 4).fill(AP.bowlInner);
  // Fruits in bowl
  g.circle(fbx + 8, fby + 2, 4).fill(AP.fruitRed);
  g.circle(fbx + 8, fby + 2, 4).fill({ color: COLORS.white, alpha: 0.1 });
  g.circle(fbx + 15, fby + 3, 3).fill(AP.fruitGreen);
  g.circle(fbx + 11, fby - 1, 3).fill(AP.fruitYellow);

  container.addChild(g);
}

function addBadge(container: Container, x: number, y: number, count: number): void {
  if (count === 0) return;

  const bg = new Graphics();
  const bw = count >= 10 ? 26 : 20;
  const bh = 18;

  bg.roundRect(x, y, bw, bh, 9).fill(0xff9aa2);
  bg.roundRect(x, y, bw, bh, 9).stroke({ width: 1, color: 0xffffff, alpha: 0.8 });

  const text = new Text({ text: String(count), style: BADGE_STYLE });
  text.anchor.set(0.5, 0.5);
  text.x = x + bw / 2;
  text.y = y + bh / 2;

  container.addChild(bg);
  container.addChild(text);
}

export interface RoomLayout {
  zones: ApplianceZone[];
  canvasWidth: number;
  canvasHeight: number;
}

export function drawKitchenRoom(
  roomContainer: Container,
  itemCounts: Record<Location, number>,
  isMobile: boolean,
): RoomLayout {
  const scale = isMobile ? 0.6 : 1;
  const cw = Math.round(800 * scale);
  const ch = Math.round(520 * scale);

  roomContainer.scale.set(scale);

  const wallHeight = 230;
  const floorY = wallHeight;

  // 1. Wall with wallpaper pattern
  drawWallpaper(roomContainer, 800, wallHeight);

  // 2. Crown molding at ceiling
  drawMolding(roomContainer, 800);

  // 3. Floor tiles
  drawFloorTiles(roomContainer, floorY, 800, 520 - wallHeight);

  // 4. Baseboard
  drawBaseboard(roomContainer, wallHeight - 1, 800);

  // 5. Window (center-left of wall)
  drawWindow(roomContainer, 210, 30, 80, 70);

  // 6. Backsplash behind counter area
  drawBacksplash(roomContainer, 50, wallHeight - 80, 700, 80);

  // 7. Ambient light from window
  drawAmbientLight(roomContainer, 210, 800, 520);

  // 8. Wall clock (right of window)
  drawWallClock(roomContainer, 340, 40);

  const zones: ApplianceZone[] = [];

  // Fridge — left side (on the floor, taller now)
  const fridgeC = new Container();
  const fridgeX = 30;
  const fridgeH = 170;
  const fridgeY = floorY - fridgeH + 6; // sits on floor
  drawFridge(fridgeC, fridgeX, fridgeY);
  addBadge(fridgeC, fridgeX + 90, fridgeY - 8, itemCounts.fridge);
  roomContainer.addChild(fridgeC);
  zones.push({
    location: 'fridge',
    container: fridgeC,
    x: fridgeX,
    y: fridgeY,
    width: 120,
    height: fridgeH,
  });

  // Pantry shelf — center (mounted on wall)
  const pantryC = new Container();
  const pantryX = 390;
  const pantryY = wallHeight - 146;
  drawPantryShelf(pantryC, pantryX, pantryY);
  addBadge(pantryC, pantryX + 150, pantryY - 10, itemCounts.pantry);
  roomContainer.addChild(pantryC);
  zones.push({
    location: 'pantry',
    container: pantryC,
    x: pantryX,
    y: pantryY,
    width: 180,
    height: 140,
  });

  // Freezer — right side (on the floor)
  const freezerC = new Container();
  const freezerX = 640;
  const freezerH = 160;
  const freezerY = floorY - freezerH + 6;
  drawFreezer(freezerC, freezerX, freezerY);
  addBadge(freezerC, freezerX + 80, freezerY - 8, itemCounts.freezer);
  roomContainer.addChild(freezerC);
  zones.push({
    location: 'freezer',
    container: freezerC,
    x: freezerX,
    y: freezerY,
    width: 108,
    height: freezerH,
  });

  // Potted plant (on floor, between window and pantry)
  drawPottedPlant(roomContainer, 360, floorY - 28);

  // Counter — bottom portion (with cabinets)
  const counterC = new Container();
  const counterX = 50;
  const counterY = floorY + 40;
  const counterW = 700;
  drawCounter(counterC, counterX, counterY, counterW);
  addBadge(counterC, counterX + counterW - 30, counterY - 12, itemCounts.counter);
  roomContainer.addChild(counterC);
  zones.push({
    location: 'counter',
    container: counterC,
    x: counterX,
    y: counterY,
    width: counterW,
    height: 80,
  });

  return { zones, canvasWidth: cw, canvasHeight: ch };
}
