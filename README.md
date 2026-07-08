# THRESHOLD

A browser-based **cooperative 3D puzzle-adventure** for 1–4 players. Open the URL and
you drop straight into a shared Nexus lobby — no menus, no codes. Walk into a portal,
solve, fight, and cross the Threshold. Some levels you can beat alone; most are better —
or only possible — once you wave someone in.

![status](https://img.shields.io/badge/status-playable-a8f0c6) — 12 levels across 4 worlds,
4 dual-use devices, 4 enemy archetypes, a skill tree, and a shared drop-in lobby.

## Quick start

```bash
npm install
npm run build     # bundle the client
npm start         # serve everything on http://localhost:8080
```

Open `http://localhost:8080` in two browser windows (or send the URL to a friend on your
network) — both of you land in the same Nexus.

**Development** (client hot-reload on :5173, server on :8080, level JSON hot-reload):

```bash
npm run dev
```

**Checks:**

```bash
npm run typecheck              # strict TS across client/server/shared
npm run validate:content       # level format + design-invariant validation
npx tsx tools/playtest-bot.ts  # headless protocol bots: solo solve, co-op solve, down/revive
```

## How to play

| Input | Action |
|---|---|
| WASD + mouse | move + look (click to capture the mouse) |
| Space | jump (Double Jump is a skill) |
| E | interact — levers, wheels, pickups, sockets; **hold** to revive a downed partner |
| F | grab / set down carryables (heavy ones need two players… or the right skill) |
| LMB / RMB | fire equipped device (Portal Device: LMB = cyan, RMB = rose) |
| 1–4 / wheel | switch device |
| Enter | chat (instance-scoped; log + speech bubbles) |
| MMB | ping — drop a "look here" marker for your team |
| Q | raise a help beacon (visible to everyone in the Nexus) |
| L | loadout: equip devices, spend skill points, check inventory |
| T | place/recall your Echo (Echo Core skill) |
| V | Phase Sight (skill) — reveal hidden items |
| Esc | menu: settings, invite link, reset level, return to Nexus |

**Graphics (auto-scaling Low/Medium/High, set in Esc → menu):** traveling device
projectiles that fly, cast a dynamic light as they pass, and flash on impact; a
budgeted dynamic-light pool (portals, receivers, enemies, projectiles all cast real
light within a fixed budget instead of an unbounded pile); planar **mirror floors**
on the Nexus plaza and Observatory (a true reflection render — the "fake ray
tracing"); a first-person device viewmodel; per-world starfield/aurora skies and
weather particles. The tier auto-detects from your GPU and can be overridden; heavy
effects (reflections, projectile lights, weather) turn off on Low to hold 60fps.

**1.1 — "The Open Nexus":** the lobby is now a floating-island archipelago with
bridges, vista islets, and hidden stargems; every level except the First Light
tutorial is **co-op** — walk into a portal alone and you wait at the threshold
(visible as a beacon to everyone) until a partner joins you. Puzzles were reworked
to be genuinely multi-step: expect to ferry, sequence, aim, freeze, and coordinate,
not just shoot a switch. Boxes have real physics now (collision, restitution,
stacking, docking into sockets), everything replicated is interpolated smoothly,
and each world got a starfield sky, weather particles, and a visible held device.

**The loop:** clear a level → everyone present earns a **shard** (+skill points) → shards
unseal deeper portals in the Nexus. Progress, devices, skills, and best times persist in
your browser (guest identity; SQLite server-side).

**Devices are dual-use** — every weapon is also a puzzle tool:

- **Kinetic Pulse** (starter): trigger switches at range · stagger shields, shatter the frozen
- **Freeze Ray** (found in the Vaults): freeze steam and mechanisms · freeze enemies solid
- **Tractor Beam** (found in the Gardens): move blocks and hold plates · drag foes off ledges, expose a Colossus' core
- **Portal Device** (found deeper in the Gardens): place a linked portal pair · route yourself, your partner, or an enemy through impossible space

**Nobody gets walled out:** every co-op-required level is beatable by two players with
starter gear; hidden items, devices, and skills open *additive* solo routes. Downed
players are revived by partners or respawn at checkpoints — puzzle progress is never lost.
Strictly-co-op finales (the Colossus) have no solo route, by design.

## Architecture

```
/shared    protocol, level format + validator, expression evaluator, collision,
           palette/devices/skills/enemies — single source of truth for BOTH sides
/server    Node + ws. Instance manager (shared lobby + per-level instances),
           authoritative physics/AI/combat/puzzle state, SQLite persistence, telemetry
/client    Three.js WebGL2: procedural normal-mapped PBR + bloom, character controller,
           HUD, procedural WebAudio (adaptive music, spatial SFX)
/content   all levels as validated JSON — new levels need zero engine changes
/tools     content validator, headless playtest bots
```

- **Netcode:** movement is client-reported and server-sanity-checked; *everything else*
  (enemies, combat, health, puzzle state, physics bodies, portals, items) is
  server-authoritative. PvE only — no PvP, ever (that's what keeps this tractable).
- **Ticks:** 20 Hz per level instance, 10 Hz lobby. JSON protocol (see `shared/messages.ts`).
- **Persistence:** guest token in localStorage ↔ SQLite profile (shards, devices, skills,
  inventory, best times). Reconnect within 90 s drops you back into your live instance.
- Health: `GET /api/health` · Telemetry summary: `GET /api/telemetry`

## Authoring levels

Levels are JSON (`content/worlds/<world>/<id>.json`) — geometry, doors, moving
architecture, plates/levers/beams/hazards, enemies, checkpoints, and win conditions as
declarative expressions:

```jsonc
"puzzle": {
  "solved": "bellA.pressed && bellB.pressed && allEnemiesDown",  // base co-op path
  "soloSolution": "hoistMount.filled && allEnemiesDown",         // additive, gear-gated
  "shard": "my-level", "skillPoints": 1
}
```

See `content/FORMAT.md`. `npm run validate:content` enforces the design invariants
(base path never requires non-starter gear; strictly-co-op never has a solo route;
enemy/physics budgets). The server hot-reloads content in dev.

## Deploy

Single container: `docker build -t threshold . && docker run -p 8080:8080 -v threshold-data:/app/data threshold`

See `SPEC-CHANGES.md` for where this implementation deliberately diverges from the
original v1.0 spec and why.
