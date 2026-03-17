import { Container, Graphics } from 'pixi.js';
import { COLORS } from './drawAppliances';

// Extended palette for environment details
const ENV = {
  // Wall
  wallBase: 0xfff9f5,
  wallPattern: 0xfff0e8,
  wainscot: 0xfff0ea,
  wainscotTrim: 0xebd8c8,
  molding: 0xf5e6d8,
  moldingHighlight: 0xfffaf5,
  moldingShadow: 0xe8d0be,

  // Floor
  tileLight: 0xf5edd9,
  tileDark: 0xecdcc3,
  grout: 0xe0d0b8,

  // Window
  sky: 0xc5e8f5,
  skyBottom: 0xd8f0ff,
  cloud: 0xffffff,
  curtainMain: 0xffb5c5,
  curtainFold: 0xf5a0b5,
  curtainHighlight: 0xffc8d5,
  windowFrame: 0xf0dcc8,
  windowFrameLight: 0xfaf0e5,
  sill: 0xe8d5c0,
  sillHighlight: 0xf5e8d8,
  glass: 0xd5eef8,
  glassTint: 0xe0f2ff,
  mullion: 0xe5d0b8,

  // Baseboard
  baseboardTop: 0xf0dcc8,
  baseboardFace: 0xe5cdb5,

  // Backsplash
  backsplashTile: 0xf0e8e0,
  backsplashGrout: 0xe5d8c8,
  backsplashAccent: 0xffd8e0,

  // Ambient
  shadowBase: 0x4a4a4a,

  // Plant
  pot: 0xd4a373,
  potRim: 0xc09060,
  soil: 0x8b6f47,
  leafDark: 0x5a9e5a,
  leafLight: 0x7ec87e,
  leafHighlight: 0xa0dca0,
  stem: 0x4a8a4a,
} as const;

/** Draw subtle wallpaper pattern on the wall area */
export function drawWallpaper(container: Container, width: number, wallHeight: number): void {
  const g = new Graphics();

  // Base wall color
  g.rect(0, 0, width, wallHeight).fill(ENV.wallBase);

  // Subtle diamond/dot pattern
  const spacing = 24;
  for (let y = 8; y < wallHeight - 20; y += spacing) {
    for (let x = 8; x < width; x += spacing) {
      // Offset every other row
      const ox = y % (spacing * 2) === 8 ? spacing / 2 : 0;
      const px = x + ox;
      if (px < width) {
        // Tiny diamond motif (4px)
        g.rect(px, y, 2, 2).fill({ color: ENV.wallPattern, alpha: 0.6 });
        g.rect(px - 1, y + 1, 1, 1).fill({ color: ENV.wallPattern, alpha: 0.3 });
        g.rect(px + 2, y + 1, 1, 1).fill({ color: ENV.wallPattern, alpha: 0.3 });
      }
    }
  }

  // Wainscoting — lower half of wall
  const wainscotY = wallHeight * 0.55;
  const wainscotH = wallHeight - wainscotY;
  g.rect(0, wainscotY, width, wainscotH).fill(ENV.wainscot);

  // Wainscot trim line (chair rail)
  g.rect(0, wainscotY, width, 3).fill(ENV.wainscotTrim);
  g.rect(0, wainscotY, width, 1).fill(ENV.moldingHighlight);

  // Vertical panel lines in wainscoting
  const panelSpacing = 80;
  for (let x = panelSpacing; x < width; x += panelSpacing) {
    g.rect(x, wainscotY + 6, 1, wainscotH - 10).fill({ color: ENV.wainscotTrim, alpha: 0.5 });
  }

  container.addChild(g);
}

/** Draw checkerboard floor tiles */
export function drawFloorTiles(
  container: Container,
  floorY: number,
  width: number,
  height: number,
): void {
  const g = new Graphics();

  const tileSize = 32;
  const rows = Math.ceil(height / tileSize);
  const cols = Math.ceil(width / tileSize);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isLight = (row + col) % 2 === 0;
      const color = isLight ? ENV.tileLight : ENV.tileDark;
      const tx = col * tileSize;
      const ty = floorY + row * tileSize;

      g.rect(tx, ty, tileSize, tileSize).fill(color);

      // Grout lines
      g.rect(tx, ty, tileSize, 1).fill({ color: ENV.grout, alpha: 0.3 });
      g.rect(tx, ty, 1, tileSize).fill({ color: ENV.grout, alpha: 0.3 });
    }
  }

  // Subtle perspective: darken tiles further from "camera" (top rows)
  g.rect(0, floorY, width, 16).fill({ color: ENV.shadowBase, alpha: 0.04 });

  container.addChild(g);
}

