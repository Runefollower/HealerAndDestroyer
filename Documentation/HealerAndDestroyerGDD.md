# Healer and Destroyer
## Game Design Document

Version: 0.2 draft  
Status: Expanded working draft  
Source basis: `Documentation/HealerAndDestroyerGDD.docx`  
Last updated: 2026-03-21

---

## 1. Overview

### 1.1 High Concept
*Healer and Destroyer* is a 2D browser-based multiplayer action-exploration game set in a destructible underground cave network. Players pilot modular ships that can mine, fight, repair, and construct. The game combines cave exploration, ship engineering, real-time combat, co-op support play, territorial control, and PvP conflict in long-lived persistent multiplayer worlds.

The central fantasy is:

"Build a ship that can survive the depths, heal and defend allies, or overwhelm enemies through superior firepower."

### 1.2 Genre
- 2D multiplayer action game
- Exploration and survival sandbox
- Modular ship builder
- Co-op and light competitive territory-control game

### 1.3 Platform
- Web browser
- Desktop-first for initial release
- Keyboard and mouse required for Version 1
- Mobile support is not planned for the first playable version

### 1.4 Target Audience
- Players who enjoy engineering-driven combat games
- Fans of sandbox co-op experiences
- Players who like mining, upgrading, and experimenting with builds
- Small groups of friends who want drop-in cooperative progression

### 1.5 Design Goals
- Deliver satisfying cave exploration with constant small discoveries
- Make ship building matter mechanically, not just cosmetically
- Support both aggressive and support-oriented playstyles
- Create emergent stories through player cooperation, conflict, and salvage
- Keep the controls readable enough for browser play while preserving depth

### 1.6 Non-Goals for Initial Development
- Massive MMO-scale population in one world
- Deep narrative campaign content
- Full PvE raid structure in the first milestone
- Fully player-authored economies at launch
- Controller and mobile-first UX in the first milestone

---

## 2. Game Vision

### 2.1 Core Fantasy
Players descend into dangerous cave systems in handcrafted or procedural ships. They mine valuable materials, fight robotic defenders, rescue allies, salvage wrecks, and slowly push further into the underground. Every trip deeper carries risk, but also access to better resources and higher-value objectives.

### 2.2 Core Design Pillars
#### Exploration First
Progress should come from going somewhere dangerous and coming back with knowledge or materials. The map should constantly tempt players with new tunnels, signatures, structures, and shortcuts.

#### Engineering Matters
The player's ship is a machine assembled from tradeoffs. Weight, thrust, power use, weapon placement, and support tools should all influence performance.

#### Healer and Destroyer Roles
The game name reflects a deliberate spectrum of playstyles. Some ships should specialize in defense, repair, shielding, and sustain, while others specialize in burst damage, pressure, and structure destruction. Hybrid builds should also be viable, but the support-vs-offense identity should remain one of the game's defining features.

#### Shared Risk, Shared Opportunity
Players should regularly encounter choices that are more interesting in multiplayer than solo play: rescue, resource-sharing, salvage races, escorting vulnerable miners, and defending structures.

#### Terrain as Tactics
The cave is not just scenery. Terrain shapes combat, movement, line of sight, escape routes, ambushes, and mining strategy. Destruction and construction should alter how players navigate and fight.

---

## 3. Player Experience

### 3.1 Player Role
The player controls a pilot operating a modular spacecraft or hovercraft-like cave vessel capable of thrust-based movement, mining, combat, repair, and construction.

### 3.2 Emotional Experience Goals
- Curiosity when entering unexplored spaces
- Tension when operating far from safety
- Pride in ship design choices
- Relief when an ally arrives with repairs or cover fire
- Excitement when a destroyed enemy structure opens a region
- Opportunism around salvage and contested materials

### 3.3 Expected Session Length
- Short session: 15 to 25 minutes
- Standard session: 30 to 60 minutes
- Long co-op session: 90 minutes or more

### 3.4 Primary Motivators
- Upgrade the ship
- Unlock new modules
- Reach deeper cave zones
- Defeat stronger enemies
- Establish safe routes and defended positions
- Recover from losses and improve the next run

---

## 4. Core Gameplay Loop

### 4.1 Macro Loop
1. Enter the game and join a world or room.
2. Spawn at a safe starting area or player-controlled base.
3. Explore nearby tunnels and identify threats, resources, and objectives.
4. Mine or salvage materials.
5. Return to a safe area or mobile build state to repair and upgrade.
6. Push into more dangerous areas for higher-value rewards.
7. Capture, destroy, or defend strategic structures.
8. Repeat with a stronger or more specialized ship.

### 4.2 Moment-to-Moment Loop
1. Scan nearby terrain and enemy presence.
2. Position the ship based on line of sight and movement constraints.
3. Manage thrust, rotation, weapon range, and incoming damage.
4. Collect drops or protect a teammate doing so.
5. Decide whether to press deeper, retreat, or establish a foothold.

### 4.3 Failure and Recovery Loop
1. Player ship is destroyed.
2. Salvage and dropped materials remain in the world.
3. Player respawns with a fallback ship, starter loadout, or insured chassis.
4. Player attempts recovery alone or with allies.
5. Recovery becomes a meaningful part of the story rather than a hard reset.

---

## 5. Game Structure

### 5.1 Match or World Model
The game uses long-lived persistent worlds.

- Each world hosts a graph of persistent cave maps rather than one single infinite playfield
- Each individual cave map is finite in size
- Maps are connected through exits, gateways, portals, shafts, or other traversal points
- New maps are procedurally generated when players discover and enter new connections
- Players may leave and return while retaining their ship, inventory, and progression state
- The world continues progressing while players are offline
- Structures, territorial changes, destruction, and exploration state remain saved

This persistence is a core pillar rather than an optional feature.

Recommended technical direction:
- simulate finite persistent maps
- allow effectively infinite exploration by generating additional maps on demand
- avoid a literally infinite continuous coordinate space

### 5.2 Supported Play Modes
- Solo exploration and progression in a shared persistent world
- Ad hoc cooperation between players
- Team-based play
- Open PvP conflict between individual players or groups

The game should support players who want to explore alone, form temporary alliances, or engage directly in PvP from the start.

### 5.3 Player Presence and Logout
- Active players appear in the world's active player list
- When a player logs out, their ship is removed from the active world simulation
- The player is removed from the active player list
- Ship design, owned resources, and player progression are preserved for when they return
- The player's configured spawn point is preserved for when they next enter the world

This keeps persistent progression without forcing offline vulnerability in the first design version.

### 5.4 Recommended Initial World Population
- 4 to 8 concurrent players for early production targets
- Stretch goal: 12 to 16 if performance allows

### 5.5 Win and Loss Conditions
The core game is open-ended. Success in a persistent world is measured by:
- depth reached
- structures destroyed
- rare materials secured
- territory held
- ship progression achieved
- rival players defeated or driven back

Loss is local and recoverable rather than global. Individual destruction matters more than absolute game over.

---

## 6. Controls and Camera

### 6.1 Camera
- 2D top-down camera
- Camera centered on player ship
- Slight look-ahead in mouse aim direction is recommended
- Zoom levels should support navigation and combat readability

### 6.2 Recommended PC Controls
- `W`: forward thrust
- `S`: reverse thrust or brake
- `A` / `D`: rotate left and right
- Mouse: aim turret or primary facing direction
- Left click: primary weapon
- Right click: secondary weapon or support tool
- `Space`: utility action
- `E`: interact, collect, or transfer
- `B`: build mode
- `M`: minimap
- `Tab`: scoreboard, team, or player list

### 6.3 Input Design Goals
- Easy to learn in under five minutes
- High ceiling through ship design and positioning
- Clear feedback for thrust, impact, healing, and low-resource states

---

## 7. Player Progression

### 7.1 Progression Philosophy
Progression should mostly come from:
- new modules
- better materials
- broader tactical options
- access to riskier regions

Progression should not create impossible catch-up gaps in normal room play.
The initial design should avoid relying on a traditional character level system unless later testing shows a clear need for stronger gating.

### 7.2 Progression Layers
#### Persistent World Progression
- Gather resources and store them safely
- Replace lost parts
- Install newly crafted modules
- Expand or redesign the current ship
- Establish defended positions, caches, or operating routes
- Maintain multiple owned ships if sufficient resources and storage exist

#### Account-Level Progression
Recommended initial account scope:
- identity and profile data
- owned worlds or world access
- optional blueprint unlock records if needed later

Most meaningful progression should live in the persistent world and on the player's current ship state.

