import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { PantryItem, Location } from '../../types';
import { COLORS } from './drawAppliances';
import { drawItemSprite, getExpiryColor } from './drawItems';

// Interior color palettes
const FRIDGE_INT = {
  back: 0xe8f4fa,
  backLight: 0xf0f8fd,
  shelf: 0xd5eef5,
  shelfEdge: 0xc0dde8,
  shelfHighlight: 0xeaf5fa,
  light: 0xfffff0,
  lightGlow: 0xfff8d0,
  doorShelf: 0xd0e8f0,
  doorShelfEdge: 0xb8d5e0,
  seal: 0xc8dce5,
  tempDisplay: 0x2a4050,
  tempText: 0x60d8c0,
} as const;

const PANTRY_INT = {
  back: 0xfff5e8,
  backWarm: 0xfff0d8,
  shelf: 0xd4996a,
  shelfTop: 0xdca878,
  shelfFront: 0xc88850,
  shelfShadow: 0xb87840,
  sideFrame: 0xb87a4a,
  sideLight: 0xd4996a,
  divider: 0xe0c8a8,
} as const;

const FREEZER_INT = {
  back: 0xd8e8f5,
  backCold: 0xc5d8ea,
  drawer: 0xd5dfe8,
  drawerFront: 0xc0ccd8,
  drawerHandle: 0xb0bcc8,
  frost: 0xeaf0f5,
  frostHeavy: 0xf5f8fb,
  ice: 0xd0e0f0,
  fog: 0xe0eaf2,
  led: 0x50d8c0,
} as const;

const COUNTER_INT = {
  surface: 0xe8dcc8,
  surfaceLight: 0xf0e4d0,
  grain: 0xd8ccb4,
  cuttingBoard: 0xe0c88c,
  cuttingBoardLight: 0xecd89c,
  cuttingBoardEdge: 0xd0b87c,
  shadow: 0xd0c4a8,
} as const;

const ITEM_LABEL_STYLE = new TextStyle({
  fontFamily: 'Nunito, sans-serif',
  fontSize: 9,
  fill: 0x4a4a4a,
  wordWrap: true,
  wordWrapWidth: 55,
  align: 'center',
});

const QTY_STYLE = new TextStyle({
  fontFamily: 'Nunito, sans-serif',
  fontSize: 8,
  fill: 0x888888,
});

const EMPTY_HINT_STYLE = new TextStyle({
  fontFamily: 'Nunito, sans-serif',
  fontSize: 13,
  fill: 0x999999,
  fontStyle: 'italic',
  align: 'center',
});

interface InteriorOptions {
  items: PantryItem[];
  onItemClick: (item: PantryItem) => void;
}

/** Place interactive item sprites in a container at given positions */
function placeItems(
  parent: Container,
  items: PantryItem[],
  positions: { x: number; y: number }[],
  onItemClick: (item: PantryItem) => void,
): void {
  const maxItems = positions.length;
  const visibleItems = items.slice(0, maxItems);

  visibleItems.forEach((item, idx) => {
    const pos = positions[idx];
    const ic = new Container();

    // Sprite
    const spriteG = new Graphics();
    drawItemSprite(spriteG, item.category, pos.x, pos.y);
    ic.addChild(spriteG);

    // Expiry dot
    const dotG = new Graphics();
    const dotColor = getExpiryColor(item.days_until_expiry);
    dotG.circle(pos.x + 18, pos.y + 2, 3).fill(dotColor);
    ic.addChild(dotG);

    // Name label
    const name = item.name.length > 10 ? item.name.slice(0, 9) + '\u2026' : item.name;
    const label = new Text({ text: name, style: ITEM_LABEL_STYLE });
    label.anchor.set(0.5, 0);
    label.x = pos.x + 8;
    label.y = pos.y + 18;
    ic.addChild(label);

    // Quantity
    if (item.quantity > 1) {
      const qty = new Text({ text: `\u00d7${item.quantity}`, style: QTY_STYLE });
      qty.anchor.set(0.5, 0);
      qty.x = pos.x + 8;
      qty.y = pos.y + 28;
      ic.addChild(qty);
    }

    // Hit area
    const hit = new Graphics();
    hit.rect(pos.x - 8, pos.y - 4, 36, 42).fill({ color: 0xffffff, alpha: 0.01 });
    ic.addChild(hit);

    ic.eventMode = 'static';
    ic.cursor = 'pointer';
    ic.on('pointerover', () => { ic.alpha = 0.75; });
    ic.on('pointerout', () => { ic.alpha = 1; });
    ic.on('pointerdown', () => { onItemClick(item); });

    parent.addChild(ic);
  });
}

