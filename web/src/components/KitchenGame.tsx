/**
 * KitchenGame — Phaser 3 kitchen scene with drag-and-drop item placement.
 *
 * Enabled via VITE_KITCHEN_V2=true environment variable.
 * Renders food items as Fluent Emoji icons in zone-based slots (fridge/freezer/pantry/counter).
 * Drag-and-drop between zones calls PATCH /api/pantry/{id}/slot to persist position.
 */

import Phaser from 'phaser';
import { useEffect, useRef, useCallback } from 'react';
import type { PantryItem, Location } from '../types';

interface KitchenGameProps {
  items: PantryItem[];
  onItemClick: (item: PantryItem) => void;
}

// Zone layout — pixel coords within 800x520 game canvas
const ZONES: Record<Location, { x: number; y: number; width: number; height: number; label: string }> = {
  pantry:  { x: 20,  y: 200, width: 220, height: 280, label: 'Pantry Shelf' },
  fridge:  { x: 280, y: 180, width: 160, height: 300, label: 'Fridge' },
  freezer: { x: 460, y: 180, width: 160, height: 300, label: 'Freezer' },
  counter: { x: 640, y: 300, width: 140, height: 200, label: 'Counter' },
};

const ZONE_COLORS: Record<Location, number> = {
  pantry:  0xffecd0,
  fridge:  0xb5d8eb,
  freezer: 0xc9b5e8,
  counter: 0xd4c4a8,
};

const ITEM_SIZE = 40;
const ITEM_COLS = 4;

class KitchenScene extends Phaser.Scene {
  private items: PantryItem[] = [];
  private onItemClick: (item: PantryItem) => void = () => {};
  private onSlotChange: (itemId: string, slotIndex: number, location: Location) => void = () => {};
  private itemSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private dragTarget: Phaser.GameObjects.Container | null = null;
  private sceneReady = false;
  private pendingItems: PantryItem[] | null = null;

  constructor() {
    super({ key: 'KitchenScene' });
  }

  init(data: {
    items: PantryItem[];
    onItemClick: (item: PantryItem) => void;
    onSlotChange: (itemId: string, slotIndex: number, location: Location) => void;
  }) {
    this.items = data.items;
    this.onItemClick = data.onItemClick;
    this.onSlotChange = data.onSlotChange;
  }

  preload() {
    // Load food icons from /api/icons/ — one texture per item name
    const loaded = new Set<string>();
    for (const item of this.items) {
      const key = `icon_${item.name.toLowerCase().trim()}`;
      if (!loaded.has(key)) {
        loaded.add(key);
        this.load.image(key, `/api/icons/${encodeURIComponent(item.name.toLowerCase().trim())}`);
      }
    }
    // Load kitchen background if available
    this.load.image('kitchen_bg', '/kitchen/room/background.png');
    // Load decoration sprites
    this.load.image('deco_flower_pot', '/kitchen/decorations/flower_pot.png');
    this.load.image('deco_cactus', '/kitchen/decorations/cactus.png');
    this.load.image('deco_herb_garden', '/kitchen/decorations/herb_garden.png');
  }