### 7.3 Progression Gating Recommendation
Current recommended direction:
- no traditional player levels in the first implementation
- progression should come from resources, ship construction, modules, and world access
- unlocks, blueprints, or milestone gates can be added later if content needs clearer progression boundaries

This keeps early development focused on the core sandbox loop rather than layering in an RPG progression system too early.

### 7.4 Owned Ship Management
- A player may own multiple ships if they have sufficient resources
- Only one ship may be active in the world at a time
- Inactive ships are stored in a stable, garage, hangar, or equivalent storage system
- Stored ships preserve their current design and installed modules

### 7.5 Ship Building and Swap Flow
- Ship management should open in a separate pop-up style interface rather than staying embedded in moment-to-moment gameplay
- This interface should allow players to view their stable, inspect owned ships, and select their active ship
- Active ship swapping is currently intended to be instantaneous once the player is inside the ship management flow
- Ship construction should require the player to have the necessary resources available in their inventory totals

Recommended current direction:
- players use ship builder sites in the world to construct new ships
- players use ship builder sites in the world to access the stable and swap active ships
- ship builder sites appear in the world at some limited frequency
- later in progression, players may be able to construct their own ship builder sites

Recommended construction rule:
- building a new ship at a ship builder site should take time
- more complex ships should take longer to build
- ship swapping should remain faster and simpler than building a new ship

Open implementation note:
- the current design requires access to a ship builder site for both ship construction and stable access
- this should remain an open topic, because later testing may show that active ship swapping should be available from anywhere

### 7.6 Module Crafting and Upgrade Flow
- Modules are crafted from the player's current resource totals
- Module crafting should initially be available at valid ship builder sites
- Basic modules should craft instantly to keep early iteration fast
- Advanced modules may later receive build timers if pacing needs more structure, but this is not required for the first implementation
- Installing, removing, or swapping modules should happen through the builder interface rather than in active combat
- Upgrades should generally replace earlier modules rather than stacking infinite linear stat increases

Recommended first-pass rule:
- hull construction uses build time
- module crafting is instant
- ship swapping is instant once the player is in the correct interface

This keeps the workflow readable: new ship creation is a commitment, module iteration is fast, and active ship choice remains low-friction once the player reaches a builder site.

### 7.7 Upgrade Categories
- Mobility
- Power generation
- Weapons
- Support and healing
- Mining and utility
- Defense and armor
- Construction and logistics

### 7.8 Tech Tier Model
- Tier 0: starter survival tools
- Tier 1: stable early-game combat and mining modules
- Tier 2: specialization modules
- Tier 3: rare advanced systems from deep zones

### 7.9 Progression Branches
The main ship progression should branch primarily into:
- Healer
- Destroyer

Secondary specialized paths:
- Miner
- Heavy

Scout is the starting point that leads into the main progression branches.

---

## 8. Ship System

### 8.1 Ship Identity
Ships are built from modular components attached to a chassis using defined attachment points. Ships are not fixed character classes. Instead, the build system creates class-like behavior through hull choice, attachment layout, and installed modules.

### 8.2 Base Ship Stats
- Hull integrity
- Armor or damage reduction
- Power generation
- Power storage
- Thrust
- Angular thrust or torque
- Total mass
- Sensor range
- Repair throughput

### 8.3 Derived Stats
- Acceleration = thrust / mass
- Turn rate = torque / moment of inertia
- Top speed determined by thrust, drag, and movement tuning
- Effective durability derived from hull, armor, healing access, and evasion

### 8.4 Module Categories
- Chassis core
- Hull segments
- Engines
- Thrusters or maneuvering jets
- Reactors or batteries
- Weapon mounts
- Support modules
- Utility modules
- Armor plates
- Cargo modules
- Sensor modules

### 8.5 Placement Rules
- Modules attach to valid hardpoints defined by the current chassis or hull segment
- Weapons require line of fire
- Reactors may create heat or vulnerability if exposed
- Outer placement improves firing angle but increases fragility
- Wide ships turn slower but can mount more tools

### 8.6 Hull and Expansion Rules
- Different hull designs provide different attachment point layouts
- Hulls may specialize in combat, cargo, support, mobility, or expansion
- Some attachment points are reserved for engines, weapons, utility modules, or armor
- Certain hull types may include structural attachment points that allow one hull section to connect to another
- Connected hull sections allow players to assemble larger ships over time
- Connected hull sections still function as a single ship under one player's control

Larger ships should gain capacity and role flexibility, but pay meaningful costs in mass, target size, maneuverability, and repair burden.

### 8.7 Build Archetypes
Recommended archetype examples:
- Scout: fast, fragile, high sensor range
- Miner: efficient extraction, cargo-focused, weak offense
- Destroyer: front-loaded damage and armor
- Healer: repair beam, drones, shield support, low burst damage
- Hybrid escort: medium damage plus sustain tools
- Siege builder: slow, tough, construction-oriented

### 8.8 Failure States
- Module destruction can disable specific ship functions
- Losing engines reduces mobility
- Losing reactor output may disable weapons or support systems
- Losing cargo may spill materials on destruction
- Localized weapon damage can destroy only the ship parts inside the impact radius
- Ships can remain operational in a crippled state until overall hull integrity reaches zero

This allows partial damage to matter before full ship destruction.

### 8.9 Hull Families
Recommended hull families:

#### Scout Hull
- Small frame
- Minimal slot count
- High maneuverability
- Starting point for all players
- Best for onboarding, exploration, and simple combat

#### Destroyer Hull
- Combat-focused frame
- Strong weapon hardpoint access
- Main offensive progression path
- Best for direct damage, PvP pressure, and structure destruction

#### Healer Hull
- Support-focused frame
- Better support and power hardpoint distribution
- Main defensive and sustain progression path
- Best for repair, shielding, sustain, and team utility

#### Miner Hull
- Utility and cargo focused
- Strong mining and storage support
- Lower combat efficiency
- Specialized side path rather than a full progression branch

#### Heavy Hull
- Large frame
- Strong structural expansion capacity
- Designed to attach multiple hulls into larger ships or systems
- Best for late-game growth, large builds, and multi-section ship architecture

### 8.10 Hardpoint Types
Recommended hardpoint categories:
- structural hardpoint
- engine hardpoint
- weapon hardpoint
- turret hardpoint
- utility hardpoint
- support hardpoint
- armor hardpoint
- sensor hardpoint
- cargo hardpoint

Different hulls should vary not only in hardpoint count, but also in hardpoint placement and firing geometry.

### 8.11 Mount Orientation
- Hardpoints have a mount direction determined by hull design
- Fixed weapons fire in the direction set by the mount when installed
- Fixed weapons may face forward, sideways, rearward, or at diagonals depending on hardpoint orientation
- Turreted or cursor-aimed weapons may rotate or aim independently if the module supports it

Mount orientation should be a meaningful ship-design choice.

### 8.12 Diagram Legend
The hardpoint diagrams in this section use the following shorthand:

- `[CORE]`: main hull body
- `[W>]`: fixed weapon hardpoint facing forward
- `[W<]`: fixed weapon hardpoint facing rearward
- `[T]`: turret hardpoint
- `[T/W]`: hardpoint that can support a turret or weapon
- `[S>]`: support hardpoint facing forward
- `[S^]`: support hardpoint facing upward or alternate arc
- `[U]`: utility hardpoint
- `[C]`: cargo hardpoint
- `[A]`: armor or defense hardpoint
- `[A/U]`: armor or utility hardpoint
- `[P]`: power hardpoint
- `[P/S]`: power or support hardpoint
- `[<E]`: rear-facing engine hardpoint
- Lines between nodes indicate direct structural attachment to the hull body

### 8.13 Example Starter Hull Catalog
#### Sparrow Scout
- 1 core hull
- 1 weapon hardpoint
- 1 engine hardpoint
- high speed, low durability

#### Badger Miner
- 1 core hull
- 1 mining or utility hardpoint
- 1 weapon hardpoint
- 1 engine hardpoint
- 1 cargo hardpoint
- medium speed, strong resource play

#### Warden Healer
- 1 core hull
- 1 support hardpoint
- 1 weapon or turret hardpoint
- 1 engine hardpoint
- 1 utility hardpoint
- strong sustain, low burst

#### Talon Destroyer
- 1 core hull
- 1 forward weapon hardpoint
- 1 turret or secondary weapon hardpoint
- 1 engine hardpoint
- 1 armor or utility hardpoint
- moderate mobility, stronger offensive growth path

#### Crusher Heavy
- 1 core hull
- 1 weapon hardpoint
- 1 engine hardpoint
- 1 armor hardpoint
- 2 structural hardpoints
- lower mobility, strong expansion growth path