function drawEmptyHint(parent: Container, location: Location): void {
  const hints: Record<Location, string> = {
    fridge: 'Your fridge is empty!\nAdd items to see them here',
    freezer: 'Nothing in the freezer\nAdd frozen items to stock up',
    pantry: 'Pantry shelves are bare!\nScan a receipt to fill them',
    counter: 'Counter is clear\nItems on the counter show here',
  };
  const text = new Text({ text: hints[location], style: EMPTY_HINT_STYLE });
  text.anchor.set(0.5, 0.5);
  text.x = 400;
  text.y = 260;
  parent.addChild(text);
}

/** Fridge interior: shelves with light glow, door shelves, items on glass shelves */
export function drawFridgeInterior(
  container: Container,
  { items, onItemClick }: InteriorOptions,
): void {
  container.removeChildren();
  const g = new Graphics();

  // Back wall of fridge (cool blue gradient)
  g.rect(0, 0, 800, 520).fill(FRIDGE_INT.back);
  // Lighter at top (fridge light)
  g.rect(0, 0, 800, 80).fill({ color: FRIDGE_INT.backLight, alpha: 0.6 });

  // Fridge light at top center
  g.rect(340, 8, 120, 6).fill(FRIDGE_INT.light);
  // Light glow
  g.rect(300, 0, 200, 30).fill({ color: FRIDGE_INT.lightGlow, alpha: 0.15 });
  g.rect(320, 0, 160, 20).fill({ color: FRIDGE_INT.lightGlow, alpha: 0.1 });

  // Rubber seal border (frame around the view)
  g.rect(0, 0, 800, 520).stroke({ width: 6, color: FRIDGE_INT.seal });
  g.rect(3, 3, 794, 514).stroke({ width: 1, color: 0xb8d0db, alpha: 0.5 });

  // Glass shelves (4 shelves)
  const shelfPositions = [100, 200, 310, 420];
  for (const sy of shelfPositions) {
    // Shelf surface (glass effect — semi transparent)
    g.rect(20, sy, 560, 5).fill({ color: FRIDGE_INT.shelf, alpha: 0.8 });
    // Shelf front edge
    g.rect(20, sy + 5, 560, 3).fill({ color: FRIDGE_INT.shelfEdge, alpha: 0.7 });
    // Highlight on top
    g.rect(20, sy, 560, 1).fill({ color: FRIDGE_INT.shelfHighlight, alpha: 0.6 });
    // Shadow below shelf
    g.rect(22, sy + 8, 556, 4).fill({ color: COLORS.shadow, alpha: 0.04 });

    // Shelf supports (small brackets on sides)
    g.rect(20, sy - 4, 4, 8).fill({ color: 0xc0c8d0, alpha: 0.5 });
    g.rect(576, sy - 4, 4, 8).fill({ color: 0xc0c8d0, alpha: 0.5 });
  }

  // Door shelves on right side (condiment area)
  const doorX = 610;
  const doorW = 170;
  // Door shelf background
  g.rect(doorX, 20, doorW, 480).fill({ color: FRIDGE_INT.doorShelf, alpha: 0.4 });
  // Vertical divider line
  g.rect(doorX - 2, 20, 3, 480).fill({ color: FRIDGE_INT.doorShelfEdge, alpha: 0.5 });

  // Door shelf lips
  const doorShelfYs = [120, 230, 350, 450];
  for (const dsy of doorShelfYs) {
    g.rect(doorX + 4, dsy, doorW - 8, 4).fill({ color: FRIDGE_INT.doorShelfEdge, alpha: 0.7 });
    g.rect(doorX + 4, dsy, doorW - 8, 1).fill({ color: COLORS.white, alpha: 0.3 });
  }

  // Temperature display (bottom-right corner)
  g.rect(710, 480, 60, 22).fill(FRIDGE_INT.tempDisplay);
  g.rect(715, 484, 12, 14).fill({ color: FRIDGE_INT.tempText, alpha: 0.8 });
  g.rect(730, 484, 12, 14).fill({ color: FRIDGE_INT.tempText, alpha: 0.8 });
  g.rect(745, 484, 4, 4).fill({ color: FRIDGE_INT.tempText, alpha: 0.6 });
  g.rect(752, 486, 8, 8).fill({ color: FRIDGE_INT.tempText, alpha: 0.5 });

  // Condensation drops (subtle)
  const drops = [
    { dx: 50, dy: 60 }, { dx: 150, dy: 45 }, { dx: 320, dy: 55 },
    { dx: 480, dy: 50 }, { dx: 100, dy: 180 }, { dx: 400, dy: 280 },
  ];
  for (const d of drops) {
    g.circle(d.dx, d.dy, 1.5).fill({ color: COLORS.white, alpha: 0.25 });
  }

  container.addChild(g);

  if (items.length === 0) {
    drawEmptyHint(container, 'fridge');
    return;
  }

  // Place items on shelves — distribute across the 4 shelves
  // Items sit ABOVE each shelf (shelf is the baseline)
  const positions: { x: number; y: number }[] = [];
  const itemsPerShelf = Math.ceil(items.length / 4);

  for (let shelf = 0; shelf < 4; shelf++) {
    const baseY = shelfPositions[shelf] - 36; // items sit above shelf
    const startX = 40;
    const spacing = 65;
    const count = Math.min(itemsPerShelf, 8); // max 8 per shelf
    for (let i = 0; i < count; i++) {
      if (positions.length >= items.length) break;
      positions.push({ x: startX + i * spacing, y: baseY });
    }
  }

  // Also place some on door shelves
  const doorPositions: { x: number; y: number }[] = [];
  for (let ds = 0; ds < doorShelfYs.length; ds++) {
    const baseY = doorShelfYs[ds] - 34;
    doorPositions.push({ x: doorX + 20, y: baseY });
    doorPositions.push({ x: doorX + 85, y: baseY });
  }

  // Split items: condiments/beverages go to door, rest to main shelves
  const doorItems = items.filter(
    (i) => i.category === 'condiments' || i.category === 'beverages',
  );
  const mainItems = items.filter(
    (i) => i.category !== 'condiments' && i.category !== 'beverages',
  );

  placeItems(container, mainItems, positions, onItemClick);
  placeItems(container, doorItems, doorPositions, onItemClick);
}

