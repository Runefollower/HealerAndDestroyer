import type { ResourceMap } from "@healer/shared";
import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";

interface WorldSpriteDefinition {
  id: string;
  textureUrl: string;
  width: number;
  height: number;
  offset?: { x: number; y: number };
}

type SalvageSpriteId = "ferrite-salvage" | "plasma-salvage" | "mixed-salvage";

const textureCache = new Map<string, Texture>();
let preloadPromise: Promise<void> | null = null;

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

const allWorldSprites = [
  ...Object.values(enemySpriteRegistry),
  ...Object.values(structureSpriteRegistry),
  ...Object.values(salvageSpriteRegistry)
];

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

export function createEnemyDisplay(enemyTypeId: string): Container {
  const definition = enemySpriteRegistry[enemyTypeId];
  return createWorldSprite(definition, 0xff6478, 16, 12);
}

export function createStructureDisplay(structureTypeId: string): Container {
  const definition = structureSpriteRegistry[structureTypeId];
  return createWorldSprite(definition, 0x73f3ca, 24, 24);
}

export function createFoundryDisplay(active: boolean): Container {
  const definition = structureSpriteRegistry["enemy-foundry"];
  const display = createWorldSprite(definition, active ? 0xff7e6b : 0x74808f, 28, 28);
  display.alpha = active ? 1 : 0.72;
  return display;
}

export function createSalvageDisplay(resources: ResourceMap): Container {
  const definition = salvageSpriteRegistry[getSalvageSpriteId(resources)];
  return createWorldSprite(definition, 0xffd86f, 10, 10);
}

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
