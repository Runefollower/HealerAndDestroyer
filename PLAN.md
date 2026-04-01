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

9. Terrain sprite pipeline and first-pass rock art
- client terrain rendering now uses sprite assets instead of flat primitive rock cells
- shared terrain art selection derives deterministic `1-64` tile variants from stable map and cell inputs
- first-pass rock terrain assets now exist as generated PNG clusters with slight tile overlap for more natural silhouettes
- terrain textures preload on the client and terrain preview tooling exists for fast art iteration
- tests cover stable terrain variant selection and the asset flow now builds cleanly through the normal client pipeline

10. Entity sprite support for ships, NPCs, structures, and salvage
- player ships now render from modular hull, engine, and weapon sprite parts that are ready for builder-driven assembly
- enemy ships now render as sprite assets and face their actual travel direction in the client
- foundries, builder sites, and salvage markers now render through keyed sprite assets instead of primitive placeholders
- client asset loading now includes a lightweight world-entity registry with visible fallbacks for missing sprite keys
- the current readability pass keeps labels and hull-state overlays where useful while moving the world view onto sprite-backed presentation

11. Authoritative collision and first-pass weapon readability
- ships now collide authoritatively with solid terrain, foundries, builder sites, and simple ship/enemy bodies on the server
- player connect, enemy spawn, and map transitions now resolve to valid non-colliding positions instead of trusting raw anchors
- client projectile rendering now shows animated pulse shots instead of invisible weapon fire
- the current pulse cannon now fires from the forward weapon mount along ship facing, and the primary fire control is mapped to `Space`
- tests now cover collision constraints plus forward-mounted projectile spawning and travel direction

## Summary

The next phase should continue shifting from proving core loop structure to making the game readable, navigable, and spatially coherent. The multiplayer slice now has builder flow, module-gated actions, foundry pressure, deeper-path unlocks, persistence, terrain sprites, entity sprites, authoritative collision, and first-pass projectile readability working well enough that the biggest missing pieces are movement feel, visibility-driven world readability, and follow-up combat/environment interaction polish.

The priority for the next phase is:

1. visibility, line-of-sight, and player memory of explored terrain
2. projectile-vs-terrain collision plus impact feedback that builds on the new collision rules
3. acceptance-test expansion around these spatial systems
4. follow-up terrain and entity readability polish only if issues remain after visibility and combat readability land

## Key Changes

### 1. Sprite support for ships, NPCs, foundries, and structures (completed baseline)

Status: complete for the first readability pass.

- player ships are now off primitive graphics and onto modular sprite assets
- sprite rendering now exists for at least:
  - player ship hulls
  - enemy ships/NPCs
  - foundries
  - builder site structures
  - pickups or salvage markers if needed for readability
- preserve gameplay-facing readability over visual complexity, especially for hull state, allegiance, and interactable structures
- keep the render system ready for later animation, but do not block this phase on full animation support

Important implementation notes:

- a lightweight client asset registry now exists for player hull parts, enemy types, structure types, salvage markers, and terrain tile art ids
- missing assets still fail visibly without crashing the client
- asset keys continue to align with shared/content ids where practical, which should remain the rule for future additions

### 2. Authoritative collision and movement constraints

Status: complete for the first gameplay pass.

- ships now stop against solid terrain instead of passing through mined and unmined rock cells
- ships now stop against major structures such as foundries and builder sites
- simple ship and enemy body separation now exists to avoid the worst overlap cases in the current phase
- collision remains authoritative on the server, with clients following replicated results
- player connect, enemy spawn, and map transitions now resolve onto valid non-colliding positions

Important implementation notes:

- the current pass uses simple collision shapes:
  - terrain tiles as solid grid cells
  - structures/foundries as circles
  - ships and enemies as simple radii
- movement resolution currently favors stable blocked-axis behavior over full physical sliding
- the collision helper now provides a reuse point for the next projectile-vs-terrain and impact pass

### 2.5 Weapon presentation and firing readability

Status: first pass complete, follow-up still needed.

- primary weapon fire now originates from the mounted forward weapon hardpoint rather than the ship center
- the current pulse cannon now fires straight along ship facing instead of steering toward the mouse cursor
- the client now renders animated projectile pulses so weapon fire is visually legible during movement and combat
- primary fire is now mapped to `Space`, with support/repair moved off that key to keep the weapon loop comfortable

Important implementation notes:

- this pass improves readability and mount logic only; projectile-vs-terrain collision and impact flashes still belong to the next follow-up
- future multi-weapon hulls should keep using hardpoint-local origin and orientation as the firing source of truth

### 3. Visibility, line of sight, and terrain memory

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

### 4. Persistence and acceptance hardening for spatial systems

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
- forward-mounted weapons spawn projectiles from the correct hardpoint and fire along ship facing
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

Optional terrain-art follow-up checks, only if later phases reveal a need:

- terrain clusters remain readable when mixed with ship, pickup, and structure sprites
- tile overlap does not create distracting seams or ambiguity at chokepoints
- future biome or terrain-set expansion can reuse the current variant selection and preview workflow cleanly

## Assumptions

- the next phase stays on the current `ws` runtime; Colyseus is still deferred
- we are not starting full animation, particle polish, or high-end rendering yet; the goal is clear sprite-based readability first
- terrain art starts with the current rock terrain before expanding to multiple biomes
- collision is implemented as gameplay-first deterministic constraints, not full rigid-body physics
- fog-of-war style memory can begin with the main playfield before any dedicated minimap/exploration UI is expanded
