import { getHullDefinition, getModuleDefinition } from "@healer/content";
import type { InstalledModule } from "@healer/shared";
import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";

export type ShipPartKind = "hull" | "engine" | "weapon";

export interface ShipPartOption {
  // id is the stable variant id used for deterministic visual selection.
  id: string;
  // label is shown in the builder part gallery.
  label: string;
  // kind determines layering and gallery grouping.
  kind: ShipPartKind;
  // textureUrl points to the SVG/bitmap asset used by Pixi and HTML previews.
  textureUrl: string;
  // width/height define the rendered size in world-space pixels.
  width: number;
  height: number;
  // offset positions the part relative to the ship center in local ship space.
  offset: { x: number; y: number };
  // compatibleHullIds limits hull art variants to matching hull definitions.
  compatibleHullIds?: string[];
  // compatibleModuleIds limits engine/weapon art to installed module ids.
  compatibleModuleIds?: string[];
}

interface PlacedShipPart {
  part: ShipPartOption;
  // offset is the final ship-local position after moving the part to its module's hardpoint.
  offset: { x: number; y: number };
}

interface ShipVisualLoadout {
  // The hull is nullable so missing art can fall back gracefully; engines and weapons get one sprite per module.
  hull: PlacedShipPart | null;
  engines: PlacedShipPart[];
  weapons: PlacedShipPart[];
}

// Engine and weapon part offsets were authored for the Sparrow's hardpoints. Parts on other hardpoints keep the
// same mounting relationship by shifting with the hardpoint's position relative to these.
const referenceHardpointPositions: Record<"engine" | "weapon", { x: number; y: number }> = {
  engine: { x: -14, y: 0 },
  weapon: { x: 12, y: 0 }
};

// Textures are cached by URL after preloading so display creation is cheap during snapshots.
const textureCache = new Map<string, Texture>();
// preloadPromise keeps asset preloading idempotent.
let preloadPromise: Promise<void> | null = null;

// Catalog of prototype ship art layers used by Pixi rendering and builder previews.
export const playerShipPartCatalog: Record<ShipPartKind, ShipPartOption[]> = {
  hull: [
    {
      id: "sparrow-dart",
      label: "Sparrow Dart",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/sparrow-dart.png",
      width: 76,
      height: 54,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["sparrow-scout"]
    },
    {
      id: "sparrow-manta",
      label: "Sparrow Manta",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/sparrow-manta.png",
      width: 78,
      height: 56,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["sparrow-scout"]
    },
    {
      id: "warden-crest",
      label: "Warden Crest",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/warden-crest.png",
      width: 82,
      height: 60,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["warden-healer"]
    },
    {
      id: "warden-bulwark",
      label: "Warden Bulwark",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/warden-bulwark.png",
      width: 84,
      height: 60,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["warden-healer"]
    },
    {
      id: "breaker-spear",
      label: "Breaker Spear",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/breaker-spear.png",
      width: 90,
      height: 58,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["breaker-destroyer"]
    },
    {
      id: "breaker-fang",
      label: "Breaker Fang",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/breaker-fang.png",
      width: 90,
      height: 58,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["breaker-destroyer"]
    },
    {
      id: "delver-hauler",
      label: "Delver Hauler",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/delver-hauler.png",
      width: 86,
      height: 66,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["delver-miner"]
    },
    {
      id: "delver-bore",
      label: "Delver Bore",
      kind: "hull",
      textureUrl: "/assets/ships/player/hulls/delver-bore.png",
      width: 84,
      height: 64,
      offset: { x: 0, y: 0 },
      compatibleHullIds: ["delver-miner"]
    }
  ],
  engine: [
    {
      id: "thruster-block",
      label: "Thruster Block",
      kind: "engine",
      textureUrl: "/assets/ships/player/engines/thruster-block.png",
      width: 32,
      height: 28,
      offset: { x: -29, y: 0 },
      compatibleModuleIds: ["starter-thruster"]
    },
    {
      id: "thruster-arc",
      label: "Thruster Arc",
      kind: "engine",
      textureUrl: "/assets/ships/player/engines/thruster-arc.png",
      width: 34,
      height: 28,
      offset: { x: -30, y: 0 },
      compatibleModuleIds: ["starter-thruster"]
    },
    {
      id: "thruster-bell",
      label: "Thruster Bell",
      kind: "engine",
      textureUrl: "/assets/ships/player/engines/thruster-bell.png",
      width: 34,
      height: 30,
      offset: { x: -30, y: 0 },
      compatibleModuleIds: ["starter-thruster"]
    },
    {
      id: "heavy-drive",
      label: "Heavy Drive",
      kind: "engine",
      textureUrl: "/assets/ships/player/engines/heavy-drive.png",
      width: 38,
      height: 30,
      offset: { x: -32, y: 0 },
      compatibleModuleIds: ["heavy-drive"]
    }
  ],
  weapon: [
    {
      id: "pulse-lance",
      label: "Pulse Lance",
      kind: "weapon",
      textureUrl: "/assets/ships/player/weapons/pulse-lance.png",
      width: 38,
      height: 18,
      offset: { x: 32, y: 0 },
      compatibleModuleIds: ["pulse-cannon"]
    },
    {
      id: "pulse-prong",
      label: "Pulse Prong",
      kind: "weapon",
      textureUrl: "/assets/ships/player/weapons/pulse-prong.png",
      width: 40,
      height: 18,
      offset: { x: 32, y: 0 },
      compatibleModuleIds: ["pulse-cannon"]
    },
    {
      id: "pulse-spike",
      label: "Pulse Spike",
      kind: "weapon",
      textureUrl: "/assets/ships/player/weapons/pulse-spike.png",
      width: 36,
      height: 16,
      offset: { x: 32, y: 0 },
      compatibleModuleIds: ["pulse-cannon"]
    },
    {
      id: "rail-lance",
      label: "Rail Lance",
      kind: "weapon",
      textureUrl: "/assets/ships/player/weapons/rail-lance.png",
      width: 46,
      height: 14,
      offset: { x: 36, y: 0 },
      compatibleModuleIds: ["rail-lance"]
    }
  ]
};