  create() {
    // Background
    if (this.textures.exists('kitchen_bg')) {
      this.add.image(400, 260, 'kitchen_bg').setDisplaySize(800, 520);
    } else {
      this.add.rectangle(400, 260, 800, 520, 0xfff9f5);
    }

    // Draw zones
    for (const [loc, zone] of Object.entries(ZONES) as [Location, typeof ZONES[Location]][]) {
      const g = this.add.graphics();
      g.fillStyle(ZONE_COLORS[loc], 0.6);
      g.fillRoundedRect(zone.x, zone.y, zone.width, zone.height, 10);
      g.lineStyle(2, 0xffffff, 0.4);
      g.strokeRoundedRect(zone.x, zone.y, zone.width, zone.height, 10);

      this.add.text(zone.x + zone.width / 2, zone.y + 12, zone.label, {
        fontSize: '11px',
        color: '#4a4a4a',
        fontFamily: 'Nunito, sans-serif',
      }).setOrigin(0.5, 0);

      // Drop zone invisible rectangle for hit-testing
      const dropZone = this.add
        .zone(zone.x + zone.width / 2, zone.y + zone.height / 2, zone.width, zone.height)
        .setRectangleDropZone(zone.width, zone.height)
        .setData('location', loc);

      this.input.on(
        'dragenter',
        (_: Phaser.Input.Pointer, __: Phaser.GameObjects.GameObject, dz: Phaser.GameObjects.Zone) => {
          if (dz === dropZone) {
            g.lineStyle(3, 0xff9aa2, 1);
            g.strokeRoundedRect(zone.x, zone.y, zone.width, zone.height, 10);
          }
        }
      );
      this.input.on(
        'dragleave',
        (_: Phaser.Input.Pointer, __: Phaser.GameObjects.GameObject, dz: Phaser.GameObjects.Zone) => {
          if (dz === dropZone) {
            g.lineStyle(2, 0xffffff, 0.4);
            g.strokeRoundedRect(zone.x, zone.y, zone.width, zone.height, 10);
          }
        }
      );
    }

    // Place items in their zones
    const zoneItemCounts: Partial<Record<Location, number>> = {};
    for (const item of this.items) {
      const loc = item.location as Location;
      const zone = ZONES[loc];
      if (!zone) continue;

      const idx = zoneItemCounts[loc] ?? 0;
      zoneItemCounts[loc] = idx + 1;

      const col = idx % ITEM_COLS;
      const row = Math.floor(idx / ITEM_COLS);
      const x = zone.x + 20 + col * (ITEM_SIZE + 8);
      const y = zone.y + 30 + row * (ITEM_SIZE + 16);

      const container = this.createItemSprite(item, x, y);
      this.itemSprites.set(item.id, container);
    }

    // Drop handler
    this.input.on(
      'drop',
      (_: Phaser.Input.Pointer, obj: Phaser.GameObjects.Container, dropZone: Phaser.GameObjects.Zone) => {
        const itemId = obj.getData('itemId') as string;
        const newLocation = dropZone.getData('location') as Location;
        const zone = ZONES[newLocation];
        if (!zone) return;

        // Snap to next available slot in target zone (exclude the item being moved)
        const existingInZone = this.items.filter(
          (it) => it.location === newLocation && it.id !== itemId
        ).length;
        const col = existingInZone % ITEM_COLS;
        const row = Math.floor(existingInZone / ITEM_COLS);
        obj.setPosition(zone.x + 20 + col * (ITEM_SIZE + 8), zone.y + 30 + row * (ITEM_SIZE + 16));

        const slotIndex = existingInZone;
        this.onSlotChange(itemId, slotIndex, newLocation);
      }
    );

    // Mark scene ready and flush any items that arrived before create() fired
    this.sceneReady = true;
    if (this.pendingItems !== null) {
      this.updateItems(this.pendingItems);
      this.pendingItems = null;
    } else {
      this.updateItems(this.items);
    }
  }

  private createItemSprite(item: PantryItem, x: number, y: number): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    container.setData('itemId', item.id);
    container.setData('item', item);
    container.setSize(ITEM_SIZE, ITEM_SIZE + 12);

    const key = `icon_${item.name.toLowerCase().trim()}`;
    let icon: Phaser.GameObjects.Image | Phaser.GameObjects.Text;

