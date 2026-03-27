# Healer and Destroyer Agent Guide

This document explains the current project structure and the purpose of each major area of the codebase.

## Project State

The repository is currently a TypeScript monorepo for an early multiplayer vertical slice of **Healer and Destroyer**.

The implemented foundation now includes:

- a browser client built with `Vite` and `PixiJS`
- a server-authoritative multiplayer runtime built on `Node.js` and `ws`
- shared gameplay, persistence, networking, and content contracts
- data-driven starter content for hulls, modules, enemies, resources, and structures
- persistence adapters for in-memory development and Postgres-oriented storage
- persistent terrain editing and chunk restoration
- real builder/module state with ship build timers, install/remove flow, and crafted module inventory
- tool-gated gameplay where weapons, mining, and support use distinct module capability paths
- foundry-driven PvE pressure plus deeper-path unlock after root foundry destruction

This is still a prototype foundation, not a full production game.

## Root Layout

- `README.md`
  - project overview and high-level vision
- `Documentation/`
  - design documents, including the GDD
- `AGENT.md`
  - current codebase map for future contributors/agents
- `apps/`
  - runnable applications
- `packages/`
  - shared libraries and domain packages
- `package.json`
  - root scripts and workspace dependencies
- `pnpm-workspace.yaml`
  - workspace definition
- `tsconfig.base.json`
  - shared TypeScript compiler settings
- `tsconfig.build.json`
  - TypeScript build references for package/server compilation
- `vitest.config.ts`
  - test configuration

## Applications

### `apps/client`

Browser client for the current playable slice.

Key files:

- `apps/client/src/main.ts`
  - boots the client
- `apps/client/src/game/app.ts`
  - main client runtime and network/input orchestration
- `apps/client/src/game/renderBuilder.ts`
  - builder/stable UI rendering and interactions
- `apps/client/src/game/renderWorld.ts`
  - HUD and world rendering
- `apps/client/src/game/networkClient.ts`
  - WebSocket client wrapper
- `apps/client/src/game/input.ts`
  - keyboard and mouse input capture
- `apps/client/index.html`
  - shell document and basic UI styling

Current responsibilities:

- connect to the local game server
- send movement, weapon fire, module activation, and builder messages
- render terrain chunks, structures, foundries, enemies, drops, and ships
- show builder UI with active/ready/building ships and hardpoint install/remove controls
- locally render ship build countdowns using server time offsets

Current input model:

- `WASD`: movement/rotation
- left click: weapon fire
- right click: mining module activation
- `Space`: support module activation
- `E`: interact with builder site

### `apps/server`

Authoritative multiplayer simulation runtime.

Key files:

- `apps/server/src/index.ts`
  - server startup entry point
- `apps/server/src/gameServer.ts`
  - WebSocket server, connection lifecycle, and snapshot broadcast loop
- `apps/server/src/config.ts`
  - environment-driven runtime config
- `apps/server/src/simulation/createWorld.ts`
  - seeded persistent world, maps, starter structures, foundries, and starter player save setup
- `apps/server/src/simulation/gameWorld.ts`
  - orchestration layer for the simulation
- `apps/server/src/simulation/shipLifecycle.ts`
  - runtime ship creation, builder state shaping, and build completion handling
- `apps/server/src/simulation/moduleActions.ts`
  - weapon fire, mining activation, and support activation rules
- `apps/server/src/simulation/foundries.ts`
  - foundry spawning, enemy counts, destruction, and objective unlock state
- `apps/server/src/simulation/terrain.ts`
  - chunk/tile addressing and mining result application
- `apps/server/src/simulation/mapPersistence.ts`
  - serialization and restoration of chunks, structures, and foundries

Current responsibilities:

- player join, disconnect, reconnect flow
- active map runtime state
- movement and projectile simulation
- mining and support actions driven by installed module capabilities
- persistent terrain destruction and chunk restoration
- loot and salvage pickup
- ship builder interaction, ship construction timers, module crafting, and module install/remove
- foundry-driven enemy spawning and foundry destruction rewards
- map transitions between the starter and deeper map
- deeper-map progression gate based on root foundry destruction

## Packages

### `packages/shared`

Canonical shared domain contracts used by both client and server.

Key files:

- `packages/shared/src/ids.ts`
  - branded ID types
- `packages/shared/src/math.ts`
  - vector helpers and math utilities
- `packages/shared/src/resources.ts`
  - resource map helpers
- `packages/shared/src/content.ts`
  - shared content definition types and module capability metadata
- `packages/shared/src/persistence.ts`
  - persistence-safe save models for players, maps, structures, and foundries
