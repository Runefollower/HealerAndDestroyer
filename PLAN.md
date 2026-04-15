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

15. Spatial slice acceptance hardening
- server-side acceptance coverage now exercises the full root-to-depth spatial loop in one flow
- the acceptance scenario covers collision, mining, salvage creation, terrain memory, LOS cover, enemy idle behavior behind cover, foundry destruction, deeper-path unlock, map transition placement, and reconnect persistence
- the test suite now confirms the prototype's individual spatial systems work together as a coherent playable slice rather than only as isolated mechanics

16. First procedural cave generation pass
- server world creation now builds the root and deeper maps from deterministic seed-driven cave layouts instead of the tiny hand-authored terrain templates
- the root map is now much larger than the initial prototype layout, with generated rooms, corridors, mineable wall pockets, and required gameplay anchors
- generated placement now provides deterministic spawn, builder site, foundry, enemy, and map-connection anchor positions while preserving stable map ids and persistence contracts
- tests cover deterministic output, seed variation, connected required anchors, and mineable solid terrain near generated open space

17. Generated-map client performance hardening
- the first larger generated maps exposed client-side render pressure that did not show up on the tiny hand-authored map
- the renderer now destroys old snapshot display objects instead of only removing them from the Pixi world layer
- hidden fog no longer draws a rectangle for every unseen tile; the dark background represents unexplored space while remembered fog still renders where needed
- snapshot rendering now receives the camera viewport and culls off-screen terrain, entities, fog, and transient effects with padding

18. Terrain material definitions and behavior centralization
- terrain cell ids, solidity, break damage, debris resources, and client render styling now live in one shared material registry
- server terrain mining/destruction, collision, visibility, map generation, and client rendering now read terrain behavior from shared helpers instead of duplicating `0`, `1`, and `2` material assumptions
- current active generated materials are open space, common rock, ferrite ore, plasma crystal veins, ancient stone, and rare unstable crystal
- tests now cover the shared terrain material registry and map generation uses named material constants

19. Ship design workstation
- the builder-site popup now supports new-ship design and existing-ship refit modes
- players can cycle hulls/ships, cycle hardpoint mounts, cycle compatible modules, preview costs/stats, and submit a complete loadout
- server validation accepts `submitShipDesign`, rejects invalid mounts/resources, persists the resulting stable ship design, and syncs active refits into runtime immediately
- tests cover new ship design, active refit behavior, and invalid hardpoint/module submissions

## Summary

The next phase should turn the current procedural cave prototype into a more content-ready exploration loop. The multiplayer slice now has builder flow, module-gated actions, foundry pressure, deeper-path unlocks, persistence, terrain sprites, entity sprites, authoritative collision, projectile-driven terrain destruction, shatter feedback, a player-centered camera, first-pass visibility, terrain memory, spatial-slice acceptance coverage, larger generated root/deeper maps, first-pass client viewport culling, and centralized terrain material definitions. The next major unlock is using those foundations to make exploration, materials, objectives, and ship progression less placeholder-like and closer to the design document.

The priority for the next phase is:

1. expand the terrain/material economy from ferrite/plasma placeholders toward the GDD's rock/ore resource model
2. harden procedural generation with validation, explicit map archetypes, safer placement, and better resource/encounter distribution
3. start the persistent world-graph expansion path so discovered connections can generate and persist additional finite maps beyond the fixed root/deeper pair
4. add encounter and objective variety around enemy infrastructure, defensive pockets, and foundry-adjacent pressure
5. grow ship and module content into concrete archetype data for healer, destroyer, miner, and heavy progression
6. add exploration information tools such as minimap/fog summaries or scanner-style discovery only after the world/resource loop has enough content to reveal
7. continue client performance hardening only where playtesting shows spikes, with chunk/display caching as the next rendering optimization if viewport culling is not enough

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
- the collision helper should remain the validation path for future procedural spawn, structure, and connection placement