/** Draw window with curtains on the wall */
export function drawWindow(
  container: Container,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const g = new Graphics();

  // Window frame (outer)
  g.rect(x - 4, y - 4, w + 8, h + 8).fill(ENV.windowFrame);
  g.rect(x - 4, y - 4, w + 8, 2).fill(ENV.windowFrameLight);

  // Glass area
  g.rect(x, y, w, h).fill(ENV.glass);

  // Sky gradient (top = deeper blue, bottom = lighter)
  g.rect(x, y, w, h / 2).fill({ color: ENV.sky, alpha: 0.6 });
  g.rect(x, y + h / 2, w, h / 2).fill({ color: ENV.skyBottom, alpha: 0.4 });

  // Clouds (simple pixel blobs)
  const cx = x + w * 0.3;
  const cy = y + h * 0.3;
  g.rect(cx, cy, 12, 4).fill({ color: ENV.cloud, alpha: 0.7 });
  g.rect(cx + 2, cy - 2, 8, 3).fill({ color: ENV.cloud, alpha: 0.5 });
  g.rect(cx + 20, cy + 6, 10, 3).fill({ color: ENV.cloud, alpha: 0.5 });

  // Mullion (cross divider)
  g.rect(x + w / 2 - 1, y, 3, h).fill(ENV.mullion);
  g.rect(x, y + h / 2 - 1, w, 3).fill(ENV.mullion);

  // Glass reflection (diagonal highlight)
  g.rect(x + 4, y + 4, 8, 2).fill({ color: 0xffffff, alpha: 0.4 });
  g.rect(x + 6, y + 6, 4, 1).fill({ color: 0xffffff, alpha: 0.3 });

  // Window sill
  g.rect(x - 6, y + h + 4, w + 12, 6).fill(ENV.sill);
  g.rect(x - 6, y + h + 4, w + 12, 2).fill(ENV.sillHighlight);

  // Curtains (left)
  const curtainW = 16;
  for (let i = 0; i < h + 8; i += 2) {
    const indent = Math.sin(i * 0.15) * 3;
    const cw = curtainW + indent;
    g.rect(x - 4 - curtainW + (curtainW - cw), y - 4 + i, cw, 2).fill(
      i % 8 < 4 ? ENV.curtainMain : ENV.curtainFold,
    );
  }
  // Curtain highlight (left edge)
  for (let i = 0; i < h + 8; i += 4) {
    g.rect(x - 4, y - 4 + i, 1, 2).fill({ color: ENV.curtainHighlight, alpha: 0.6 });
  }

  // Curtains (right)
  for (let i = 0; i < h + 8; i += 2) {
    const indent = Math.sin(i * 0.15 + 1) * 3;
    const cw = curtainW + indent;
    g.rect(x + w + 4, y - 4 + i, cw, 2).fill(
      i % 8 < 4 ? ENV.curtainMain : ENV.curtainFold,
    );
  }
  for (let i = 0; i < h + 8; i += 4) {
    g.rect(x + w + 3, y - 4 + i, 1, 2).fill({ color: ENV.curtainHighlight, alpha: 0.6 });
  }

  // Curtain rod
  g.rect(x - curtainW - 6, y - 8, w + curtainW * 2 + 12, 3).fill(ENV.mullion);
  // Rod finials
  g.circle(x - curtainW - 5, y - 6, 3).fill(ENV.mullion);
  g.circle(x + w + curtainW + 5, y - 6, 3).fill(ENV.mullion);

  container.addChild(g);
}

/** Draw crown molding at ceiling */
export function drawMolding(container: Container, width: number): void {
  const g = new Graphics();

  // Three-layer molding effect
  g.rect(0, 0, width, 6).fill(ENV.molding);
  g.rect(0, 0, width, 2).fill(ENV.moldingHighlight);
  g.rect(0, 6, width, 1).fill(ENV.moldingShadow);

  container.addChild(g);
}

/** Draw baseboard at wall-floor junction */
export function drawBaseboard(container: Container, y: number, width: number): void {
  const g = new Graphics();

  // Baseboard with highlight on top edge
  g.rect(0, y, width, 6).fill(ENV.baseboardFace);
  g.rect(0, y, width, 2).fill(ENV.baseboardTop);
  g.rect(0, y + 6, width, 1).fill({ color: ENV.shadowBase, alpha: 0.08 });

  container.addChild(g);
}

