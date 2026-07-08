# THRESHOLD 1.1 — "The Open Nexus" (plan)

Playtest feedback driving this update: choppy box physics, boxes clipping through
walls, switch-shooting solving too many levels, world too plain, no chat, no icons,
lobby too small. Direction decisions (confirmed): **all levels co-op-required except
the First Light tutorial · per-instance chat with log + speech bubbles · brainy
(Portal/Talos-tier) puzzle difficulty.**

## A. Physics & game-feel (the bug fixes) — do first
1. **Replication interpolation buffer.** Bodies currently snap raw at 20 Hz inside the
   network handler → "2 fps" boxes. New `Interpolator` keeps a short snapshot history
   per replicated entity (bodies, enemies, remote players) and every render frame
   samples ~100 ms in the past with velocity extrapolation on gaps. One system, used
   by everything replicated.
2. **Server body physics v2.** Carryables get full AABB collision: axis-separated
   sweeps vs level colliders and other bodies, sliding, restitution on pulse impulse,
   stacking, and friction. Carried objects collide too (no feeding cubes through walls).
   Held-drop rule: releasing inside geometry pushes the box to the nearest free spot.
3. **Feel extras:** visible held device (first-person viewmodel with idle sway + fire
   kick), pulse impact particles + decal flash, boxes tumble visually with velocity.

## B. Puzzle-depth pass (brainy) — every level reworked
- **New validator rules (enforced):** a level's `solved` dependency graph must be ≥3
  steps deep, mix ≥2 interaction families (carry/plate, beam/prism, rotator, portal,
  freeze, socket), and a pulse switch may never be the final gate. Static analysis of
  the expression graph + interactable references; export blocked otherwise.
- **Rework the switch-heavy offenders** (The Choir, Cold Store, Root & Bloom, Meridian):
  beam-routing through rotatable prism mounts, mass-budget plates (fewer cubes than
  plates — ferry and re-plan), freeze-timing sequences (frozen fountains as temporary
  platforms that thaw), cross-room relays where each player operates what the other
  sees. Combat stays seasoning: environmental kills woven into the puzzle, never a
  DPS gate.
- **Difficulty target:** a coordinated pair should expect to stand and think; stuck
  moments resolved by observation, not pixel-hunting. Telemetry stall/solve-path data
  reviewed after ship to re-tune.

## C. Co-op gating
- Every level except `atrium-01` becomes `co-op-required` with a **hard entry gate**:
  walking into the portal alone shows "This threshold needs two" and offers
  one-key beacon raise; the portal glows for everyone in the Nexus while you wait.
  Chat + beacons are the pairing loop.
- Existing hidden-item solo *routes inside* levels are retired from win conditions;
  hidden collectibles remain as secrets (cosmetic shard variants / lore).
- Playtest bot suite updated: all level tests run as bot pairs.

## D. Open-world Nexus
- The walled square becomes a **floating-island archipelago** (~10× area): central
  plaza with the loadout pedestal, arched bridges, four outlying islands — one per
  world, dressed in that world's palette and holding its portals — plus vista islets,
  hidden collectibles, ambient non-combat wildlife (drifting motes, light-fish).
- Kept instanced + population-capped; chunked geometry with distance culling and AoI
  presence so the bigger space stays cheap. Falling off = soft respawn on the plaza.

## E. World beauty pass (all worlds)
- Procedural starfield skybox + per-world aurora bands; animated emissive trims.
- GPU particle systems: portal motes, vault snowfall, garden pollen, observatory
  star-dust, ember trails on aggroed enemies, shatter bursts, revive sparkles.
- Geometry dressing pass on every level: arches, trims, floating shards, foliage
  billboards (gardens), light pooling so interactables read from across the room.

## F. UI overhaul
- **Inline SVG icon set** (single sprite module): every device, skill, item, shard
  pip, beacon, downed marker, ping. Used in HUD device bar, loadout, skill tree,
  roster, chat.
- **Skill tree as a real graph:** two branches with connector lines, icon nodes,
  hover details, affordable-glow.
- **Chat:** Enter to type; per-instance scope; chat log panel (fades when idle) +
  speech bubble above the speaker's avatar; join/leave/solve system lines;
  rate-limited + sanitized server-side. **Quick-ping:** middle-click places a
  world-space "look here" marker visible to your instance.

## Ship order
A (feel fixes) → F (icons/chat — pairing loop needs it) → C (gating) → B (level
rework) → D (open Nexus) → E (beauty pass) — each step leaves the game playable;
full bot suite + browser pass re-run at every step.
