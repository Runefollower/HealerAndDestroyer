import { getModuleDefinition } from "@healer/content";
import type { InstalledModule } from "@healer/shared";
import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";

export type ShipPartKind = "hull" | "engine" | "weapon";

export interface ShipPartOption {
  id: string;
  label: string;
  kind: ShipPartKind;
  textureUrl: string;
  width: number;
  height: number;
  offset: { x: number; y: number };
  compatibleHullIds?: string[];
  compatibleModuleIds?: string[];
}

interface ShipVisualLoadout {
  hull: ShipPartOption | null;
  engine: ShipPartOption | null;
  weapon: ShipPartOption | null;
}

const textureCache = new Map<string, Texture>();
let preloadPromise: Promise<void> | null = null;

export const playerShipPartCatalog: Record<ShipPartKind, ShipPartOption[]> = {
  hull: [
    {
      id: "sparrow-dart",
      label: "Sparrow Dart",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/sparrow-dart.svg",
      width: 76,
      height: 54,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["sparrow-scout"]
    },
    {
      id: "sparrow-manta",
      label: "Sparrow Manta",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/sparrow-manta.svg",
      width: 78,
      height: 56,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["sparrow-scout"]
    },
    {
      id: "warden-crest",
      label: "Warden Crest",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/warden-crest.svg",
      width: 82,
      height: 60,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["warden-healer"]
    },
    {
      id: "warden-bulwark",
      label: "Warden Bulwark",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/warden-bulwark.svg",
      width: 84,
      height: 60,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["warden-healer"]
    }
  ],
  engine: [
    {
      id: "thruster-block",
      label: "Thruster Block",
      kind: "engine",
      textureUrl: "/assets/ships/player/engines/thruster-block.svg",
      width: 32,
      height: 28,
      offset: { x: -29, y: 0 },
      compatibleModuleIds: ["starter-thruster"]
    },
    {
      id: "thruster-arc",
      label: "Thruster Arc",
      kind: "engine",
      textureUrl: "/assets/ships/player/engines/thruster-arc.svg",
      width: 34,
      height: 28,
      offset: { x: -30, y: 0 },
      compatibleModuleIds: ["starter-thruster"]
    },
    {
      id: "thruster-bell",
      label: "Thruster Bell",
      kind: "engine",
      textureUrl: "/assets/ships/player/engines/thruster-bell.svg",
      width: 34,
      height: 30,
      offset: { x: -30, y: 0 },
      compatibleModuleIds: ["starter-thruster"]
    }
  ],
  weapon: [
    {
      id: "pulse-lance",
      label: "Pulse Lance",
      kind: "weapon",
      textureUrl: "/assets/ships/player/weapons/pulse-lance.svg",
      width: 38,
      height: 18,
      offset: { x: 32, y: 0 },
      compatibleModuleIds: ["pulse-cannon"]
    },
    {
      id: "pulse-prong",
      label: "Pulse Prong",
      kind: "weapon",
      textureUrl: "/assets/ships/player/weapons/pulse-prong.svg",
      width: 40,
      height: 18,
      offset: { x: 32, y: 0 },
      compatibleModuleIds: ["pulse-cannon"]
    },
    {
      id: "pulse-spike",
      label: "Pulse Spike",
      kind: "weapon",
      textureUrl: "/assets/ships/player/weapons/pulse-spike.svg",
      width: 36,
      height: 16,
      offset: { x: 32, y: 0 },
      compatibleModuleIds: ["pulse-cannon"]
    }
  ]
};

const allParts = Object.values(playerShipPartCatalog).flat();

export function preloadPlayerShipTextures(): Promise<void> {
  if (preloadPromise) {
    return preloadPromise;
  }

  preloadPromise = Promise.all(
    allParts.map(async (part) => {
      const texture = await Assets.load<Texture>(part.textureUrl);
      textureCache.set(part.textureUrl, texture);
    })
  ).then(() => undefined);

  return preloadPromise;
}

export function createPlayerShipDisplay(hullId: string, modules: InstalledModule[], seed: string, isSelf: boolean): Container {
  const display = new Container();
  const loadout = resolvePlayerShipLoadout(hullId, modules, seed);

  const glow = new Graphics();
  glow.ellipse(0, 0, 23, 15).fill(isSelf ? 0x2b89c7 : 0x4f6177);
  glow.alpha = isSelf ? 0.24 : 0.16;
  display.addChild(glow);

  if (!loadout.hull) {
    display.addChild(createFallbackShipBody(isSelf));
    return display;
  }

  for (const part of [loadout.engine, loadout.hull, loadout.weapon]) {
    if (!part) {
      continue;
    }

    const sprite = new Sprite(textureCache.get(part.textureUrl) ?? Texture.from(part.textureUrl));
    sprite.anchor.set(0.5);
    sprite.position.set(part.offset.x, part.offset.y);
    sprite.width = part.width;
    sprite.height = part.height;
    display.addChild(sprite);
  }

  return display;
}

export function renderPlayerShipPreviewMarkup(hullId: string, modules: InstalledModule[], seed: string, label: string): string {
  const loadout = resolvePlayerShipLoadout(hullId, modules, seed);
  const parts = [loadout.engine, loadout.hull, loadout.weapon]
    .filter((part): part is ShipPartOption => part !== null)
    .map(
      (part) => `
        <img
          class="ship-preview-sprite ship-preview-${part.kind}"
          src="${part.textureUrl}"
          alt=""
          style="width:${Math.round(part.width * 1.15)}px;height:${Math.round(part.height * 1.15)}px;transform:translate(-50%, -50%) translate(${Math.round(part.offset.x * 1.15)}px, ${Math.round(part.offset.y * 1.15)}px);"
        />`
    )
    .join("");

  if (!parts) {
    return `<div class="ship-preview ship-preview-fallback" aria-label="${label}"></div>`;
  }

  return `<div class="ship-preview" aria-label="${label}">${parts}</div>`;
}

function resolvePlayerShipLoadout(hullId: string, modules: InstalledModule[], seed: string): ShipVisualLoadout {
  const hullOptions = playerShipPartCatalog.hull.filter((part) => part.compatibleHullIds?.includes(hullId));
  const engineModules = modules.filter((module) => getModuleDefinition(module.moduleId).slotType === "engine");
  const weaponModules = modules.filter((module) => getModuleDefinition(module.moduleId).capabilities.includes("weapon"));

  return {
    hull: pickVariant(`${seed}:${hullId}:hull`, hullOptions),
    engine: pickCompatibleVariant(`${seed}:engine`, playerShipPartCatalog.engine, engineModules),
    weapon: pickCompatibleVariant(`${seed}:weapon`, playerShipPartCatalog.weapon, weaponModules)
  };
}

function pickCompatibleVariant(seed: string, options: ShipPartOption[], modules: InstalledModule[]): ShipPartOption | null {
  const compatible = options.filter((option) => modules.some((module) => option.compatibleModuleIds?.includes(module.moduleId)));
  return pickVariant(seed, compatible);
}

function pickVariant<T>(seed: string, options: T[]): T | null {
  if (!options.length) {
    return null;
  }

  return options[hashString(seed) % options.length] ?? null;
}

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function createFallbackShipBody(isSelf: boolean): Container {
  const container = new Container();
  const hull = new Graphics();
  hull.roundRect(-17, -11, 34, 22, 8).fill(isSelf ? 0x49c6ff : 0xaab6c9);
  hull.alpha = 0.92;
  const cockpit = new Graphics();
  cockpit.circle(6, 0, 4).fill(0xe9f6ff);
  cockpit.alpha = 0.72;
  container.addChild(hull, cockpit);
  return container;
}
