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

20. Procedural generation validation and map archetypes
- generated maps are validated for anchor clearance, spacing, ship-sized reachability, volatile placement, and minimum materials, and generation throws on failure
- named archetype configs (starter cavern, deep cavern, foundry arena, resource cavern, tunnel network) replace hard-coded generator constants and root/deeper settings
- ore and unstable crystals can no longer block corridors, and minimum resource counts are guaranteed per archetype

21. Client leak fix and server robustness
- per-frame Pixi `Graphics` are destroyed with `context: true`; without it Pixi v8 kept every GraphicsContext until its idle GC and the client heap grew about 7MB/s
- malformed client messages are rejected instead of crashing the server; tick and snapshot loops are guarded and overlapping async ticks are skipped
- the client reconnects with backoff and shows a connection banner; the newest socket wins for a duplicate player id

22. Generated art pipeline
- terrain materials (rock, ferrite, plasma crystal, ancient stone, unstable crystal) are cut from FLUX textures generated through fal (`npm run generate:terrain`)
- player hull parts, enemies, structures, and salvage are FLUX sprites with background removal (`npm run generate:sprites`); `npm run generate:fal` generates new source images

23. Fixed-rate input, prediction, and wall-clock motion
- the client samples input at the 30 Hz tick rate with sequence numbers; the server applies one queued input per tick and echoes the last applied input, and the client replays unacknowledged inputs (fixes rotation snap-back)
- snapshots carry projectile and enemy velocity; entities are placed by server tick mapped onto the local clock, and remote corrections blend out over about 80 ms

24. Fog-of-war minimap (§11 first pass)
- top-right canvas minimap built only from the visibility-filtered snapshot; `M` cycles local, sector, and hidden views; exits are drawn once seen

25. Discovery-based world graph (§8)
- every map has an undiscovered deeper exit that reserves its destination seed and archetype; the first trip through generates and persists `map-depth-<n>`
- snapshots carry exits and the nearby exit; `E` travels, and a map's deeper exit is locked while it has an active foundry

26. Combat consequences and first encounter pass (§9)
- each enemy deals its own `contactDamage` at most once per `attackCooldownMs` (enemy AI moved to `simulation/combat.ts`)
- at 0 hull the ship is destroyed: half the carried cargo plus half the hull and module build cost drop as a wreck reserved for the owner for 60 s; the lost ship leaves the stable and the player respawns at the root spawn in a free Fallback Sparrow with 3 s of damage immunity; ship and enemy deaths emit §12 explosion effects
- enemy roles: melee (drone, sentry), ranged Sentinel that holds range and fires hostile bolts, and stationary defense turrets
- foundries get fortification pockets (turret rings planned clear of exits, spawn, and builder), rebuild one lost turret per interval while standing, produce a per-archetype enemy mix, and drop a depth-scaled reward

## Summary

The next phase should turn the current procedural cave prototype into a more content-ready exploration loop. The multiplayer slice now has builder flow, module-gated actions, foundry pressure, deeper-path unlocks, persistence, terrain sprites, entity sprites, authoritative collision, projectile-driven terrain destruction, shatter feedback, a player-centered camera, first-pass visibility, terrain memory, spatial-slice acceptance coverage, larger generated root/deeper maps, first-pass client viewport culling, and centralized terrain material definitions. The next major unlock is using those foundations to make exploration, materials, objectives, and ship progression less placeholder-like and closer to the design document.

The priority for the next phase is:

Done in this phase: the first resource expansion (§7), generation validation and archetypes (§8), discovery-based world-graph expansion (§8), and the first-pass minimap (§11).

Remaining, in recommended order:

1. ~~make combat consequential~~ and ~~add encounter variety around foundries~~: first pass done (completed step 26); remaining §9 items are listed in §9
2. (folded into 1)
3. grow ship and module content into concrete archetype data for healer, destroyer, miner, and heavy progression, and make mass, power, and thrust affect play (§10)
4. add scanner/sensor discovery tools on top of the minimap (§11)
5. scale the world graph: branching exits, simulating only occupied maps, and wiring durable persistence (§8, Assumptions)
6. cosmetic feedback pass: mining drone swarm, visible mining hardware on ships, drifting debris, and dust/explosion effects (§12)
7. continue client performance hardening only where playtesting shows spikes

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

Next implementation target (validation, archetypes, per-map generation parameters, and reload-over-baseline tests are done; see §8):

