import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { useEffect, useRef, useCallback } from 'react';
import type { PantryItem, Location } from '../types';
import { drawKitchenRoom, COLORS } from './pixel/drawAppliances';
import type { ApplianceZone } from './pixel/drawAppliances';
import { drawItemSprite, getExpiryColor } from './pixel/drawItems';

interface KitchenSceneProps {
  items: PantryItem[];
  onItemClick: (item: PantryItem) => void;
}

const TWEEN_DURATION = 300; // ms
const ZOOM_SCALE = 2.5;

const LABEL_STYLE = new TextStyle({
  fontFamily: 'Nunito, sans-serif',
  fontSize: 10,
  fill: 0x4a4a4a,
  wordWrap: true,
  wordWrapWidth: 60,
  align: 'center',
});

const ZONE_TITLE_STYLE = new TextStyle({
  fontFamily: 'Nunito, sans-serif',
  fontSize: 16,
  fontWeight: 'bold',
  fill: 0x4a4a4a,
});

const EMPTY_STYLE = new TextStyle({
  fontFamily: 'Nunito, sans-serif',
  fontSize: 13,
  fill: 0x999999,
  fontStyle: 'italic',
  align: 'center',
});

const ZONE_LABELS: Record<Location, string> = {
  fridge: 'Fridge',
  freezer: 'Freezer',
  pantry: 'Pantry Shelf',
  counter: 'Counter',
};

