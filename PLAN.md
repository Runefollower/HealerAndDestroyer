# Healer and Destroyer Next-Step Plan

## Summary

The next phase should optimize for a more playable vertical slice on top of the current `ws`-based runtime, while doing only the refactors needed to keep that work maintainable. The goal is to turn the current prototype into a loop that feels intentional: build ships, wait for and manage construction, use installed tools for distinct actions, fight foundry-driven enemies, and persist meaningful progress across reconnects.

Recommended sequence:

1. ship construction timers and builder completion UX
2. tool-gated mining/combat/support rules
3. foundry-driven PvE/objective loop
4. targeted server subsystem extraction to support those features
5. persistence/test hardening for the expanded slice

## Key Changes

### 1. Ship build timers and builder UX

- extend builder state so each stored ship exposes whether it is `building`, `ready`, or `active`, plus remaining build time when applicable
- finalize ship builds in the server runtime on tick, not only during incidental player interactions
- update the builder UI to separate `Active Ship`, `Stored Ships`, and `Building Ships`
- show countdown timers in the client and disable swap/install actions on unfinished ships
- emit or infer a build-completed state transition so a finished ship becomes visibly usable without needing a reconnect

Important contract changes:

- `StoredShip` should expose stable build-timer information suitable for UI display
- `BuilderStateMessage` should include enough timing data for live countdown rendering

### 2. Installed modules become real gameplay capabilities

- stop treating generic projectile use as both weapon fire and mining
- keep `fireWeapon` for weapon-capable installed modules only
- add a distinct module-activation path for non-weapon tools, with mining and support tools using installed module definitions instead of hardcoded behavior
- mining should require a mining-capable installed module on a valid hardpoint
- repair/support actions should require a support-capable installed module and target an allied ship or self, not terrain
- terrain yields should come from the mining tool path; normal weapons should no longer be the primary way to mine

Important contract changes:

- add explicit capability metadata to module/content definitions for `weapon`, `mining`, and `support`
- add a new shared client message for module activation, rather than overloading `fireWeapon` for every tool
- replicated state should remain minimal; authoritative validation stays server-side

### 3. Foundry-driven PvE loop

- upgrade the existing foundry structure from seeded scenery into the first real objective system
- give foundries a spawn timer, local enemy cap, and simple rebuild/spawn behavior while active
- spawn only basic enemy types in this phase; no squad logic or advanced AI yet
- make foundry destruction meaningfully reward players with salvage/resources and temporarily reduce local threat
- tie the deeper map push to this loop by making the root map's foundry the first meaningful objective before sustained deeper exploration

Important data/model changes:

- promote foundry-specific runtime state out of generic structure-only handling
- persist foundry health, active status, and spawn timing so reconnects preserve pressure correctly

### 4. Targeted server/client refactor to support the new slice

- split [`gameWorld.ts`](/D:/Users/jim/github/HealerAndDestroyer/apps/server/src/simulation/gameWorld.ts) into focused subsystems without introducing a full ECS
- recommended boundaries: `builder/ship lifecycle`, `terrain/mining`, `combat/tools`, `ai/foundries`, and `map persistence`
- keep the current runtime/state model and `ws` transport; do not introduce Colyseus in this phase
- keep [`app.ts`](/D:/Users/jim/github/HealerAndDestroyer/apps/client/src/game/app.ts) thin, but extract builder rendering and world rendering into separate client modules once timers and tool actions are added
- continue using [`packages/shared`](/D:/Users/jim/github/HealerAndDestroyer/packages/shared/src/index.ts) as the only source of truth for cross-boundary contracts

### 5. Persistence and acceptance hardening

- persist ship build timers and completion state cleanly across disconnect/reconnect
- persist installed module layouts and crafted module inventory as the canonical source for ship capabilities
- persist foundry runtime state alongside chunk edits and structure state
- replace current full-chunk snapshot persistence with chunk-delta persistence only if the implementation stays simple; otherwise keep the current representation for this phase and defer optimization
- expand acceptance tests to cover the intended playable-slice path, not just isolated mechanics

## Test Plan

Add or update automated scenarios for:

- ship build starts, countdown advances, build completes, ship becomes swappable
- unfinished ships cannot be swapped into or modified
- mining fails without an installed mining tool and succeeds with one
- weapon fire damages enemies but does not serve as the main mining path
- support module activation repairs a valid ship and rejects invalid targets
- foundry spawns enemies on timer, respects local cap, and stops once destroyed
- reconnect restores:
  - chunk edits
  - build timers/build completion state
  - installed modules
  - crafted module inventory
  - foundry state
- full vertical-slice flow:
  - join world
  - mine resources
  - craft/install module
  - start ship build
  - survive enemy pressure
  - destroy foundry
  - disconnect and reconnect with state preserved

## Assumptions

- the next phase stays on the current `ws` runtime; Colyseus is deferred
- the target is a stronger vertical slice, not a transport/runtime migration
- one starter map plus one deeper connected map remains sufficient for this phase
- no new auth, matchmaking, or account-scope systems are added
- refactoring is limited to what is needed to support timers, tool validation, foundry behavior, and persistence without letting the server remain a single growing file