### 8.14 Early Hull Layout Concepts
These layouts describe the first concrete hulls that can anchor prototype implementation.

#### Hull 01: Starter Scout
Purpose:
- first player hull
- simple movement and combat onboarding

Layout:
- 1 forward-facing weapon hardpoint on the nose
- 1 rear-facing engine hardpoint on the tail

Diagram:
```text
      [W>]
        |
      [CORE]
        |
      [<E]
```

Recommended starter loadout:
- basic forward laser
- light engine

Gameplay role:
- teaches ship facing
- teaches thrust-based movement
- teaches fixed-forward weapon use

Strengths:
- simple to understand
- easy to balance
- strong readability for new players

Weaknesses:
- no utility specialization
- limited upgrade space

#### Hull 02: Starter Miner
Purpose:
- early resource-gathering hull

Layout:
- 1 forward-facing utility or mining hardpoint
- 1 rear-facing engine hardpoint
- 1 side utility or cargo hardpoint

Diagram:
```text
      [U>]
        |
      [CORE]--[C]
        |
      [<E]
```

Recommended starter loadout:
- mining laser
- light engine
- small cargo module

Gameplay role:
- teaches mining and hauling
- weaker in direct PvP than combat-focused hulls

#### Hull 03: Starter Healer
Purpose:
- early healer and sustain playstyle hull

Layout:
- 1 forward-facing support hardpoint
- 1 secondary weapon or utility hardpoint
- 1 rear-facing engine hardpoint

Diagram:
```text
      [S>]
        |
      [CORE]--[U/W]
        |
      [<E]
```

Recommended starter loadout:
- repair beam or low-tier support emitter
- light defensive weapon
- light engine

Gameplay role:
- teaches active support play
- introduces healer identity early

#### Hull 04: Starter Destroyer
Purpose:
- more combat-capable early PvP and PvE hull

Layout:
- 1 forward-facing fixed weapon hardpoint
- 1 side or top turret hardpoint
- 1 rear-facing engine hardpoint

Diagram:
```text
      [W>]
        |
      [CORE]--[T]
        |
      [<E]
```

Recommended starter loadout:
- fixed forward cannon or laser
- mouse-aimed light turret
- medium engine

Gameplay role:
- introduces mixed aiming styles
- supports both PvE and PvP skirmishes

### 8.15 Healer Progression Hulls
The Healer branch is one of the two main progression paths from the starter Scout. It focuses on sustain, defense, utility, and team support rather than raw damage output.

#### Healer I
Purpose:
- first dedicated support hull after Scout

Layout:
- 1 forward-facing support hardpoint
- 1 secondary weapon or utility hardpoint
- 1 rear-facing engine hardpoint

Diagram:
```text
      [S>]
        |
      [CORE]--[U/W]
        |
      [<E]
```

Design notes:
- direct evolution of the starter Scout into a support role
- keeps the same simple front-to-back readability
- side slot gives the player one flexible choice between defense and utility

Role:
- introductory healing and sustain ship
- viable solo but strongest in teams

Typical loadout:
- repair beam
- light defensive laser
- light engine

#### Healer II
Purpose:
- stronger team sustain and better battlefield presence

Layout:
- 1 forward-facing support hardpoint
- 1 turret or flexible weapon hardpoint
- 1 utility hardpoint
- 1 rear-facing engine hardpoint
- 1 power or support hardpoint

Diagram:
```text
        [S>]
          |
 [U]--  [CORE]--[T/W]
          |
        [<E]
          |
        [P/S]
```

Design notes:
- side utility slot supports scanners, tractor tools, or support gear
- opposite-side turret slot gives the ship defensive coverage while healing
- lower slot deepens power and sustain specialization

Role:
- mid-tier healer with better positioning options
- capable of active support during PvP or deeper PvE excursions

Typical loadout:
- repair beam or shield projector
- mouse-aimed defensive turret
- scanner, power link, or support utility
- upgraded engine

#### Healer III
Purpose:
- advanced sustain and battlefield control support hull

Layout:
- 2 support hardpoints
- 1 turret or defensive weapon hardpoint
- 1 utility hardpoint
- 1 rear-facing engine hardpoint
- 1 power hardpoint
- 1 armor or defense hardpoint

Diagram:
```text
      [S>]   [S^]
         \   /
        [CORE]--[T/D]
         /   \
       [U]   [A]
          |
        [<E]
          |
         [P]
```

Design notes:
- dual support mounts let the ship specialize in layered sustain tools
- utility and armor side branches help survivability without turning it into a destroyer
- built to operate in the center of coordinated team fights

Role:
- high-value support ship for organized teams
- enables sustained fights, recovery, and defensive pushes

Typical loadout:
- repair beam
- shield projector or healing drone bay
- defensive turret
- reinforced power system

### 8.16 Destroyer Progression Hulls
The Destroyer branch is one of the two main progression paths from the starter Scout. It focuses on direct damage, pressure, aggressive PvP, and structure destruction.

#### Destroyer I
Purpose:
- first dedicated offense hull after Scout

Layout:
- 1 forward-facing weapon hardpoint
- 1 secondary turret or weapon hardpoint
- 1 rear-facing engine hardpoint

Diagram:
```text
      [W>]
        |
      [CORE]--[T/W]
        |
      [<E]
```

Design notes:
- mirrors Healer I structurally, but trades support identity for offensive pressure
- forward weapon establishes direct attack runs
- side slot introduces either turret coverage or a second offensive option

Role:
- introductory combat ship
- stronger pressure than Scout with manageable complexity

Typical loadout:
- forward cannon or pulse laser
- light turret or secondary weapon
- medium engine

#### Destroyer II
Purpose:
- mid-tier offensive hull with better versatility

Layout:
- 2 forward-facing weapon hardpoints
- 1 turret or side weapon hardpoint
- 1 rear-facing engine hardpoint
- 1 armor or utility hardpoint

Diagram:
```text
    [W>]   [W>]
       \   /
       [CORE]--[T/W]
         |
       [<E]
         |
       [A/U]
```

Design notes:
- twin forward guns establish the branch's signature frontal pressure
- side slot supports flexible anti-player or anti-enemy coverage
- lower slot supports either survivability or light utility without diluting role identity

Role:
- strong skirmish and structure-pressure hull
- supports mixed fixed and aimed weapon play

Typical loadout:
- dual forward weapons
- one mouse-aimed turret or auto-aim weapon
- reinforced armor or damage-control module

#### Destroyer III
Purpose:
- advanced offensive hull for heavy pressure and front-line fighting

Layout:
- 2 forward-facing weapon hardpoints
- 1 turret hardpoint
- 1 side or rear weapon hardpoint
- 1 rear-facing engine hardpoint
- 1 armor hardpoint
- 1 power hardpoint

Diagram:
```text
    [W>]   [W>]
       \   /
       [CORE]--[T]
         |   \
       [<E]  [W< / W>]
         |
        [A]
         |
        [P]
```

Design notes:
- built around sustained forward assault with wider firing coverage
- side or rear mount helps protect flanks or punish pursuit
- armor and power mounts let the hull support heavier weapons and longer engagements

Role:
- high-threat combat ship
- excels at aggressive PvP pushes and strong PvE clearing

Typical loadout:
- heavy forward weapons
- defensive or utility turret
- secondary flanking or rear-cover weapon
- upgraded reactor and armor

### 8.17 Progression Design Rules for Healer and Destroyer
- Scout should remain the mandatory simple starting hull
- Healer and Destroyer should each feel like clear answers to different player motivations
- Each hull tier should add only a small amount of new complexity
- Healer progression should increase sustain, utility, and survivability more than raw damage
- Destroyer progression should increase pressure, weapon coverage, and combat durability
- Both branches should remain viable for solo play, but each should become stronger when used in its preferred context
- Miner and Heavy should remain specialized side paths rather than replacing the main branches
- Healer and Destroyer diagrams should remain visually distinct even when they have similar total hardpoint counts
- Destroyer layouts should bias toward frontal pressure and combat arcs
- Healer layouts should bias toward layered support coverage, defensive response, and survivability

### 8.18 Hull Layout Design Rules
- Every hull should have a clear front and rear orientation
- Early hulls should use very few hardpoints so their role is obvious
- Rear engine placement should be common for readability and intuitive thrust visuals
- Forward hardpoints are the simplest onboarding option for fixed weapons
- As hulls become more advanced, side, diagonal, and turret hardpoints can create more specialized playstyles

### 8.19 Module Families
The module system should reinforce the game's healer-versus-destroyer identity while still supporting mining, logistics, and hybrid builds.