const ZONE_EMOJIS: Record<Location, string> = {
  fridge: '🧊',
  freezer: '❄️',
  pantry: '🏠',
  counter: '🍎',
};

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export default function KitchenScene({ items, onItemClick }: KitchenSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const stateRef = useRef<{
    zoomedZone: Location | null;
    tweening: boolean;
    roomContainer: Container | null;
    zoneContainer: Container | null;
    counterSprites: Container | null;
    zones: ApplianceZone[];
    isMobile: boolean;
  }>({
    zoomedZone: null,
    tweening: false,
    roomContainer: null,
    zoneContainer: null,
    counterSprites: null,
    zones: [],
    isMobile: false,
  });

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const onItemClickRef = useRef(onItemClick);
  onItemClickRef.current = onItemClick;

  const zoomOutRef = useRef<(app: Application) => void>();

  const buildZoneView = useCallback(
    (app: Application, zone: ApplianceZone, zoneContainer: Container) => {
      zoneContainer.removeChildren();

      const zoneItems = itemsRef.current.filter((i) => i.location === zone.location);

      // Background
      const bg = new Graphics();
      bg.rect(0, 0, 800, 520).fill(COLORS.wall);
      zoneContainer.addChild(bg);

      // Back arrow
      const backBtn = new Container();
      const arrow = new Graphics();
      arrow.moveTo(24, 12).lineTo(8, 24).lineTo(24, 36);
      arrow.stroke({ width: 3, color: 0x4a4a4a, alpha: 0.7 });
      backBtn.addChild(arrow);
      const backHit = new Graphics();
      backHit.rect(0, 0, 48, 48).fill({ color: 0xffffff, alpha: 0.01 });
      backBtn.addChild(backHit);
      backBtn.x = 16;
      backBtn.y = 12;
      backBtn.eventMode = 'static';
      backBtn.cursor = 'pointer';
      backBtn.on('pointerdown', () => {
        zoomOutRef.current?.(app);
      });
      zoneContainer.addChild(backBtn);

      // Zone title
      const title = new Text({
        text: `${ZONE_EMOJIS[zone.location]} ${ZONE_LABELS[zone.location]}`,
        style: ZONE_TITLE_STYLE,
      });
      title.x = 72;
      title.y = 20;
      zoneContainer.addChild(title);

      if (zoneItems.length === 0) {
        const emptyText = new Text({
          text: `No items in ${ZONE_LABELS[zone.location].toLowerCase()} yet`,
          style: EMPTY_STYLE,
        });
        emptyText.x = 400 - emptyText.width / 2;
        emptyText.y = 240;
        zoneContainer.addChild(emptyText);
        return;
      }

      // Grid of item sprites
      const cols = Math.min(zoneItems.length, 8);
      const spriteSize = 16;
      const cellW = 80;
      const cellH = 60;
      const gridW = cols * cellW;
      const startX = Math.max(40, (800 - gridW) / 2);
      const startY = 70;

      zoneItems.forEach((item, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cx = startX + col * cellW;
        const cy = startY + row * cellH;

        const itemContainer = new Container();

        // Sprite
        const spriteG = new Graphics();
        drawItemSprite(spriteG, item.category, cx + (cellW - spriteSize) / 2, cy);
        itemContainer.addChild(spriteG);

        // Expiry dot
        const dotG = new Graphics();
        const dotColor = getExpiryColor(item.days_until_expiry);
        dotG.circle(cx + (cellW + spriteSize) / 2 + 4, cy + 2, 3).fill(dotColor);
        itemContainer.addChild(dotG);

        // Name label
        const label = new Text({
          text: item.name.length > 12 ? item.name.slice(0, 11) + '\u2026' : item.name,
          style: LABEL_STYLE,
        });
        label.x = cx + (cellW - label.width) / 2;
        label.y = cy + spriteSize + 4;
        itemContainer.addChild(label);

        // Quantity badge
        if (item.quantity > 1) {
          const qtyText = new Text({
            text: `\u00d7${item.quantity}`,
            style: new TextStyle({
              fontFamily: 'Nunito, sans-serif',
              fontSize: 9,
              fill: 0x888888,
            }),
          });
          qtyText.x = cx + (cellW - qtyText.width) / 2;
          qtyText.y = cy + spriteSize + 16;
          itemContainer.addChild(qtyText);
        }

        // Hit area for clicking
        const hitArea = new Graphics();
        hitArea.rect(cx, cy - 4, cellW, cellH).fill({ color: 0xffffff, alpha: 0.01 });
        itemContainer.addChild(hitArea);

        itemContainer.eventMode = 'static';
        itemContainer.cursor = 'pointer';
        itemContainer.on('pointerover', () => {
          itemContainer.alpha = 0.75;
        });
        itemContainer.on('pointerout', () => {
          itemContainer.alpha = 1;
        });
        itemContainer.on('pointerdown', () => {
          onItemClickRef.current(item);
        });

        zoneContainer.addChild(itemContainer);
      });
    },
    [],
  );

  const zoomIn = useCallback(
    (app: Application, zone: ApplianceZone) => {
      const state = stateRef.current;
      if (state.tweening || state.zoomedZone) return;

      state.tweening = true;
      state.zoomedZone = zone.location;

      // Build zone detail view
      if (state.zoneContainer) {
        buildZoneView(app, zone, state.zoneContainer);
      }

      const room = state.roomContainer!;
      const zoneC = state.zoneContainer!;

      // Calculate pivot to center on the clicked zone
      const pivotX = zone.x + zone.width / 2;
      const pivotY = zone.y + zone.height / 2;

      const startScale = room.scale.x;
      const startPivotX = room.pivot.x;
      const startPivotY = room.pivot.y;
      const startPosX = room.x;
      const startPosY = room.y;

      // Mobile uses 0.6 base scale; zoom relative to that
      const targetScale = ZOOM_SCALE * (state.isMobile ? 0.6 : 1);
      const targetPivotX = pivotX;
      const targetPivotY = pivotY;
      const targetPosX = 400 * (state.isMobile ? 0.6 : 1);
      const targetPosY = 260 * (state.isMobile ? 0.6 : 1);

      const startTime = performance.now();

      const tickerFn = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / TWEEN_DURATION, 1);
        const t = easeOutCubic(progress);

        const s = lerp(startScale, targetScale, t);
        room.scale.set(s);
        room.pivot.x = lerp(startPivotX, targetPivotX, t);
        room.pivot.y = lerp(startPivotY, targetPivotY, t);
        room.x = lerp(startPosX, targetPosX, t);
        room.y = lerp(startPosY, targetPosY, t);
        room.alpha = lerp(1, 0, t);

        if (progress >= 1) {
          app.ticker.remove(tickerFn);
          room.visible = false;
          zoneC.visible = true;
          zoneC.alpha = 1;
          state.tweening = false;
        }
      };

      app.ticker.add(tickerFn);
    },
    [buildZoneView],
  );

  const zoomOut = useCallback((app: Application) => {
    const state = stateRef.current;
    if (state.tweening || !state.zoomedZone) return;

    state.tweening = true;

    const room = state.roomContainer!;
    const zoneC = state.zoneContainer!;

    room.visible = true;
    room.alpha = 0;
    zoneC.visible = true;

    const startScale = room.scale.x;
    const startPivotX = room.pivot.x;
    const startPivotY = room.pivot.y;
    const startPosX = room.x;
    const startPosY = room.y;

    // Zoom back to base scale (0.6 on mobile, 1 on desktop)
    const targetScale = state.isMobile ? 0.6 : 1;

    const startTime = performance.now();

    const tickerFn = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / TWEEN_DURATION, 1);
      const t = easeOutCubic(progress);

      const s = lerp(startScale, targetScale, t);
      room.scale.set(s);
      room.pivot.x = lerp(startPivotX, 0, t);
      room.pivot.y = lerp(startPivotY, 0, t);
      room.x = lerp(startPosX, 0, t);
      room.y = lerp(startPosY, 0, t);
      room.alpha = lerp(0, 1, t);
      zoneC.alpha = lerp(1, 0, t);

      if (progress >= 1) {
        app.ticker.remove(tickerFn);
        zoneC.visible = false;
        room.scale.set(targetScale);
        room.pivot.set(0, 0);
        room.position.set(0, 0);
        room.alpha = 1;
        state.zoomedZone = null;
        state.tweening = false;
      }
    };

    app.ticker.add(tickerFn);
  }, []);

  // Keep zoomOutRef current so buildZoneView's back button always works
  zoomOutRef.current = zoomOut;

  // Init PixiJS app once on mount
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const isMobile = window.innerWidth < 768;
    const scale = isMobile ? 0.6 : 1;
    const cw = Math.round(800 * scale);
    const ch = Math.round(520 * scale);

    const app = new Application();
    let destroyed = false;

    (async () => {
      await app.init({
        width: cw,
        height: ch,
        antialias: false,
        resolution: 2,
        autoDensity: true,
        background: COLORS.wall,
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      appRef.current = app;
      el.appendChild(app.canvas);

      app.canvas.style.width = '100%';
      app.canvas.style.maxWidth = `${cw}px`;
      app.canvas.style.height = 'auto';
      app.canvas.style.imageRendering = 'pixelated';
      app.canvas.style.borderRadius = '16px';

      // Room container
      const roomContainer = new Container();
      app.stage.addChild(roomContainer);

      // Zone detail container (hidden initially)
      const zoneContainer = new Container();
      zoneContainer.visible = false;
      app.stage.addChild(zoneContainer);

      // Container for counter item sprites (rebuilt when items change)
      const counterSprites = new Container();
      roomContainer.addChild(counterSprites);

      const state = stateRef.current;
      state.roomContainer = roomContainer;
      state.zoneContainer = zoneContainer;
      state.counterSprites = counterSprites;
      state.isMobile = isMobile;

      // Count items per zone
      const currentItems = itemsRef.current;
      const counts: Record<Location, number> = {
        fridge: 0,
        freezer: 0,
        pantry: 0,
        counter: 0,
      };
      for (const item of currentItems) {
        counts[item.location]++;
      }

      // Draw the room
      const { zones } = drawKitchenRoom(roomContainer, counts, isMobile);
      state.zones = zones;

      // Make each appliance interactive
      for (const zone of zones) {
        zone.container.eventMode = 'static';
        zone.container.cursor = 'pointer';

        zone.container.on('pointerover', () => {
          zone.container.alpha = 0.85;
        });
        zone.container.on('pointerout', () => {
          zone.container.alpha = 1;
        });

        zone.container.on('pointerdown', () => {
          zoomIn(app, zone);
        });
      }

      // Draw counter items on the counter surface
      const counterZone = zones.find((z) => z.location === 'counter');
      const counterItems = currentItems.filter((i) => i.location === 'counter');
      if (counterZone && counterItems.length > 0) {
        const spacing = 32;
        const startX = counterZone.x + 20;
        const startY = counterZone.y + 8;

        counterItems.slice(0, 15).forEach((item, idx) => {
          const spriteContainer = new Container();
          spriteContainer.x = startX + (idx % 15) * spacing;
          spriteContainer.y = startY + Math.floor(idx / 15) * 24;
          spriteContainer.scale.set(0.8);

          const g = new Graphics();
          drawItemSprite(g, item.category, 0, 0);
          spriteContainer.addChild(g);

          counterSprites.addChild(spriteContainer);
        });
      }
    })();

    return () => {
      destroyed = true;
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
      const state = stateRef.current;
      state.roomContainer = null;
      state.zoneContainer = null;
      state.counterSprites = null;
      state.zones = [];
      state.zoomedZone = null;
      state.tweening = false;
    };
    // Mount-only: PixiJS app lifecycle tied to DOM mount, not item changes.
    // Items are read via itemsRef.current when zones are clicked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={mountRef}
      className="flex justify-center"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
