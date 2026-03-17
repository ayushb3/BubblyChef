import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Location } from '../../types';

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

function drawPixelRect(g: Graphics, x: number, y: number, w: number, h: number, fill: number) {
  g.rect(x, y, w, h).fill(fill);
}

function drawOutlinedRect(g: Graphics, x: number, y: number, w: number, h: number, fill: number) {
  g.rect(x, y, w, h).fill(fill);
  g.rect(x, y, w, h).stroke({ width: 2, color: COLORS.outline, alpha: 0.6 });
}

function drawFridge(container: Container, x: number, y: number): void {
  const g = new Graphics();

  // Body
  drawOutlinedRect(g, x, y, 100, 140, COLORS.fridge);

  // Two door panels
  g.rect(x + 4, y + 4, 92, 60).fill(0xc5e4f3);
  g.rect(x + 4, y + 72, 92, 64).fill(0xc5e4f3);

  // Divider line
  g.rect(x + 4, y + 66, 92, 4).fill(0xa0c8db);

  // Handle on right
  drawPixelRect(g, x + 88, y + 30, 4, 16, COLORS.handle);
  drawPixelRect(g, x + 88, y + 90, 4, 16, COLORS.handle);

  // Snowflake detail in upper door (4 pixel cross)
  const sx = x + 48;
  const sy = y + 28;
  drawPixelRect(g, sx, sy - 4, 4, 12, 0xffffff);
  drawPixelRect(g, sx - 4, sy, 12, 4, 0xffffff);

  container.addChild(g);
}

function drawPantryShelf(container: Container, x: number, y: number): void {
  const g = new Graphics();

  // Body
  drawOutlinedRect(g, x, y, 200, 120, COLORS.pantry);

  // 3 shelf lines
  for (let i = 1; i <= 3; i++) {
    const sy = y + i * 28;
    g.rect(x + 6, sy, 188, 3).fill(0xc8956c);
  }

  // Small item silhouettes on shelves
  const silhouettes = [
    { sx: 20, sy: 12, w: 8, h: 14 },
    { sx: 40, sy: 14, w: 6, h: 12 },
    { sx: 65, sy: 10, w: 10, h: 16 },
    { sx: 100, sy: 12, w: 8, h: 14 },
    { sx: 140, sy: 14, w: 6, h: 12 },
    { sx: 25, sy: 40, w: 8, h: 14 },
    { sx: 55, sy: 42, w: 10, h: 12 },
    { sx: 110, sy: 40, w: 8, h: 14 },
    { sx: 30, sy: 68, w: 6, h: 14 },
    { sx: 70, sy: 70, w: 10, h: 12 },
    { sx: 120, sy: 68, w: 8, h: 14 },
  ];
  for (const s of silhouettes) {
    g.rect(x + s.sx, y + s.sy, s.w, s.h).fill({ color: 0xc8956c, alpha: 0.4 });
  }

  container.addChild(g);
}

function drawFreezer(container: Container, x: number, y: number): void {
  const g = new Graphics();

  // Body
  drawOutlinedRect(g, x, y, 90, 130, COLORS.freezer);

  // Inner panel
  g.rect(x + 4, y + 4, 82, 122).fill(0xd8c5ed);

  // Frost pattern (diagonal pixel lines)
  for (let i = 0; i < 6; i++) {
    const fx = x + 10 + i * 14;
    const fy = y + 8 + i * 8;
    g.rect(fx, fy, 6, 2).fill({ color: 0xffffff, alpha: 0.5 });
    g.rect(fx + 2, fy + 4, 6, 2).fill({ color: 0xffffff, alpha: 0.4 });
  }

  // Handle
  drawPixelRect(g, x + 78, y + 50, 4, 16, COLORS.handle);

  // Padlock icon (simplified pixel lock)
  const lx = x + 38;
  const ly = y + 100;
  g.rect(lx, ly + 4, 14, 10).fill(0x8fa8b8);
  g.rect(lx + 3, ly, 8, 6).stroke({ width: 2, color: 0x8fa8b8 });
  drawPixelRect(g, lx + 5, ly + 7, 4, 4, COLORS.outline);

  container.addChild(g);
}