### 2.5 Weapon presentation and firing readability

Status: first pass complete.

- primary weapon fire now originates from the mounted forward weapon hardpoint rather than the ship center
- the current pulse cannon now fires straight along ship facing instead of steering toward the mouse cursor
- the client now renders animated projectile pulses so weapon fire is visually legible during movement and combat
- primary fire is now mapped to `Space`, with support/repair moved off that key to keep the weapon loop comfortable

Important implementation notes:

- this pass improves readability and mount logic; projectile-vs-terrain collision and terrain impact feedback are now covered by the later projectile terrain destruction pass
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

Status: first acceptance pass complete.

- validate that terrain variants remain stable across reconnects and reloads
- validate that collision prevents illegal positions after reconnect and map transitions
- validate that explored-memory state behaves consistently when leaving and re-entering an area
- expand acceptance coverage so the world feels spatially believable, not just mechanically connected
- keep adding focused acceptance cases when new spatial systems change map topology or placement rules

Important implementation notes:

- the current acceptance test deliberately uses the server `GameWorld` API rather than the WebSocket layer, keeping the flow deterministic and fast
- the flow now covers mining, LOS cover, foundry unlock, deeper-map transition, and reconnect persistence together
- future acceptance work should validate generated maps at the map-generator boundary and at the gameplay-flow boundary

### 5. Procedural map generation

Status: first pass complete; hardening and tuning next.

- the current implementation replaces the tiny hand-shaped starter/deeper terrain templates with deterministic seed-driven cave generation
- generated cave terrain now provides larger rooms, corridors, mineable wall pockets, and required objective spaces
- generate or validate safe placement for:
  - player spawn points
  - builder sites
  - foundries and enemy pressure zones
  - map connection anchors
  - resource-rich terrain pockets
  - enemy starter positions
- preserve current persistence behavior by treating generated maps as the baseline state and persisted chunk/structure/foundry records as deltas over that baseline
- keep generated map output compatible with the existing tile grid, collision helper, visibility service, terrain art variant selection, and snapshot shape

First implementation target:

- add a small deterministic generation module under the server simulation layer: complete
- start with a seeded cave generator that carves rooms/corridors into chunk cell arrays: complete
- guarantee a connected walkable path from player spawn to builder site, foundry objective, and route connection: complete for the first pass
- place terrain/resource cells with tunable density while leaving enough open navigation space for ship collision radii: first pass complete
- generate the root map and deeper map from their existing map seeds while keeping the current ids stable: complete
- add tests for deterministic output, required placement validity, route connectivity, and persistence reload over generated baseline maps: generation tests complete; persistence-over-generated-baseline should continue through world tests and future acceptance cases

Next implementation target:

- add generator validation helpers that can fail fast when a generated map lacks required connectivity or safe placement
- tune generated layout shape so spawned foundry pressure, cover, and mining pockets are less uniform
- consider multiple map archetypes, such as starter-safe caves, foundry arenas, and deeper resource caverns
- expose generation parameters per biome/map summary instead of hard-coding root/deeper chunk sizes in world creation
- add persistence-specific tests that mutate generated terrain/foundries, reload over the same generated baseline, and verify the deltas still apply cleanly

### 6. Larger-map client rendering performance

Status: first hardening pass complete; monitor during playtesting.

- the first generated-map playtest exposed two client renderer issues:
  - old Pixi display objects were removed from the world layer without being destroyed
  - the fog overlay generated too much geometry for unseen tiles on larger maps
- the renderer now destroys removed snapshot children while preserving shared textures
- hidden/unexplored space now relies on the game background instead of per-tile fog rectangles
- remembered fog, terrain, entities, projectile effects, and terrain bursts are culled to the padded camera viewport
- snapshot handling now updates the camera before rendering so culling uses the correct world-space viewport

Next implementation target, only if playtesting still shows periodic drops:

