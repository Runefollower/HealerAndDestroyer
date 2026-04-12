import type { ResourceMap } from "@healer/shared";
import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";

interface WorldSpriteDefinition {
  // id mirrors the content/entity type id this sprite represents.
  id: string;
  // textureUrl points to the visual asset loaded by Pixi.
  textureUrl: string;
  // width/height define rendered size in world-space pixels.
  width: number;
  height: number;
  // offset adjusts the sprite relative to the entity center.
  offset?: { x: number; y: number };
}

type SalvageSpriteId = "ferrite-salvage" | "plasma-salvage" | "mixed-salvage";

// Shared cache for enemy, structure, foundry, and salvage textures.
const textureCache = new Map<string, Texture>();
// preloadPromise ensures world entity sprites are loaded only once.
let preloadPromise: Promise<void> | null = null;

// Enemy content ids map to their world sprite assets and display sizes.
const enemySpriteRegistry: Record<string, WorldSpriteDefinition> = {
  "drone-scout": {
    id: "drone-scout",
    textureUrl: "/assets/world/enemies/drone-scout.svg",
    width: 42,
    height: 30
  },
  "burrow-sentry": {
    id: "burrow-sentry",
    textureUrl: "/assets/world/enemies/burrow-sentry.svg",
    width: 48,
    height: 34
  }
};

// Structure/foundry content ids map to their world sprite assets and display sizes.
const structureSpriteRegistry: Record<string, WorldSpriteDefinition> = {
  "builder-site": {
    id: "builder-site",
    textureUrl: "/assets/world/structures/builder-site.svg",
    width: 72,
    height: 72
  },
  "enemy-foundry": {
    id: "enemy-foundry",
    textureUrl: "/assets/world/structures/enemy-foundry.svg",
    width: 92,
    height: 92
  }
};

// Salvage sprite ids map resource payload types to distinct pickup art.
const salvageSpriteRegistry: Record<SalvageSpriteId, WorldSpriteDefinition> = {
  "ferrite-salvage": {
    id: "ferrite-salvage",
    textureUrl: "/assets/world/salvage/ferrite-salvage.svg",
    width: 28,
    height: 28
  },
  "plasma-salvage": {
    id: "plasma-salvage",
    textureUrl: "/assets/world/salvage/plasma-salvage.svg",
    width: 28,
    height: 28
  },
  "mixed-salvage": {
    id: "mixed-salvage",
    textureUrl: "/assets/world/salvage/mixed-salvage.svg",
    width: 30,
    height: 30
  }
};

// allWorldSprites flattens every registry for bulk preloading during client bootstrap.
const allWorldSprites = [
  ...Object.values(enemySpriteRegistry),
  ...Object.values(structureSpriteRegistry),
  ...Object.values(salvageSpriteRegistry)
];

// Preloads all non-ship world entity textures before the first render.
export function preloadWorldEntityTextures(): Promise<void> {
  if (preloadPromise) {
    return preloadPromise;
  }

  preloadPromise = Promise.all(
    allWorldSprites.map(async (entry) => {
      const texture = await Assets.load<Texture>(entry.textureUrl);
      textureCache.set(entry.textureUrl, texture);
    })
  ).then(() => undefined);

  return preloadPromise;
}

// Creates an enemy display for the given enemy type, falling back for missing art.
export function createEnemyDisplay(enemyTypeId: string): Container {
  const definition = enemySpriteRegistry[enemyTypeId];
  return createWorldSprite(definition, 0xff6478, 16, 12);
}

// Creates a static structure display for the given structure type.
export function createStructureDisplay(structureTypeId: string): Container {
  const definition = structureSpriteRegistry[structureTypeId];
  return createWorldSprite(definition, 0x73f3ca, 24, 24);
}

// Creates the foundry display and fades destroyed/inactive foundries.
export function createFoundryDisplay(active: boolean): Container {
  const definition = structureSpriteRegistry["enemy-foundry"];
  const display = createWorldSprite(definition, active ? 0xff7e6b : 0x74808f, 28, 28);
  display.alpha = active ? 1 : 0.72;
  return display;
}

// Creates a salvage pickup display based on the resources contained in the drop.
export function createSalvageDisplay(resources: ResourceMap): Container {
  const definition = salvageSpriteRegistry[getSalvageSpriteId(resources)];
  return createWorldSprite(definition, 0xffd86f, 10, 10);
}

// Chooses the salvage art variant from the resource mix in a drop.
function getSalvageSpriteId(resources: ResourceMap): SalvageSpriteId {
  const hasFerrite = (resources.ferrite ?? 0) > 0;
  const hasPlasma = (resources["plasma-crystal"] ?? 0) > 0;

  if (hasFerrite && hasPlasma) {
    return "mixed-salvage";
  }
  if (hasPlasma) {
    return "plasma-salvage";
  }
  return "ferrite-salvage";
}

// Creates a sprite-backed display with a geometric fallback for missing registry entries.
function createWorldSprite(definition: WorldSpriteDefinition | undefined, fallbackColor: number, fallbackWidth: number, fallbackHeight: number): Container {
  const container = new Container();

  if (!definition) {
    const fallback = new Graphics();
    fallback.roundRect(-fallbackWidth, -fallbackHeight, fallbackWidth * 2, fallbackHeight * 2, 8).fill(fallbackColor);
    fallback.stroke({ color: 0xf6fbff, width: 2, alpha: 0.8 });
    fallback.alpha = 0.9;
    container.addChild(fallback);
    return container;
  }

  const sprite = new Sprite(textureCache.get(definition.textureUrl) ?? Texture.from(definition.textureUrl));
  sprite.anchor.set(0.5);
  sprite.position.set(definition.offset?.x ?? 0, definition.offset?.y ?? 0);
  sprite.width = definition.width;
  sprite.height = definition.height;
  container.addChild(sprite);
  return container;
}
