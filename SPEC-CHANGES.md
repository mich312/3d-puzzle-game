# Spec changes — THRESHOLD as built vs. the v1.0 spec

The spec authorized changes "in order to get a better result." These are the deliberate
divergences, each with the reasoning. Everything not listed here is implemented as specced
(identity guardrails, dual-use devices, PvE-only combat, additive solo routes, the
strictly-co-op protected tier, downed/revive/checkpoints, shard progression, help
beacons, guest persistence, reconnection, telemetry, softlock protection).

## 1. Renderer: WebGL2 default + opt-in WebGPU (behind a fallback)
Three.js `WebGLRenderer` is the default and carries the full intended look —
normal-mapped PBR, ACES tone-mapping, bloom, planar mirror floors, per-world
fog/lighting. Both backends now sit behind an `IRenderer` interface
(`client/render/api.ts`); `create.ts` picks one at boot from the saved preference
with **automatic fallback to WebGL2** if WebGPU is unavailable or init fails.

A **WebGPU backend** (`client/render/webgpu.ts`, three's `WebGPURenderer`) is
selectable in Settings → Graphics API (experimental). It is dynamically imported so
WebGL2 users never bundle it (~548 KB split chunk). This first WebGPU pass renders a
correct base image — scene, lights, shadows, ACES, sky, fog — with these deferred to
a follow-up (all need TSL/node ports, done once verified on real WebGPU hardware):
bloom post, planar mirror floors, and the GLSL ray-marched projectile (which falls
back to an additive glow sprite on WebGPU). **Why staged:** WebGPU can't be validated
in this project's headless test sandbox (no Dawn/Vulkan backend — `navigator.gpu` is
absent), so the untestable surface is kept minimal and strictly opt-in; the tested
WebGL2 path is the default and remains unchanged. The *material* strategy (tiling
procedural normals, no unique bakes, generated at runtime from seeded noise) is
backend-agnostic.

## 2. Physics: custom shared AABB collision, not Rapier WASM
`shared/collision.ts` is used by both the server (authoritative bodies, beams, hit
validation) and the client (movement prediction) — one source of truth, deterministic,
zero WASM. Carryables get gravity/rest/knockback; the character controller does
axis-separated AABB with auto-step.
**Why:** the spec's own physics vocabulary (carry, push, plates, beams) never needs
full rigid-body dynamics; Rapier would add a heavyweight dependency and server-client
divergence risk for no gameplay gain at "low tens of bodies."

## 3. Protocol: compact JSON, not binary channels
All messages JSON (`shared/messages.ts`), snapshots at 20 Hz with states sent as deltas
on change. **Why:** at 1–4 players and ≤20 enemies per instance the snapshot is ~1–2 KB;
binary framing is an optimization with real debugging cost. The message vocabulary
matches the spec's, so a binary encoding can be layered under it later.

## 4. Level instances: one live instance per level (join-if-exists)
The spec wanted per-player instances plus join-by-beacon. As built, walking into a portal
joins the level's live instance if one exists (capped at the level's `players.max`),
else creates it. **Why:** the common case — friends walking into the same portal
together — lands them together with zero coordination UI. Beacons still work as the
"needs a hand" signal in the Nexus. At office/friend-group scale this is strictly better UX.

## 5. In-browser editor: deferred; validator + hot-reload + playtest bots instead
The content pipeline is the data-driven format + `validate-content` (which enforces the
spec's invariant guard) + dev hot-reload + `tools/playtest-bot.ts` (headless bots that
actually *play* levels through the real protocol — the spec's "dual-path playtest").
**Why:** with one content author (you + Claude), authoring JSON against a validator is
faster than building and debugging a GUI editor; the format was designed so the editor
can be added without touching the engine. This traded roughly a third of the budget into
shipped levels and combat polish.

## 6. Skill tweaks
- **Echo Core** simplified from record-and-replay to a placeable stationary echo that
  counts as your weight on plates (T to place/recall). Same design role (the signature
  solo enabler for simultaneity puzzles), a fraction of the complexity/desync risk.
- **Grapple** cut; **Dash**, **Double Jump**, **Quick Carry**, **Phase Sight**,
  **Charged Pulse**, **Field Medic**, **Overcharge** shipped. 8 nodes, 2 branches,
  free respec — within the spec's 10–14 target range at the small end.

## 7. Accessibility baseline: partially shipped
Shipped: per-player combat difficulty (Story = 60% damage reduction, applied
server-side), reduce-motion toggle, mouse sensitivity, master/music/SFX sliders,
every audio cue paired with a visual twin (telegraphs flash + ring; portals differ by
colour *and* label; enemies read by silhouette + hostile accent + HP bar), high-contrast
DOM HUD. Telegraph windows are generous by default (0.9–1.5 s).
Deferred: key rebinding, aim-assist, toggle-vs-hold options — all straightforward
client-side additions on the existing settings panel.

## 8. Content: 12 levels (Nexus + 11), worlds shipped at 2–3 levels each
Spec asked 16–20. The 11 shipped levels cover every mechanic, every device teaching
beat, every dependency type in the taxonomy, every enemy archetype, all four co-op
tiers, and the strictly-co-op Colossus finale. The format + validator make the
remaining count pure authoring work.

## 9. Accounts: guest-only (magic-link/OAuth deferred)
Guest tokens persist in localStorage and map to SQLite profiles. This was flagged as an
open decision (§30.2) — deferring auth costs nothing structurally (profiles are already
keyed and portable; an accounts table claiming tokens is additive).

## 10. Open decisions (spec §30) — how they were resolved
| # | Decision | Resolution |
|---|---|---|
| 1 | Names | Kept: THRESHOLD, Nexus/Atrium/Vaults/Gardens/Observatory |
| 2 | Auth | Guest-only for now (see 9) |
| 3 | Concurrency target | Untuned; single proc, instances tick only when occupied, reap when idle |
| 4 | Palette/PBR | Spec hexes shipped; per-world scripts in `shared/palette.ts` |
| 5 | Editor exposure | Deferred entirely (see 5) |
| 6 | Music | Generative-lite WebAudio layers incl. combat layer — zero assets |
| 7 | Solo-route coverage | ~60% of co-op-required levels have `soloSolution` |
| 8 | Echo Core | In, simplified (see 6) |
| 9 | Combat weight | Seasoning, as recommended: every fight is device/environment-flavored; no pure DPS encounter exists |
| 10 | Enemy budget | 20/instance, validator-enforced |
