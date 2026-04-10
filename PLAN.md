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

12. Player-centered camera follow pass
- the local player now stays centered on screen while the world scrolls underneath the ship
- screen-to-world targeting now converts pointer input through the camera transform so mining still aims at the correct world location
- the moment-to-moment view now reads more like a moving ship through space instead of a ship sliding across a static board

13. Projectile terrain destruction and shatter feedback
- projectiles now collide with solid terrain authoritatively instead of tunneling through cave walls
- critical projectile impacts now destroy terrain cells, persist the terrain edit, and leave salvage debris behind
- terrain occupied by active major structures is treated as structure space so foundries remain hittable where they are placed
- the client now shows a visible burst when terrain disappears so mining and weapon destruction both read clearly on screen
- tests now cover projectile terrain impact, terrain destruction, debris spawning, and persistence after reload

14. Visibility, line of sight, and terrain memory
- per-player snapshots now filter terrain and entities through server-side line of sight
- players retain remembered terrain per map, with out-of-sight terrain shown as greyed memory instead of updating live
- enemy perception now reuses the same LOS helper so NPCs stop aggroing through cave walls
- only terrain blocks first-pass visibility; large structures and foundries remain visible objects rather than acting as opaque occluders
- tests now cover blocked LOS, remembered terrain persistence, reconnect behavior, and nearby structure visibility

## Summary

The next phase should continue shifting from proving core loop structure to making the game readable, navigable, and spatially coherent. The multiplayer slice now has builder flow, module-gated actions, foundry pressure, deeper-path unlocks, persistence, terrain sprites, entity sprites, authoritative collision, projectile-driven terrain destruction, shatter feedback, a player-centered camera, and first-pass visibility working well enough that the biggest remaining gaps are acceptance hardening, follow-up readability polish, and combat interactions that better exploit terrain and cover.

The priority for the next phase is:

1. persistence and acceptance hardening around visibility, reconnect, and broader spatial flows
2. follow-up terrain and combat readability polish only where playtesting still shows issues
3. next-step combat interactions that build on the new terrain destruction and line-of-sight rules

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

### 2.75 Player-centered camera follow

Status: first pass complete.

- the local player now remains centered on screen while terrain, structures, enemies, and projectiles move relative to the ship
- world-space pointer targeting now resolves through the camera transform so utility actions still target the intended terrain location
- this camera pass improves navigation readability without changing the authoritative gameplay state

Important implementation notes:

- the current follow camera is a direct lock to the local player position with no smoothing yet
- if later playtesting reveals a need, camera look-ahead, damping, or screen-edge composition can be layered on top without changing the world simulation

### 2.9 Projectile terrain destruction and impact feedback

Status: first pass complete.

- projectiles now stop on solid terrain instead of flying through intact rock
- critical projectile impacts now destroy terrain cells, persist the terrain edit, and drop debris into the existing salvage system
- the client now renders a visible terrain burst when a tile disappears so mining and weapon-driven destruction are easy to read
- active structures and foundries continue to take projectile hits even when their footprint overlaps generated terrain

Important implementation notes:

- the current destruction rule is threshold-based per terrain cell type rather than a long-lived per-tile health simulation
- the impact burst is currently inferred from terrain cells disappearing between snapshots, which keeps the client lightweight and works for both mining and weapon destruction

### 3. Visibility, line of sight, and terrain memory

Status: first pass complete.

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
- visibility should be computed in realtime from the observer's current tile rather than precomputed for every map location
- use one shared server-side visibility service for both player disclosure and NPC perception, while allowing player and NPC rules to differ
- first implementation target:
  - tile-based line of sight using grid-aware ray checks over a bounded vision radius
  - lightweight caching keyed by observer tile and map visibility revision, rather than a full precomputed lookup table
  - player snapshots filtered on the server for currently visible entities and terrain
  - player terrain memory stored per map as last-seen chunk cell state so out-of-sight terrain stays stable
  - NPC perception reuses the same LOS helper but can apply its own radius and future cone or alert rules
- choose a line-of-sight approach that fits the tile grid and current scope, starting with bounded ray sampling and leaving shadowcasting as an optimization path if needed
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
- critical projectile hits destroy terrain, spawn debris, and persist after reload
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