- cache static terrain chunks as display containers instead of rebuilding terrain sprites every snapshot
- invalidate cached chunks only when terrain cells or visibility memory for that chunk changes
- keep dynamic entities, projectiles, labels, and transient effects on lightweight separate layers
- consider reducing server snapshot rate or decoupling static terrain redraw frequency from dynamic entity updates if spikes persist

### 7. Terrain material and resource economy expansion

Status: first resource expansion complete; tuning and content use next.

- the current code now has a single shared source of truth for terrain cell ids, solidity, break damage, drops, and render treatment
- the GDD calls for common environment blocks, specialized ore blocks, weapon-vs-mining extraction differences, and early/advanced resource tiers
- the first pass now has rock, stone, ferrite, and plasma-crystal resources tied to clear terrain materials
- unstable crystal remains a rare generated block that detonates and destroys nearby terrain when broken

Completed implementation target:

- decide the first playable resource set, likely starting with a small subset of the GDD list rather than all proposed materials at once: complete
- map terrain materials to concrete drops such as common rock/ferrite plus at least one or two ore types: complete
- update module and hull costs so the new materials have immediate gameplay purpose: first pass complete
- keep weapon destruction viable but less efficient than mining modules through existing `yieldMultiplier` rules: complete
- add generation controls for ore rarity, pocket size, and map/archetype-specific resource distribution: first pass complete
- add tests for each material's break damage, debris resources, and generated-map distribution expectations: first pass complete

Next implementation target:

- tune ore rarity and resource pacing through playtesting
- add resource-specific UI/readability improvements for rock, stone, ferrite, and plasma drops
- connect rarer materials to broader hull/module progression as the content catalog expands

### 8. Procedural generation hardening and world graph expansion

Status: root/deeper generated maps complete; validation, archetypes, and discovery-based expansion next.

- the GDD recommends a graph of finite persistent cave maps, with each map carrying its own seed, layout, objectives, persistence state, and saved connections
- the prototype currently has a fixed root map and fixed deeper map generated from stable seeds
- the next generation pass should make maps more robust and provide hooks for future on-demand discovery

Next implementation target:

- add generator validation helpers that fail fast when required anchors are disconnected, crowded, or colliding
- introduce explicit generation parameter objects for starter-safe caves, foundry arenas, resource caverns, and tunnel networks
- move hard-coded root/deeper generation settings into map summaries or generation config data
- prepare connection records so undiscovered exits can reserve a destination seed and generate a persistent map when first used
- add tests for generated safe placement, minimum navigable widths, resource distribution, and persistence deltas applied over a generated baseline

### 9. Encounter, objective, and enemy infrastructure growth

Status: foundry objective first pass complete; variety and infrastructure behavior next.

- the current foundry loop proves the basic objective gate: destroy a structure, reduce pressure, unlock the deeper path
- the GDD calls for enemy fortification pockets, default defense rebuilding, richer enemy roles, and objective escalation
- this should come after generation validation so encounters can be placed in reliable spaces

Next implementation target:

- add at least one additional enemy role beyond the current scout/sentry behavior, such as a defender, repair drone, or burrower
- create generated enemy fortification pockets around foundries and resource vaults
- prototype slow defense rebuilding while an enemy production structure is active, stopping rebuilds when the foundry is destroyed
- add objective feedback for reduced enemy pressure and newly safer routes
- add acceptance coverage for fortification placement, foundry pressure, and post-destruction state

### 10. Ship design workstation and module content progression

Status: ship design workstation complete; content breadth next.

- the GDD's immediate next steps call for turning hulls and module families into concrete data tables with costs, weights, power use, health, and build times
- the current prototype has enough builder and module plumbing that adding new archetype content should now produce visible gameplay differences
- the builder flow now includes a clearer ship-design screen where players choose a hull and place weapons/modules onto the hull's available mount points
- ship creation and modification should happen at valid ship-building locations; if we keep calling this interaction a foundry in gameplay, it should remain distinct in code/design from enemy production foundries

