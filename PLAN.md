# Healer and Destroyer Next-Step Plan

## Completed Steps

The following major milestones are already implemented in the current prototype and should be treated as completed baseline work for future planning:

1. Initial monorepo and shared contract scaffold
- `apps/client`, `apps/server`, `packages/shared`, `packages/content`, and `packages/persistence` are in place
- shared network, content, persistence, and world-state contracts are established
- client/server build and test flow is working from the repo root

2. Authoritative multiplayer vertical-slice foundation
- `ws`-based server runtime is active
- player join, disconnect, reconnect, snapshots, and server tick loop are implemented
- one starter map plus one connected deeper map exist in the world graph

3. Persistent terrain and builder-state foundation
- destructible terrain edits persist across reloads
- builder site interaction, ship stable state, crafted module inventory, and install/remove module flow exist
- builder state syncs between runtime and persistence cleanly enough for ongoing iteration

4. Ship build timers and builder UX
- ship builds track `building`, `ready`, and `active` states
- ship completion is processed during server tick and surfaced to the client
- builder UI supports build timers, completion feedback, stable sections, and open/close behavior tied to builder range and `E` toggling

5. Module-gated gameplay actions
- weapon fire remains separate from module activation
- mining requires a mining-capable installed module
- support/repair requires a support-capable installed module
- crafted modules, hardpoint installs, and active-ship module usage are all wired into gameplay state

6. Foundry-driven objective loop
- root-map foundry acts as an objective structure with health, spawn cadence, and enemy cap behavior
- destroying the root foundry unlocks the deeper path
- foundry state persists across reloads and reconnects

7. Step 2 and 3 hardening pass
- client now surfaces module/action rejection feedback instead of failing silently
- client supports explicit module-slot selection for weapon, mining, and support roles
- HUD now communicates objective and foundry state more clearly
- tests cover locked-route feedback, foundry unlock flow, and module-action rejection cases

8. Logging and debugging support
- server logging supports `normal`, `verbose`, and `very-verbose`
- startup logs include configured and resolved log level
- resource pickup, ship-build success/failure, connection lifecycle, and inventory sync diagnostics are logged

## Summary

The next phase should shift from proving core loop structure to making the game readable, navigable, and spatially coherent. The current multiplayer slice now has builder flow, module-gated actions, foundry pressure, deeper-path unlocks, and persistence working well enough that the biggest missing pieces are presentation and world readability.

The priority for the next phase is:

1. sprite-based world rendering, starting with terrain
2. ship, NPC, foundry, and structure sprite support
3. authoritative collision and movement constraints
4. visibility, line-of-sight, and player memory of explored terrain
5. acceptance-test expansion around these spatial systems

## Key Changes

### 1. Terrain sprite pipeline and visual variety

- replace the current flat rendered rock tiles with sprite-based terrain rendering on the client
- generate or source approximately 64 terrain-rock variations for the current solid terrain type
- during map generation, assign each solid terrain cell a stable sprite variant from `1-64` so the map looks naturally varied instead of repeated
- keep the terrain variant assignment deterministic so reconnects and re-renders show the same rock layout for the same persisted terrain state
- preserve support for mined/destructible terrain, meaning the sprite disappears or changes correctly when a tile is removed

Important implementation notes:

- introduce a terrain asset manifest and loading path in the client
- expand chunk/tile state only as much as needed to support stable variant selection
- prefer deterministic variant selection from tile coordinates plus map seed unless persisted overrides are needed
- keep the first pass limited to the current rock terrain; do not introduce multiple biome art sets yet unless the pipeline makes that trivial

### 2. Sprite support for ships, NPCs, foundries, and structures

- move player ships off primitive graphics and onto sprite assets
- add sprite rendering for at least:
  - player ship hulls
  - enemy ships/NPCs
  - foundries
  - builder site structures
  - pickups or salvage markers if needed for readability
- preserve gameplay-facing readability over visual complexity, especially for hull state, allegiance, and interactable structures
- keep the render system ready for later animation, but do not block this phase on full animation support

Important implementation notes:

- define a lightweight client asset registry keyed by hull id, enemy type id, structure type id, and terrain tile art id
- keep a fallback path so missing assets fail visibly but do not crash the client
- avoid baking gameplay meaning into ad hoc client-only names; asset keys should align with shared/content ids where practical

### 3. Authoritative collision and movement constraints

- prevent ships from moving through solid terrain
- prevent ships from overlapping major structures such as foundries and builder sites
- prevent unrealistic overlap with other ships if that can be done simply in this phase
- keep collision authoritative on the server, with the client following replicated resolution rather than inventing its own truth
- update mining, navigation, and combat expectations so terrain actually matters as navigable space

Important implementation notes:

- start with simple collision shapes:
  - terrain tiles as solid grid cells
  - structures/foundries as circles or AABBs
  - ships as circles or simple radii
- prefer a stable and predictable collision response over a highly physical one
- if full sliding movement is too much for the first pass, snapping or blocked-axis movement is acceptable as long as it feels consistent
- add hooks so later weapon/projectile collision with terrain can reuse the same solidity rules

### 4. Visibility, line of sight, and terrain memory

- players should not see through solid terrain
- each player should only have live vision within a local visual radius and unobstructed line of sight
- players should retain a memory of terrain they have already seen
- remembered terrain should remain visible but greyed out when it is outside current vision
- remembered terrain should not update while out of sight; it only refreshes when the player regains vision on that area
- the first pass can focus on terrain memory and coarse enemy/structure visibility rather than fully nuanced stealth systems

Important implementation notes:

- keep the authoritative visibility model on the server if possible, especially for hidden active entities
- if server-side terrain memory replication is too expensive for the first pass, a hybrid approach is acceptable:
  - server controls current visibility and entity disclosure
  - client stores remembered terrain based on previously visible chunk/tile data
- choose a line-of-sight approach that fits the tile grid and current scope, such as ray sampling or flood-fill with occlusion
- the HUD/minimap should eventually reflect explored-vs-currently-visible state, but the main world view is the first target

### 5. Persistence and acceptance hardening for spatial systems

- validate that terrain variants remain stable across reconnects and reloads
- validate that collision prevents illegal positions after reconnect and map transitions
- validate that explored-memory state behaves consistently when leaving and re-entering an area
- expand acceptance coverage so the world feels spatially believable, not just mechanically connected

## Test Plan

Add or update automated scenarios for:

- terrain cells derive stable sprite variants from deterministic inputs
- mined terrain removes or updates its rendered tile correctly after sync/reconnect
- ships cannot move through solid terrain
- ships cannot overlap foundries or builder sites
- map transitions place the player in valid non-colliding positions
- visibility hides terrain behind walls until line of sight is established
- explored terrain remains visible in memory as greyed-out state when outside current vision
- explored terrain memory does not update while the area is out of sight
- reconnect preserves the intended terrain/visibility presentation state for the current implementation approach
- full spatial slice flow:
  - join world
  - navigate through terrain corridors
  - mine reachable ore
  - use cover around terrain
  - destroy the root foundry
  - unlock and enter the deeper route
  - reconnect without losing stable terrain presentation

## Assumptions

- the next phase stays on the current `ws` runtime; Colyseus is still deferred
- we are not starting full animation, particle polish, or high-end rendering yet; the goal is clear sprite-based readability first
- terrain art starts with the current rock terrain before expanding to multiple biomes
- collision is implemented as gameplay-first deterministic constraints, not full rigid-body physics
- fog-of-war style memory can begin with the main playfield before any dedicated minimap/exploration UI is expanded