/** Draw backsplash tile pattern behind counter area */
export function drawBacksplash(
  container: Container,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const g = new Graphics();

  const tileW = 16;
  const tileH = 12;
  const rows = Math.ceil(height / tileH);
  const cols = Math.ceil(width / tileW);

  for (let row = 0; row < rows; row++) {
    // Offset every other row (brick pattern)
    const ox = row % 2 === 0 ? 0 : tileW / 2;
    for (let col = -1; col < cols + 1; col++) {
      const tx = x + col * tileW + ox;
      const ty = y + row * tileH;

      if (tx >= x && tx + tileW <= x + width) {
        // Tile
        g.rect(tx, ty, tileW, tileH).fill(ENV.backsplashTile);

        // Grout edges
        g.rect(tx, ty, tileW, 1).fill({ color: ENV.backsplashGrout, alpha: 0.5 });
        g.rect(tx, ty, 1, tileH).fill({ color: ENV.backsplashGrout, alpha: 0.5 });

        // Occasional accent tile
        if ((row + col) % 7 === 0) {
          g.rect(tx + 2, ty + 2, tileW - 4, tileH - 4).fill({
            color: ENV.backsplashAccent,
            alpha: 0.4,
          });
        }
      }
    }
  }

  container.addChild(g);
}

/** Draw a small potted plant decoration */
export function drawPottedPlant(container: Container, x: number, y: number): void {
  const g = new Graphics();

  // Pot
  g.rect(x + 2, y + 16, 16, 12).fill(ENV.pot);
  g.rect(x, y + 14, 20, 4).fill(ENV.potRim);
  // Pot shadow
  g.rect(x + 4, y + 26, 12, 2).fill({ color: ENV.shadowBase, alpha: 0.1 });

  // Soil
  g.rect(x + 3, y + 14, 14, 3).fill(ENV.soil);

  // Stems and leaves
  // Center stem
  g.rect(x + 9, y + 2, 2, 14).fill(ENV.stem);
  // Left stem
  g.rect(x + 5, y + 6, 2, 10).fill(ENV.stem);
  // Right stem
  g.rect(x + 13, y + 4, 2, 12).fill(ENV.stem);

  // Leaves (pixel clusters)
  // Top cluster
  g.rect(x + 7, y, 6, 4).fill(ENV.leafLight);
  g.rect(x + 8, y - 2, 4, 3).fill(ENV.leafDark);
  g.rect(x + 9, y, 2, 1).fill(ENV.leafHighlight);

  // Left cluster
  g.rect(x + 2, y + 4, 5, 4).fill(ENV.leafLight);
  g.rect(x + 1, y + 3, 4, 3).fill(ENV.leafDark);

  // Right cluster
  g.rect(x + 13, y + 2, 5, 4).fill(ENV.leafLight);
  g.rect(x + 14, y + 1, 4, 3).fill(ENV.leafDark);
  g.rect(x + 15, y + 2, 2, 1).fill(ENV.leafHighlight);

  // Extra leaves
  g.rect(x + 4, y + 8, 3, 2).fill(ENV.leafLight);
  g.rect(x + 14, y + 6, 3, 2).fill(ENV.leafLight);

  container.addChild(g);
}

/** Draw a small wall clock */
export function drawWallClock(container: Container, x: number, y: number): void {
  const g = new Graphics();

  // Clock body (circle approximation with rects)
  const r = 10;
  // Outer ring
  g.circle(x + r, y + r, r).fill(0xffffff);
  g.circle(x + r, y + r, r).stroke({ width: 2, color: 0xd4a373 });

  // Clock face dots (12, 3, 6, 9 positions)
  g.circle(x + r, y + 3, 1).fill(COLORS.shadow); // 12
  g.circle(x + r + 7, y + r, 1).fill(COLORS.shadow); // 3
  g.circle(x + r, y + r + 7, 1).fill(COLORS.shadow); // 6
  g.circle(x + r - 7, y + r, 1).fill(COLORS.shadow); // 9

  // Hour hand (pointing ~10)
  g.rect(x + r - 4, y + r - 1, 5, 2).fill(COLORS.shadow);

  // Minute hand (pointing ~2)
  g.rect(x + r, y + r - 6, 2, 7).fill(COLORS.shadow);

  // Center dot
  g.circle(x + r, y + r, 1.5).fill(0xff9aa2);

  container.addChild(g);
}

/** Draw ambient lighting gradient (warm light from window area) */
export function drawAmbientLight(
  container: Container,
  windowX: number,
  width: number,
  height: number,
): void {
  const g = new Graphics();

  // Warm light cone from window direction
  // Light fades from window side across the room
  const lightW = 200;
  for (let i = 0; i < lightW; i += 4) {
    const alpha = 0.03 * (1 - i / lightW);
    g.rect(windowX + i - 40, 0, 4, height).fill({ color: 0xfffae0, alpha });
  }

  container.addChild(g);
}
