import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { useEffect, useRef, useCallback } from 'react';
import type { PantryItem, Location } from '../types';
import { drawKitchenRoom, COLORS } from './pixel/drawAppliances';
import type { ApplianceZone } from './pixel/drawAppliances';
import { drawItemSprite } from './pixel/drawItems';
import { getInteriorRenderer } from './pixel/drawInteriors';

interface KitchenSceneProps {
  items: PantryItem[];
  onItemClick: (item: PantryItem) => void;
}

const TWEEN_DURATION = 300; // ms
const ZOOM_SCALE = 2.5;
const COUNTER_MAX_COLS = 8;

const ZONE_TITLE_STYLE = new TextStyle({
  fontFamily: 'Nunito, sans-serif',
  fontSize: 16,
  fontWeight: 'bold',
  fill: 0x4a4a4a,
});

const ZONE_LABELS: Record<Location, string> = {
  fridge: 'Fridge',
  freezer: 'Freezer',
  pantry: 'Pantry Shelf',
  counter: 'Counter',
};

const ZONE_EMOJIS: Record<Location, string> = {
  fridge: '\u{1F9CA}',
  freezer: '\u2744\uFE0F',
  pantry: '\u{1F3E0}',
  counter: '\u{1F34E}',
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

  // Refs for stable access in PixiJS event handlers (avoids stale closures)
  const zoomInRef = useRef<(app: Application, zone: ApplianceZone) => void>();
  const zoomOutRef = useRef<(app: Application) => void>();

  const buildZoneView = useCallback(
    (_app: Application, zone: ApplianceZone, zoneContainer: Container) => {
      zoneContainer.removeChildren();

      const zoneItems = itemsRef.current.filter((i) => i.location === zone.location);

      // Use the immersive interior renderer for this location
      const renderer = getInteriorRenderer(zone.location);
      renderer(zoneContainer, {
        items: zoneItems,
        onItemClick: (item: PantryItem) => onItemClickRef.current(item),
      });

      // Overlay: back arrow button (always on top)
      const backBtn = new Container();
      const backBg = new Graphics();
      backBg.roundRect(0, 0, 44, 44, 12).fill({ color: 0xffffff, alpha: 0.85 });
      backBg.roundRect(0, 0, 44, 44, 12).stroke({ width: 1, color: 0xdddddd, alpha: 0.5 });
      backBtn.addChild(backBg);

      const arrow = new Graphics();
      arrow.moveTo(26, 12).lineTo(14, 22).lineTo(26, 32);
      arrow.stroke({ width: 3, color: 0x4a4a4a, alpha: 0.8 });
      backBtn.addChild(arrow);

      const backHit = new Graphics();
      backHit.rect(0, 0, 44, 44).fill({ color: 0xffffff, alpha: 0.01 });
      backBtn.addChild(backHit);

      backBtn.x = 16;
      backBtn.y = 12;
      backBtn.eventMode = 'static';
      backBtn.cursor = 'pointer';
      backBtn.on('pointerdown', () => {
        if (appRef.current) zoomOutRef.current?.(appRef.current);
      });
      zoneContainer.addChild(backBtn);

      // Overlay: zone title (floating label)
      const titleBg = new Graphics();
      titleBg.roundRect(0, 0, 160, 32, 8).fill({ color: 0xffffff, alpha: 0.85 });
      titleBg.x = 68;
      titleBg.y = 16;
      zoneContainer.addChild(titleBg);

      const title = new Text({
        text: `${ZONE_EMOJIS[zone.location]} ${ZONE_LABELS[zone.location]}`,
        style: ZONE_TITLE_STYLE,
      });
      title.x = 76;
      title.y = 22;
      zoneContainer.addChild(title);
    },
    [],
  );

  const zoomIn = useCallback(
    (app: Application, zone: ApplianceZone) => {
      const state = stateRef.current;
      if (state.tweening || state.zoomedZone) return;
      if (!state.roomContainer || !state.zoneContainer) return;

      state.tweening = true;
      state.zoomedZone = zone.location;

      // Build zone detail view
      buildZoneView(app, zone, state.zoneContainer);

      const room = state.roomContainer;
      const zoneC = state.zoneContainer;

      // Calculate pivot to center on the clicked zone
      const pivotX = zone.x + zone.width / 2;
      const pivotY = zone.y + zone.height / 2;

      const startScale = room.scale.x;
      const startPivotX = room.pivot.x;
      const startPivotY = room.pivot.y;
      const startPosX = room.x;
      const startPosY = room.y;

      // Mobile uses 0.6 base scale; zoom relative to that
      const mobileF = state.isMobile ? 0.6 : 1;
      const targetScale = ZOOM_SCALE * mobileF;
      const targetPivotX = pivotX;
      const targetPivotY = pivotY;
      const targetPosX = 400 * mobileF;
      const targetPosY = 260 * mobileF;

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
    if (!state.roomContainer || !state.zoneContainer) return;

    state.tweening = true;

    const room = state.roomContainer;
    const zoneC = state.zoneContainer;

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

  // Keep refs current so PixiJS event handlers always call latest version
  zoomInRef.current = zoomIn;
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
    // Assign immediately so cleanup can always reach it
    appRef.current = app;
    let destroyed = false;

    (async () => {
      try {
        await app.init({
          width: cw,
          height: ch,
          antialias: false,
          resolution: 2,
          autoDensity: true,
          background: COLORS.wall,
        });
      } catch {
        // WebGL unavailable or canvas creation blocked — fail gracefully
        appRef.current = null;
        return;
      }

      if (destroyed) {
        app.destroy(true);
        appRef.current = null;
        return;
      }

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

      // Container for counter item sprites
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

      // Make each appliance interactive — use refs for stable callbacks
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
          if (appRef.current) zoomInRef.current?.(appRef.current, zone);
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
          spriteContainer.x = startX + (idx % COUNTER_MAX_COLS) * spacing;
          spriteContainer.y = startY + Math.floor(idx / COUNTER_MAX_COLS) * 24;
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
        try {
          appRef.current.destroy(true);
        } catch {
          // PixiJS v8 may throw during destroy if init() hadn't fully completed
          // (e.g. React StrictMode double-invoke). Safe to ignore.
        }
        appRef.current = null;
      }
      // Reset mutable state container (stateRef is stable across renders)
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const s = stateRef.current;
      s.roomContainer = null;
      s.zoneContainer = null;
      s.counterSprites = null;
      s.zones = [];
      s.zoomedZone = null;
      s.tweening = false;
    };
    // Mount-only: PixiJS app lifecycle tied to DOM mount, not item changes.
    // Items are read via itemsRef.current when zones are clicked.
  }, []);

  return (
    <div
      ref={mountRef}
      className="flex justify-center"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