- `packages/shared/src/world.ts`
  - active runtime state shapes
- `packages/shared/src/network.ts`
  - client/server message schemas and snapshot payloads

Use this package whenever adding:

- new replicated state
- new message types
- new persistent save fields
- shared enums or identifiers

### `packages/content`

Data-driven starter content.

Key files:

- `packages/content/src/hulls.ts`
- `packages/content/src/modules.ts`
- `packages/content/src/enemies.ts`
- `packages/content/src/resources.ts`
- `packages/content/src/structures.ts`
- `packages/content/src/index.ts`

Current contents:

- starter hulls
- starter modules with explicit capabilities
- weapon definition data
- enemy definitions
- resource definitions
- structure definitions

Purpose:

- keep game content separate from runtime logic
- allow future balancing/content iteration without rewriting simulation code

### `packages/persistence`

Persistence abstraction layer.

Key files:

- `packages/persistence/src/ports.ts`
  - repository interfaces
- `packages/persistence/src/memory.ts`
  - in-memory development/test adapter
- `packages/persistence/src/postgres.ts`
  - Postgres-oriented adapter and schema SQL

Current repository boundaries:

- `PlayerRepository`
- `WorldRepository`
- `MapRepository`
- `StructureRepository`
- `ShipRepository`

Purpose:

- keep gameplay systems independent from storage implementation details

## Current Gameplay/Data Flow

### Connection flow

1. Client opens a WebSocket connection.
2. Client sends `joinWorld`.
3. Server loads or creates player save data.
4. Server creates the runtime ship entity from the saved active ship.
5. Server starts sending snapshots.

### Simulation flow

1. Client sends input and action messages.
2. Server validates/parses messages with shared schemas.
3. Server mutates authoritative runtime state.
4. Server periodically broadcasts snapshots to connected clients.
5. Client redraws from snapshot state.

### Terrain persistence flow

1. Mining module activation targets terrain.
2. Server converts world position to chunk/cell coordinates.
3. Target cell is cleared.
4. Chunk changes are saved through `MapRepository`.
5. On world initialization, saved chunk and map state are reapplied.

### Builder/module flow

1. Player interacts with builder site.
2. Server returns builder state containing:
   - active ship id
   - ship timer state
   - crafted module inventory
3. Player can:
   - craft modules
   - start a ship build
   - swap ready ships
   - install a module to a hardpoint
   - remove a module from a hardpoint
4. Server persists those changes and syncs runtime ship state if needed.

### Foundry/objective flow

1. Root foundry periodically spawns enemies up to a local cap.
2. Players fight spawned enemies and attack the foundry.
3. When the foundry is destroyed, it drops rewards and stops producing pressure.
4. The deeper path becomes available once the root foundry objective is cleared.

## Tests

Current tests cover:

- shared network schema behavior
- content smoke validation
- persistence save/load behavior
- server gameplay flows including:
  - spawning
  - mining tool gating and terrain persistence reload
  - ship build timers and support activation
  - foundry spawning/destruction and path unlock
  - reconnect persistence for runtime map/objective state

Main test files:

- `packages/shared/src/network.test.ts`
- `packages/content/src/content.test.ts`
- `packages/persistence/src/persistence.test.ts`
- `apps/server/src/simulation/gameWorld.test.ts`

## How To Run

Install dependencies:

```powershell
npm install
```

Run tests:

```powershell
npm test
```

Build the workspace:

```powershell
npm run build
```

Run the server:

```powershell
npm run dev:server
```

Run the client:

```powershell
npm run dev:client
```

Open:

- `http://localhost:5173`

## Recommended Next Refactor Targets

- improve target selection for support tools beyond the current self-target-first flow
- tighten foundry progression and objective messaging in the client
- break remaining orchestration logic out of `gameWorld.ts` where it still coordinates multiple subsystems directly
- expand persistence from prototype full-chunk serialization toward more selective chunk diff storage
- migrate networking/runtime orchestration to Colyseus later if desired

## Working Notes For Future Agents

- treat `packages/shared` as the source of truth for cross-boundary contracts
- treat `packages/content` as data, not gameplay logic
- prefer extending repository interfaces in `packages/persistence` before coupling systems to storage details
- avoid putting authoritative rules in the client
- if changing builder flow, update server logic, shared contracts, client rendering, and tests together
- if changing terrain/chunk formats, update both persistence restoration and snapshot rendering paths
- if changing tool behavior, update module capability definitions in content at the same time as server action handling
- if changing foundry/objective behavior, update persistence serialization and client HUD/objective presentation together
