# THRESHOLD 1.2 — "Play It Together" (plan)

1.1 made the game look like a polished indie title. A multi-lens review after the
graphics overhaul (PR #3) scored it 2–5/10 against AAA on every axis, and the gap
is no longer rendering: it is **co-op plumbing, first-run bugs, feel & audio, and
puzzle depth**. 1.2 targets a credible *AA-lite co-op puzzler*, not AAA. No new
rendering features this cycle beyond loading/hitch work.

Each milestone leaves the game shippable. Gate for every milestone: `typecheck` +
`validate:content` + full bot suite **without** `THRESHOLD_DEV_UNLOCK` (new in M0)
+ a `tools/shots.ts` pass reviewed by eye.

## Decisions (settled 2026-09-30)
1. **Help beacons vs. shard gates:** joining a *hosted* instance (someone
   connected inside, via beacon, gate-wait or invite) ignores the joiner's own
   shard gate — a newer player can follow a friend anywhere. The gate still
   applies when nobody is there, so it can't open a sealed level solo. (M2)
2. **Solo fallback:** none for 1.2 — the co-op-required levels stay co-op.
   Revisit with telemetry on gate-wait abandonment.
3. **Content target:** 18 levels (+5), quality over count. (M4)
4. **Reset rule:** any player proposes, a majority confirms within 10 s; a solo
   instance resets immediately. (M2)

## M0 — Safety net (S, ~1–2 days) — do first — ✅ done
- GitHub Actions: `npm ci`, `typecheck`, `validate:content`, `build`, then boot
  the server and run `playtest-bot.ts` + `playtest-proving.ts`.
- Bots stop relying on `THRESHOLD_DEV_UNLOCK`: they log in with seeded guest
  profiles written straight into the server's store (`tools/test-profiles.ts`,
  no new server surface) and walk inside the move speed budget, so the real
  access checks and the move validator are exercised. The security suite keeps
  the negative test that a fresh profile is refused a sealed level.
- Promote the ad-hoc attack script to `tools/playtest-security.ts` in CI.
- Fix the flaky `observatory-01` bot step (give `clearEnemies` a budget based on
  enemy count, not a fixed 70 iterations).
- Unit tests (node:test, no new deps) for `shared/expr.ts`, `shared/validate.ts`,
  `shared/collision.ts`, and `validateLevel` cycle detection.

**Done when:** CI is green on PR #3's branch and red on a deliberately broken commit.

## M1 — First-run bug sweep (S, ~2 days) — ✅ done (objectives authored for atrium-01/02; the rest land with the M4 puzzle rework; `?join=` docs move to M2)
Confirmed bugs a new player hits in the first minutes:
- **Respawn ejects to Nexus:** `respawn()` never clears `armedPortals`
  (`server/instances.ts:732`); with spawn ~1 m from the back portal, dying
  before the first checkpoint teleports you out. Clear it + set
  `portalCooldownUntil` on respawn. Bot test: die at spawn, stay in level.
- **Two tabs evict each other:** `client/net.ts` must stop reconnecting on close
  code 4001 / `session_replaced`, and show "Playing in another tab — take over?".
- **Enter on the title screen opens chat;** guard with `started`/intro state.
- **Connection UI:** overlay for connecting / reconnecting / lost, with retry.
- **Objectives:** per-level `objectives` list in the level JSON (optional,
  validated), shown in the HUD, ticked by the same expressions as `solved`.
  Add a prompt for shoot-to-activate switches (`client/main.ts` focus logic).
- README: stop telling people to test with two windows on one profile (use a
  private window), document the `?join=` link.

**Done when:** a scripted fresh-profile run (title → atrium-01 → die → solve)
passes with no ejects, and the new bot tests are in CI.

## M2 — Co-op flow (M, ~1 week) — ✅ done
- **Instances per party, not per level.** Today `levels` is keyed by level id
  (`instances.ts:1325`, `:1358`), so one level = one global 4-player room.
  Key by instance id; the portal queue matches a party (or joins an existing
  non-full *public* instance only if the player opted in).
- **Parties:** a party is formed by invite link or by answering a beacon;
  party persists across levels and returns together to the Nexus.
- **Invite links that work:** "Copy invite" includes `?join=<lobby or instance>`
  (`client/hud.ts:577` currently copies the bare URL).
- **Reset vote** per decision 4.
- **Unique player colours:** the server assigns the first free accent in the
  instance, honouring the title-screen preference when free.