Completed implementation target:

- design a dedicated ship-configuration screen with hull selection, current stable ships, selected hull preview, mount-point list, and available module inventory: complete
- show each hull's hardpoints/mount points with type and orientation, then allow compatible weapons, mining tools, support tools, engines, and other modules to be assigned to those points: complete
- validate mount compatibility, resource costs, power use, mass, hardpoint occupancy, and build timing before the server accepts a design: complete
- preview the resulting ship stats and role tradeoffs before the player commits: complete for first pass
- persist the resulting ship design as the stored ship record and replicate the active design to the world renderer so visible hull/module parts match the chosen loadout: complete
- modifying an existing ship is instant at the ship-building location for the current pass

Next implementation target:

- add or tune first-pass hull/module data for the scout, healer, destroyer, miner, and heavy directions without over-expanding the roster
- make material costs align with the new terrain/resource economy so exploration feeds ship choices
- add tests for content validity, build costs, mount compatibility, module install rules, saved ship design persistence, and active-ship behavior across the expanded catalog

### 11. Exploration information and player-facing map tools

Status: server-side line of sight and terrain memory complete; minimap/sensors not started.

- the GDD recommends fog-of-war minimap memory, scanner pings, and sensor modules for structure/salvage detection
- this should follow the resource/generation pass so there is meaningful hidden information to reveal

Next implementation target:

- add a small minimap or exploration summary that distinguishes unknown, remembered, and currently visible terrain
- prototype a scanner ping action or sensor module that reveals nearby structure, salvage, or connection hints
- keep enemy movement hidden in unexplored fog unless a sensor rule explicitly reveals it
- add tests for sensor visibility rules and remembered-map state persistence

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
- procedural map generation:
  - same seed produces the same terrain, structures, foundries, and connection anchors
  - different seeds produce meaningfully different layouts
  - generated player spawn, builder site, foundry, enemy spawns, and route anchors are non-colliding
  - generated root maps include a connected traversable path from spawn to builder, foundry, and deeper-route anchor
  - generated maps include enough solid terrain for mining and LOS cover without blocking required progression
  - persisted terrain edits, foundry destruction, and player spawn/map state restore correctly over a generated baseline
- terrain material and resource economy:
  - each terrain material defines its cell id, solidity, break damage, debris resources, and render treatment in the shared registry
  - generated ore distribution stays within expected rarity/density bounds for the selected map archetype
  - mining modules and weapon destruction produce the intended relative yields from the same material
  - hull/module costs remain valid after resource additions and cannot reference undefined resources
- ship design workstation:
  - the ship-building screen lists available hulls and shows the selected hull's mount points
  - compatible weapons/modules can be assigned to open hardpoints while incompatible modules are rejected with clear feedback
  - committed ship designs persist into the stable, can become the active ship, and render with the selected hull/module parts
  - server validation rejects invalid mount occupancy, missing resources, invalid hardpoint types, and stale design submissions
- world graph and discovery:
  - an undiscovered connection can reserve or generate a deterministic destination map
  - returning through a known connection reloads the same persistent destination rather than creating a duplicate map
  - terrain edits, foundry state, and player map position persist across generated map transitions
- encounter and progression expansion:
  - enemy fortification pockets spawn in valid generated spaces without blocking required routes
  - foundry destruction reduces local pressure and stops any first-pass defense rebuilding behavior
  - expanded hull/module data validates costs, hardpoints, power use, and build timers

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
- procedural generation should be deterministic and seed-driven before it becomes highly varied or content-rich
- generated maps can start small and conservative; reliability, connectedness, and valid placement matter more than visual novelty in the first pass
- resource expansion should start with a small useful material set before adding every GDD-proposed resource tier
- discovery-based map generation should preserve deterministic seeds and persisted deltas before adding deep biome variety