- tune generated layout shape so spawned foundry pressure, cover, and mining pockets are less uniform

### 6. Larger-map client rendering performance

Status: first hardening pass complete; monitor during playtesting.

- the first generated-map playtest exposed two client renderer issues:
  - old Pixi display objects were removed from the world layer without being destroyed
  - the fog overlay generated too much geometry for unseen tiles on larger maps
- the renderer now destroys removed snapshot children while preserving shared textures
- hidden/unexplored space now relies on the game background instead of per-tile fog rectangles
- remembered fog, terrain, entities, projectile effects, and terrain bursts are culled to the padded camera viewport
- snapshot handling now updates the camera before rendering so culling uses the correct world-space viewport
- per-frame `Graphics` are destroyed with `context: true` (PR #2); any new per-frame Pixi code must do the same or reuse retained objects
- terrain sprites and player ship displays are already retained between frames and rebuilt only when terrain or the viewport key changes

Next implementation target, only if playtesting still shows periodic drops:

- group the retained terrain sprites into per-chunk containers so a terrain change invalidates one chunk instead of the whole viewport key
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

Status: validation, archetypes, and discovery-based world-graph expansion complete; tuning and richer graph shapes next.

- the GDD recommends a graph of finite persistent cave maps, with each map carrying its own seed, layout, objectives, persistence state, and saved connections
- the world now starts with the fixed root map and fixed deeper map, and grows a chain of generated maps as players push through undiscovered exits
- generation fails fast on bad layouts and is driven by named archetype configs, so new maps are generated from just a seed and archetype id

Completed implementation target:

- generator validation (`mapValidation.ts`) rejects layouts whose anchors are out of bounds, blocked, too close together, unreachable from spawn through ship-sized (3x3 clearance) passages, or near unstable crystals, and checks per-archetype minimum material counts: complete
- explicit generation configs (`mapArchetypes.ts`) for starter cavern, deep cavern, foundry arena, resource cavern, and tunnel network: complete
- root/deeper seeds, sizes, and archetypes moved into `prototypeMaps` config data; map summaries store the archetype id in `biomeId`: complete
- fixed a generator bug where ore pockets and unstable crystals were placed on carved corridor floor, which left many seeds (including the shipped deeper map) without a ship-navigable path from spawn to the foundry and exits; corridor centerlines are now kept clear: complete
- materials are topped up on exposed walls when random placement falls short, so each archetype's minimum resource counts are guaranteed: complete
- tests sweep every archetype across many seeds, cover each validation rule, confirm maps regenerate from their persisted summary, restore persisted chunk edits over a regenerated baseline, and pin root/deeper terrain fingerprints: complete

Completed implementation target (discovery-based expansion):

- every map has one deeper exit at its layout's exit anchor. Until someone uses it, the exit is an undiscovered `MapConnection` that reserves `destinationSeed` (`<world seed>/<connection id>`) and `destinationArchetypeId`, so what lies behind it does not depend on who opens it or when: complete
- the first trip through an undiscovered exit generates the map (`worldGraph.ts` `discoverExit`), retrying the reserved seed with a numbered suffix if validation rejects it, records the summary (seed, archetype, `depth`) and connection in the world graph, gives the new map its own undiscovered deeper exit, and persists the world and map state before the player arrives. Generation takes a few milliseconds: complete
- map ids for discovered maps are `map-depth-<n>`; summaries carry `depth` (root 0, deeper prototype 1): complete
- archetypes for discovered maps are rolled from the reserved seed out of per-depth pools (`discoveredArchetypePools`): depth 2 rolls tunnel network, resource cavern, or deep cavern; depth 3+ adds foundry arena: complete
- archetype `content` config places foundries on discovered maps (tunnel network and foundry arena have one, deep and resource caverns do not). Foundry health scales by 25% per depth past 1, and foundry arenas are double health with more defenders: complete
- the deeper-exit lock generalizes the root rule: any map's deeper exit is locked while that map has an active foundry. `deeperPathUnlocked` in snapshots now describes the player's current map: complete
- connections can be travelled both ways; the destination end of a connection is the way back up. Travel now requires the ship to be within about two tiles of the exit (`EXIT_TRAVEL_RADIUS`): complete
- on startup, maps discovered in earlier sessions are regenerated from their summaries before persisted deltas are replayed, and worlds saved before this change get the missing deeper exit and map depths added: complete
- snapshots carry `exits` (position, ascend/descend, discovered, locked) and `nearbyExitId`. The client draws exit rings with labels (also shown on the §11 minimap) and E travels through a nearby exit when no builder site is in range (previously the client had no way to change maps at all): complete
- tests cover reservation determinism, archetype pools, chained discovery to depth 7, discovery through `GameWorld` (range check, generation, reuse on return trips, reload with mined terrain and the player on the generated map), foundry locks on a discovered foundry arena, and migration of an old saved world: complete

Next implementation target:

- tune the archetypes and depth pools through playtesting now that they appear in the world graph
- give generated maps more than one deeper exit so the graph can branch, using the reserved-connection model per exit (map ids already de-duplicate)
- place depth-appropriate enemy variety and fortifications per archetype as §9 adds enemy content
- only simulate maps that have players on them (every loaded map currently ticks every frame), and unload idle maps once the graph grows
- record discovered maps in each player's save (`discoveredMapIds`) so the minimap/scanner work in §11 can show what a player has charted; today only the world graph records them
- discovered maps only persist for the life of the server process: `GameServer` constructs `GameWorld` with in-memory persistence and `POSTGRES_URL` is read but never used, so the Postgres adapter needs wiring before the world is truly persistent

### 9. Encounter, objective, and enemy infrastructure growth

Status: combat consequences and first encounter pass complete (completed step 26); escalation and feedback next.

- the foundry loop proves the objective gate: destroy a structure, reduce pressure, unlock the deeper path
- the GDD calls for enemy fortification pockets, default defense rebuilding, richer enemy roles, and objective escalation

Completed in the first pass:

- contact damage uses each `EnemyDefinition.contactDamage`, once per `attackCooldownMs` per enemy (was a flat 4 hull every tick, about 120 per second)
- ship destruction (GDD §4.3, §16): at 0 hull, 50% of carried resources (`CARGO_SPILL_FRACTION`) plus 50% of the hull and installed modules' build cost (`WRECK_SALVAGE_FRACTION`) drop at the death site as a wreck with `ownerPlayerId`/`protectedUntil` (60 s, owner-only pickup). The destroyed ship is removed from the stable, the player respawns at the root spawn in a free "Fallback Sparrow" (starter loadout) with 3 s of invulnerability, and gets a "Ship Destroyed" toast plus fresh builder state. Other ships in the stable are untouched
- enemy roles in content (`role`, `attackCooldownMs`, `visionRadiusTiles`, `collisionRadius`, optional `ranged`): melee drone and sentry; the ranged **Sentinel** (GDD §11.2) holds about 140 px and fires bolts; the stationary **Defense Turret** guards foundries. Projectiles carry a `faction`: enemy bolts hit only players and stop on rock without mining it; snapshots mark them `hostile` and the client draws them red/orange
- fortification pockets: archetype `content.foundry` now sets `enemyMix`, `defenseCount`, `defenseRebuildMs`, and a base `reward`. Turret slots are planned on a ring around the foundry, on open terrain and at least 80 px from exits, spawn, and builder sites; deeper maps add one turret per two depth levels. Turrets do not count toward the spawn cap. Standing foundries are garrisoned on load and on discovery (enemies are not persisted)
- defense rebuilding (GDD §12.2-12.3): an active foundry rebuilds one empty slot once `defenseRebuildMs` has passed since the last loss or rebuild (40 s root, 30 s arena), never while a ship sits on the slot, and never after the foundry is destroyed
- depth scaling: foundry reward is the archetype base times `1 + 0.5 * depth` (root 30 ferrite / 10 plasma, foundry arena at depth 3 113 ferrite / 40 plasma / 25 stone). Defense slots, enemy mix, and reward persist with the foundry; older saves fall back to the generated template
- tests in `combat.test.ts` (contact cadence, destruction/salvage/respawn, owner protection, invulnerability, ranged behavior, bolt terrain rules, garrison placement, rebuild timing, persistence) and depth checks in `worldGraph.test.ts`

Known gaps and tuning notes:

- the Sentinel reuses the drone sprite tinted amber and the turret is drawn procedurally; both need fal sprites (`npm run generate:sprites`)
- respawn always uses the root spawn; there is no player-set spawn point yet (GDD §16.2), and no wreck marker on the minimap (§16.1)
- installed modules are not dropped as items; their value comes back as resources in the wreck
- numbers are first-pass and need playtesting: two turrets plus a Sentinel make the root foundry noticeably harder for a 100-hull Sparrow

Next implementation target:

- objective feedback for reduced enemy pressure and newly safer routes (for example HUD or minimap marks for remaining defenders and rebuild timers)
- fortification pockets around resource vaults, not only foundries, and terrain fortification (walls or chokepoints) rather than turrets alone
- more roles from GDD §11.7: repair drone (heals turrets and foundry, creates target priority) and burrower
- alert sharing between nearby enemies (GDD §11.6) and patrol/investigate states instead of idle-until-seen
- wreck marker on the owner's minimap (§16.1)

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

Loose ends from the current build:

- only two hulls exist (Sparrow Scout, Warden Healer) and one weapon (Pulse Cannon); there is no destroyer, miner, or heavy hull yet
- module `mass` and `powerUse` and hull `mass` and `powerCapacity` are validated at design time but have no effect in play: every ship uses the same shared thrust and turn constants, and module use never spends power
- weapons fire from their own hardpoint, but `Space` fires only the selected weapon slot, so a multi-weapon hull would need a fire-group rule

Next implementation target:

- add or tune first-pass hull/module data for the scout, healer, destroyer, miner, and heavy directions without over-expanding the roster
- make material costs align with the new terrain/resource economy so exploration feeds ship choices
- derive acceleration and turn rate from thrust and mass (GDD §8.3) through the shared movement code so client prediction stays in sync, and spend or cap power on module use
- add tests for content validity, build costs, mount compatibility, module install rules, saved ship design persistence, and active-ship behavior across the expanded catalog

### 11. Exploration information and player-facing map tools

Status: server-side line of sight, terrain memory, first-pass minimap, and exits on the minimap complete; sensors/scanner not started.

- the GDD recommends fog-of-war minimap memory, scanner pings, and sensor modules for structure/salvage detection
- this should follow the resource/generation pass so there is meaningful hidden information to reveal

Minimap (first pass, complete):

- `apps/client/src/game/minimap.ts` draws an HTML canvas overlay in the top-right corner, built from the snapshot the player already receives
- every snapshot carries all chunks of the current map filtered through that player's per-map terrain memory, so the minimap needs no new server data and cannot reveal anything the main view hides
- unknown cells are transparent, remembered cells are dimmed, and currently visible cells are drawn at full brightness with per-material colors (ore and crystal stand out from rock)
- markers show the local ship (arrow with heading), other players, enemies, structures, and foundries, all from the server's visibility-filtered lists
- `M` cycles local view (48x40 tiles around the ship, clamped to the map edge) -> whole-sector view -> hidden; the panel hides while the builder is open
- the header shows the map id and an explored percentage (remembered plus visible cells over all cells in the map)
- terrain is rebuilt once per snapshot into a one-pixel-per-tile image; markers are redrawn per frame from the predicted render snapshot
- multiple maps: the image is derived from whichever map the snapshot names, so new procgen maps (§8) work without changes; memory per map is already persisted on the server

Next implementation target:

- show map connections/exits on the minimap: complete (PR #6 added `exits` to snapshots)
- prototype a scanner ping action or sensor module that reveals nearby structure, salvage, or connection hints
- keep enemy movement hidden in unexplored fog unless a sensor rule explicitly reveals it
- add tests for sensor visibility rules and remembered-map state persistence

### 12. Cosmetic feedback: mining, debris, and destruction effects

Status: in progress. Drifting debris and dust/explosion effects are done (first part); the mining drone swarm and the ship mining part are next.

Completed so far:

- drops drift server-side: `apps/server/src/simulation/drops.ts` launches every new drop (whatever created it) with a random direction, speed (14–34 px/s), and spin on its first tick, integrates it with exponential drag, and bounces it off terrain and structures (restitution 0.55). Drops spawned against a wall are nudged into open space; drops come to rest after a few seconds. Pickup runs before drift each tick so a drop under a ship is collected where it appeared. Tuning lives in `DROP_DRIFT` in `packages/shared/src/effects.ts`
- snapshots carry drop `velocity`, `rotation`, and `angularVelocity`; the client extrapolates along the same drag curve (`driftOffset`) and blends wall bounces like other remote entities, and draws salvage rotated
- effect events: the server records short-lived `EffectEvent`s on the map (`apps/server/src/simulation/effects.ts`) and snapshots include the visible ones for about one second (`effects`). Kinds: `dust` when a mining module clears a block, `rockBurst` when weapon fire breaks one, and `explosion` sized to the blast for unstable crystal detonations (blast radius), enemy kills (28 px), and foundry destruction (64 px)
- client: `apps/client/src/game/worldEffects.ts` plays each event once (deduped by id, capped at 32 active, late events start part-way through), and `renderWorld.ts` draws them into two retained `Graphics` objects that are cleared and redrawn each frame (dust and bursts above terrain, explosions above ships), so effects allocate nothing per frame. These replace the old client-inferred terrain burst
- player ship destruction has no event yet: call `emitEffect(map, { kind: "explosion", ... })` from the death/respawn work in §9 when a ship is destroyed

The goal is to make mining, salvage, and destruction feel physical without changing who owns gameplay state: the server stays authoritative for anything that affects play (mining timing, drop positions, pickups), and the client owns pure visuals.

Mining drone swarm:

- mining spawns a swarm of tiny drones from the ship's mining module; they fan out, then converge on the target block and work it for a few seconds before it breaks
- today `mineTerrainAt` clears a cell instantly on a mining action (180 ms cooldown), so a multi-second swarm is also a gameplay change: mining becomes a short channelled job per block
- server: track an active mining job (player, target cell, start time, duration from the material, for example longer for stone and ore), cancel it if the ship leaves range or the cell is destroyed by something else, and clear the cell when it completes. Snapshots carry the active job (target and progress) so every player sees the swarm
- client: drones are purely visual particles driven by the job's target and progress (spread phase, converge phase, orbit/work phase, return or dissolve on completion)
- open questions for playtesting: one job per ship or several in parallel, whether more mining modules mean more drones or faster jobs, and whether drones can be shot down later

Mining hardware on the ship:

- installing a mining module adds a visible part to the ship sprite at its hardpoint (for example a drone bay or rack that the swarm launches from), the same way hull, engine, and weapon parts already layer in `playerShipAssets.ts`
- needs a new sprite part per mining module, generated through the existing fal sprite pipeline (`npm run generate:sprites`)
- later support and armor modules should follow the same rule so every installed module reads on the ship

Drifting debris:

- debris and salvage drops (from mining, weapon terrain hits, enemy kills, and foundries) spawn with a small random velocity, direction, and spin, and drift slowly instead of sitting still
- drift must be server-side because pickup is decided by drop position on the server: give drops `velocity` and `angularVelocity`, integrate them each tick with gentle drag, and bounce off solid terrain and structures with the existing collision helper
- snapshots carry drop velocity and rotation so the client extrapolates smoothly between snapshots, the same way projectiles and enemies already are (completed step 23)
- drops should settle to a slow drift or stop after a while so they stay collectible and do not pile into walls

Dust and explosion effects:

- a dust cloud puff when mining finishes a block (replacing or extending the current terrain burst)
- an explosion when an unstable crystal detonates or a rock is blown apart by weapon fire, sized to the blast radius
- an explosion when an enemy, a foundry, or a player ship is destroyed (player ship destruction depends on the death/respawn work in §9)
- effects are client-only and driven by events the client can already see or that snapshots add (cell cleared by mining vs. by explosion, entity destroyed); destruction of entities needs a small event or "destroyed" marker in snapshots because removed entities currently just vanish
- follow the §6 rule: retain and reuse effect objects or destroy per-frame `Graphics` with `context: true`, and cap active particles

Next implementation target:

- ~~debris drift first (self-contained, server plus client, testable)~~ done
- ~~then dust/explosion effects, with destruction events added to snapshots~~ done (player ship explosion waits on §9 death/respawn)
- then the mining job and drone swarm, together with the ship mining part
- tests: mining job timing and cancellation, drop drift and terrain collision staying within map bounds, drops remaining collectible, and snapshot fields for jobs and destruction events

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
- cosmetic feedback (§12):
  - a mining job takes its configured time, completes once, and cancels when the ship leaves range or the cell is already gone
  - drifting drops collide with terrain, stay inside the map, slow down, and remain collectible
  - snapshots expose active mining jobs and destruction events so other players see the same effects

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
- the running server currently uses in-memory persistence only; restarts reset the world until the Postgres adapter is wired in