#### Destroyer Modules
- Heavy cannon
- Pulse blaster
- Missile rack
- Siege beam
- Armor-piercing mount

Primary purpose:
- burst damage
- structure destruction
- PvP pressure

Tradeoffs:
- higher power demand
- higher weight
- lower sustain

#### Healer and Support Modules
- Repair beam emitter
- Shield projector
- Healing drone bay
- Power transfer link
- Ally-targeted buff emitter

Primary purpose:
- repair
- sustain
- protection
- team utility

Tradeoffs:
- lower direct damage
- higher reliance on allied positioning
- vulnerable when isolated

#### Mobility Modules
- Light engine
- Heavy engine
- Maneuvering thruster pack
- Boost system
- Drift stabilizer

#### Utility Modules
- Mining laser
- Tractor beam
- Scanner array
- Salvage processor
- Construction tool

#### Defense Modules
- Armor plating
- Reactive plating
- Hull reinforcement
- Point defense
- Damage-control subsystem

#### Power Modules
- Small reactor
- High-output reactor
- Battery bank
- Capacitor array
- Heat venting system

### 8.20 Starter Module Packages
Recommended early packages:

#### Starter Explorer Package
- light engine
- mining laser
- light weapon
- small cargo hold

#### Starter Destroyer Package
- medium weapon mount
- reinforced hull plating
- basic engine
- low utility capacity

#### Starter Healer Package
- repair beam
- light defensive weapon
- support-oriented power module
- moderate mobility

These packages should help new players understand distinct build identities quickly.

---

## 9. Resource Economy

### 9.1 Resource Design Goals
- Easy-to-understand early-game materials
- Valuable rare materials that change decision-making
- Local scarcity that encourages exploration
- Sufficient clarity that players know why a resource matters

### 9.2 Proposed Resource Tiers
#### Basic Resources
- Rock: construction filler, common walls, low-tier structure costs
- Iron: basic hull, mounts, and ammunition
- Aluminum: lightweight hull elements and mobility-oriented construction
- Copper: power systems, wiring, and low-tier energy weapons

#### Advanced Resources
- Gold: precision electronics, sensors, advanced weapons
- Palladium: high-tier energy handling, support tools, elite modules
- Iridium: rare high-end structural or energy technology resource
- Crystal or Core Fragments: rare drops for unique modules or boss-gated upgrades

### 9.3 Block and Ore Types
The terrain itself is a resource source.

#### Common Environment Blocks
- Most ordinary terrain blocks are simple rock
- Destroying these yields basic rock material
- Rock should be the most common crafting resource in the game

#### Ore Blocks
- Some terrain blocks are specialized ore-bearing blocks
- Ore blocks should appear occasionally within the cave network
- Ore block yields determine access to more advanced materials

Recommended early ore examples:
- iron ore
- aluminum ore

Recommended rarer ore examples:
- palladium ore
- iridium ore

### 9.4 Extraction Rules
- Every destructible block releases resources when destroyed
- Destroying blocks with standard weapons yields some resources
- Destroying blocks with a dedicated mining ship or mining module yields more resources from the same block
- Mining-specialized tools should improve extraction efficiency rather than simply enabling extraction
- Weapon-based destruction should remain viable for convenience, but inefficient for long-term resource gathering

This creates a clear gameplay distinction between combat destruction and intentional mining.

### 9.5 Mining Module Progression
Recommended first-pass mining progression:
- basic mining laser
- improved mining laser
- rare advanced mining module

Progression goals:
- improve extraction yield
- improve mining speed
- potentially improve performance on rarer ore types

This progression should remain intentionally extensible so more mining tools can be added later as the game design matures.

### 9.6 Resource Sources
- Destroyed environment blocks
- Ore blocks
- Enemy salvage
- Destroyed structures
- Deep-cave caches
- PvP wreck recovery

### 9.7 Material Usage Philosophy
- Hull construction should rely primarily on common materials
- Rock and iron should form the baseline cost for early hulls and basic structural growth
- Advanced engines should increasingly require rarer or more specialized materials
- Advanced weapons should increasingly require rarer or more specialized materials
- Advanced healer and support modules should also increasingly require exotic materials
- The material system should be extensible so additional resource uses can be added later without redesigning the whole economy

Recommended first-pass material use:
- Rock: common hull structure, walls, and simple construction
- Iron: basic hull reinforcement, simple weapons, and general-purpose structural parts
- Aluminum: lighter mobility-oriented parts and some engine-related upgrades
- Palladium: advanced support systems, energy handling, and high-end modules
- Iridium: rare late-game weapons, engines, and specialty systems

### 9.8 Pickup and Inventory Rules
- Resource drops are collected by colliding with them
- Collected resources go directly into the player's inventory
- Players continue collecting resources as they move through the world
- Player resource inventory is currently uncapped
- This simple model should be preferred for early development unless later balance requires storage constraints

### 9.9 Economic Sinks
- Module crafting
- New ship construction at ship builder sites
- Repairs
- Structure construction
- Ammunition or consumables if enabled
- Respawn replacement loadouts

### 9.10 Economic Risks
- Hoarding should not become the only dominant strategy
- Salvage theft should create tension without making recovery hopeless
- Rare resources should be exciting, not mandatory too early
- Mining ships should feel meaningfully more efficient than combat ships without making weapon-based terrain destruction useless
- Unlimited inventory should be monitored in case it reduces hauling risk or territorial strategy too much

---

## 10. Combat System

### 10.1 Combat Goals
- Movement and positioning should matter as much as raw stats
- Damage, sustain, and control should all have value
- Support play should feel active and skillful
- Terrain should naturally break sightlines and shape engagements

### 10.2 Damage Model
Recommended initial model:
- Weapons apply damage within a hit radius or impact radius
- Only ship parts within that radius take damage
- Individual modules and hull sections can be disabled or destroyed without immediately killing the player
- Hull integrity on the core active ship determines final destruction
- When hull integrity reaches zero, the player ship is destroyed and the player dies
- Optional armor reduction or armor plate hit points
- Contact damage only if it adds meaningful gameplay

### 10.3 Weapon Families
#### Energy Weapons
- Starter laser
- Beam laser
- Pulse laser
- Mining laser with weak combat fallback

Strengths:
- precise
- immediate hit registration

Weaknesses:
- power hungry
- may overheat or lose efficiency at long range

#### Projectile Weapons
- Light cannon
- Missile launcher
- Guided missile
- Cluster missile

Strengths:
- burst damage
- area denial

Weaknesses:
- travel time
- ammo or cooldown constraints

#### Electrical Weapons
- Arc emitter
- Chain lightning projector
- EMP burst

Strengths:
- anti-swarm
- anti-support disruption

Weaknesses:
- shorter range
- reduced effectiveness against insulated or shielded targets

### 10.4 Support Tools
- Repair beam
- Healing drone
- Temporary shield projector
- Power transfer link
- Tractor beam for salvage or ally assist

### 10.5 Weapon Aiming Models
Weapons should support several aiming behaviors:

#### Fixed-Forward Weapons
- Fire in the direction the weapon or ship is pointing
- Best suited for frontal assault ships, charge weapons, drilling tools, and simple ballistic mounts

#### Mouse-Aimed Weapons
- Aim at the player's cursor position when fired
- Best suited for skill-based turrets, support beams, precision weapons, and flexible combat ships

#### Auto-Aimed or Lock-Aimed Weapons
- Acquire a target automatically or choose direction at fire time and then travel independently
- Includes seeking missiles, simple lock-on projectiles, and smart energy shots

These aiming models should create distinct ship identities and control feel.

### 10.6 Combat Status Effects
Recommended limited set:
- burning or overheating
- ionized or EMP-disrupted
- slowed movement
- revealed or sensor-tagged

### 10.7 Combat Clarity Rules
- Incoming fire direction must be legible
- Area-of-effect boundaries should be readable for dangerous weapons
- Healing should use clearly distinct visuals from damage
- Low hull, disabled systems, and low power need strong UI warnings

---

## 11. Enemy Faction and AI

### 11.1 Enemy Fantasy
The underground is defended by robotic forces that mine, patrol, protect infrastructure, and escalate aggression when disturbed.

### 11.2 Enemy Types
- Drone: weak swarm unit
- Sentinel: patrol guard with steady ranged fire
- Enforcer: frontline bruiser
- Warden: mini-boss area controller
- Boss: large encounter unit tied to deep structures or rare zones