/** Pantry interior: warm wooden shelves with items arranged naturally */
export function drawPantryInterior(
  container: Container,
  { items, onItemClick }: InteriorOptions,
): void {
  container.removeChildren();
  const g = new Graphics();

  // Warm back wall
  g.rect(0, 0, 800, 520).fill(PANTRY_INT.back);
  // Warmer gradient at bottom
  g.rect(0, 300, 800, 220).fill({ color: PANTRY_INT.backWarm, alpha: 0.5 });

  // Side frames
  g.rect(0, 0, 20, 520).fill(PANTRY_INT.sideFrame);
  g.rect(0, 0, 6, 520).fill(PANTRY_INT.sideLight);
  g.rect(780, 0, 20, 520).fill(PANTRY_INT.sideFrame);
  g.rect(794, 0, 6, 520).fill(PANTRY_INT.sideLight);

  // Top cap
  g.rect(0, 0, 800, 16).fill(PANTRY_INT.sideFrame);
  g.rect(0, 0, 800, 4).fill(PANTRY_INT.sideLight);

  // Wooden shelves (5 shelves)
  const shelfPositions = [80, 170, 270, 370, 460];
  for (const sy of shelfPositions) {
    // Shelf top surface
    g.rect(20, sy, 760, 8).fill(PANTRY_INT.shelfTop);
    // Front face
    g.rect(20, sy + 8, 760, 6).fill(PANTRY_INT.shelfFront);
    // Bottom shadow
    g.rect(24, sy + 14, 752, 4).fill({ color: PANTRY_INT.shelfShadow, alpha: 0.2 });
    // Top highlight
    g.rect(20, sy, 760, 2).fill({ color: COLORS.white, alpha: 0.15 });
    // Wood grain lines on shelf
    for (let gx = 40; gx < 760; gx += 80) {
      g.rect(gx, sy + 2, 40, 1).fill({ color: PANTRY_INT.shelf, alpha: 0.3 });
    }

    // Support brackets
    g.rect(20, sy - 8, 6, 12).fill(PANTRY_INT.sideFrame);
    g.rect(774, sy - 8, 6, 12).fill(PANTRY_INT.sideFrame);
  }

  // Decorative: section dividers (vertical lines on back wall)
  for (let dx = 200; dx < 800; dx += 200) {
    g.rect(dx, 16, 1, 504).fill({ color: PANTRY_INT.divider, alpha: 0.3 });
  }

  container.addChild(g);

  if (items.length === 0) {
    drawEmptyHint(container, 'pantry');
    return;
  }

  // Distribute items across shelves
  const positions: { x: number; y: number }[] = [];
  const itemsPerShelf = Math.ceil(items.length / 5);

  for (let shelf = 0; shelf < 5; shelf++) {
    const baseY = shelfPositions[shelf] - 34;
    const startX = 40;
    const spacing = 70;
    const count = Math.min(itemsPerShelf, 10);
    for (let i = 0; i < count; i++) {
      if (positions.length >= items.length) break;
      positions.push({ x: startX + i * spacing, y: baseY });
    }
  }

  placeItems(container, items, positions, onItemClick);
}