    if (this.textures.exists(key)) {
      icon = this.add.image(0, 0, key).setDisplaySize(ITEM_SIZE, ITEM_SIZE);
    } else {
      // Emoji fallback
      const CATEGORY_EMOJI: Record<string, string> = {
        produce: '🍎', dairy: '🥛', meat: '🍗', seafood: '🐟',
        frozen: '🧊', canned: '🥫', dry_goods: '📦', condiments: '🧈',
        beverages: '🧃', snacks: '🍿', bakery: '🍞', other: '❓',
      };
      const emoji = CATEGORY_EMOJI[item.category] ?? '❓';
      icon = this.add.text(0, 0, emoji, { fontSize: '28px' }).setOrigin(0.5);
    }
    container.add(icon);

    // Expiry dot
    const days = item.days_until_expiry;
    const dotColor = days === null ? 0xcccccc : days <= 0 ? 0xff6b6b : days <= 2 ? 0xffa94d : 0x69db7c;
    const dot = this.add.circle(ITEM_SIZE / 2 - 4, -ITEM_SIZE / 2 + 4, 4, dotColor);
    container.add(dot);

    // Name label
    const label = this.add.text(0, ITEM_SIZE / 2 + 2, item.name, {
      fontSize: '8px',
      color: '#4a4a4a',
      fontFamily: 'Nunito, sans-serif',
    }).setOrigin(0.5, 0);
    container.add(label);

    // Make interactive
    this.input.setDraggable(container);
    container.setInteractive();

    container.on('pointerover', () => {
      this.tweens.add({ targets: container, scaleX: 1.15, scaleY: 1.15, duration: 100 });
    });
    container.on('pointerout', () => {
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 100 });
    });
    container.on('pointerdown', () => {
      this.onItemClick(item);
    });

    this.input.on('drag', (_: Phaser.Input.Pointer, obj: Phaser.GameObjects.Container, dragX: number, dragY: number) => {
      if (obj === container) {
        obj.setPosition(dragX, dragY);
      }
    });

    return container;
  }

  updateItems(items: PantryItem[]) {
    if (!this.sceneReady) {
      // create() hasn't fired yet — queue for later
      this.pendingItems = items;
      return;
    }
    this.items = items;
    // Clear and rebuild — simple approach
    for (const [, sprite] of this.itemSprites) {
      sprite.destroy();
    }
    this.itemSprites.clear();

    const zoneItemCounts: Partial<Record<Location, number>> = {};
    for (const item of items) {
      const loc = item.location as Location;
      const zone = ZONES[loc];
      if (!zone) continue;
      const idx = zoneItemCounts[loc] ?? 0;
      zoneItemCounts[loc] = idx + 1;
      const col = idx % ITEM_COLS;
      const row = Math.floor(idx / ITEM_COLS);
      const x = zone.x + 20 + col * (ITEM_SIZE + 8);
      const y = zone.y + 30 + row * (ITEM_SIZE + 16);
      const container = this.createItemSprite(item, x, y);
      this.itemSprites.set(item.id, container);
    }
  }
}

export function KitchenGame({ items, onItemClick }: KitchenGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<KitchenScene | null>(null);

  const handleSlotChange = useCallback(
    async (itemId: string, slotIndex: number, _location: Location) => {
      try {
        await fetch(`/api/pantry/${itemId}/slot?slot_index=${slotIndex}`, { method: 'PATCH' });
      } catch {
        // Non-critical — position just won't persist
      }
    },
    []
  );

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const scene = new KitchenScene();
    sceneRef.current = scene;

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      width: 800,
      height: 520,
      backgroundColor: '#fff9f5',
      parent: containerRef.current,
      scene: scene,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      callbacks: {
        preBoot: (game) => {
          game.scene.start('KitchenScene', {
            items,
            onItemClick,
            onSlotChange: handleSlotChange,
          });
        },
      },
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push item updates into the running scene
  useEffect(() => {
    sceneRef.current?.updateItems(items);
  }, [items]);

  return (
    <div className="flex justify-center">
      <div
        ref={containerRef}
        className="w-full rounded-2xl overflow-hidden"
        style={{ maxWidth: 800, aspectRatio: '800 / 520' }}
      />
    </div>
  );
}