### 11.3 Spawn Presence Rules
- Enemies should appear throughout the world at random locations
- Foundries should also be randomly placed throughout the world
- Randomly placed world enemies help keep exploration and travel dangerous even away from major structures
- In the current design, randomly placed enemies do not automatically respawn once defeated
- Future versions may revisit random enemy respawn if the world begins to feel too empty over time

### 11.4 Behavioral Goals
- Enemies should feel territorial
- Early enemies should teach line of sight and flanking
- Higher-tier enemies should punish static play
- Support enemies should create target-priority decisions

### 11.5 AI States
- idle
- patrol
- investigate
- alert
- attack
- retreat or regroup
- defend structure

### 11.6 Detection Rules
- vision cone
- sensor radius
- line of sight checks
- shared alert broadcast to nearby allies

### 11.7 Special Enemy Roles
Recommended additions:
- Repair drone: heals enemy structures or allies
- Burrower: opens alternate paths through rock
- Sniper turret unit: controls long corridors
- Jammer: interferes with minimap or sensors

---

## 12. Enemy Infrastructure and Objectives

### 12.1 Structure Types
- Assembler: produces low-tier drones
- Foundry: produces advanced combat units
- Power relay: powers nearby defenses
- Shield node: protects a local base cluster
- Command core: major objective that coordinates regional activity

### 12.2 Foundry Production Rules
- Foundries are randomly placed throughout the world
- Foundries create new enemies over time
- Enemy production should happen on a cooldown or timed interval
- Each foundry should stop producing once it has reached a local unit cap
- If locally produced enemies are destroyed, the foundry can resume production until it reaches the cap again
- Foundry production pauses when the world has no active players because the world itself is paused

Recommended first-pass defaults:
- each foundry should maintain a local patrol or defense population rather than spawning endlessly
- low-tier foundries should mostly produce basic drones and occasional sentinels
- deeper or more advanced foundries may produce stronger unit mixes
- destroyed default defenses may be rebuilt slowly if the foundry remains operational
- foundries should not rapidly replace losses during an active assault, to avoid feeling unfair

### 12.3 Objective Logic
Destroying infrastructure should do more than drop loot. It should:
- reduce enemy spawn pressure
- weaken local defenses
- unlock safer routes
- create contested salvage opportunities

If enemy production structures remain active, they may eventually rebuild default defensive structures in their local area. This rebuilding behavior should stop if the production structure itself is destroyed.

### 12.4 Objective Escalation
- Peripheral structures are accessible early
- Deeper structures require stronger ships or teamwork
- Major objectives should be visible on scans only after discovery or intel gathering

---

## 13. World Design

### 13.1 World Structure
The game world is a destructible network of persistent cave maps composed of grid-based tiles or cells grouped into chunks. Each map should feel like a large coherent cave system, but the overall world should expand by linking many finite maps together.

Recommended structure:
- each individual cave map is finite
- each map contains multiple regions, tunnels, chambers, hazards, and objectives
- some maps contain exits or portal-like traversal points to other maps
- undiscovered connections can lead to newly generated maps
- discovered maps remain part of the persistent world and can be revisited later

This allows the game to feel effectively infinite without requiring a single infinite simulation space.

### 13.2 Region Types
Recommended early region set:
- Start caverns
- Narrow tunnel networks
- Open mining chambers
- Enemy fortification pockets
- Rare resource vaults
- Hazard zones

### 13.3 Inter-Map Connections
Recommended first-pass connection types:
- deep tunnel exits
- machine-built gate chambers
- ancient portal nodes
- elevator or shaft transitions

Design goals for map connections:
- make discovery of a new map feel significant
- allow players to retreat back to known territory
- support geographic variety without requiring a full world reset
- create natural places for route expansion, exploration choice, and spatial variety

Recommended first-pass connectivity:
- a typical map should expose up to about 5 outbound connections
- some maps may have fewer to create dead ends, objective pockets, or staging zones
- not every connection must lead immediately to a newly generated map

### 13.4 Environmental Hazards
Recommended hazards:
- lava or thermal vents
- electric fields
- collapsing rock
- explosive gas pockets
- low-visibility dust clouds

Hazards should be limited in Version 1 so they enhance variety without overwhelming readability.

### 13.5 Destruction Rules
- Players can mine and destroy selected terrain
- Every destructible block releases some amount of resource when destroyed
- Common environment blocks mostly yield rock
- Ore-bearing blocks yield specific materials such as iron, aluminum, palladium, or iridium
- Some rock types are tougher or require better tools
- Weapon fire can destroy blocks and recover some resources
- Mining-focused ships and mining modules recover more resources from the same blocks than weapons do
- Structural rules may prevent trivial collapse exploits
- Destruction should create new paths, ambush routes, or access to sealed chambers

### 13.6 Construction Rules
- Players may place defensive structures and utility objects
- Construction may require proximity to open space and stable surfaces
- Build rules should avoid grief-heavy full-path blocking where possible
- Player-built structures do not decay on their own
- Player-built structures may be damaged and ultimately destroyed by other players
- Damaged player-built structures may be repaired by ships equipped with the correct engineering-oriented hardpoint or module

---

## 14. Procedural Generation

### 14.1 Generation Goals
- Produce readable navigable cave spaces
- Support different encounter tempos
- Ensure enough connectivity for recovery and retreat
- Allow hidden chambers and shortcuts without excessive dead ends
- Support effectively infinite exploration through chained finite maps

### 14.2 World Graph Model
- The persistent world should be represented as a graph of generated cave maps
- Each map has its own seed, layout, objectives, and persistence state
- Connections between maps should be saved as part of the world graph
- A map should only be generated when players first discover or activate its connection

This keeps world expansion open-ended while keeping simulation scope manageable.

### 14.3 Chunk Model
- World divided into fixed-size chunks
- Recommended starting chunk size: `32 x 32` tiles
- Chunks generated on approach or discovery
- Non-active chunks may sleep or serialize

### 14.4 Proposed Map Generation Pipeline
1. Create or load a map seed
2. Generate density using noise
3. Apply smoothing with cellular automata
4. Enforce minimum connectivity
5. Stamp special features such as chambers, objective pockets, and map exits
6. Populate resources, hazards, and enemy structures
7. Reserve valid inter-map connection points if the map can lead deeper

### 14.5 Map Expansion Rules
- entering an undiscovered connection can trigger generation of a new linked map
- returning through a known connection loads an existing persistent map instead of generating a new one
- map generation should preserve a broadly consistent challenge level across maps in the initial design
- variation should come from layout, hazards, structures, and resource placement rather than formal depth scaling
- not every map needs to create more outbound connections, which helps control branching complexity

### 14.6 Transition Experience Goals
- moving between connected maps should feel quick and low-friction
- transition time should be kept as short as practical
- the player should feel like they are moving through one large explorable network rather than launching a separate mission
- loading behavior should prioritize responsiveness over cinematic transition complexity

### 14.7 Biome or Region Variation
Recommended later expansion:
- metallic machine caverns
- crystal caves
- volcanic tunnels
- abandoned industrial shafts

Biome variation should change:
- visual palette
- hazard mix
- resource distribution
- enemy composition

---

## 15. Exploration, Visibility, and Information

### 15.1 Fog of War
- Players only see active nearby space
- Explored areas remain on the minimap as last-known information
- Enemy movement in unexplored fog is hidden unless sensor tools reveal it

### 15.2 Sensor Gameplay
Recommended sensor mechanics:
- baseline local vision
- scanner ping for map reveals
- advanced sensor modules for structure detection or salvage detection

### 15.3 Discovery Rewards
Exploration should reward players with:
- resources
- shortcuts
- objective intel
- rare blueprints
- safe staging points

---

## 16. Death, Respawn, and Salvage

### 16.1 Ship Destruction
When a ship is destroyed:
- modules may drop as salvage
- cargo spills into the environment
- a wreck marker appears on the minimap for the owner

### 16.2 Respawn Model
Recommended initial approach:
- players respawn at their configured spawn point
- the default spawn point is the player's original starting location
- players may reset their spawn point at any time
- respawn with an insured fallback chassis or preserved core hull state
- recoverable losses remain in the world as salvage

### 16.3 Salvage Design Goals
- Recovery should be dramatic and worth attempting
- Theft should be possible but not completely punishing
- Co-op recovery should feel heroic
- Death should set players back in resources without erasing their overall progress

### 16.4 Anti-Frustration Rules
Recommended safety valves:
- owner-only pickup protection for a short duration
- partial insurance on core modules or hull chassis
- fallback respawn loadout that preserves continued play
- significant salvage left at the death site so recovery remains worthwhile

These can be tuned depending on how harsh the intended experience becomes.

---

## 17. Multiplayer and Social Systems