- **Waiting at a gate:** HUD chip "Waiting for a partner (1/2)" with cancel and a
  copy-invite button; beacon raised automatically after N seconds (opt-out).
- Server: per-instance player cap (4) stays; lobby cap 24 stays.

**Done when:** bot test with 6 players forming 3 parties runs 3 concurrent
instances of the same level; the invite link drops a second browser into the
inviter's instance.

## M3 — Feel & audio pass (M, ~1–1.5 weeks)
Movement and camera (`client/player.ts`):
- Fixed-timestep simulation (120 Hz) with render interpolation.
- Acceleration/friction ground model, air control, jump buffer + coyote time,
  variable jump height; keep server speed allowance in sync.
- Camera: landing dip, subtle FOV kick on dash, optional head-bob (setting),
  screen shake on nearby impacts (respects reduce-motion).
- **Portal traversal that feels right:** client detects crossing the portal
  plane with the body capsule, rotates position/velocity/yaw through the pair;
  server validates the crossing rather than using a feet-radius trigger
  (`instances.ts` ~1039).

Audio (`client/audio.ts`, untouched since first commit):
- Per-surface footsteps (material role → synth patch), jump/land, the unused
  `'jump'` cue wired, looping tractor/freeze/steam/conveyor sources.
- Convolution reverb with procedurally generated impulse responses per world;
  master compressor/limiter; music stingers on solve/shard/down.
- Spatial audio for peers' devices and enemy telegraphs.

**Done when:** a recorded side-by-side (old/new) of the atrium-01 route is
reviewed; no audio node leaks after 5 level transitions (count live nodes).

## M4 — Puzzle depth (L, ~2–3 weeks)
- **Fix the broken insights:** Meridian (`observatory-01`) reveals each ring's
  answer independently — gate on one combined success signal only. The Choir
  (`atrium-03`) is a 27-combination brute force — seed the answer per instance
  and give the clue to the *other* player.
- **Real interdependence:** role loadouts per level (e.g. one player gets
  Freeze, the other Tractor), information split across rooms, timed relays.
  Retire "partner stands on a `reads:'any'` plate" as the main co-op beat.
- **Use the whole toolbox:** resonators, scales, conveyors, prisms and mimics
  currently live only in the optional Proving Ground — build a 3–4 level arc
  per mechanic (teach → twist → combine). Grant the Portal Device earlier.
- Validator rules: no level's `solved` may be satisfiable by a single player's
  actions alone (static check of which interactables each role can reach).
- New levels per decision 3, each with a bot solve path in CI.

**Done when:** every level has a bot solve test and passes the new
interdependence validator; two human playtests per new level with notes.

## M5 — World identity (M, ~1 week)
- Geometry kit beyond boxes/cylinders in the level format: `arch`, `stair`,
  `lathe` (profile), `cornice`, `ramp` (visual shapes with box colliders).
- A distinct colour script per world (today 4 of 5 are cool indigo nights):
  warm dawn gardens, harsh white vaults, amber dusk atrium, deep night observatory.
- Distant landmark silhouettes per world; restore the Nexus sky nebula strength
  (`client/render/sky.ts` ~99) and lamp glow lost in the overhaul.

## M6 — Load & performance (M, ~1 week)
- Portal-transition curtain: build the level behind a fade, then
  `renderer.compileAsync(scene, camera)` before revealing; pre-warm shader
  variants (frost shell, dissolve, projectiles, beams, peer avatar) at boot.
- Move procedural texture generation to a worker (OffscreenCanvas) + cache in
  IndexedDB keyed by generator version.
- Code-split the bundle (dev galleries already excluded; split models/vfx/audio).
- Real-hardware profiling on an Intel iGPU laptop (Low) and a mid GPU (High);
  record frame-time budgets in `quality.ts` comments.

## Order and rationale
M0 → M1 → M2 → M3 → M4 → M5 → M6. The safety net comes first so every later
change is protected. First-run bugs and co-op flow come next because they
decide whether two players can even start playing together. Feel/audio precede
puzzles because every new level benefits from it. M5/M6 can run in parallel
with M4 once M2 lands, since they touch different files (render/ vs content/).

## Out of scope for 1.2
Accounts/login beyond the guest token, matchmaking with strangers beyond public
instances, gamepad and touch (plan for 1.3), localisation, narrative campaign.