/** Freezer interior: icy drawers with frost overlay and fog */
export function drawFreezerInterior(
  container: Container,
  { items, onItemClick }: InteriorOptions,
): void {
  container.removeChildren();
  const g = new Graphics();

  // Icy blue back wall
  g.rect(0, 0, 800, 520).fill(FREEZER_INT.back);
  // Colder at bottom
  g.rect(0, 300, 800, 220).fill({ color: FREEZER_INT.backCold, alpha: 0.5 });

  // Frame (frost-covered seal)
  g.rect(0, 0, 800, 520).stroke({ width: 6, color: FREEZER_INT.frost });
  g.rect(3, 3, 794, 514).stroke({ width: 1, color: FREEZER_INT.ice, alpha: 0.5 });

  // Ice crystal decorations on edges
  const crystals = [
    { cx: 15, cy: 30 }, { cx: 780, cy: 50 }, { cx: 20, cy: 200 },
    { cx: 775, cy: 180 }, { cx: 10, cy: 400 }, { cx: 785, cy: 420 },
    { cx: 100, cy: 12 }, { cx: 500, cy: 8 }, { cx: 700, cy: 15 },
  ];
  for (const c of crystals) {
    // Small cross crystal
    g.rect(c.cx, c.cy, 6, 2).fill({ color: COLORS.white, alpha: 0.4 });
    g.rect(c.cx + 2, c.cy - 2, 2, 6).fill({ color: COLORS.white, alpha: 0.4 });
    g.rect(c.cx - 1, c.cy - 1, 2, 2).fill({ color: COLORS.white, alpha: 0.2 });
    g.rect(c.cx + 5, c.cy + 1, 2, 2).fill({ color: COLORS.white, alpha: 0.2 });
  }

  // Drawers/compartments (3 large drawers + top shelf)
  // Top open shelf area
  const shelfY = 90;
  g.rect(30, shelfY, 740, 5).fill({ color: FREEZER_INT.drawer, alpha: 0.7 });
  g.rect(30, shelfY + 5, 740, 2).fill({ color: FREEZER_INT.drawerFront, alpha: 0.5 });

  // 3 pull-out drawers
  const drawerYs = [190, 310, 430];
  const drawerH = 90;
  for (const dy of drawerYs) {
    // Drawer body
    g.rect(30, dy, 740, drawerH).fill({ color: FREEZER_INT.drawer, alpha: 0.6 });
    // Front face
    g.rect(30, dy + drawerH - 10, 740, 10).fill(FREEZER_INT.drawerFront);
    // Handle (horizontal bar)
    g.rect(340, dy + drawerH - 7, 120, 4).fill(FREEZER_INT.drawerHandle);
    g.rect(340, dy + drawerH - 7, 120, 1).fill({ color: COLORS.white, alpha: 0.3 });
    // Frost on drawer edges
    g.rect(30, dy, 8, drawerH).fill({ color: FREEZER_INT.frostHeavy, alpha: 0.3 });
    g.rect(762, dy, 8, drawerH).fill({ color: FREEZER_INT.frostHeavy, alpha: 0.3 });
    // Shadow inside drawer
    g.rect(38, dy + 2, 724, 4).fill({ color: COLORS.shadow, alpha: 0.05 });
  }

  // Fog effect at bottom
  for (let i = 0; i < 6; i++) {
    const fogY = 480 - i * 8;
    const alpha = 0.08 - i * 0.012;
    g.rect(0, fogY, 800, 8).fill({ color: FREEZER_INT.fog, alpha: Math.max(0, alpha) });
  }

  // LED indicator
  g.rect(740, 15, 4, 4).fill(FREEZER_INT.led);
  g.rect(739, 14, 6, 6).fill({ color: FREEZER_INT.led, alpha: 0.3 });

  container.addChild(g);

  if (items.length === 0) {
    drawEmptyHint(container, 'freezer');
    return;
  }

  // Place items: some on top shelf, rest in drawers
  const positions: { x: number; y: number }[] = [];

  // Top shelf items
  const topShelfCount = Math.min(Math.ceil(items.length / 4), 8);
  for (let i = 0; i < topShelfCount; i++) {
    positions.push({ x: 50 + i * 75, y: shelfY - 36 });
  }

  // Drawer items (inside the drawers)
  for (const dy of drawerYs) {
    const drawerCount = Math.min(8, 8);
    for (let i = 0; i < drawerCount; i++) {
      if (positions.length >= items.length) break;
      positions.push({ x: 50 + i * 80, y: dy + 10 });
    }
  }

  placeItems(container, items, positions, onItemClick);
}