### 17.1 Cooperation
- shared combat
- shared healing and repair
- resource transfer
- escorting miners or damaged ships
- coordinated base defense

### 17.2 Competitive Interaction
PvP and PvE are both supported from day one.

- Players may explore independently
- Players may form teams or alliances
- Players may engage in direct PvP conflict
- Worlds should support shifting relationships between neutral, allied, and hostile players

PvP should be an intentional part of the game's identity rather than a later add-on.

### 17.3 World Danger Model
- The whole world is currently considered dangerous
- There are no guaranteed safe zones in the current design
- PvP risk is part of exploration, travel, salvage recovery, and territorial control

This can be revisited later if early testing shows excessive frustration.

### 17.4 PvP Rules
Recommended first-pass PvP behavior:
- players not on your team are valid hostile targets
- direct weapon fire, explosives, and offensive disruption effects may be used against hostile players
- team members are usually protected by friendly-fire immunity
- weapon-specific exceptions may override friendly-fire immunity for certain high-risk weapons
- player-built structures should follow owner or team alignment rules so ordinary allied fire does not destroy them by mistake
- salvage and dropped resources from destroyed players may become contested after any brief owner-protection window expires

### 17.5 Engagement and Targeting Rules
- players may attack neutral players without requiring duel confirmation
- lock-on and auto-target systems should prefer hostile targets where possible
- healing and positive support effects should prioritize the player's own team
- the UI should clearly indicate whether another player is neutral, allied, or hostile
- the UI should warn the player when a friendly-fire exception weapon may damage allies

### 17.6 Team Formation Rules
- A player may invite another player to join a team
- The invited player must explicitly accept
- If neither player is currently on a team, the accepted invite creates a new team
- Players already in a team cannot receive additional team invites
- A player must leave their current team before joining a different one
- Leaving a team happens instantly
- Teams should persist at least for the current active session or until explicitly disbanded

### 17.7 Friendly Fire Rules
- Team members should typically have friendly-fire immunity
- Friendly-fire behavior should ultimately be configurable per weapon type
- Certain high-powered or exceptional weapons may still damage allied players or allied ship parts
- Friendly-fire exceptions should be clearly communicated in the weapon description

### 17.8 Teamplay Opportunities
- healer escorts destroyer
- miner protected by scout
- salvage runs after boss kill
- temporary defense of a narrow tunnel choke

### 17.9 Communication
Recommended initial feature set:
- player nameplates
- ping system
- quick emotes or canned messages
- optional text chat

---

## 18. Structures and Basebuilding

### 18.1 Player Structures
- turret
- wall
- repair station
- storage cache
- sensor beacon
- respawn relay or field outpost
- ship builder site (later progression)

### 18.2 Basebuilding Goals
- Create temporary footholds
- Reward area control
- Support cooperative logistics
- Avoid infinite turtling

### 18.3 Restrictions
- building costs must matter
- placement rules should prevent total map griefing
- structures should need maintenance, power, or vulnerability windows if long-lived

---

## 19. Onboarding and Early Game

### 19.1 New Player Goals
The first 10 minutes should teach:
- movement and aiming
- mining a node
- returning resources
- equipping or crafting a simple upgrade
- surviving a basic enemy encounter
- understanding recovery after damage

### 19.2 Tutorial Recommendation
Version 1 should include:
- guided first room or scripted starter cavern
- contextual prompts rather than long text popups
- one early support interaction, such as repairing or being repaired

### 19.3 Early Progression Curve
- immediate access to movement and mining
- first weapon upgrade within one short session
- first meaningful specialization within two to three sessions

---

## 20. User Interface and UX

### 20.1 Core Screens
- login and account creation
- lobby and room browser
- room summary and join flow
- gameplay HUD
- ship builder and stable interface
- build and inventory interface
- respawn and recovery screen

### 20.2 Gameplay HUD
Recommended HUD elements:
- hull
- power
- heat or cooldown state if used
- current resource inventory
- minimap
- ability and weapon slots
- interaction prompts
- teammate status for co-op

### 20.3 UI Design Principles
- keep center of screen clear
- prioritize combat readability
- keep build flow fast and browser-friendly
- support low-friction learning of module tradeoffs

### 20.4 Build Interface
The build interface must communicate:
- module cost
- module weight
- power impact
- role and use case
- placement validity
- resulting ship stat changes

### 20.5 Ship Builder and Stable Interface
The ship builder and stable flow should:
- appear as a separate pop-up style dialogue that temporarily takes the player out of moment-to-moment play
- show the player's available ships in storage
- allow selection of the currently active ship
- show ship construction options when the player is at a valid ship builder site
- require the player to be at a valid ship builder site for stable access in the current design
- communicate build time for newly constructed ships
- distinguish clearly between instant ship swapping and time-based ship construction
- note that stable access from anywhere remains an open design topic for later revision

---

## 21. Visual Direction

### 21.1 Art Style Goals
Recommended direction:
- readable sci-fi silhouettes
- high contrast between terrain, allies, enemies, and pickups
- strong weapon-color language
- clean 2D presentation with atmospheric lighting accents

### 21.2 Visual Priorities
- projectiles and beam paths must read instantly
- destructible terrain needs clear damage states
- healing visuals must not be confused with enemy beams
- rare resources and objectives should stand out

### 21.3 Animation Needs
- thrust and directional exhaust
- weapon firing
- impact and destruction
- repair and support effects
- mining feedback
- structure activation states

---

## 22. Audio Direction

### 22.1 Audio Goals
- reinforce motion and impact
- distinguish healing from damage
- build tension in unexplored areas
- support awareness in multiplayer combat

### 22.2 Key Audio Categories
- engine and thrust loops
- weapon fire
- impact and hull damage
- mining and collection
- UI alerts
- ambient cave and machine sounds

---

## 23. Balance Targets

### 23.1 High-Level Balance Goals
- Solo players should survive early content
- Groups should gain flexibility, not automatic victory
- Support builds should meaningfully extend team survival
- Destroyer builds should feel powerful but punish overcommitment
- No single module type should dominate every ship

### 23.2 Early Tuning Targets
Recommended starting targets:
- time-to-kill against basic drone: low
- time-to-kill against peer player ship: moderate
- time-to-repair from critical state: meaningful but not instant
- mining time on basic node: short and satisfying

Exact numeric values should be established in prototype tuning sheets.

---

## 24. Monetization and Live Ops

### 24.1 Recommended Business Model
No monetization direction is currently locked.

This should remain undecided until the core game loop, persistence model, and PvP/PvE balance are proven.

### 24.2 Cosmetic Opportunities
- ship decals
- thruster colors
- hull skins
- profile badges

### 24.3 Live Ops Scope
Not required for prototype. Future options:
- rotating room modifiers
- seasonal challenges
- limited-time cave anomalies

---

## 25. Technical Design Overview

### 25.1 Architecture Summary
The game uses an authoritative client-server architecture designed for persistent worlds.

Client responsibilities:
- input capture
- rendering
- UI
- prediction and interpolation

Server responsibilities:
- simulation
- physics authority
- combat resolution
- AI
- world generation
- state persistence if enabled

### 25.2 Technology Recommendations
- Client: TypeScript
- Rendering: Canvas or WebGL through PixiJS for 2D
- Server: Node.js with TypeScript
- Networking: WebSockets
- Multiplayer framework candidate: Colyseus
- Storage: PostgreSQL or lightweight hosted backend for accounts and room metadata

### 25.3 Recommended Repository Layout
Recommended first-pass codebase structure:

```text
HealerAndDestroyer/
  apps/
    client/
      src/
        game/
          rendering/
          scenes/
          input/
          audio/
          ui/
          state/
          networking/
        assets/
    server/
      src/
        bootstrap/
        config/
        networking/
        simulation/
          ecs/
          physics/
          combat/
          ai/
          mining/
          structures/
          maps/
          transitions/
        persistence/
          repositories/
          serializers/
          migrations/
        services/
        rooms/
    tools/
      worldgen/
      balance/
      scripts/
  packages/
    shared/
      src/
        types/
        constants/
        math/
        protocols/
        schemas/
    content/
      src/
        hulls/
        modules/
        weapons/
        enemies/
        structures/
        resources/
  docs/
```

Layout goals:
- keep client, server, and shared protocol code clearly separated
- keep game content data separate from simulation logic
- allow data-driven iteration on hulls, modules, enemies, and structures
- keep persistence code isolated from gameplay systems

### 25.4 Code Organization Principles
- shared network schemas and identifiers should live in a common package
- content definitions should be data-first and serializable
- simulation systems should depend on shared types, not client code
- client rendering code should consume replicated state rather than authoring authoritative behavior
- persistence adapters should be replaceable without rewriting simulation systems

