// HUD / menu stylesheet — one visual language for every screen-space element.
// Thin geometric lines, glassy panels (blur only on the few big panels), a display
// face (Rajdhani) over a clean UI face (Inter), accent theming through --acc.
// Everything scales with the #hud font-size (clamped to viewport height), so the
// layout reads the same at 1280x720 and 1920x1080.
export const HUD_CSS = `
@property --sp { syntax: '<length>'; inherits: true; initial-value: 0px; }
:root {
  --acc: #6ec6ff; --acc-rgb: 110,198,255;
  --gold: #ffd98a; --gold-rgb: 255,217,138;
  --mint: #a8f0c6; --ember: #e0654a; --ember-rgb: 224,101,74; --rose: #ff9ecb;
  --ink: #eceef6; --ink-2: rgba(236,238,246,0.72); --ink-3: rgba(236,238,246,0.46);
  --glass: rgba(10,12,24,0.62); --glass-2: rgba(16,18,34,0.78);
  --line: rgba(236,238,246,0.14); --line-2: rgba(236,238,246,0.26);
  --f-disp: 'Rajdhani', 'Bahnschrift', 'DIN Alternate', 'Segoe UI', system-ui, sans-serif;
  --f-ui: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-io: cubic-bezier(0.65, 0, 0.35, 1);
}
#hud, #hud *, #intro, #intro * { box-sizing: border-box; margin: 0; user-select: none; }
#hud {
  position: fixed; inset: 0; pointer-events: none; color: var(--ink); z-index: 10;
  font-family: var(--f-ui); font-size: clamp(13px, calc(1.05vh + 6px), 18px);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
#hud .disp { font-family: var(--f-disp); }
.hud-shadow, #levelinfo, #roster, #health, #shards .lbl { text-shadow: 0 1px 2px rgba(0,0,0,0.7), 0 0 12px rgba(0,0,0,0.35); }

/* ---------- shared panel ---------- */
#hud .panel {
  background: linear-gradient(180deg, rgba(20,22,40,0.72), rgba(10,12,24,0.66));
  border: 1px solid var(--line); border-radius: 3px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05);
}
.kc {
  display: inline-flex; align-items: center; justify-content: center; min-width: 1.75em; height: 1.75em; padding: 0 0.45em;
  font-family: var(--f-disp); font-weight: 700; font-size: 0.95em; line-height: 1; color: #15131f;
  background: linear-gradient(180deg, #fff6df, var(--gold)); border-radius: 3px;
  box-shadow: 0 2px 0 rgba(120,90,30,0.9), 0 0 14px rgba(var(--gold-rgb),0.35);
}
.kc.ghost { color: var(--ink); background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px var(--line-2), 0 2px 0 rgba(0,0,0,0.5); font-weight: 600; }

/* ---------- crosshair ---------- */
#crosshair { position: absolute; left: 50%; top: 50%; width: 0; height: 0; --sp: 0px; transition: --sp 0.28s var(--ease); }
#crosshair.fire { --sp: 7px; transition: --sp 0.05s linear; }
#crosshair .c-dot { position: absolute; left: -2px; top: -2px; width: 4px; height: 4px; border-radius: 50%; background: #fff; box-shadow: 0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(255,255,255,0.35); }
#crosshair .t { position: absolute; background: rgba(255,255,255,0.82); box-shadow: 0 0 2px rgba(0,0,0,0.9); }
#crosshair .t-u, #crosshair .t-d { width: 2px; height: 6px; left: -1px; }
#crosshair .t-l, #crosshair .t-r { width: 6px; height: 2px; top: -1px; }
#crosshair .t-u { top: calc(-12px - var(--sp)); }
#crosshair .t-d { top: calc(6px + var(--sp)); }
#crosshair .t-l { left: calc(-12px - var(--sp)); }
#crosshair .t-r { left: calc(6px + var(--sp)); }
#crosshair .hm { position: absolute; left: 0; top: 0; opacity: 0; }
#crosshair .hm i { position: absolute; width: 9px; height: 2px; left: -4.5px; top: -1px; background: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.8), 0 0 2px #000; }
#crosshair .hm i:nth-child(1) { transform: rotate(45deg) translateX(11px); }
#crosshair .hm i:nth-child(2) { transform: rotate(135deg) translateX(11px); }
#crosshair .hm i:nth-child(3) { transform: rotate(225deg) translateX(11px); }
#crosshair .hm i:nth-child(4) { transform: rotate(315deg) translateX(11px); }
#crosshair .hm.on { animation: hitmark 0.32s var(--ease) forwards; }
#crosshair .hm.kill i { background: var(--ember); box-shadow: 0 0 8px rgba(var(--ember-rgb),0.9), 0 0 2px #000; }
@keyframes hitmark { 0% { opacity: 1; transform: scale(1.45); } 30% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.05); } }
#hud.focus #crosshair .c-dot { background: var(--gold); box-shadow: 0 0 8px rgba(var(--gold-rgb),0.9); }

/* revive ring (around crosshair; also the downed player's progress) */
#reviveBar { position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px; display: none; }
#reviveBar svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
#reviveBar .bg { stroke: rgba(255,255,255,0.16); }
#reviveBar .fg { stroke: var(--mint); filter: drop-shadow(0 0 4px rgba(168,240,198,0.8)); transition: stroke-dashoffset 0.12s linear; }
#reviveBar .rv-lbl { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 6px; white-space: nowrap; font-family: var(--f-disp); font-weight: 600; font-size: 0.8em; letter-spacing: 0.24em; color: var(--mint); text-shadow: 0 1px 3px #000; }

/* ---------- interact prompt: key-cap chip beside the crosshair ---------- */
#prompt { position: absolute; left: calc(50% + 2.4em); top: calc(50% + 1.3em); display: none; align-items: center; gap: 0.6em; padding: 0.3em 0.9em 0.3em 0.35em; font-size: 0.95em; border-radius: 3px;
  background: linear-gradient(90deg, rgba(10,12,24,0.78), rgba(10,12,24,0.35)); border-left: 2px solid var(--gold); animation: chipIn 0.22s var(--ease); white-space: nowrap; }
#prompt .pl { color: var(--ink); letter-spacing: 0.01em; }
#prompt .pl em { font-style: normal; font-family: var(--f-disp); font-weight: 700; letter-spacing: 0.16em; color: var(--gold); margin-right: 0.3em; font-size: 0.9em; }
@keyframes chipIn { from { opacity: 0; transform: translateX(-8px); } }

/* ---------- level info (top-left, fades after a few seconds) ---------- */
#levelinfo { position: absolute; top: 1.4em; left: 1.6em; padding: 0.1em 0 0.2em 0.9em; border-left: 2px solid var(--acc); transition: opacity 1.2s var(--ease), transform 1.2s var(--ease); max-width: 32em; }
#levelinfo.faded { opacity: 0; transform: translateX(-6px); }
#levelinfo .tier { font-family: var(--f-disp); font-weight: 600; font-size: 0.78em; letter-spacing: 0.28em; text-transform: uppercase; color: var(--acc); }
#levelinfo b { display: block; font-family: var(--f-disp); font-weight: 700; font-size: 1.55em; letter-spacing: 0.04em; line-height: 1.1; }
#levelinfo .obj { font-size: 0.82em; color: var(--ink-2); margin-top: 0.15em; }

/* ---------- shard pips (top-centre) ---------- */
#shards { position: absolute; top: 1.3em; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 0.36em; }
#shards .pip { width: 0.62em; height: 0.9em; clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); background: rgba(236,238,246,0.2); transition: background 0.4s; }
#shards .pip.on { background: linear-gradient(180deg, #fff3d0, var(--gold)); filter: drop-shadow(0 0 4px rgba(var(--gold-rgb),0.8)); }
#shards .pip.gain { animation: pipGain 1.1s var(--ease); }
@keyframes pipGain { 0% { transform: scale(2.4) rotate(90deg); filter: brightness(3) drop-shadow(0 0 10px var(--gold)); } 60% { transform: scale(0.9); } 100% { transform: none; } }
#shards .lbl { font-family: var(--f-disp); font-weight: 600; font-size: 0.8em; letter-spacing: 0.18em; color: var(--ink-2); margin-left: 0.5em; }
#shards .lbl b { color: var(--gold); font-weight: 700; }
#shards::before, #shards::after { content: ''; width: 2.4em; height: 1px; background: linear-gradient(90deg, transparent, var(--line-2)); margin-right: 0.3em; }
#shards::after { background: linear-gradient(90deg, var(--line-2), transparent); margin: 0 0 0 0.3em; }
#shardcall { position: absolute; top: 2.9em; left: 50%; transform: translateX(-50%); font-family: var(--f-disp); font-weight: 700; letter-spacing: 0.34em; font-size: 0.9em; color: var(--gold); opacity: 0; white-space: nowrap; text-shadow: 0 0 12px rgba(var(--gold-rgb),0.7), 0 1px 2px #000; }
#shardcall.on { animation: callout 2.6s var(--ease) forwards; }
@keyframes callout { 0% { opacity: 0; letter-spacing: 0.8em; } 15% { opacity: 1; letter-spacing: 0.34em; } 75% { opacity: 1; } 100% { opacity: 0; } }

/* ---------- roster (top-right) ---------- */
#roster { position: absolute; top: 1.3em; right: 1.6em; min-width: 12em; display: flex; flex-direction: column; gap: 0.35em; }
#roster .row { display: grid; grid-template-columns: 0.6em auto 1fr; align-items: center; gap: 0.3em 0.55em; font-size: 0.9em; }
#roster .dot { width: 0.55em; height: 0.55em; transform: rotate(45deg); border-radius: 1px; box-shadow: 0 0 6px currentColor; }
#roster .nm { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 9em; }
#roster .self .nm { color: var(--acc); }
#roster .hp { height: 3px; min-width: 4em; background: rgba(255,255,255,0.14); overflow: hidden; }
#roster .hp i { display: block; height: 100%; background: var(--mint); transition: width 0.3s var(--ease); }
#roster .down .nm { color: var(--ember); }
#roster .down .hp i { background: var(--ember); animation: lowpulse 0.9s ease-in-out infinite; }
#roster .down .dot { animation: lowpulse 0.9s ease-in-out infinite; }

/* ---------- health (bottom-left) ---------- */
#health { position: absolute; bottom: 1.8em; left: 1.8em; width: 17em; }
#health .hp-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.3em; }
#health .lbl { font-family: var(--f-disp); font-weight: 600; font-size: 0.78em; letter-spacing: 0.3em; color: var(--ink-2); display: flex; align-items: center; gap: 0.5em; }
#health .lbl svg { color: var(--mint); }
#health .num { font-family: var(--f-disp); font-weight: 700; font-size: 1.6em; line-height: 1; letter-spacing: 0.02em; }
#health .num small { font-size: 0.5em; color: var(--ink-3); margin-left: 0.15em; letter-spacing: 0.1em; }
#health .bar { position: relative; height: 0.62em; background: rgba(8,10,20,0.6); clip-path: polygon(0.45em 0, 100% 0, calc(100% - 0.45em) 100%, 0 100%); box-shadow: inset 0 0 0 1px var(--line); }
#health .bar i, #health .bar b { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; }
#health .bar b { background: #f3efe6; opacity: 0.8; transition: width 0.7s var(--ease-io) 0.35s; }
#health .bar i { background: linear-gradient(90deg, var(--mint), color-mix(in srgb, var(--mint) 55%, var(--acc))); transition: width 0.12s linear; box-shadow: 0 0 10px rgba(168,240,198,0.4); }
#health .bar .seg { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 2px), rgba(6,8,16,0.9) calc(10% - 2px) 10%); }
#health.low .bar i { background: linear-gradient(90deg, #ff8a6a, var(--ember)); box-shadow: 0 0 12px rgba(var(--ember-rgb),0.7); animation: lowpulse 0.9s ease-in-out infinite; }
#health.low .num { color: #ff9a80; }
#health.low .lbl svg { color: var(--ember); animation: lowpulse 0.9s ease-in-out infinite; }
@keyframes lowpulse { 50% { opacity: 0.45; } }

/* ---------- device bar (bottom-right) ---------- */
#devices { position: absolute; bottom: 1.8em; right: 1.8em; display: flex; gap: 0.5em; }
#devices .dv-sel { position: absolute; left: 0; top: 0; width: 4.8em; height: 100%; pointer-events: none; transition: transform 0.28s var(--ease);
  border: 1px solid var(--acc); box-shadow: 0 0 14px rgba(var(--acc-rgb),0.45), inset 0 0 12px rgba(var(--acc-rgb),0.18); border-radius: 3px; }
#devices .dv-sel::before, #devices .dv-sel::after { content: ''; position: absolute; left: 50%; width: 1.2em; height: 2px; margin-left: -0.6em; background: var(--acc); }
#devices .dv-sel::before { top: -4px; } #devices .dv-sel::after { bottom: -4px; }
#devices .slot { position: relative; width: 4.8em; padding: 0.55em 0.3em 0.45em; text-align: center; border-radius: 3px; overflow: hidden;
  background: linear-gradient(180deg, rgba(20,22,40,0.62), rgba(8,10,20,0.7)); border: 1px solid var(--line); transition: opacity 0.25s, transform 0.25s var(--ease); opacity: 0.62; }
#devices .slot.eq { opacity: 1; transform: translateY(-3px); }
#devices .slot svg { display: block; margin: 0 auto 0.2em; width: 1.6em; height: 1.6em; filter: drop-shadow(0 0 5px currentColor); }
#devices .slot .nm { font-family: var(--f-disp); font-weight: 600; font-size: 0.78em; letter-spacing: 0.14em; text-transform: uppercase; }
#devices .slot .k { position: absolute; top: 0.3em; left: 0.35em; font-family: var(--f-disp); font-weight: 700; font-size: 0.7em; color: var(--ink-3); }
#devices .slot .pips { display: flex; justify-content: center; gap: 3px; height: 0.8em; align-items: center; margin-top: 0.15em; font-size: 0.75em; color: var(--ink-3); }
#devices .slot .pips i { width: 0.7em; height: 3px; background: rgba(255,255,255,0.18); }
#devices .slot .pips i.on { background: var(--dc, var(--acc)); box-shadow: 0 0 5px var(--dc, var(--acc)); }
#devices .slot .cd { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--dc, var(--acc)); opacity: 0.9; }
#devices .slot.cool svg { opacity: 0.45; }

/* ---------- hints / gate / toasts ---------- */
#hud #hint { position: absolute; bottom: 24%; left: 50%; transform: translateX(-50%); font-size: 0.92em; padding: 0.45em 1.1em; display: none; white-space: nowrap; letter-spacing: 0.02em;
  background: linear-gradient(90deg, transparent, rgba(10,12,24,0.72) 15%, rgba(10,12,24,0.72) 85%, transparent); border: 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 0; box-shadow: none; }
#gate { position: absolute; top: 4.6em; left: 50%; transform: translateX(-50%); font-size: 0.92em; padding: 0.55em 1.2em; display: none; border-color: rgba(var(--gold-rgb),0.5) !important; max-width: 80vw; }
#gate svg { vertical-align: -3px; margin-right: 0.5em; color: var(--gold); }
#toasts { position: absolute; left: 50%; top: 5.2em; transform: translateX(-50%); display: flex; flex-direction: column; gap: 0.4em; align-items: center; width: min(40em, 90vw); }
#toasts .toast { padding: 0.5em 1.1em 0.5em 0.95em; font-size: 0.92em; line-height: 1.4; text-align: center; border-left: 2px solid var(--acc);
  background: linear-gradient(90deg, rgba(10,12,24,0.86), rgba(10,12,24,0.7)); box-shadow: 0 6px 20px rgba(0,0,0,0.3); animation: toastIn 0.3s var(--ease), toastOut 0.5s ease-in 3.7s forwards; }
#toasts .toast.success { border-left-color: var(--mint); color: #dcfbe9; }
#toasts .toast.warn { border-left-color: var(--ember); color: #ffd2c6; }
@keyframes toastIn { from { opacity: 0; transform: translateY(-8px); } }
@keyframes toastOut { to { opacity: 0; transform: translateY(-4px); } }

/* ---------- beacons (lobby) ---------- */
#beacons { position: absolute; left: 1.6em; top: 7.5em; display: flex; flex-direction: column; gap: 0.45em; max-width: 21em; }
#beacons .b { padding: 0.55em 0.85em; font-size: 0.88em; line-height: 1.4; pointer-events: auto; cursor: pointer; border-left: 2px solid var(--gold) !important; transition: transform 0.2s var(--ease), border-color 0.2s; }
#beacons .b:hover { transform: translateX(3px); border-color: rgba(var(--gold-rgb),0.6) !important; }
#beacons .b .lvl { color: var(--gold); font-weight: 600; }
#beacons .b u { text-decoration: none; color: var(--acc); }

/* ---------- chat ---------- */
#chatlog { position: absolute; left: 1.8em; bottom: 7.2em; width: 25em; max-height: 15em; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; font-size: 0.88em; }
#chatlog .line { padding: 0.28em 0.7em; background: linear-gradient(90deg, rgba(10,12,24,0.7), rgba(10,12,24,0)); line-height: 1.4; transition: opacity 1s; word-wrap: break-word; border-left: 1px solid var(--line-2); }
#chatlog .line .who { font-weight: 600; margin-right: 0.5em; }
#chatlog .line.sys { color: var(--ink-2); font-style: italic; }
#chatlog.dim .line { opacity: 0.28; }
#chatinput { position: absolute; left: 1.8em; bottom: 5.2em; width: 25em; display: none; pointer-events: auto; }
#chatinput input { width: 100%; background: rgba(10,12,24,0.92); border: 1px solid var(--acc); color: var(--ink); padding: 0.55em 0.8em; border-radius: 3px; font: inherit; font-size: 0.95em; outline: none; box-shadow: 0 0 14px rgba(var(--acc-rgb),0.25); }

/* ---------- screen-space feedback ---------- */
#vignette { position: absolute; inset: 0; opacity: 0; transition: opacity 0.35s; background: radial-gradient(ellipse 75% 70% at 50% 50%, transparent 55%, rgba(var(--ember-rgb),0.5) 100%); }
#vignette.low { opacity: 0.55; animation: vigpulse 1.3s ease-in-out infinite; }
#vignette.hit { opacity: 1; transition: opacity 0.05s; }
@keyframes vigpulse { 50% { opacity: 0.3; } }
#dmgdir { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
#dmgdir .arc { position: absolute; left: -9em; top: -9em; width: 18em; height: 18em; border-radius: 50%; opacity: 0;
  background: radial-gradient(circle at 50% 0%, rgba(var(--ember-rgb),0.95), rgba(var(--ember-rgb),0) 35%);
  -webkit-mask: radial-gradient(circle, transparent 62%, #000 64%, #000 70%, transparent 72%); mask: radial-gradient(circle, transparent 62%, #000 64%, #000 70%, transparent 72%); }
#dmgdir .arc.on { animation: dmgArc 1.1s ease-out forwards; }
@keyframes dmgArc { 0% { opacity: 1; } 60% { opacity: 0.8; } 100% { opacity: 0; } }
#downed { position: absolute; inset: 0; display: none; align-items: center; justify-content: flex-start; flex-direction: column; padding-top: 30vh; gap: 0.5em;
  background: radial-gradient(ellipse at 50% 50%, rgba(40,8,12,0.1) 30%, rgba(40,6,10,0.78)); backdrop-filter: grayscale(0.85) brightness(0.8); -webkit-backdrop-filter: grayscale(0.85) brightness(0.8); animation: fadeIn 0.6s var(--ease); }
#downed .dn-t { font-family: var(--f-disp); font-weight: 700; font-size: 2.6em; letter-spacing: 0.5em; padding-left: 0.5em; color: #ffb3a3; text-shadow: 0 0 24px rgba(var(--ember-rgb),0.8); }
#downed .dn-t svg { vertical-align: middle; margin-right: 0.3em; }
#downed .sub { font-size: 0.95em; color: var(--ink-2); letter-spacing: 0.03em; }
@keyframes fadeIn { from { opacity: 0; } }
#levelcard { position: absolute; left: 50%; top: 24%; transform: translateX(-50%); text-align: center; opacity: 0; white-space: nowrap; isolation: isolate; }
#levelcard::before, #banner::before { content: ''; position: absolute; inset: -3em -8em; z-index: -1; background: radial-gradient(ellipse closest-side, rgba(6,8,18,0.55), rgba(6,8,18,0.25) 60%, transparent); }
#levelcard.on { animation: cardLife 4.2s var(--ease) forwards; }
#levelcard .lc-world { font-family: var(--f-disp); font-weight: 600; font-size: 0.95em; letter-spacing: 0.6em; padding-left: 0.6em; color: var(--acc); text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
#levelcard .lc-name { font-family: var(--f-disp); font-weight: 700; font-size: 3.6em; letter-spacing: 0.08em; line-height: 1.05; margin: 0.08em 0; text-shadow: 0 2px 18px rgba(0,0,0,0.55); }
#levelcard .lc-line { height: 1px; width: 26em; margin: 0.4em auto; background: linear-gradient(90deg, transparent, var(--acc), transparent); transform-origin: center; }
#levelcard.on .lc-line { animation: lineGrow 1.1s var(--ease) both; }
#levelcard .lc-sub { font-size: 0.85em; letter-spacing: 0.26em; text-transform: uppercase; color: var(--ink-2); text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
@keyframes cardLife { 0% { opacity: 0; transform: translate(-50%, 8px); } 14% { opacity: 1; transform: translate(-50%, 0); } 78% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -6px); } }
@keyframes lineGrow { from { transform: scaleX(0); } }
#letterbox i { position: absolute; left: 0; right: 0; height: 9vh; background: #04050a; transform: scaleY(0); transition: transform 0.9s var(--ease-io); }
#letterbox i:first-child { top: 0; transform-origin: top; } #letterbox i:last-child { bottom: 0; transform-origin: bottom; }
#letterbox.on i { transform: scaleY(1); }
#banner { position: absolute; left: 50%; top: 32%; transform: translateX(-50%); text-align: center; display: none; white-space: nowrap; isolation: isolate; }
#banner.on { display: block; animation: cardLife 4.5s var(--ease) forwards; }
#banner .bn-mark { color: var(--gold); margin-bottom: 0.4em; filter: drop-shadow(0 0 10px rgba(var(--gold-rgb),0.8)); }
#banner h2 { font-family: var(--f-disp); font-weight: 700; letter-spacing: 0.42em; padding-left: 0.42em; font-size: 2.8em; color: var(--gold); text-shadow: 0 0 28px rgba(var(--gold-rgb),0.6), 0 2px 4px rgba(0,0,0,0.6); }
#banner .lc-line { height: 1px; width: 30em; margin: 0.5em auto; background: linear-gradient(90deg, transparent, var(--gold), transparent); }
#banner.on .lc-line { animation: lineGrow 1.1s var(--ease) both; }
#banner p { color: var(--ink); font-size: 1em; letter-spacing: 0.06em; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }

/* ---------- big panels (loadout / menu) ---------- */
#scrim { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, rgba(6,7,14,0.45), rgba(4,5,10,0.82)); opacity: 0; transition: opacity 0.3s; }
#hud.panel-open #scrim { opacity: 1; }
#hud.panel-open > :not(.bigpanel):not(#scrim):not(#toasts):not(#tip) { opacity: 0; transition: opacity 0.2s; }
.bigpanel { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(58em, 94vw); max-height: 88vh; overflow-y: auto; padding: 1.6em 1.9em 1.7em; pointer-events: auto; display: none;
  background: linear-gradient(180deg, rgba(18,20,38,0.8), rgba(8,10,20,0.84)) !important; backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2);
  border: 1px solid var(--line-2) !important; animation: panelIn 0.32s var(--ease); scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent; }
.bigpanel::before { content: ''; position: absolute; left: 0; top: 0; width: 5em; height: 2px; background: var(--acc); box-shadow: 0 0 10px var(--acc); }
@keyframes panelIn { from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)); } }
.bigpanel .ph { display: flex; align-items: baseline; gap: 1em; padding-bottom: 0.7em; margin-bottom: 1em; border-bottom: 1px solid var(--line); }
.bigpanel h2 { font-family: var(--f-disp); font-weight: 700; font-size: 1.9em; letter-spacing: 0.3em; color: var(--ink); line-height: 1; }
.bigpanel .ph .sub { font-family: var(--f-disp); font-weight: 600; letter-spacing: 0.26em; font-size: 0.8em; color: var(--acc); }
.bigpanel h3 { display: flex; align-items: center; gap: 0.8em; margin: 1.3em 0 0.7em; font-family: var(--f-disp); font-weight: 700; font-size: 0.85em; letter-spacing: 0.3em; color: var(--ink-2); }
.bigpanel h3::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, var(--line-2), transparent); }
.bigpanel h3:first-child { margin-top: 0; }
.bigpanel .close { position: absolute; top: 1.1em; right: 1.2em; cursor: pointer; width: 2em; height: 2em; display: flex; align-items: center; justify-content: center; color: var(--ink-2); border: 1px solid var(--line); border-radius: 3px; transition: color 0.2s, border-color 0.2s; font-size: 0.9em; }
.bigpanel .close:hover { color: var(--ink); border-color: var(--acc); }
.bigpanel button { pointer-events: auto; font: inherit; font-family: var(--f-disp); font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; font-size: 0.88em;
  background: rgba(255,255,255,0.04); color: var(--ink); border: 1px solid var(--line-2); border-radius: 3px; padding: 0.6em 1.1em; cursor: pointer; transition: background 0.2s, border-color 0.2s, color 0.2s; display: inline-flex; align-items: center; gap: 0.5em; white-space: nowrap; }
.bigpanel button:hover { border-color: var(--acc); background: rgba(var(--acc-rgb),0.1); }
.bigpanel button:focus-visible, .bigpanel input:focus-visible, .sw:focus-visible, #intro button:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
.bigpanel button.primary { background: rgba(var(--acc-rgb),0.16); border-color: var(--acc); color: #fff; }
.bigpanel button.danger:hover { border-color: var(--ember); background: rgba(var(--ember-rgb),0.12); }
.bigpanel button.sm { padding: 0.35em 0.8em; font-size: 0.72em; }

/* menu */
.mn-grid { display: grid; grid-template-columns: 1fr 15em; gap: 2em; }
@media (max-width: 760px) { .mn-grid { grid-template-columns: 1fr; } }
.mn-actions { display: flex; flex-direction: column; gap: 0.5em; }
.mn-actions button { justify-content: flex-start; width: 100%; }
.mn-actions .sep { height: 1px; background: var(--line); margin: 0.4em 0; }
.st-row { display: grid; grid-template-columns: 11em 1fr 3em; align-items: center; gap: 1em; padding: 0.5em 0; font-size: 0.92em; border-bottom: 1px solid rgba(255,255,255,0.05); }
.st-row.wide { grid-template-columns: 11em 1fr; }
.st-row > span:first-child { color: var(--ink-2); }
.st-row output { font-family: var(--f-disp); font-weight: 700; text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; }
.st-note { grid-column: 2 / -1; font-size: 0.8em; color: var(--ink-3); margin-top: -0.2em; }
.bigpanel input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 1.4em; background: transparent; cursor: pointer; --v: 50%; }
.bigpanel input[type=range]::-webkit-slider-runnable-track { height: 3px; background: linear-gradient(90deg, var(--acc) var(--v), rgba(255,255,255,0.16) var(--v)); }
.bigpanel input[type=range]::-moz-range-track { height: 3px; background: linear-gradient(90deg, var(--acc) var(--v), rgba(255,255,255,0.16) var(--v)); }
.bigpanel input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 0.8em; height: 1.1em; margin-top: calc(-0.55em + 1.5px); background: #fff; border-radius: 1px; box-shadow: 0 0 0 2px var(--acc), 0 0 10px rgba(var(--acc-rgb),0.6); transform: skewX(-12deg); }
.bigpanel input[type=range]::-moz-range-thumb { width: 0.8em; height: 1.1em; background: #fff; border: 0; border-radius: 1px; box-shadow: 0 0 0 2px var(--acc); }
.segc { display: inline-flex; border: 1px solid var(--line-2); border-radius: 3px; overflow: hidden; }
.segc button { border: 0 !important; border-radius: 0 !important; border-right: 1px solid var(--line) !important; padding: 0.45em 1em !important; font-size: 0.78em !important; background: transparent !important; color: var(--ink-2) !important; }
.segc button:last-child { border-right: 0 !important; }
.segc button:hover { color: var(--ink) !important; background: rgba(255,255,255,0.05) !important; }
.segc button.on { background: rgba(var(--acc-rgb),0.2) !important; color: #fff !important; box-shadow: inset 0 -2px 0 var(--acc); }
.tgl { position: relative; display: inline-block; width: 2.6em; height: 1.35em; cursor: pointer; }
.tgl input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.tgl span { position: absolute; inset: 0; border: 1px solid var(--line-2); border-radius: 1em; background: rgba(255,255,255,0.05); transition: background 0.2s, border-color 0.2s; pointer-events: none; }
.tgl span::after { content: ''; position: absolute; top: 50%; left: 0.2em; width: 0.9em; height: 0.9em; margin-top: -0.45em; border-radius: 50%; background: var(--ink-2); transition: transform 0.25s var(--ease), background 0.2s; }
.tgl input:checked + span { background: rgba(var(--acc-rgb),0.25); border-color: var(--acc); }
.tgl input:checked + span::after { transform: translateX(1.2em); background: #fff; box-shadow: 0 0 8px var(--acc); }
.tgl input:focus-visible + span { outline: 2px solid var(--acc); outline-offset: 2px; }
.swatches { display: flex; gap: 0.55em; align-items: center; }
.sw { width: 1.5em; height: 1.5em; border: 0; padding: 0 !important; cursor: pointer; background: var(--c) !important; clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); transition: transform 0.2s var(--ease), filter 0.2s; pointer-events: auto; }
.sw:hover { transform: scale(1.15); }
.sw.on { transform: scale(1.3); filter: drop-shadow(0 0 6px var(--c)) brightness(1.15); }
.mn-foot { font-size: 0.8em; color: var(--ink-3); margin-top: 1.4em; line-height: 1.5; }

/* loadout */
.lo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12.5em, 1fr)); gap: 0.6em; }
.bigpanel .card { position: relative; padding: 0.8em 0.9em 0.85em; border: 1px solid var(--line); border-radius: 3px; font-size: 0.82em; line-height: 1.45; cursor: pointer; color: var(--ink-2);
  background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.01)); transition: border-color 0.2s, transform 0.2s var(--ease), background 0.2s; }
.bigpanel .card:hover { border-color: var(--line-2); transform: translateY(-2px); background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02)); }
.bigpanel .card.active { border-color: var(--dc, var(--acc)); box-shadow: 0 0 16px color-mix(in srgb, var(--dc, var(--acc)) 25%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--dc, var(--acc)) 30%, transparent); }
.bigpanel .card .ct { display: flex; align-items: center; gap: 0.6em; margin-bottom: 0.75em; color: var(--ink); font-family: var(--f-disp); font-weight: 700; font-size: 1.15em; letter-spacing: 0.06em; }
.lo-grid.dev { grid-template-columns: repeat(auto-fill, minmax(16em, 1fr)); }
.bigpanel .card .ct .ib { margin: 0.3em 0.45em 0.3em 0.3em; display: flex; align-items: center; justify-content: center; width: 2em; height: 2em; border: 1px solid currentColor; border-radius: 2px; transform: rotate(45deg); flex: 0 0 auto; }
.bigpanel .card .ct .ib svg { transform: rotate(-45deg); }
.bigpanel .card .tag { position: absolute; top: 0.7em; right: 0.8em; font-family: var(--f-disp); font-weight: 700; font-size: 0.8em; letter-spacing: 0.2em; color: var(--dc, var(--acc)); }
.bigpanel .card .cu { display: block; margin-top: 0.35em; color: var(--ink-3); }
.bigpanel .card.item { cursor: default; }
.bigpanel .card.empty { cursor: default; border-style: dashed; text-align: center; color: var(--ink-3); display: flex; align-items: center; justify-content: center; min-height: 3.2em; }
.bigpanel .card.empty:hover { transform: none; }
.lo-pts { display: inline-flex; align-items: center; gap: 0.5em; font-family: var(--f-disp); font-weight: 700; letter-spacing: 0.12em; color: var(--gold); font-size: 1em; }
.lo-pts i { width: 0.55em; height: 0.55em; transform: rotate(45deg); background: var(--gold); box-shadow: 0 0 6px var(--gold); }
.sk-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2em; }
@media (max-width: 760px) { .sk-wrap { grid-template-columns: 1fr; } }
.sk-branch { padding: 0.8em 0.9em; border: 1px solid var(--line); border-radius: 3px; background: rgba(255,255,255,0.02); }
.sk-branch .bl { font-family: var(--f-disp); font-weight: 700; font-size: 0.78em; letter-spacing: 0.34em; color: var(--acc); margin-bottom: 0.5em; }
.sk-row { display: flex; align-items: center; margin: 0.55em 0; }
.sk-node { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 0.6em; padding: 0.55em 0.7em; border: 1px solid var(--line); border-radius: 3px; font-size: 0.85em; cursor: pointer; position: relative;
  background: rgba(8,10,20,0.55); transition: border-color 0.2s, background 0.2s, transform 0.2s var(--ease); }
.sk-node .hx { flex: 0 0 auto; width: 2.1em; height: 2.1em; display: flex; align-items: center; justify-content: center; clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%); background: rgba(255,255,255,0.07); }
.sk-node b { display: block; font-family: var(--f-disp); font-weight: 700; font-size: 1.08em; letter-spacing: 0.04em; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-node .cost { font-size: 0.82em; color: var(--ink-3); letter-spacing: 0.08em; }
.sk-node:hover { transform: translateY(-1px); border-color: var(--line-2); background: rgba(20,22,40,0.7); }
.sk-node.owned { border-color: rgba(168,240,198,0.55); }
.sk-node.owned .hx { background: rgba(168,240,198,0.18); }
.sk-node.owned .cost { color: var(--mint); }
.sk-node.can { border-color: var(--gold); box-shadow: 0 0 14px rgba(var(--gold-rgb),0.22); }
.sk-node.can .hx { background: rgba(var(--gold-rgb),0.18); }
.sk-node.can .cost { color: var(--gold); }
.sk-node.can::after { content: ''; position: absolute; inset: -1px; border: 1px solid var(--gold); border-radius: 3px; animation: canPulse 2s ease-in-out infinite; pointer-events: none; }
@keyframes canPulse { 50% { opacity: 0; inset: -4px; } }
.sk-node.locked { opacity: 0.62; cursor: default; }
.sk-node.locked:hover { transform: none; }
.sk-link { position: relative; width: 1.8em; height: 2px; background: rgba(255,255,255,0.14); flex: 0 0 auto; }
.sk-link::after { content: ''; position: absolute; right: -1px; top: -3px; width: 0; height: 0; border-left: 5px solid rgba(255,255,255,0.25); border-top: 4px solid transparent; border-bottom: 4px solid transparent; }
.sk-link.owned { background: var(--mint); box-shadow: 0 0 6px rgba(168,240,198,0.6); }
.sk-link.owned::after { border-left-color: var(--mint); }
#tip { position: fixed; z-index: 30; max-width: 19em; padding: 0.7em 0.85em; font-size: 0.82em; line-height: 1.45; pointer-events: none; opacity: 0; transition: opacity 0.15s;
  background: rgba(8,10,20,0.95); border: 1px solid var(--line-2); border-top: 2px solid var(--acc); border-radius: 3px; color: var(--ink-2); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
#tip.on { opacity: 1; }
#tip b { display: block; color: var(--ink); font-family: var(--f-disp); font-size: 1.15em; letter-spacing: 0.05em; margin-bottom: 0.2em; }
#tip .ts { display: block; margin-top: 0.45em; font-family: var(--f-disp); font-weight: 600; letter-spacing: 0.14em; font-size: 0.9em; }

/* ---------- title screen ---------- */
#intro { position: fixed; inset: 0; z-index: 20; pointer-events: auto; color: var(--ink); font-family: var(--f-ui); font-size: clamp(13px, calc(1.1vh + 6px), 18px); overflow: hidden;
  background: radial-gradient(ellipse at 50% 38%, #221d3d, #0d0c18 70%); display: flex; align-items: center; justify-content: center; }
#intro.out { animation: introOut 0.7s var(--ease-io) forwards; pointer-events: none; }
@keyframes introOut { to { opacity: 0; transform: scale(1.03); } }
#intro-bg { position: absolute; inset: 0; width: 100%; height: 100%; }
#intro .in-wrap { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 2em; max-width: 44em; }
#intro .mark { color: var(--acc); filter: drop-shadow(0 0 14px rgba(var(--acc-rgb),0.7)); animation: rise 1.2s var(--ease) both; }
#intro h1 { display: flex; font-family: var(--f-disp); font-weight: 600; font-size: 4.4em; letter-spacing: 0.42em; padding-left: 0.42em; line-height: 1; margin: 0.35em 0 0.1em; color: #f4f2fb;
  text-shadow: 0 0 34px rgba(var(--acc-rgb),0.45), 0 2px 0 rgba(0,0,0,0.3); }
#intro h1 span { display: inline-block; animation: letterIn 1s var(--ease) both; }
@keyframes letterIn { from { opacity: 0; transform: translateY(0.35em); filter: blur(6px); } }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } }
#intro .rule { display: flex; align-items: center; gap: 1em; width: 100%; max-width: 34em; white-space: nowrap; font-family: var(--f-disp); font-weight: 600; letter-spacing: 0.4em; font-size: 0.78em; color: var(--acc); animation: rise 1s var(--ease) 0.6s both; }
#intro .rule::before, #intro .rule::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, transparent, rgba(var(--acc-rgb),0.6)); }
#intro .rule::after { background: linear-gradient(90deg, rgba(var(--acc-rgb),0.6), transparent); }
#intro p.tag { color: var(--ink-2); max-width: 33em; line-height: 1.6; font-size: 0.95em; margin: 1.3em 0 1.6em; animation: rise 1s var(--ease) 0.75s both; }
#intro .in-card { display: flex; flex-direction: column; gap: 1em; width: min(26em, 90vw); padding: 1.3em 1.4em 1.4em; border: 1px solid var(--line-2); border-radius: 3px;
  background: linear-gradient(180deg, rgba(20,22,40,0.66), rgba(8,10,20,0.72)); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 20px 60px rgba(0,0,0,0.45); position: relative; animation: rise 1s var(--ease) 0.9s both; }
#intro .in-card::before { content: ''; position: absolute; left: -1px; top: -1px; width: 3em; height: 2px; background: var(--acc); box-shadow: 0 0 10px var(--acc); }
#intro .wb { font-family: var(--f-disp); font-weight: 600; font-size: 0.8em; letter-spacing: 0.24em; color: var(--ink-3); text-align: left; }
#intro .wb b { color: var(--acc); font-weight: 700; letter-spacing: 0.08em; }
#intro .fld { display: flex; flex-direction: column; gap: 0.45em; text-align: left; }
#intro .fld > span { font-family: var(--f-disp); font-weight: 700; font-size: 0.75em; letter-spacing: 0.22em; color: var(--ink-3); }
#intro input { background: rgba(4,5,12,0.6); border: 1px solid var(--line-2); color: var(--ink); padding: 0.7em 0.9em; border-radius: 3px; font: inherit; font-size: 1.05em; outline: none; transition: border-color 0.2s, box-shadow 0.2s; user-select: text; }
#intro input:focus { border-color: var(--acc); box-shadow: 0 0 0 3px rgba(var(--acc-rgb),0.18); }
#intro .swatches { justify-content: flex-start; }
#intro-go { position: relative; display: flex; align-items: center; justify-content: center; gap: 0.8em; width: 100%; margin-top: 0.3em; padding: 0.85em 1em; cursor: pointer; border: 1px solid var(--acc); border-radius: 3px;
  background: linear-gradient(90deg, rgba(var(--acc-rgb),0.28), rgba(var(--acc-rgb),0.12)); color: #fff; font-family: var(--f-disp); font-weight: 700; font-size: 1.15em; letter-spacing: 0.36em; padding-left: 1.36em; overflow: hidden; transition: box-shadow 0.25s, background 0.25s; }
#intro-go::after { content: ''; position: absolute; top: 0; bottom: 0; left: -40%; width: 30%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent); transform: skewX(-20deg); animation: sheen 3.6s ease-in-out 2s infinite; }
#intro-go:hover { box-shadow: 0 0 26px rgba(var(--acc-rgb),0.5); background: linear-gradient(90deg, rgba(var(--acc-rgb),0.4), rgba(var(--acc-rgb),0.2)); }
#intro-go .kc { letter-spacing: 0; font-size: 0.7em; }
@keyframes sheen { 0%, 60% { left: -40%; } 100% { left: 130%; } }
#intro .keys { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5em 1.2em; margin-top: 1.8em; max-width: 44em; font-size: 0.78em; color: var(--ink-3); animation: rise 1s var(--ease) 1.1s both; }
#intro .keys span { display: inline-flex; align-items: center; gap: 0.45em; white-space: nowrap; }
#intro .keys .kc { font-size: 0.95em; min-width: 1.9em; height: 1.9em; }
#intro .foot { position: absolute; bottom: 1.4em; left: 0; right: 0; text-align: center; font-size: 0.72em; letter-spacing: 0.3em; color: var(--ink-3); font-family: var(--f-disp); font-weight: 600; }

/* ---------- reduced motion: keep fades, drop travel/scale/pulse ---------- */
.rm *, .rm *::before, .rm *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; animation-delay: 0s !important; transition-duration: 0.05s !important; }
.rm #levelcard.on, .rm #banner.on { animation: cardFade 4.2s linear forwards !important; }
.rm #shardcall.on { animation: cardFade 2.6s linear forwards !important; }
.rm #toasts .toast { animation: cardFade 4.2s linear forwards !important; }
.rm #dmgdir .arc.on { animation: cardFade 1.1s linear forwards !important; }
.rm #crosshair .hm.on { animation: cardFade 0.3s linear forwards !important; }
@keyframes cardFade { 0% { opacity: 0; } 12% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  #intro *, #hud * { animation-iteration-count: 1 !important; }
  #intro h1 span, #intro .mark, #intro .rule, #intro p.tag, #intro .in-card, #intro .keys { animation-name: fadeIn !important; }
}
`;
