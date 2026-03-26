import type { StructureDefinition } from "@healer/shared";

export const structureDefinitions: StructureDefinition[] = [
  {
    id: "builder-site",
    name: "Builder Site",
    structureKind: "builderSite",
    maxHealth: 500
  },
  {
    id: "enemy-foundry",
    name: "Enemy Foundry",
    structureKind: "foundry",
    maxHealth: 350
  }
];