// allParts flattens the catalog for bulk asset preloading.
const allParts = Object.values(playerShipPartCatalog).flat();

// Preloads every player ship part texture before the first world/builder render.
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

// Creates the layered Pixi display for a player ship from hull id, installed modules, and seed.
export function createPlayerShipDisplay(hullId: string, modules: InstalledModule[], seed: string, isSelf: boolean): Container {
  const display = new Container();
  // The loadout chooses deterministic visual variants so a ship stays visually stable between snapshots.
  const loadout = resolvePlayerShipLoadout(hullId, modules, seed);

  // Draw a subtle glow under every ship to keep it readable over terrain.
  const glow = new Graphics();
  glow.ellipse(0, 0, 23, 15).fill(isSelf ? 0x2b89c7 : 0x4f6177);
  glow.alpha = isSelf ? 0.24 : 0.16;
  display.addChild(glow);

  if (!loadout.hull) {
    // Fallback art keeps unknown or not-yet-authored hulls visible during development.
    display.addChild(createFallbackShipBody(isSelf));
    return display;
  }

  // Layer order puts engines behind the hull and weapons above the hull.
  for (const { part, offset } of [...loadout.engines, loadout.hull, ...loadout.weapons]) {
    const sprite = new Sprite(textureCache.get(part.textureUrl) ?? Texture.from(part.textureUrl));
    sprite.anchor.set(0.5);
    sprite.position.set(offset.x, offset.y);
    sprite.width = part.width;
    sprite.height = part.height;
    display.addChild(sprite);
  }

  return display;
}

// Creates the HTML preview markup used inside the builder panel for a saved ship.
export function renderPlayerShipPreviewMarkup(hullId: string, modules: InstalledModule[], seed: string, label: string): string {
  const loadout = resolvePlayerShipLoadout(hullId, modules, seed);
  // HTML previews use the same loadout rules as Pixi rendering so builder and world agree.
  const parts = [...loadout.engines, ...(loadout.hull ? [loadout.hull] : []), ...loadout.weapons]
    .map(
      ({ part, offset }) => `
        <img
          class="ship-preview-sprite ship-preview-${part.kind}"
          src="${part.textureUrl}"
          alt=""
          style="width:${Math.round(part.width * 1.15)}px;height:${Math.round(part.height * 1.15)}px;transform:translate(-50%, -50%) translate(${Math.round(offset.x * 1.15)}px, ${Math.round(offset.y * 1.15)}px);"
        />`
    )
    .join("");

  if (!parts) {
    return `<div class="ship-preview ship-preview-fallback" aria-label="${label}"></div>`;
  }

  return `<div class="ship-preview" aria-label="${label}">${parts}</div>`;
}

// Resolves the deterministic visual parts that match the ship hull and installed modules.
function resolvePlayerShipLoadout(hullId: string, modules: InstalledModule[], seed: string): ShipVisualLoadout {
  const hullOptions = playerShipPartCatalog.hull.filter((part) => part.compatibleHullIds?.includes(hullId));
  const hullPart = pickVariant(`${seed}:${hullId}:hull`, hullOptions);
  const hardpoints = new Map(tryGetHardpoints(hullId).map((hardpoint) => [hardpoint.id, hardpoint.localPosition]));
  const engineModules = modules.filter((module) => getModuleDefinition(module.moduleId).slotType === "engine");
  const weaponModules = modules.filter((module) => getModuleDefinition(module.moduleId).capabilities.includes("weapon"));

  return {
    hull: hullPart ? { part: hullPart, offset: hullPart.offset } : null,
    engines: placeModuleParts(`${seed}:engine`, "engine", engineModules, hardpoints),
    weapons: placeModuleParts(`${seed}:weapon`, "weapon", weaponModules, hardpoints)
  };
}

// Picks art for each installed module and moves it to that module's hardpoint. Every module of the same type
// shares one variant so a twin-gun ship looks symmetric.
function placeModuleParts(
  seed: string,
  kind: "engine" | "weapon",
  modules: InstalledModule[],
  hardpoints: Map<string, { x: number; y: number }>
): PlacedShipPart[] {
  const reference = referenceHardpointPositions[kind];
  return modules.flatMap((module) => {
    const compatible = playerShipPartCatalog[kind].filter((option) => option.compatibleModuleIds?.includes(module.moduleId));
    const part = pickVariant(`${seed}:${module.moduleId}`, compatible);
    if (!part) {
      return [];
    }
    const mount = hardpoints.get(module.hardpointId) ?? reference;
    return [{ part, offset: { x: part.offset.x + mount.x - reference.x, y: part.offset.y + mount.y - reference.y } }];
  });
}

// Unknown hulls (stale saves, missing content) still render with reference mounts instead of throwing.
function tryGetHardpoints(hullId: string) {
  try {
    return getHullDefinition(hullId).hardpoints;
  } catch {
    return [];
  }
}

// Picks a stable option from a list using a hash seed.
function pickVariant<T>(seed: string, options: T[]): T | null {
  if (!options.length) {
    return null;
  }

  return options[hashString(seed) % options.length] ?? null;
}

// Produces a deterministic unsigned hash for variant selection.
function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

// Draws a simple fallback ship body when no compatible hull art exists.
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
