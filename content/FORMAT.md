# THRESHOLD level authoring guide (format v1)

Levels are JSON files in `content/worlds/<world>/<id>.json`, typed by `shared/level.ts`
(`LevelDef`). Run `npm run validate:content` after authoring.

## Conventions
- **Units:** metres. **Y is up.** Player: height 1.7, radius 0.4, auto-steps up 0.55 m,
  jump clears ~1.3 m vertical / ~4 m horizontal gap. Walk speed 6 m/s.
- Floors are boxes whose TOP surface sits at the walkable height (e.g. a floor slab
  `pos:[0,-0.5,0], size:[20,1,20]` gives a walkable plane at y=0). Spawns go ~1 above the floor.
- Keep levels compact: a level is a handful of connected rooms/terraces, total footprint
  under ~90×90 m. Use verticality (ledges, drops) — combat wants cover and sightlines.
- **Budgets:** ≤ 20 enemies, ≤ 24 carryables, ≤ ~180 geometry entries per level
  (the open-world Nexus may go up to ~500 — the client distance-culls).
- Fog + emissive accents do the mood work. 90% of geometry uses cool materials
  (`stone`, `tile`, `metal`); reserve `accent` (warm `#ffd98a`) for interactable hints,
  `crystal` for glowy set-pieces. Add `emissive` sparingly.

## Geometry
```jsonc
{ "shape": "box", "pos": [x,y,z], "size": [w,h,d], "material": "stone" }
```
- `rotY` (radians): colliders only honour multiples of PI/2 ≈ 1.5708. Decorative geometry
  may use any rotY with `"collider": false`.
- `activeWhen: "rotator1.state==2"` — the box only exists (visual + collider) while the
  expression is true. This is how moving architecture and pulse-summoned bridges are
  authored: one box per state.
- `door: {"id":"gateA","openWhen":"p1.pressed && p2.pressed"}` — slides open while the
  expression is true. Give doors `material:"metal"` and a sensible size.
- `portalSurface: true` — legal wall for the Portal Device. Mark large flat walls only.

## Interactables (state exposed to expressions)
| type | fields | expression state |
|---|---|---|
| `plate` | `reads:"any"\|"mass"`, `threshold` (mass units; player=1, light carryable=1, heavy=3) | `<id>.pressed`, `<id>.mass` |
| `lever` | `states` (default 2, cycles on interact) | `<id>.state` (0-based) |
| `rotator` | `states` (cycles on interact; pairs with `visibleWhen`) | `<id>.state` |
| `switch` | `latched` (default true; else momentary 3 s) — activated by a **Pulse shot** | `<id>.on` |
| `carryable` | `mass:"light"\|"heavy"` (heavy needs 2 players grabbing, or Quick-Carry skill, or Tractor) , `kind` cosmetic | — |
| `collectible` | `grants:"<item>"`, `hidden` (true = shimmer only via Phase Sight) | `<id>.collected` |
| `socket` | `accepts:"<x>"` — filled by an inventory item (use_item) OR by setting down a carryable whose id/kind matches within 1.3m (docking) | `<id>.filled` |
| `emitter` | `dir:[x,y,z]` — traces a light beam, blocked by geometry/doors | — |
| `receiver` | lit when a beam reaches it | `<id>.lit` |
| `hazard` | `kind:"steam"\|"void"\|"spark"`, `freezable`, `dps` (default 20) | `<id>.frozen` |

Enemy state: `<enemyId>.down`, plus `allEnemiesDown` and `playersPresent`.

## Enemies
```jsonc
{ "type": "drifter"|"warden"|"sower"|"colossus", "id": "d1", "spawn": [x,y,z],
  "patrol": [[x,y,z],...], "weakTo": ["freeze-shatter"] }
```
- **drifter**: fodder, telegraphed lunge. **warden**: shielded — Pulse-stagger first.
- **sower**: spawns drifter adds until killed — positioning puzzle. **colossus**:
  two-role boss — a Tractor must expose its core before it takes damage. Use ONLY in
  strictly-co-op levels.
- Enemies never go in the Nexus.

## Portals
- Exit “Threshold” portal: `{ "id":"exit", "pos":..., "linkedTo":"nexus", "label":"Threshold", "requiresSolved": true }`.
  Every level MUST have one.
- `placeablePortals: {"enabled": true, "budgetPerPlayer": 2}` where the Portal Device should work.

## The puzzle block (every non-nexus level)
```jsonc
"puzzle": {
  "solved": "gate.open && allEnemiesDown",   // the co-op path: min players, base gear
  "shard": "<levelId>", "skillPoints": 1
}
```
**1.1 rules (validator-enforced):**
- Every level except the nexus and the `atrium-01` tutorial is **co-op**:
  `players.min >= 2`, coop tier `co-op-required` or `strictly-co-op`, and NO
  `soloSolution` (retired — hidden collectibles remain as secrets only).
- **Brainy depth:** `solved` (with door `openWhen` chains expanded) must span **>= 2
  interaction families beyond switches and combat**. Families: mass (plates/carryables),
  beam-item (emitter/receiver/socket/collectible), mechanism (rotator/lever),
  freeze (hazards), switch, combat. A pulse-switch may never be the effective final gate.
- `requiresDevice` may list only the Pulse, this level's own `grantsDevice`, or a
  device granted by a level with a lower Nexus shard gate.
- The `solved` expression must be reachable by `players.min` players with those
  devices and no items.

## Design language (spec §13)
Declare `coop` tier, `dependency` tags (`simultaneity`, `asymmetric-info`,
`asymmetric-ability`, `spatial-separation`, `sequential-relay`, `shared-carry`,
`sightline`), `encounters` tags (`environmental-kill`, `two-role`, `wave-under-pressure`,
`escort-hold`). No level introduces two new mechanics at once. Every level ends at a
visible Threshold portal; the shard chime moment should feel earned.

See `content/worlds/atrium/atrium-01.json` for a complete reference level.