### 25.5 Why PixiJS Is the Best Current Fit
For a 2D browser game, PixiJS is the most practical recommendation because it:
- is built for 2D rendering
- performs well in browser environments
- supports sprites, particles, lighting-style effects, and UI overlays cleanly
- avoids the overhead of forcing a 3D-oriented stack onto a 2D game

ThreeJS should only be considered if the project later needs hybrid 2D/3D scenes.

---

## 26. Simulation Model

### 26.1 Server Authority
The server is authoritative over:
- player transforms
- projectiles
- combat outcomes
- AI behavior
- world state
- drops and loot ownership rules

### 26.2 Tick Rate
Recommended starting target:
- simulation tick: `30 Hz`
- render frame rate: client-side best effort
- network snapshot rate: `10 to 15 Hz`

Increase only if testing shows movement quality requires it.

### 26.3 Prediction Model
- client predicts local movement
- server sends corrections
- client reconciles with smoothing
- remote entities use interpolation

### 26.4 Persistence Model
Persistence is required for the core game.

- account data persists
- player resource counts persist
- player ship stable persists
- active ship selection persists
- player spawn point persists
- discovered map graph persists
- world terrain changes persist
- placed structures persist
- exploration state and territorial changes persist
- logging out removes the player ship from the active simulation while preserving its saved state
- worlds pause simulation when no players are active in them
- worlds are intended to persist indefinitely unless intentionally recreated or reset by system design

The world should only continue advancing while at least one player is active in it.

### 26.5 Player Save Model
The initial player save should contain only the data needed to restore meaningful progression cleanly and predictably.

Required saved player data:
- player identifier
- total stored resource counts
- owned ship stable
- active ship identifier
- configured spawn point

Each stored ship record should preserve:
- hull type
- installed modules
- ship integrity state if damaged ships are allowed to remain damaged between sessions

Resource handling assumption:
- collected resources are stored directly in the player's running inventory totals rather than being constrained by ship cargo limits in the initial design

Spawn point rules:
- every player starts with a default spawn point at their original game start location
- the player may reset their spawn point at any time
- when the player restarts the game, they re-enter at their current saved spawn point

### 26.6 Save Timing Strategy
Recommended initial save events:
- on logout
- on ship swap
- on spawn point change
- on meaningful inventory or resource change
- at periodic world save intervals as backup protection

The first implementation should favor correctness and durability over aggressive optimization.

Recommended first-pass save cadence:
- save immediately on explicit player state changes such as logout, ship swap, construction completion, and spawn-point update
- perform periodic world snapshots on a short timer for crash recovery
- prefer small frequent persistence updates for player state over rare large monolithic saves

### 26.7 World Persistence Rules
- if a world has no active players, world simulation pauses
- paused worlds retain terrain, structures, resource state, and player-related saved data
- enemy rebuilding, enemy production, and other world progression systems pause when the world is paused
- worlds do not naturally expire
- a world only resets if it is intentionally recreated or explicitly replaced by game systems in the future
- generated maps remain persistent once discovered
- undiscovered maps do not need to exist until a player reaches their connection point

### 26.8 Map Transition and Persistence Rules
- each generated cave map should have its own persistent identifier and seed
- inter-map connections should store which map they lead to once discovered
- moving between maps should unload the current local simulation area when appropriate and load the destination map
- only active maps and recently relevant neighboring state need to stay fully loaded in memory
- inactive discovered maps should remain saved in persistence storage rather than simulated continuously
- map transitions should be implemented as fast loads between persistent map instances, not as heavy session changes
- the initial world model should not rely on formal difficulty scaling by map depth

---

## 27. Physics Model

### 27.1 Movement
- thrust-based acceleration
- drag-limited velocity
- angular rotation based on torque and inertia

### 27.2 Recommended Formula Set
- `acceleration = thrust / mass`
- `velocity += acceleration * dt`
- `position += velocity * dt`
- `drag_force = drag_coefficient * velocity`
- `velocity -= drag_force * dt`

### 27.3 Collision Model
Recommended Version 1 approach:
- circular or simple convex collision for ships
- tile-based terrain collision
- projectile collision against terrain and entities

### 27.4 Performance Constraint
Physical simulation must remain simple enough to support several players, active projectiles, destructible terrain, and AI in a browser-friendly server environment.

---

## 28. World Data and Chunking

### 28.1 Tile Model
Recommended tile size:
- `32 px` logical tiles for finer terrain

Alternative:
- `64 px` if simulation needs lower density

### 28.2 Cell Types
- empty
- rock
- reinforced rock
- resource node
- hazard
- structure anchor

### 28.3 Chunk Lifecycle
- generate when approached
- activate when nearby players exist
- sleep when inactive
- persist summary state if necessary

### 28.4 Recommended World-Level Data Structures
```ts
type WorldId = string;
type MapId = string;
type ConnectionId = string;
type PlayerId = string;
type EntityId = string;

interface WorldGraph {
  worldId: WorldId;
  rootMapId: MapId;
  discoveredMapIds: MapId[];
  connectionIndex: Record<ConnectionId, MapConnection>;
  activeMapIds: MapId[];
}

interface PersistentWorld {
  id: WorldId;
  name: string;
  seed: string;
  createdAt: number;
  updatedAt: number;
  graph: WorldGraph;
  maps: Record<MapId, PersistentMapSummary>;
  playerIds: PlayerId[];
  paused: boolean;
}

interface PersistentMapSummary {
  id: MapId;
  seed: string;
  status: "undiscovered" | "discovered" | "active" | "sleeping";
  connectionIds: ConnectionId[];
  lastActivatedAt: number | null;
  biomeId?: string;
}

interface MapConnection {
  id: ConnectionId;
  sourceMapId: MapId;
  sourceAnchor: Vec2i;
  destinationMapId?: MapId;
  destinationAnchor?: Vec2i;
  type: "tunnel" | "gate" | "portal" | "shaft";
  discovered: boolean;
}
```

### 28.5 Recommended Active Map Data Structures
```ts
interface ActiveMapState {
  id: MapId;
  seed: string;
  width: number;
  height: number;
  chunks: Record<string, ChunkState>;
  entities: Record<EntityId, SimEntity>;
  structures: Record<EntityId, StructureState>;
  foundries: Record<EntityId, FoundryState>;
  connections: MapConnection[];
}

interface ChunkState {
  chunkX: number;
  chunkY: number;
  cells: Uint16Array;
  dirty: boolean;
  active: boolean;
}
```

---

## 29. Entity and Data Model

### 29.1 Core Entity Types
- player ship
- enemy
- projectile
- structure
- resource node
- loot drop
- environmental hazard

### 29.2 Recommended ECS-Style Components
- transform
- velocity
- collider
- health
- power
- weapon
- inventory
- AI state
- construction state

### 29.3 Persistent Player Save Shape
```ts
interface PlayerSave {
  playerId: PlayerId;
  worldId: WorldId;
  resourceCounts: ResourceMap;
  shipStable: Record<string, StoredShip>;
  activeShipId: string;
  spawnPoint: SpawnPoint;
  teamId: string | null;
  discoveredMapIds: MapId[];
  updatedAt: number;
}

interface SpawnPoint {
  mapId: MapId;
  position: Vec2;
}

interface StoredShip {
  id: string;
  name: string;
  hullId: string;
  modules: InstalledModule[];
  hullIntegrity: number;
  status: "stored" | "active" | "building";
  buildCompleteAt?: number | null;
}
```

### 29.4 Example Player Ship Shape
```ts
interface PlayerShip {
  id: string;
  playerId: string;
  mapId: MapId;
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  angularVelocity: number;
  hull: number;
  maxHull: number;
  power: number;
  maxPower: number;
  modules: ShipModule[];
  inventory: ResourceMap;
  statusEffects: StatusEffect[];
}
```

### 29.5 World Entity Shapes
```ts
interface StructureState {
  id: EntityId;
  mapId: MapId;
  ownerType: "player" | "enemy" | "neutral";
  ownerTeamId?: string | null;
  structureTypeId: string;
  position: Vec2;
  health: number;
  maxHealth: number;
  buildState: "planned" | "building" | "active" | "destroyed";
}

interface FoundryState extends StructureState {
  spawnCooldownMs: number;
  spawnCap: number;
  activeSpawnCount: number;
  lastSpawnAt: number;
  canRebuildDefenses: boolean;
}

interface EnemyState {
  id: EntityId;
  mapId: MapId;
  enemyTypeId: string;
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  health: number;
  aiState: string;
  sourceFoundryId?: EntityId | null;
}

interface LootDrop {
  id: EntityId;
  mapId: MapId;
  position: Vec2;
  resources: ResourceMap;
  ownerPlayerId?: PlayerId | null;
  protectedUntil?: number | null;
}
```