function drawCounter(container: Container, x: number, y: number, width: number): void {
  const g = new Graphics();

  // Counter surface
  drawOutlinedRect(g, x, y, width, 60, COLORS.counter);

  // Wood grain lines
  for (let i = 1; i <= 4; i++) {
    g.rect(x + 8, y + i * 12, width - 16, 1).fill({ color: 0xb0a48c, alpha: 0.3 });
  }

  // Front edge shadow
  g.rect(x, y + 56, width, 4).fill({ color: COLORS.shadow, alpha: 0.15 });

  container.addChild(g);
}

function addBadge(container: Container, x: number, y: number, count: number): void {
  const bg = new Graphics();
  const bw = 20;
  const bh = 18;

  bg.roundRect(x, y, bw, bh, 9).fill(0xff9aa2);
  bg.roundRect(x, y, bw, bh, 9).stroke({ width: 1, color: 0xffffff, alpha: 0.8 });

  // Use anchor for reliable centering (avoids pre-render .width = 0)
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

  // Background — wall
  const bg = new Graphics();
  bg.rect(0, 0, 800, 520).fill(COLORS.wall);
  roomContainer.addChild(bg);

  // Floor
  const floor = new Graphics();
  floor.rect(0, 200, 800, 320).fill(COLORS.floor);
  roomContainer.addChild(floor);

  // Back wall tile line
  const wallLine = new Graphics();
  wallLine.rect(0, 196, 800, 4).fill({ color: COLORS.shadow, alpha: 0.1 });
  roomContainer.addChild(wallLine);

  // Shadows under appliances
  const shadows = new Graphics();
  shadows.ellipse(100, 195, 60, 8).fill({ color: COLORS.shadow, alpha: 0.08 });
  shadows.ellipse(400, 195, 110, 8).fill({ color: COLORS.shadow, alpha: 0.08 });
  shadows.ellipse(700, 195, 55, 8).fill({ color: COLORS.shadow, alpha: 0.08 });
  roomContainer.addChild(shadows);

  const zones: ApplianceZone[] = [];

  // Fridge — left side
  const fridgeC = new Container();
  const fridgeX = 50;
  const fridgeY = 50;
  drawFridge(fridgeC, fridgeX, fridgeY);
  addBadge(fridgeC, fridgeX + 70, fridgeY - 4, itemCounts.fridge);
  roomContainer.addChild(fridgeC);
  zones.push({
    location: 'fridge',
    container: fridgeC,
    x: fridgeX,
    y: fridgeY,
    width: 100,
    height: 140,
  });

  // Pantry shelf — center
  const pantryC = new Container();
  const pantryX = 300;
  const pantryY = 70;
  drawPantryShelf(pantryC, pantryX, pantryY);
  addBadge(pantryC, pantryX + 168, pantryY - 4, itemCounts.pantry);
  roomContainer.addChild(pantryC);
  zones.push({
    location: 'pantry',
    container: pantryC,
    x: pantryX,
    y: pantryY,
    width: 200,
    height: 120,
  });

  // Freezer — right side
  const freezerC = new Container();
  const freezerX = 660;
  const freezerY = 60;
  drawFreezer(freezerC, freezerX, freezerY);
  addBadge(freezerC, freezerX + 58, freezerY - 4, itemCounts.freezer);
  roomContainer.addChild(freezerC);
  zones.push({
    location: 'freezer',
    container: freezerC,
    x: freezerX,
    y: freezerY,
    width: 90,
    height: 130,
  });

  // Counter — bottom
  const counterC = new Container();
  const counterX = 50;
  const counterY = 420;
  const counterW = 700;
  drawCounter(counterC, counterX, counterY, counterW);
  addBadge(counterC, counterX + counterW - 30, counterY - 4, itemCounts.counter);
  roomContainer.addChild(counterC);
  zones.push({
    location: 'counter',
    container: counterC,
    x: counterX,
    y: counterY,
    width: counterW,
    height: 60,
  });

  return { zones, canvasWidth: cw, canvasHeight: ch };
}