/** Counter view: surface with cutting board area, items spread naturally */
export function drawCounterView(
  container: Container,
  { items, onItemClick }: InteriorOptions,
): void {
  container.removeChildren();
  const g = new Graphics();

  // Counter surface (slightly angled top-down view)
  g.rect(0, 0, 800, 520).fill(COUNTER_INT.surface);

  // Wood grain pattern across surface
  for (let gy = 20; gy < 520; gy += 16) {
    const grainAlpha = 0.1 + Math.sin(gy * 0.05) * 0.05;
    g.rect(0, gy, 800, 1).fill({ color: COUNTER_INT.grain, alpha: grainAlpha });
  }
  // Perpendicular grain (subtle cross-grain)
  for (let gx = 30; gx < 800; gx += 120) {
    g.rect(gx, 0, 1, 520).fill({ color: COUNTER_INT.grain, alpha: 0.05 });
  }

  // Edge highlight (top of counter)
  g.rect(0, 0, 800, 4).fill(COUNTER_INT.surfaceLight);

  // Cutting board area (top-right)
  const cbx = 560;
  const cby = 30;
  const cbw = 200;
  const cbh = 140;
  g.rect(cbx, cby, cbw, cbh).fill(COUNTER_INT.cuttingBoard);
  g.rect(cbx, cby, cbw, cbh).stroke({ width: 2, color: COUNTER_INT.cuttingBoardEdge });
  // Board grain
  for (let i = 0; i < cbh; i += 12) {
    g.rect(cbx + 4, cby + i, cbw - 8, 1).fill({
      color: COUNTER_INT.cuttingBoardEdge,
      alpha: 0.3,
    });
  }
  // Board highlight
  g.rect(cbx + 2, cby + 2, cbw - 4, 2).fill({
    color: COUNTER_INT.cuttingBoardLight,
    alpha: 0.5,
  });

  // Shadow areas (subtle depth cues)
  g.rect(0, 510, 800, 10).fill({ color: COUNTER_INT.shadow, alpha: 0.15 });

  // Decorative: knife (on cutting board)
  g.rect(cbx + 30, cby + 50, 80, 2).fill(0xc0c0c0); // blade
  g.rect(cbx + 30, cby + 49, 80, 1).fill({ color: COLORS.white, alpha: 0.4 }); // blade highlight
  g.rect(cbx + 110, cby + 46, 30, 8).fill(0x8b6f47); // handle
  g.rect(cbx + 110, cby + 46, 30, 2).fill(0xa0845c); // handle highlight

  container.addChild(g);

  if (items.length === 0) {
    drawEmptyHint(container, 'counter');
    return;
  }

  // Spread items across the counter surface
  const positions: { x: number; y: number }[] = [];
  const cols = 8;
  const startX = 40;
  const startY = 60;
  const spacingX = 65;
  const spacingY = 80;

  for (let i = 0; i < Math.min(items.length, 32); i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Slight random offset for natural feel (deterministic based on index)
    const ox = (i * 7) % 11 - 5;
    const oy = (i * 13) % 9 - 4;
    positions.push({
      x: startX + col * spacingX + ox,
      y: startY + row * spacingY + oy,
    });
  }

  placeItems(container, items, positions, onItemClick);
}

/** Get the interior renderer for a given location */
export function getInteriorRenderer(
  location: Location,
): (container: Container, options: InteriorOptions) => void {
  const renderers: Record<Location, (c: Container, o: InteriorOptions) => void> = {
    fridge: drawFridgeInterior,
    freezer: drawFreezerInterior,
    pantry: drawPantryInterior,
    counter: drawCounterView,
  };
  return renderers[location];
}
