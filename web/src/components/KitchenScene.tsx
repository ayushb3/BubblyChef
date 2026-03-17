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

const FADE_DURATION = 200; // ms
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
    animating: boolean;
    roomContainer: Container | null;
    zoneContainer: Container | null;
    zones: ApplianceZone[];
    isMobile: boolean;
  }>({
    zoomedZone: null,
    animating: false,
    roomContainer: null,
    zoneContainer: null,
    zones: [],
    isMobile: false,
  });

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const onItemClickRef = useRef(onItemClick);
  onItemClickRef.current = onItemClick;

  const zoomInRef = useRef<(app: Application, zone: ApplianceZone) => void>();
  const zoomOutRef = useRef<(app: Application) => void>();

  const buildInterior = useCallback(
    (zone: ApplianceZone, zoneContainer: Container) => {
      zoneContainer.removeChildren();

      const zoneItems = itemsRef.current.filter((i) => i.location === zone.location);

      // Render the immersive interior
      const renderer = getInteriorRenderer(zone.location);
      renderer(zoneContainer, {
        items: zoneItems,
        onItemClick: (item: PantryItem) => onItemClickRef.current(item),
      });

      // Overlay: back arrow button
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

      // Overlay: zone title
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
      if (state.animating || state.zoomedZone) return;
      if (!state.roomContainer || !state.zoneContainer) return;

      state.animating = true;
      state.zoomedZone = zone.location;

      const room = state.roomContainer;
      const zoneC = state.zoneContainer;

      // Build interior view and scale it to match canvas
      buildInterior(zone, zoneC);
      const scale = state.isMobile ? 0.6 : 1;
      zoneC.scale.set(scale);

      // Crossfade: room fades out, interior fades in
      zoneC.visible = true;
      zoneC.alpha = 0;

      const startTime = performance.now();
      const tickerFn = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / FADE_DURATION, 1);
        const t = easeOutCubic(progress);

        room.alpha = lerp(1, 0, t);
        zoneC.alpha = lerp(0, 1, t);

        if (progress >= 1) {
          app.ticker.remove(tickerFn);
          room.visible = false;
          room.alpha = 1; // reset for later
          zoneC.alpha = 1;
          state.animating = false;
        }
      };
      app.ticker.add(tickerFn);
    },
    [buildInterior],
  );

  const zoomOut = useCallback((app: Application) => {
    const state = stateRef.current;
    if (state.animating || !state.zoomedZone) return;
    if (!state.roomContainer || !state.zoneContainer) return;

    state.animating = true;

    const room = state.roomContainer;
    const zoneC = state.zoneContainer;

    // Crossfade: interior fades out, room fades in
    room.visible = true;
    room.alpha = 0;

    const startTime = performance.now();
    const tickerFn = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / FADE_DURATION, 1);
      const t = easeOutCubic(progress);

      room.alpha = lerp(0, 1, t);
      zoneC.alpha = lerp(1, 0, t);

      if (progress >= 1) {
        app.ticker.remove(tickerFn);
        zoneC.visible = false;
        zoneC.alpha = 1; // reset
        room.alpha = 1;
        state.zoomedZone = null;
        state.animating = false;
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
        // Only clear ref if it still points to this app instance
        if (appRef.current === app) appRef.current = null;
        return;
      }

      if (destroyed) {
        try { app.destroy(true); } catch { /* StrictMode race */ }
        // Only clear ref if it still points to this app instance
        if (appRef.current === app) appRef.current = null;
        return;
      }

      // Re-assign after async init in case StrictMode cleanup ran between
      // new Application() and init() resolving
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

      const state = stateRef.current;
      state.roomContainer = roomContainer;
      state.zoneContainer = zoneContainer;
      state.isMobile = isMobile;
      // Reset transition state in case of StrictMode re-mount
      state.zoomedZone = null;
      state.animating = false;

      // Count items per zone
      const currentItems = itemsRef.current;
      const counts: Record<Location, number> = {
        fridge: 0, freezer: 0, pantry: 0, counter: 0,
      };
      for (const item of currentItems) {
        counts[item.location]++;
      }

      // Draw the room
      const { zones } = drawKitchenRoom(roomContainer, counts, isMobile);
      state.zones = zones;

      // Make each appliance interactive
      for (const zone of zones) {
        // Explicit hit area covering the appliance bounds
        const hitArea = new Graphics();
        hitArea.rect(zone.x, zone.y, zone.width, zone.height).fill({
          color: 0xffffff,
          alpha: 0.01,
        });
        zone.container.addChild(hitArea);

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

      // Counter item sprites (non-interactive overlay)
      const counterSprites = new Container();
      counterSprites.eventMode = 'none';
      roomContainer.addChild(counterSprites);

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
      if (appRef.current === app) {
        try { app.destroy(true); } catch { /* PixiJS v8 StrictMode */ }
        appRef.current = null;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const s = stateRef.current;
      s.roomContainer = null;
      s.zoneContainer = null;
      s.zones = [];
      s.zoomedZone = null;
      s.animating = false;
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="flex justify-center"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