### 29.6 Content Definition Shapes
```ts
interface HullDefinition {
  id: string;
  name: string;
  category: "scout" | "healer" | "destroyer" | "miner" | "heavy";
  baseHull: number;
  mass: number;
  hardpoints: HardpointDefinition[];
  buildCost: ResourceMap;
  buildTimeMs: number;
}

interface HardpointDefinition {
  id: string;
  type:
    | "weapon"
    | "turret"
    | "support"
    | "utility"
    | "engine"
    | "armor"
    | "power"
    | "structural";
  localPosition: Vec2;
  orientation: Direction;
}

interface ModuleDefinition {
  id: string;
  name: string;
  slotType: string;
  mass: number;
  powerUse: number;
  maxHealth: number;
  rarity: "basic" | "improved" | "advanced" | "rare";
  buildCost: ResourceMap;
  craftTimeMs: number;
}
```

### 29.7 Recommended Supporting Types
```ts
type ResourceMap = Record<string, number>;

type Direction =
  | "north"
  | "south"
  | "east"
  | "west"
  | "northEast"
  | "northWest"
  | "southEast"
  | "southWest";

interface Vec2 {
  x: number;
  y: number;
}

interface Vec2i {
  x: number;
  y: number;
}

interface InstalledModule {
  moduleId: string;
  hardpointId: string;
  currentHealth: number;
}
```

---

## 30. Networking Model

### 30.1 Client to Server Messages
- movement input
- aim direction
- fire weapon
- activate support tool
- interact
- build or place structure
- inventory transfer

### 30.2 Server to Client Messages
- world snapshot delta
- entity spawn and despawn
- damage and repair events
- chunk reveal or unload
- room events
- objective state changes

### 30.3 Networking Priorities
- keep message schema compact
- avoid sending hidden chunk detail unnecessarily
- prioritize nearby combat-relevant data

### 30.4 Recommended Network Message Shapes
```ts
interface MoveInputMessage {
  type: "moveInput";
  thrustForward: boolean;
  thrustReverse: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  aimWorld: Vec2;
  tick: number;
}

interface FireWeaponMessage {
  type: "fireWeapon";
  weaponHardpointId: string;
  targetWorld?: Vec2;
  targetEntityId?: EntityId;
  tick: number;
}

interface ChangeMapMessage {
  type: "changeMap";
  connectionId: ConnectionId;
}

interface SelectShipMessage {
  type: "selectShip";
  shipId: string;
}
```

### 30.5 Replication Strategy
- replicate only the active map and any directly relevant local state to the client
- do not stream the full persistent world graph every frame
- send compact summaries for nearby connections, structures, and discovered exits
- send event messages for major transitions such as map changes, construction completion, destruction, and salvage ownership updates

---

## 31. AI Implementation Notes

### 31.1 Recommended First AI Stack
- finite state machine
- simple threat selection
- line-of-sight checks
- leash radius around structures or patrol zones

### 31.2 Later Improvements
- squad coordination
- retreat and repair behavior
- environmental destruction logic
- role-aware target prioritization

## 32. Runtime Module Responsibilities

### 32.1 Server Runtime Responsibilities
- `rooms/` manages player sessions and active world membership
- `simulation/maps/` loads, activates, sleeps, and transitions maps
- `simulation/physics/` applies thrust, drag, rotation, and collision
- `simulation/combat/` resolves hits, area damage, module destruction, and salvage drops
- `simulation/ai/` updates enemy state and foundry production
- `simulation/mining/` resolves terrain destruction and extraction yield
- `simulation/structures/` handles construction, repair, ownership, and rebuilding
- `persistence/` saves and restores player, world, and map state

### 32.2 Client Runtime Responsibilities
- `scenes/` handles login, lobby, gameplay, and builder-site UI flows
- `rendering/` draws terrain, ships, weapons, effects, minimap, and UI overlays
- `input/` captures controls and translates them into network commands
- `networking/` manages connection state, prediction, reconciliation, and map-change events
- `state/` stores replicated game state and local UI state
- `ui/` manages builder dialogs, stable views, HUD, and interaction prompts

### 32.3 Shared Package Responsibilities
- canonical identifiers and shared enums
- network message schemas
- serialization-safe data types
- math helpers and content references

---

## 33. Security and Fairness

### 33.1 Anti-Cheat Principles
- authoritative server simulation
- validate player actions and fire rates
- do not trust client inventory or damage reports

### 33.2 Abuse Prevention
- rate-limit chat and room joins
- protect early players from repeated salvage griefing
- restrict blocking structure placement in starter areas

---

## 34. Production Scope

### 34.1 Prototype Milestone Goals
Must prove:
- fun movement
- readable combat
- interesting mining and salvage
- satisfying co-op support
- stable PvP and PvE interactions
- technically stable persistent-world multiplayer

### 34.2 Vertical Slice Scope
Recommended vertical slice contents:
- one room type
- one starting region and one deeper region
- 3 to 4 ship archetypes achievable through modules
- 3 enemy types plus one mini-boss
- mining, building, destruction, healing, and salvage

### 34.3 Features to Defer
- advanced meta progression
- complex player trading economy
- large guild systems
- many biomes
- large boss roster

---

## 35. Prototype Feature Checklist

### 35.1 Version 1 Must-Haves
- account login
- persistent world join and reconnect flow
- top-down movement
- chunked destructible persistent map
- mining and collection
- chassis-based modular ship stats
- hull attachment point system
- one support tool
- two or three weapon types
- basic enemy AI
- salvage on death
- structure placement
- world state saving and loading

### 35.2 Version 1 Nice-to-Haves
- minimap fog of war
- advanced sensors
- guided missiles
- healer drone behavior
- richer persistent-world simulation while players are offline

---

## 36. Success Metrics

### 36.1 Design Validation Metrics
- players understand movement and mining without external help
- players can describe meaningful ship choices
- co-op groups naturally adopt different roles
- death feels punishing but recoverable

### 36.2 Technical Validation Metrics
- stable play with target room size
- acceptable latency compensation feel
- chunk streaming does not cause noticeable hitching
- server performance remains stable under combat load

---

## 37. Risks and Mitigations

### 37.1 Design Risks
#### Risk: Ship building becomes too complex too early
Mitigation: limit starting module set and expose tradeoffs gradually.

#### Risk: PvP griefing overwhelms cooperative play
Mitigation: use alliance systems, brief post-respawn protection, clear hostility indicators, and builder-site access rules to reduce griefing without removing PvP.

#### Risk: Recovery loops feel too punishing
Mitigation: use starter respawns, temporary salvage protection, or insured core parts.

### 37.2 Technical Risks
#### Risk: Destructible terrain plus multiplayer becomes too expensive
Mitigation: use chunked updates, simple tile rules, and aggressive culling.

#### Risk: Browser performance suffers during large fights
Mitigation: cap projectile counts, use pooling, and reduce off-screen simulation detail.

#### Risk: Networking corrections feel bad with thrust movement
Mitigation: tune prediction carefully and keep authoritative physics simple.

#### Risk: Indefinitely persistent worlds accumulate too much damaged or abandoned state
Mitigation: rely on paused-world behavior when empty, conservative save models, and later cleanup or admin tools if needed.

---

## 38. Direction Decisions Locked

The following major direction decisions are now treated as current design assumptions:

1. PvP and PvE are both core pillars from day one.
2. The game uses long-lived persistent worlds with saved state.
3. Ship construction is chassis-based with attachment points.
4. Hull-to-hull expansion is supported so larger ships can be assembled over time.
5. Death is a relatively soft setback, with meaningful salvage and partial persistence of progress.
6. Player and world progression persist as long as the world itself remains active.
7. Monetization is intentionally undecided for now.

---

## 39. Recommended Immediate Next Steps

1. Build a playable prototype covering movement, mining, combat, persistence, and ship builder site interaction.
2. Turn the hulls and module families into concrete data tables with costs, weights, power use, health, and build times.
3. Implement builder sites, stable access, and first-pass ship construction timers.
4. Prototype foundry production, local unit caps, and default defense rebuilding behavior.
5. Playtest PvP/PvE coexistence, especially griefing pressure, salvage recovery, and builder-site accessibility.
6. Revisit whether stable access should remain builder-site only or become available anywhere.

---

## End of Document
