/**
 * page.ts — the living Identity Forest page.
 *
 * Emits a single self-contained interactive HTML page: a bioluminescent night
 * forest rendered client-side over inline JSON (same deterministic geometry as
 * build.ts — rotation, layout, hues and curvature are precomputed or derived by
 * fixed formulas shipped in DATA, so the client only *draws*; it invents nothing).
 *
 * Design intent: data as something alive (after Jonathan Harris — We Feel
 * Fine). Luminous seedlings breathe and sway on dark ground; reach for a
 * person and their web ignites; click and you get their seed card; a ticker
 * speaks true sentences from the record. Night is the resting state — light
 * is the consequence.
 *
 * TRUST POSTURE unchanged: pure function of public Seed data, no keys, no
 * model, no network calls except web fonts, no analytics, no randomness.
 */

export type PTopic = { topic: string; sessions: number; hue: number };
export type PNode = {
  slug: string; name: string; x: number; y: number; rot: number;
  att: number; men: number; ai: number; conf: string; sol: number;
  aura: number; topics: PTopic[];
  z: number;        // topical depth, [-1,1] — the third dimension
  sess: number[];   // attended sessions as indices into SESSIONS — the fourth
};
export type PEdge = [number, number, number]; // a, b, shared

export function pageHTML(nodes: PNode[], edges: PEdge[], sentences: string[], sessions: string[]): string {
  const totalShared = edges.reduce((n, e) => n + e[2], 0);
  const data = JSON.stringify({ nodes, edges, sessions });
  const sent = JSON.stringify(sentences);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Birdbrain — Identity Forest</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#ece6d8; --muted:#a49d8b; --faint:#6f6a5c; --gold:#e0b356; --violet:#b9a0f2;
    --hair:rgba(236,230,216,.14); --glass:rgba(10,13,7,.62);
    --ease:cubic-bezier(0.22,1,0.36,1);
  }
  *{box-sizing:border-box; margin:0}
  html,body{height:100%}
  body{background:radial-gradient(1400px 900px at 62% 42%, #0c1206 0%, #070a04 52%, #030402 100%) #030402;
    color:var(--ink); font-family:Inter,-apple-system,system-ui,sans-serif; overflow-x:hidden}

  /* ---------- full-bleed stage ---------- */
  .stage{position:relative; height:100vh; min-height:640px; overflow:hidden}
  #forest{position:absolute; inset:0; width:100%; height:100%; cursor:grab; touch-action:none}
  #forest.panning{cursor:grabbing}
  .stage::after{content:""; position:absolute; inset:0; pointer-events:none;
    background:radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(2,3,1,.55) 100%)}

  /* ---------- poster panel ---------- */
  .panel{position:absolute; left:44px; top:40px; z-index:5; max-width:370px; pointer-events:none}
  .kicker{font-family:"JetBrains Mono",monospace; font-size:11px; letter-spacing:.26em; color:var(--gold); opacity:.85; margin-bottom:16px;
    opacity:0; animation:rise .9s var(--ease) .1s forwards}
  h1{font-family:Newsreader,Georgia,serif; font-weight:500; font-style:normal; text-transform:uppercase;
    font-size:clamp(40px,4.2vw,58px); letter-spacing:.06em; line-height:1.04; color:#f0ead9;
    text-shadow:0 0 44px rgba(224,179,86,.18);
    opacity:0; animation:rise .9s var(--ease) .22s forwards}
  .sprig{margin:14px 0 6px; opacity:0; animation:rise .9s var(--ease) .3s forwards}
  .lede{font-family:Newsreader,Georgia,serif; font-size:19px; color:#cfc8b6; line-height:1.5; margin-top:14px; max-width:20em;
    opacity:0; animation:rise .9s var(--ease) .34s forwards}
  .lede + .lede{margin-top:12px}
  .lede .g{color:var(--gold); font-style:normal; text-shadow:0 0 18px rgba(224,179,86,.45)}
  .lede .v{color:var(--violet); font-weight:400; text-shadow:0 0 18px rgba(185,160,242,.45)}
  .stats{font-family:"JetBrains Mono",monospace; font-size:11px; color:var(--faint); margin-top:18px; letter-spacing:.05em;
    opacity:0; animation:rise .9s var(--ease) .46s forwards}
  .stats b{color:var(--muted); font-weight:500}

  /* ---------- topic lens ---------- */
  .lens-row{position:absolute; left:44px; bottom:20px; z-index:5; max-width:calc(100vw - 440px); display:flex; gap:7px; flex-wrap:nowrap;
    overflow-x:auto; scrollbar-width:none; padding-bottom:2px;
    -webkit-mask-image:linear-gradient(90deg,#000 92%,transparent); mask-image:linear-gradient(90deg,#000 92%,transparent);
    opacity:0; animation:rise .9s var(--ease) .58s forwards}
  .lens-row::-webkit-scrollbar{display:none}
  .chip{flex:none}
  .chip{font-family:"JetBrains Mono",monospace; font-size:10.5px; letter-spacing:.03em; padding:6px 11px; border-radius:999px;
    border:1px solid var(--hair); background:rgba(12,15,8,.55); color:var(--muted); cursor:pointer; user-select:none;
    -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px);
    transition:all .25s var(--ease); display:inline-flex; align-items:center; gap:6px}
  .chip .dot{width:7px; height:7px; border-radius:50%; display:inline-block; box-shadow:0 0 8px currentColor}
  .chip:hover{border-color:rgba(236,230,216,.35); color:var(--ink); transform:translateY(-1px)}
  .chip.on{background:var(--ink); color:#0a0c06; border-color:var(--ink)}
  .chip.clear{border-style:dashed}

  /* ---------- the dimension ladder ---------- */
  .dimbar{position:absolute; left:50%; top:16px; transform:translateX(-50%); z-index:7; display:flex; align-items:center; gap:4px;
    background:var(--glass); border:1px solid var(--hair); border-radius:999px; padding:4px;
    -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
    opacity:0; animation:rise .9s var(--ease) .5s forwards}
  .dimbar button{font-family:"JetBrains Mono",monospace; font-size:12px; letter-spacing:.06em; padding:7px 15px; border-radius:999px;
    border:none; background:none; color:var(--muted); cursor:pointer; transition:all .3s var(--ease)}
  .dimbar button:hover{color:var(--ink)}
  .dimbar button.on{background:var(--ink); color:#0a0c06; font-weight:500}
  .dimcap{position:absolute; left:50%; top:64px; transform:translateX(-50%); z-index:6; width:min(88vw,620px); text-align:center; pointer-events:none;
    font-family:Newsreader,Georgia,serif; font-style:italic; font-size:15px; line-height:1.45; color:rgba(236,230,216,.62);
    text-shadow:0 1px 12px rgba(0,0,0,.85); opacity:0; transition:opacity .8s var(--ease)}
  .dimcap.on{opacity:1}

  /* ---------- canvas dimensions (1D / 3D / 4D) ---------- */
  #dim{position:absolute; inset:0; width:100%; height:100%; cursor:grab; touch-action:none; opacity:0; pointer-events:none; transition:opacity .8s var(--ease)}
  #dim.panning{cursor:grabbing}
  body.dcanvas #dim{opacity:1; pointer-events:auto}
  body.dcanvas #forest{opacity:0; pointer-events:none}
  #forest{transition:opacity .8s var(--ease)}
  body.dcanvas .legend{display:none}

  /* ---------- the fourth dimension: time ---------- */
  .timebar{position:absolute; left:50%; bottom:64px; transform:translateX(-50%); z-index:7; display:none; align-items:center; gap:14px;
    width:min(78vw,660px); padding:10px 18px; background:var(--glass); border:1px solid var(--hair); border-radius:999px;
    -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px)}
  body.d4 .timebar{display:flex}
  body.d4 .ticker{display:none}
  .timebar .play{width:34px; height:34px; flex:none; border-radius:50%; border:1px solid var(--hair); background:rgba(236,230,216,.08);
    color:var(--ink); cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center; transition:all .25s var(--ease)}
  .timebar .play:hover{background:rgba(236,230,216,.18)}
  .timebar input[type=range]{flex:1; -webkit-appearance:none; appearance:none; height:3px; border-radius:99px; background:rgba(236,230,216,.16); outline:none}
  .timebar input[type=range]::-webkit-slider-thumb{-webkit-appearance:none; appearance:none; width:15px; height:15px; border-radius:50%;
    background:var(--gold); box-shadow:0 0 12px rgba(224,179,86,.8); cursor:pointer}
  .timebar input[type=range]::-moz-range-thumb{width:15px; height:15px; border:none; border-radius:50%; background:var(--gold); box-shadow:0 0 12px rgba(224,179,86,.8); cursor:pointer}
  .timebar .tlabel{font-family:"JetBrains Mono",monospace; font-size:11.5px; letter-spacing:.06em; color:var(--gold); flex:none; min-width:118px; text-align:right}

  /* ---------- stand-with-them (3D perspective) ---------- */
  .stand{display:none; margin-top:18px; width:100%; padding:10px 14px; border-radius:12px; border:1px solid rgba(224,179,86,.4);
    background:rgba(224,179,86,.1); color:var(--gold); font-family:"JetBrains Mono",monospace; font-size:11.5px; letter-spacing:.08em;
    cursor:pointer; transition:all .3s var(--ease)}
  .stand:hover{background:rgba(224,179,86,.22)}
  body.d3 .stand, body.d4 .stand{display:block}
  .stand.year{display:block; margin-top:10px}
  body.d1 .stand.year{display:none}
  .unstand{position:absolute; left:50%; top:146px; transform:translateX(-50%); z-index:7; display:none; padding:8px 18px; border-radius:999px;
    border:1px solid rgba(224,179,86,.45); background:rgba(10,13,7,.75); color:var(--gold); font-family:"JetBrains Mono",monospace; font-size:11.5px;
    letter-spacing:.08em; cursor:pointer; -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px)}
  .unstand.on{display:block}

  /* ---------- legend ---------- */
  .legend{position:absolute; right:20px; bottom:20px; z-index:5; width:280px; padding:18px 20px 14px;
    background:var(--glass); border:1px solid var(--hair); border-radius:14px;
    -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
    opacity:0; animation:rise .9s var(--ease) .7s forwards}
  .legend .row{display:flex; align-items:center; gap:12px; padding:5px 0; font-size:13px; color:#d9d3c2}
  .legend .row svg{flex:none}
  .legend .foot{margin-top:10px; padding-top:12px; border-top:1px solid rgba(236,230,216,.1);
    font-family:Newsreader,Georgia,serif; font-size:15.5px; color:var(--gold); display:flex; align-items:center; gap:8px}

  /* ---------- ticker of true sentences ---------- */
  .ticker{position:absolute; left:50%; bottom:38px; transform:translateX(-50%); z-index:5; width:min(56%,640px); height:26px; text-align:center;
    opacity:0; animation:rise .9s var(--ease) .8s forwards}
  .ticker span{position:absolute; left:0; right:0; font-family:Newsreader,Georgia,serif; font-style:italic; font-size:16px; color:rgba(236,230,216,.68);
    text-shadow:0 1px 12px rgba(0,0,0,.8); opacity:0; transition:opacity 1.1s var(--ease)}
  .ticker span.on{opacity:1}

  /* ---------- whisper / search / hint ---------- */
  .whisper{position:absolute; left:50%; top:104px; transform:translateX(-50%); pointer-events:none;
    font-family:"JetBrains Mono",monospace; font-size:12px; letter-spacing:.05em; color:var(--ink);
    background:var(--glass); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); border:1px solid var(--hair); border-radius:999px;
    padding:7px 16px; opacity:0; transition:opacity .3s var(--ease); white-space:nowrap; z-index:6}
  .whisper.on{opacity:1}
  .find{position:absolute; right:20px; top:16px; z-index:7}
  .find input{font-family:"JetBrains Mono",monospace; font-size:12px; padding:8px 14px; border-radius:999px; border:1px solid var(--hair);
    background:var(--glass); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); color:var(--ink); width:150px; outline:none; transition:all .3s var(--ease)}
  .find input:focus{width:210px; border-color:rgba(236,230,216,.4)}
  .find input::placeholder{color:var(--faint)}
  .hint{position:absolute; left:50%; bottom:14px; transform:translateX(-50%); font-family:"JetBrains Mono",monospace; font-size:10.5px; color:#57523f; letter-spacing:.05em; pointer-events:none; z-index:5; white-space:nowrap}

  /* ---------- svg life ---------- */
  .org{cursor:pointer; transition:opacity .4s var(--ease)}
  .org .inner{transform-box:fill-box; transform-origin:center; animation:breathe var(--dur,7s) ease-in-out var(--ph,0s) infinite}
  .org .leafin{animation:sway var(--sd,9s) ease-in-out var(--sp,0s) infinite; transform-origin:0 0}
  .org .leafg{transition:opacity .35s var(--ease)}
  .org .mote{animation:twinkle 4.5s ease-in-out var(--tp,0s) infinite}
  .lbl{font-family:Inter,sans-serif; font-size:10.5px; font-weight:600; letter-spacing:.9px; fill:#e9e4d6; text-anchor:middle; pointer-events:none;
    paint-order:stroke; stroke:#030402; stroke-width:3px; transition:opacity .3s}
  .lbl.dim{opacity:.06}
  .labelset{opacity:0; transition:opacity 1.6s var(--ease) 1.2s}
  .grown .labelset{opacity:1}
  .org.dim{opacity:.08}
  .edge{transition:opacity .35s var(--ease)}
  .edge .part{animation:twinkle 3.8s ease-in-out var(--tp,0s) infinite}
  svg.haslens .leafg:not(.match){opacity:.05}
  svg.haslens .org.nomatch{opacity:.12}
  svg.haslens .lbl.nomatch{opacity:.1}
  .org.found .core{animation:pulse 1s var(--ease) 2}

  /* entrance */
  .org .inner{opacity:0; transform:scale(.2)}
  .grown .org .inner{opacity:1; transform:scale(1); transition:opacity .8s var(--ease) var(--gd,0s), transform 1.1s var(--ease) var(--gd,0s)}
  .grown .org .inner{animation-delay:calc(var(--gd) + 1.2s)}
  .edgeset{opacity:0; transition:opacity 2.4s var(--ease) .9s}
  .grown .edgeset{opacity:1}

  /* ---------- seed card ---------- */
  .card{position:fixed; right:26px; top:50%; transform:translate(30px,-50%); width:330px; max-height:78vh; overflow:auto; z-index:20;
    background:rgba(12,14,9,.9); -webkit-backdrop-filter:blur(16px); backdrop-filter:blur(16px);
    border:1px solid var(--hair); border-radius:18px; padding:26px 26px 22px;
    box-shadow:0 30px 90px -20px rgba(0,0,0,.85); opacity:0; pointer-events:none;
    transition:opacity .45s var(--ease), transform .45s var(--ease)}
  .card.on{opacity:1; pointer-events:auto; transform:translate(0,-50%)}
  .card .aura{height:4px; border-radius:99px; margin-bottom:18px; box-shadow:0 0 22px 1px rgba(224,179,86,.25)}
  .card h2{font-family:Newsreader,Georgia,serif; font-weight:500; font-size:27px; letter-spacing:.01em; color:#f0ead9}
  .card .meta{font-family:"JetBrains Mono",monospace; font-size:10.5px; color:var(--faint); letter-spacing:.08em; margin-top:7px; text-transform:uppercase}
  .card .poem{font-family:Newsreader,Georgia,serif; font-style:italic; font-size:16.5px; color:#cfc8b6; line-height:1.5; margin:16px 0 4px}
  .card h3{font-family:"JetBrains Mono",monospace; font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); margin:20px 0 10px}
  .trow{display:flex; align-items:center; gap:10px; padding:4.5px 0; font-size:13.5px; color:var(--ink)}
  .trow .dot{width:9px; height:9px; border-radius:50%; flex:none; box-shadow:0 0 10px currentColor}
  .trow .c{margin-left:auto; font-family:"JetBrains Mono",monospace; font-size:11px; color:var(--faint)}
  .tie{display:flex; align-items:center; gap:10px; padding:6px 0; cursor:pointer; border:none; background:none; width:100%; text-align:left; font-size:13.5px; color:var(--ink); font-family:Inter}
  .tie:hover .n{text-decoration:underline; text-underline-offset:3px}
  .tie .bar{height:3px; border-radius:99px; background:rgba(236,230,216,.12); flex:1; position:relative; overflow:hidden}
  .tie .bar i{position:absolute; inset:0; right:auto; background:var(--gold); border-radius:99px; box-shadow:0 0 8px rgba(224,179,86,.7)}
  .tie .c{font-family:"JetBrains Mono",monospace; font-size:11px; color:var(--faint); flex:none}
  .card .x{position:absolute; top:14px; right:14px; border:1px solid var(--hair); background:rgba(236,230,216,.06); color:var(--muted); width:30px; height:30px; border-radius:50%; cursor:pointer; font-size:15px; line-height:1}
  .card .x:hover{background:rgba(236,230,216,.14); color:var(--ink)}

  /* ---------- footer ---------- */
  footer{max-width:1180px; margin:0 auto; padding:26px 44px 54px; color:var(--faint); font-size:13px; line-height:1.7; border-top:1px solid rgba(236,230,216,.08)}
  footer code{background:rgba(236,230,216,.08); padding:1px 6px; border-radius:5px; font-family:"JetBrains Mono",monospace; font-size:11.5px; color:var(--muted)}
  footer .t{font-family:"JetBrains Mono",monospace; font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; margin-bottom:8px; color:#57523f}

  @keyframes breathe{50%{transform:scale(1.022)}}
  @keyframes sway{50%{transform:rotate(1.6deg)}}
  @keyframes twinkle{50%{opacity:.35}}
  @keyframes rise{from{opacity:0; transform:translateY(14px)}to{opacity:1; transform:none}}
  @keyframes pulse{0%{r:5}50%{r:13}100%{r:5}}

  @media (max-width:860px){
    .panel{position:static; max-width:none; padding:76px 22px 0; pointer-events:auto}
    .lens-row{position:static; max-width:none; margin:12px 22px 0}
    .stage{height:auto}
    #forest{position:relative; height:72vh; display:block}
    #dim{position:relative; inset:auto; height:72vh; display:none}
    body.dcanvas #dim{display:block}
    body.dcanvas #forest{display:none}
    .dimbar{top:10px}
    .dimcap{top:56px; font-size:13.5px}
    .timebar{bottom:20px; width:calc(100vw - 32px)}
    .stage::after{display:none}
    .legend{display:none}
    .ticker{position:static; transform:none; width:auto; margin:6px 22px; text-align:left; height:30px; position:relative}
    .card{right:0; left:0; top:auto; bottom:0; transform:translateY(30px); width:100%; max-height:62vh; border-radius:18px 18px 0 0}
    .card.on{transform:none}
    .find input{width:120px}
  }
  @media (prefers-reduced-motion: reduce){
    *,.org .inner,.org .leafin,.org .mote{animation:none !important; transition:none !important}
    .org .inner{opacity:1; transform:none}
    .edgeset{opacity:1}
    .kicker,h1,.sprig,.lede,.stats,.lens-row,.legend,.ticker{opacity:1; animation:none}
  }
</style></head><body>

<div class="stage">
  <svg id="forest" viewBox="0 0 1600 1040" preserveAspectRatio="xMidYMid meet" aria-label="The Identity Forest — a night forest of people grown from witnessed participation"></svg>
  <canvas id="dim" aria-label="The Identity Forest in one, three or four dimensions"></canvas>

  <div class="dimbar" role="tablist" aria-label="Dimensions">
    <button data-d="1" role="tab">1D</button>
    <button data-d="2" role="tab" class="on">2D</button>
    <button data-d="3" role="tab">3D</button>
    <button data-d="4" role="tab">4D</button>
  </div>
  <div class="dimcap" id="dimcap"></div>
  <button class="unstand" id="unstand">↩ step back to your own view</button>

  <div class="timebar" id="timebar">
    <button class="play" id="tplay" aria-label="Play time">▶</button>
    <input type="range" id="tscrub" min="0" max="0" value="0" step="1" aria-label="Session timeline">
    <div class="tlabel" id="tlabel"></div>
  </div>

  <div class="panel">
    <div class="kicker">BIRDBRAIN · SEEDS</div>
    <h1>Identity<br>Forest</h1>
    <div class="sprig"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#e0b356" stroke-width="1.6" stroke-linecap="round"><path d="M10 17 C10 11 5 10 2 6 C8 7 10 10 10 13"/><path d="M10 17 C10 10 15 8 19 4 C13 6 10 9 10 13"/><path d="M10 17 L10 19"/></svg></div>
    <p class="lede">Every seed is a person, grown from what they actually <span class="g">did</span> in the room.</p>
    <p class="lede">The lines are <span class="v">shared sessions</span>.</p>
    <p class="lede">The lines are the point&thinsp;—&thinsp;we are a <span class="g">web of relationships</span>.</p>
    <p class="stats"><b>${nodes.length}</b> people · <b>${edges.length}</b> relationships · <b>${totalShared}</b> shared-session ties</p>
  </div>

  <div class="lens-row" id="chips"></div>

  <div class="legend">
    <div class="row"><svg width="16" height="16" viewBox="0 0 12 13" fill="none" stroke="#8fce5a" stroke-width="1.4" stroke-linecap="round"><path d="M5 10 C5 6 2 5 0.5 3 C4 4 5 6 5 8"/><path d="M5 10 C5 5 8 4 11 1 C7 3 5 5 5 8"/><path d="M5 10 L5 12"/></svg>Seed = a person</div>
    <div class="row"><svg width="16" height="10" viewBox="0 0 30 10"><circle cx="4" cy="6" r="2.6" fill="#e0b356"/><path d="M8 6 q10 -6 20 0" stroke="#e0b356" stroke-width="1.2" fill="none" opacity="0.8"/></svg>What grows = what they did</div>
    <div class="row"><svg width="16" height="10" viewBox="0 0 30 10"><path d="M1 8 q14 -8 28 0" stroke="#b9a0f2" stroke-width="1.4" fill="none"/><circle cx="15" cy="4" r="1.6" fill="#e6dcff"/></svg>Lines = shared sessions</div>
    <div class="row"><svg width="16" height="14" viewBox="0 0 30 14"><path d="M1 6 q14 -8 28 0 M1 9 q14 -6 28 1 M1 11 q14 6 28 1" stroke="#cbb8f7" stroke-width="1.1" fill="none" opacity="0.85"/></svg>More lines = more connection</div>
    <div class="foot">We grow together.<svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="#8fce5a" stroke-width="1.3" stroke-linecap="round"><path d="M5 10 C5 6 2 5 0.5 3 C4 4 5 6 5 8"/><path d="M5 10 C5 5 8 4 11 1 C7 3 5 5 5 8"/></svg></div>
  </div>

  <div class="find"><input id="find" type="text" placeholder="find yourself" autocomplete="off" aria-label="Find a person"></div>
  <div class="whisper" id="whisper"></div>
  <div class="ticker" id="ticker" aria-live="polite"></div>
  <div class="hint" id="hint">drag to wander · scroll to lean in · double-click to step back</div>
</div>

<aside class="card" id="card" role="dialog" aria-modal="false">
  <button class="x" id="cardx" aria-label="Close">×</button>
  <div class="aura" id="c-aura"></div>
  <h2 id="c-name"></h2>
  <div class="meta" id="c-meta"></div>
  <p class="poem" id="c-poem"></p>
  <h3>Threads of thought</h3>
  <div id="c-topics"></div>
  <h3>Most often in the room with</h3>
  <div id="c-ties"></div>
  <button class="stand" id="stand">⤳ stand with them — see the room as they see it</button>
  <button class="stand year" id="year">▸ watch their year — the sessions from their seat</button>
</aside>

<footer>
  <div class="t">Why dimensions</div>
  <p>Humans mostly think in one story at a time — a list, a ranking, a line. This page is an experiment in building the dimensions up: <b>1D</b> flattens everyone to a single number and shows what that costs. <b>2D</b> gives relationships room to spread. <b>3D</b> adds depth as <em>what you think about</em> — and lets you stand where someone else stands, because the room genuinely looks different from each person's position. <b>4D</b> is time, the dimension the others are made of: the same web, watched being woven. None of the views is the truth; each is a telling. The record underneath doesn't change.</p>
  <div class="t" style="margin-top:18px">Trust posture</div>
  <p>Rendered deterministically from public Seed records in <code>vault/seeds/</code> — no keys, no model, no tracking, no server-side anything. The forest re-grows from the record on every build: <code>bun run identity-forest/scripts/build.ts</code>. Open source, Apache-2.0. Dotted circles are people present in the room but thin in the record — honest gaps, never faked.</p>
</footer>

<script>
const DATA = ${data};
const SENT = ${sent};
const N = DATA.nodes, E = DATA.edges, SESS = DATA.sessions;
const svg = document.getElementById("forest");
const NS = "http://www.w3.org/2000/svg";

// ---------- neighbours ----------
const nbr = N.map(()=>[]);
E.forEach(([a,b,s],i)=>{ nbr[a].push({o:b,s,i}); nbr[b].push({o:a,s,i}); });
const maxShared = Math.max(1, ...E.map(e=>e[2]));

// ---------- shared deterministic geometry (mirrors build.ts) ----------
function mixHue(h1,h2){ const d=((h2-h1+540)%360)-180; return (h1+d/2+360)%360; }
function leafAngleDeg(i,T,rot){ const k=Math.ceil(i/2); const side=i===0?0:(i%2===1?-1:1);
  const spread=Math.min(32,150/Math.max(1,T)); const wob=((rot*57.2958)%14)-7; return -90+side*k*spread+wob; }
function leafLen(sessions,maxT,att){ return 18+(sessions/maxT)*(34+Math.sqrt(att)*9); }
function leafHue(aura,topicHue){ const d=((topicHue-aura+540)%360)-180; const drift=Math.max(-14,Math.min(14,d*0.22)); return (aura+drift+360)%360; }
function leafVar(hue,i){ return (((hue*7)+(i*13))%20)/20; }
const MAX_LEAVES = 6;
function curveOff(a,b){ return ((a*7919+b*104729)%1000)/1000-0.5; }
function quadPoint(p,c,q,t){ const u=1-t; return {x:u*u*p.x+2*u*t*c.x+t*t*q.x, y:u*u*p.y+2*u*t*c.y+t*t*q.y}; }

// ---------- draw ----------
function el(name, attrs, parent){ const e=document.createElementNS(NS,name); for(const k in attrs) e.setAttribute(k,attrs[k]); if(parent) parent.appendChild(e); return e; }

const defs = el("defs",{},svg);
const bloom = el("filter",{id:"bloom",x:"-120%",y:"-120%",width:"340%",height:"340%"},defs);
el("feGaussianBlur",{stdDeviation:"4"},bloom);
N.forEach((n,i)=>{
  const g = el("radialGradient",{id:"halo"+i},defs);
  el("stop",{offset:"0%","stop-color":\`hsl(\${n.aura} 92% 70%)\`,"stop-opacity":"0.5"},g);
  el("stop",{offset:"40%","stop-color":\`hsl(\${n.aura} 85% 55%)\`,"stop-opacity":"0.15"},g);
  el("stop",{offset:"100%","stop-color":\`hsl(\${n.aura} 85% 55%)\`,"stop-opacity":"0"},g);
});

// threads — the web of relationships
const edgeSet = el("g",{class:"edgeset"},svg);
const edgeEls = E.map(([a,b,s],ei)=>{
  const p=N[a], q=N[b];
  const t = Math.sqrt(s/maxShared);
  const op = 0.16 + 0.6*t, w = 0.7 + 2.6*t;
  const hue = mixHue(N[a].aura, N[b].aura);
  const dx=q.x-p.x, dy=q.y-p.y, dist=Math.sqrt(dx*dx+dy*dy)||1;
  const off = curveOff(a,b)*0.56*dist;
  const c = {x:(p.x+q.x)/2 + (-dy/dist)*off, y:(p.y+q.y)/2 + (dx/dist)*off};
  const d = \`M\${p.x.toFixed(1)} \${p.y.toFixed(1)} Q\${c.x.toFixed(1)} \${c.y.toFixed(1)} \${q.x.toFixed(1)} \${q.y.toFixed(1)}\`;
  const g = el("g",{class:"edge"},edgeSet);
  const under = el("path",{d,fill:"none",stroke:\`hsl(\${hue} 80% 62%)\`,"stroke-width":(w*3.2).toFixed(2),opacity:(op*0.38).toFixed(3),"stroke-linecap":"round"},g);
  const main = el("path",{d,fill:"none",stroke:\`hsl(\${hue} 85% 68%)\`,"stroke-width":w.toFixed(2),opacity:op.toFixed(3),"stroke-linecap":"round"},g);
  const cnt = Math.min(s,4);
  for(let j=0;j<cnt;j++){
    const pt = quadPoint(p,c,q,(j+1)/(cnt+1));
    const ph = j%2===0 ? N[a].aura : N[b].aura;
    const dot = el("circle",{class:"part",cx:pt.x.toFixed(1),cy:pt.y.toFixed(1),r:"1.7",fill:\`hsl(\${ph} 90% 75%)\`,opacity:"0.85"},g);
    dot.style.setProperty("--tp",(-(ei%7)-j*1.1).toFixed(1)+"s");
  }
  return {g, under, main, hue, op, w};
});

// seedlings, painter-ordered (lower plants drawn later, overlapping naturally);
// labels live on their own top layer so no plant ever drowns a name
const orgEls = new Array(N.length);
const labelEls = new Array(N.length);
const labelSet = el("g",{class:"labelset"},svg);
function addLabel(idx,n,h,op){
  const t = el("text",{class:"lbl",x:N[idx].x.toFixed(1),y:(N[idx].y-h-16).toFixed(0),opacity:op},labelSet);
  t.textContent = n.name.toUpperCase(); labelEls[idx]=t;
}
const drawOrder = N.map((_,i)=>i).sort((a,b)=>N[a].y-N[b].y);
drawOrder.forEach((idx,rank)=>{
  const n = N[idx];
  const g = el("g",{class:"org",transform:\`translate(\${n.x.toFixed(1)} \${n.y.toFixed(1)})\`},svg);
  const inner = el("g",{class:"inner"},g);
  const ph = (n.rot % (Math.PI*2)) / (Math.PI*2);
  inner.style.setProperty("--dur", (6.2 + ph*3.4).toFixed(2)+"s");
  inner.style.setProperty("--ph", (-ph*7).toFixed(2)+"s");
  g.style.setProperty("--gd", (0.12 + 0.9*(rank/N.length)).toFixed(2)+"s");

  const ts = n.topics.slice().sort((a,b)=>b.sessions-a.sessions).slice(0,MAX_LEAVES);
  const T = ts.length, maxT = Math.max(1,...ts.map(t=>t.sessions));
  const L0 = T ? leafLen(ts[0].sessions,maxT,n.att) : 22;

  if(n.att===0 && T===0){
    el("circle",{r:"14",fill:"none",stroke:"#d8d2c2","stroke-width":"1","stroke-dasharray":"2 5",opacity:"0.35"},inner);
    el("circle",{class:"core",r:"2",fill:"#d8d2c2",opacity:"0.5"},inner);
    addLabel(idx, n, 8, 0.45);
    orgEls[idx]=g; hook(g,idx); return;
  }

  const haloR = (30 + Math.sqrt(n.att)*11) * (T ? 1 : 0.62);
  el("circle",{cx:"0",cy:(-L0*0.35).toFixed(1),r:haloR.toFixed(1),fill:\`url(#halo\${idx})\`},inner);

  for(let r=0;r<3;r++){
    const a=(90+(r-1)*34+(((n.rot*57.2958)%10)-5))*(Math.PI/180);
    const len=8+Math.sqrt(n.att)*3;
    el("path",{d:\`M0 1 Q\${(Math.cos(a+0.35)*len*0.55).toFixed(1)} \${(Math.sin(a+0.35)*len*0.55).toFixed(1)} \${(Math.cos(a)*len).toFixed(1)} \${(Math.sin(a)*len).toFixed(1)}\`,
      fill:"none",stroke:"#c9a86a","stroke-width":"0.8","stroke-linecap":"round",opacity:"0.30"},inner);
  }

  ts.forEach((t,i)=>{
    const ang = leafAngleDeg(i,T,n.rot);
    const fr = leafVar(t.hue,i);
    const L = leafLen(t.sessions,maxT,n.att)*(0.78+0.44*fr);
    const bend = L*0.24*(i%2?-1:1)*(0.4+fr);
    const lh = leafHue(n.aura, t.hue);
    const bx = bend*0.45, by = -L*0.42;
    const tx = bend, ty = -L;
    const Wd = L*0.58*0.42;
    const lg = el("g",{class:"leafg",transform:\`rotate(\${(ang+90).toFixed(1)})\`},inner);
    lg.dataset.topic = t.topic;
    const li = el("g",{class:"leafin"},lg);
    li.style.setProperty("--sd",(8+((t.hue%40)/40)*5).toFixed(2)+"s");
    li.style.setProperty("--sp",(-(t.hue%9)).toFixed(1)+"s");
    el("path",{d:\`M0 0 Q\${(bend*0.2).toFixed(1)} \${(-L*0.24).toFixed(1)} \${bx.toFixed(1)} \${by.toFixed(1)}\`,
      fill:"none",stroke:\`hsl(\${lh} 70% 60%)\`,"stroke-width":"1.1","stroke-linecap":"round",opacity:(0.5+0.35*n.sol).toFixed(2)},li);
    el("path",{d:\`M\${bx.toFixed(1)} \${by.toFixed(1)} C\${(bx-Wd*0.62).toFixed(1)} \${(-L*0.58).toFixed(1)}, \${(bx+bend*0.25-Wd*0.35).toFixed(1)} \${(-L*0.86).toFixed(1)}, \${tx.toFixed(1)} \${ty.toFixed(1)} C\${(bx+bend*0.25+Wd*0.35).toFixed(1)} \${(-L*0.86).toFixed(1)}, \${(bx+Wd*0.62).toFixed(1)} \${(-L*0.58).toFixed(1)}, \${bx.toFixed(1)} \${by.toFixed(1)} Z\`,
      fill:\`hsl(\${lh} 80% 58%)\`,"fill-opacity":(0.5+0.35*n.sol).toFixed(2),
      stroke:\`hsl(\${lh} 95% 72%)\`,"stroke-width":"0.9","stroke-opacity":(0.6+0.3*n.sol).toFixed(2)},li);
    el("path",{d:\`M\${bx.toFixed(1)} \${by.toFixed(1)} Q\${(bx+bend*0.3).toFixed(1)} \${(-L*0.7).toFixed(1)} \${(tx*0.96).toFixed(1)} \${(ty*0.97).toFixed(1)}\`,
      fill:"none",stroke:\`hsl(\${lh} 45% 88%)\`,"stroke-width":"0.7",opacity:"0.5"},li);
  });

  for(let i=0;i<n.ai;i++){
    const a = n.rot*1.7 + (i/Math.max(1,n.ai))*Math.PI*2;
    const rr = 10 + Math.sqrt(n.att)*4;
    const f = el("circle",{class:"mote",cx:(Math.cos(a)*rr).toFixed(1),cy:(Math.sin(a)*rr*0.7 - L0*0.4).toFixed(1),r:"1.8",fill:"#ffd777",opacity:"0.9"},inner);
    f.style.setProperty("--tp",(-i*1.3).toFixed(1)+"s");
  }

  const cr = 2.6 + Math.sqrt(n.att)*1.1;
  el("circle",{r:(cr*2.1).toFixed(1),fill:\`hsl(\${n.aura} 90% 62%)\`,opacity:(0.5*n.sol+0.15).toFixed(2),filter:"url(#bloom)"},inner);
  el("circle",{class:"core",r:cr.toFixed(1),fill:"#fff6e4",opacity:(0.55+0.45*n.sol).toFixed(2)},inner);

  addLabel(idx, n, L0, 0.92);
  orgEls[idx]=g; hook(g,idx);
});
svg.appendChild(labelSet); // hoist labels above every plant

function hook(g,i){
  g.addEventListener("pointerenter",()=>{ if(locked<0) light(i); });
  g.addEventListener("pointerleave",()=>{ if(locked<0) unlight(); });
  g.addEventListener("click",(ev)=>{ ev.stopPropagation(); select(i); });
}

requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.add("grown")));

// ---------- hover: ignite the web ----------
const whisper = document.getElementById("whisper");
let locked = -1;
function light(idx){
  const con = new Set(nbr[idx].map(x=>x.o)); con.add(idx);
  orgEls.forEach((g,i)=> g.classList.toggle("dim", !con.has(i)));
  labelEls.forEach((t,i)=> t && t.classList.toggle("dim", !con.has(i)));
  E.forEach(([a,b,s],i)=>{
    const on = (a===idx||b===idx);
    const ed = edgeEls[i];
    if(on){
      const hue = N[idx].aura;
      ed.main.setAttribute("stroke",\`hsl(\${hue} 92% 72%)\`);
      ed.main.setAttribute("opacity", Math.min(1, 0.5+0.5*(s/maxShared)).toFixed(2));
      ed.main.setAttribute("stroke-width",(1+3*(s/maxShared)).toFixed(2));
      ed.under.setAttribute("stroke",\`hsl(\${hue} 85% 60%)\`);
      ed.under.setAttribute("opacity",(0.22+0.3*(s/maxShared)).toFixed(2));
      ed.g.style.opacity = "1";
    } else {
      ed.g.style.opacity = "0.05";
    }
  });
  const n=N[idx];
  whisper.textContent = \`\${n.name} — \${n.att>0?\`present \${n.att} time\${n.att===1?"":"s"}\`:"faint in the record"} · \${nbr[idx].length} companion\${nbr[idx].length===1?"":"s"}\`;
  whisper.classList.add("on");
}
function unlight(){
  orgEls.forEach(g=>g.classList.remove("dim"));
  labelEls.forEach(t=>t && t.classList.remove("dim"));
  edgeEls.forEach(ed=>{
    ed.main.setAttribute("stroke",\`hsl(\${ed.hue} 85% 68%)\`);
    ed.main.setAttribute("opacity",ed.op.toFixed(3));
    ed.main.setAttribute("stroke-width",ed.w.toFixed(2));
    ed.under.setAttribute("stroke",\`hsl(\${ed.hue} 80% 62%)\`);
    ed.under.setAttribute("opacity",(ed.op*0.3).toFixed(3));
    ed.g.style.opacity = "1";
  });
  if(YEAR>=0 && MODE===4){ yearCaption(); } else { whisper.classList.remove("on"); }
}

// ---------- seed card ----------
const card = document.getElementById("card");
function poem(idx){
  const n=N[idx], ties=nbr[idx].slice().sort((a,b)=>b.s-a.s);
  if(n.att===0) return "In the room, but faint in the record — an honest gap, never faked.";
  const bits=[];
  bits.push(\`Present \${n.att} time\${n.att===1?"":"s"}\`);
  if(n.topics.length) bits.push(\`carrying \${n.topics.length} thread\${n.topics.length===1?"":"s"} of thought\`);
  let s = bits.join(", ")+".";
  if(ties.length) s += \` Most often beside \${N[ties[0].o].name} — \${ties[0].s} shared session\${ties[0].s===1?"":"s"}.\`;
  if(n.ai>0) s += \` Holding \${n.ai} open intention\${n.ai===1?"":"s"}.\`;
  return s;
}
function select(idx){
  locked = idx; light(idx);
  const n = N[idx];
  document.getElementById("c-aura").style.background = \`linear-gradient(90deg, hsl(\${n.aura} 80% 62%), hsl(\${(n.aura+50)%360} 80% 66%))\`;
  document.getElementById("c-name").textContent = n.name;
  document.getElementById("c-meta").textContent = \`\${n.att} attended · \${n.men} mentioned · \${n.conf} confidence\`;
  document.getElementById("c-poem").textContent = poem(idx);
  const tt = document.getElementById("c-topics"); tt.innerHTML="";
  n.topics.slice().sort((a,b)=>b.sessions-a.sessions).forEach(t=>{
    const d=document.createElement("div"); d.className="trow";
    d.innerHTML=\`<span class="dot" style="background:hsl(\${t.hue} 80% 62%); color:hsl(\${t.hue} 80% 62%)"></span><span class="n">\${t.topic}</span><span class="c">\${t.sessions}</span>\`;
    tt.appendChild(d);
  });
  if(!n.topics.length){ tt.innerHTML='<div class="trow"><span class="n" style="color:var(--faint)">nothing recorded yet</span></div>'; }
  const tl = document.getElementById("c-ties"); tl.innerHTML="";
  const ties = nbr[idx].slice().sort((a,b)=>b.s-a.s).slice(0,6);
  const mx = Math.max(1,...ties.map(t=>t.s));
  ties.forEach(t=>{
    const b=document.createElement("button"); b.className="tie";
    b.innerHTML=\`<span class="n">\${N[t.o].name}</span><span class="bar"><i style="width:\${(100*t.s/mx).toFixed(0)}%"></i></span><span class="c">\${t.s}</span>\`;
    b.addEventListener("click",()=>{ select(t.o); flyTo(t.o); });
    tl.appendChild(b);
  });
  if(!ties.length){ tl.innerHTML='<div class="trow"><span class="n" style="color:var(--faint)">no shared sessions yet</span></div>'; }
  document.getElementById("year").style.display = n.sess.length? "" : "none";
  card.classList.add("on");
}
function deselect(){ locked=-1; unlight(); card.classList.remove("on"); }
document.getElementById("cardx").addEventListener("click",deselect);
svg.addEventListener("click",(e)=>{ if(e.target===svg) deselect(); });
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") deselect(); });

// ---------- topic lens ----------
const topicTotals = {};
N.forEach(n=>n.topics.forEach(t=>{ (topicTotals[t.topic]=topicTotals[t.topic]||{s:0,c:0,hue:t.hue}); topicTotals[t.topic].s+=t.sessions; topicTotals[t.topic].c++; }));
const topTopics = Object.entries(topicTotals).sort((a,b)=>b[1].s-a[1].s).slice(0,12);
const chips = document.getElementById("chips");
let lens = null;
function applyLens(topic){
  lens = topic;
  document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("on", c.dataset.t===topic));
  if(!topic){ svg.classList.remove("haslens");
    svg.querySelectorAll(".leafg").forEach(x=>x.classList.remove("match"));
    orgEls.forEach(g=>g.classList.remove("nomatch"));
    labelEls.forEach(t=>t && t.classList.remove("nomatch")); return; }
  svg.classList.add("haslens");
  svg.querySelectorAll(".leafg").forEach(x=>x.classList.toggle("match", x.dataset.topic===topic));
  N.forEach((n,i)=>{ const miss = !n.topics.some(t=>t.topic===topic);
    orgEls[i].classList.toggle("nomatch", miss);
    if(labelEls[i]) labelEls[i].classList.toggle("nomatch", miss); });
}
topTopics.forEach(([t,v])=>{
  const c=document.createElement("button"); c.className="chip"; c.dataset.t=t;
  c.innerHTML=\`<span class="dot" style="background:hsl(\${v.hue} 80% 62%); color:hsl(\${v.hue} 80% 62%)"></span>\${t} <span style="opacity:.55">\${v.c}</span>\`;
  c.title=\`\${v.c} people carry this thread\`;
  c.addEventListener("click",()=>applyLens(lens===t?null:t));
  chips.appendChild(c);
});
const clearChip=document.createElement("button"); clearChip.className="chip clear"; clearChip.textContent="everything";
clearChip.addEventListener("click",()=>applyLens(null)); chips.appendChild(clearChip);

// ---------- ticker ----------
const ticker = document.getElementById("ticker");
let ti=0;
function cycleTicker(){
  ticker.innerHTML=""; const s=document.createElement("span"); s.textContent=SENT[ti%SENT.length]; ticker.appendChild(s);
  requestAnimationFrame(()=>requestAnimationFrame(()=>s.classList.add("on")));
  setTimeout(()=>s.classList.remove("on"), 6200); ti++;
}
if(SENT.length){ cycleTicker(); setInterval(cycleTicker, 7400); }

// ---------- pan / zoom ----------
let vb = {x:0,y:0,w:1600,h:1040};
const VB0 = {...vb};
function setVB(){ svg.setAttribute("viewBox",\`\${vb.x.toFixed(1)} \${vb.y.toFixed(1)} \${vb.w.toFixed(1)} \${vb.h.toFixed(1)}\`); }
svg.addEventListener("wheel",(e)=>{
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  const mx = vb.x + (e.clientX-r.left)/r.width*vb.w, my = vb.y + (e.clientY-r.top)/r.height*vb.h;
  const f = e.deltaY>0 ? 1.12 : 1/1.12;
  const w = Math.min(3200, Math.max(220, vb.w*f)); const h = w*(VB0.h/VB0.w);
  vb = { x: mx-(mx-vb.x)*(w/vb.w), y: my-(my-vb.y)*(h/vb.h), w, h }; setVB();
},{passive:false});
let pan=null;
svg.addEventListener("pointerdown",(e)=>{ pan={x:e.clientX,y:e.clientY,vx:vb.x,vy:vb.y}; svg.classList.add("panning"); });
window.addEventListener("pointermove",(e)=>{ if(!pan) return;
  const r=svg.getBoundingClientRect();
  vb.x = pan.vx - (e.clientX-pan.x)/r.width*vb.w; vb.y = pan.vy - (e.clientY-pan.y)/r.height*vb.h; setVB(); });
window.addEventListener("pointerup",()=>{ pan=null; svg.classList.remove("panning"); });
svg.addEventListener("dblclick",()=>{ animateVB(VB0); });
function animateVB(target){
  const from={...vb}; const t0=performance.now(); const D=650;
  function step(t){ const k=Math.min(1,(t-t0)/D); const e=1-Math.pow(1-k,3);
    vb={ x:from.x+(target.x-from.x)*e, y:from.y+(target.y-from.y)*e, w:from.w+(target.w-from.w)*e, h:from.h+(target.h-from.h)*e }; setVB();
    if(k<1) requestAnimationFrame(step); }
  requestAnimationFrame(step);
}
function flyTo(idx){
  if(MODE!==2){ camFocus(idx); return; }
  const n=N[idx]; const w=560, h=w*(VB0.h/VB0.w);
  animateVB({x:n.x-w/2, y:n.y-h/2, w, h});
}

// ---------- find yourself ----------
const find = document.getElementById("find");
find.addEventListener("input",()=>{
  const q=find.value.trim().toLowerCase();
  orgEls.forEach(g=>g.classList.remove("found"));
  if(q.length<2) return;
  const i=N.findIndex(n=>n.name.toLowerCase().includes(q));
  if(i>=0) orgEls[i].classList.add("found");
});
find.addEventListener("keydown",(e)=>{
  if(e.key!=="Enter") return;
  const q=find.value.trim().toLowerCase(); if(!q) return;
  const i=N.findIndex(n=>n.name.toLowerCase().includes(q));
  if(i>=0){ select(i); flyTo(i); }
});

// ================================================================
// THE DIMENSION LADDER — 1D / 2D / 3D / 4D
// Same people, same record; each dimension is a different telling.
// 2D is the flat-on view of a 3D space whose depth axis is TOPICAL
// (people carrying the same threads sit at the same depth); 4D is
// TIME played through that space. The client still only draws —
// every coordinate is precomputed or derived by fixed formulas.
// ================================================================
const canvas = document.getElementById("dim");
const cx2 = canvas.getContext("2d");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DPR = Math.min(2, window.devicePixelRatio||1);
let CW=0, CH=0, FL=900;
function sizeCanvas(){
  const r = canvas.getBoundingClientRect();
  CW=r.width||innerWidth; CH=r.height||innerHeight;
  canvas.width=Math.round(CW*DPR); canvas.height=Math.round(CH*DPR);
  cx2.setTransform(DPR,0,0,DPR,0,0);
  FL = Math.min(CW/1600, CH/1040)*1500*0.94;
}
addEventListener("resize", sizeCanvas); sizeCanvas();

// ---- world coordinates ----
const CTRX=1600*0.5875, CTRY=1040/2, ZS=330;
const W3 = N.map(n=>({x:n.x-CTRX, y:n.y-CTRY, z:n.z*ZS}));
const order1 = N.map((_,i)=>i).sort((a,b)=>N[b].att-N[a].att || (N[a].name<N[b].name?-1:1));
const W1 = new Array(N.length);
order1.forEach((idx,k)=>{ W1[idx]={x:(k/(N.length-1)-0.5)*1440+150, y:150, z:0}; });

// ---- the fourth dimension: session data ----
const S_COUNT = SESS.length;
const first = N.map(n=>n.sess.length? n.sess[0] : Infinity);
const eSess = E.map(e=>{ const A=new Set(N[e[0]].sess); return N[e[1]].sess.filter(s=>A.has(s)); });
const bySess = Array.from({length:S_COUNT},()=>[]);
N.forEach((n,i)=>n.sess.forEach(s=>{ if(bySess[s]) bySess[s].push(i); }));

// ---- sprites: every organism pre-rendered once, then just stamped ----
function makeSprite(i){
  const n=N[i], S=300, baseY=S*0.66;
  const c=document.createElement("canvas"); c.width=S*2; c.height=S*2;
  const g=c.getContext("2d"); g.setTransform(2,0,0,2,0,0); g.translate(S/2, baseY);
  const ts=n.topics.slice().sort((a,b)=>b.sessions-a.sessions).slice(0,MAX_LEAVES);
  const T=ts.length, maxT=Math.max(1,...ts.map(t=>t.sessions));
  const L0=T? leafLen(ts[0].sessions,maxT,n.att) : 22;
  if(n.att===0 && T===0){
    g.strokeStyle="rgba(216,210,194,.35)"; g.setLineDash([2,5]); g.lineWidth=1;
    g.beginPath(); g.arc(0,0,14,0,7); g.stroke(); g.setLineDash([]);
    g.fillStyle="rgba(216,210,194,.5)"; g.beginPath(); g.arc(0,0,2,0,7); g.fill();
    return {c, baseY, L0:10};
  }
  const haloR=(30+Math.sqrt(n.att)*11)*(T?1:0.62);
  const hg=g.createRadialGradient(0,-L0*0.35,0, 0,-L0*0.35,haloR);
  hg.addColorStop(0,"hsla("+n.aura+",92%,70%,0.5)");
  hg.addColorStop(0.4,"hsla("+n.aura+",85%,55%,0.15)");
  hg.addColorStop(1,"hsla("+n.aura+",85%,55%,0)");
  g.fillStyle=hg; g.beginPath(); g.arc(0,-L0*0.35,haloR,0,7); g.fill();
  g.strokeStyle="rgba(201,168,106,.30)"; g.lineWidth=0.8; g.lineCap="round";
  for(let r=0;r<3;r++){
    const a=(90+(r-1)*34+(((n.rot*57.2958)%10)-5))*(Math.PI/180);
    const len=8+Math.sqrt(n.att)*3;
    g.beginPath(); g.moveTo(0,1);
    g.quadraticCurveTo(Math.cos(a+0.35)*len*0.55, Math.sin(a+0.35)*len*0.55, Math.cos(a)*len, Math.sin(a)*len);
    g.stroke();
  }
  ts.forEach((tp,i2)=>{
    const ang=leafAngleDeg(i2,T,n.rot), fr=leafVar(tp.hue,i2);
    const L=leafLen(tp.sessions,maxT,n.att)*(0.78+0.44*fr);
    const bend=L*0.24*(i2%2?-1:1)*(0.4+fr);
    const lh=leafHue(n.aura,tp.hue);
    const bx=bend*0.45, by=-L*0.42, tx=bend, ty=-L, Wd=L*0.58*0.42;
    g.save(); g.rotate((ang+90)*Math.PI/180);
    g.strokeStyle="hsla("+lh+",70%,60%,"+(0.5+0.35*n.sol)+")"; g.lineWidth=1.1;
    g.beginPath(); g.moveTo(0,0); g.quadraticCurveTo(bend*0.2,-L*0.24,bx,by); g.stroke();
    g.beginPath(); g.moveTo(bx,by);
    g.bezierCurveTo(bx-Wd*0.62,-L*0.58, bx+bend*0.25-Wd*0.35,-L*0.86, tx,ty);
    g.bezierCurveTo(bx+bend*0.25+Wd*0.35,-L*0.86, bx+Wd*0.62,-L*0.58, bx,by);
    g.closePath();
    g.fillStyle="hsla("+lh+",80%,58%,"+(0.5+0.35*n.sol)+")"; g.fill();
    g.strokeStyle="hsla("+lh+",95%,72%,"+(0.6+0.3*n.sol)+")"; g.lineWidth=0.9; g.stroke();
    g.strokeStyle="hsla("+lh+",45%,88%,0.5)"; g.lineWidth=0.7;
    g.beginPath(); g.moveTo(bx,by); g.quadraticCurveTo(bx+bend*0.3,-L*0.7,tx*0.96,ty*0.97); g.stroke();
    g.restore();
  });
  g.fillStyle="rgba(255,215,119,.9)";
  for(let m=0;m<n.ai;m++){
    const am=n.rot*1.7+(m/Math.max(1,n.ai))*Math.PI*2, rr=10+Math.sqrt(n.att)*4;
    g.beginPath(); g.arc(Math.cos(am)*rr, Math.sin(am)*rr*0.7-L0*0.4, 1.8, 0, 7); g.fill();
  }
  const cr=2.6+Math.sqrt(n.att)*1.1;
  const cg=g.createRadialGradient(0,0,0,0,0,cr*3.4);
  cg.addColorStop(0,"hsla("+n.aura+",90%,62%,"+(0.5*n.sol+0.25)+")");
  cg.addColorStop(1,"hsla("+n.aura+",90%,62%,0)");
  g.fillStyle=cg; g.beginPath(); g.arc(0,0,cr*3.4,0,7); g.fill();
  g.fillStyle="rgba(255,246,228,"+(0.55+0.45*n.sol)+")";
  g.beginPath(); g.arc(0,0,cr,0,7); g.fill();
  return {c, baseY, L0};
}
function makeBead(i){
  const n=N[i], S=120, c=document.createElement("canvas"); c.width=S*2; c.height=S*2;
  const g=c.getContext("2d"); g.setTransform(2,0,0,2,0,0); g.translate(S/2,S/2);
  const cr=2.2+Math.sqrt(n.att)*1.25, hr=8+Math.sqrt(n.att)*4.5;
  const hg=g.createRadialGradient(0,0,0,0,0,hr);
  hg.addColorStop(0,"hsla("+n.aura+",92%,68%,0.55)"); hg.addColorStop(1,"hsla("+n.aura+",85%,55%,0)");
  g.fillStyle=hg; g.beginPath(); g.arc(0,0,hr,0,7); g.fill();
  g.fillStyle=n.att? "rgba(255,246,228,"+(0.55+0.45*n.sol)+")" : "rgba(216,210,194,0.5)";
  g.beginPath(); g.arc(0,0,n.att?cr:2,0,7); g.fill();
  return {c, half:S/2};
}
const SPRITES = N.map((_,i)=>makeSprite(i));
const BEADS = N.map((_,i)=>makeBead(i));

// ---- camera ----
const CAM0 = {yaw:-0.52, pitch:-0.13, dist:1500, tx:0, ty:0, tz:0};
let cam = Object.assign({}, CAM0);
let camTween = null;
function camTo(target, dur){
  const from = Object.assign({}, cam);
  let dy = target.yaw-from.yaw; dy = ((dy+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
  const t0 = performance.now();
  camTween = (t)=>{
    const k=Math.min(1,(t-t0)/(dur||900)), e=1-Math.pow(1-k,3);
    cam.yaw=from.yaw+dy*e; cam.pitch=from.pitch+(target.pitch-from.pitch)*e;
    cam.dist=from.dist+(target.dist-from.dist)*e;
    cam.tx=from.tx+(target.tx-from.tx)*e; cam.ty=from.ty+(target.ty-from.ty)*e; cam.tz=from.tz+(target.tz-from.tz)*e;
    if(k>=1) camTween=null;
  };
}
function camFocus(idx){
  if(MODE===1) return;
  const p=W3[idx];
  camTo({yaw:cam.yaw, pitch:cam.pitch, dist:Math.max(560, cam.dist*0.55), tx:p.x, ty:p.y, tz:p.z}, 900);
}

// ---- modes ----
let MODE=2, T4=0, playing=false, lastStep=0, STAND=-1, YEAR=-1, hoverC=-1;
let zUnfold=1, zuFrom=0, zuT0=0, zuAnim=false;
let rafId=null, lastUser=0, dragC=null, movedC=false;
const dimcap=document.getElementById("dimcap");
const hintEl=document.getElementById("hint");
const CAPS={
  1:"One dimension — a line. Everyone reduced to a single number: how often they were present. Relationships have nowhere to live — they arc overhead, and everything crosses everything.",
  2:"Two dimensions — a plane. People can stand side by side, and the web of shared sessions finally has room to spread.",
  3:"Three dimensions — a space. Depth is what you think about: people carrying the same threads sit at the same depth. Click someone, then stand with them.",
  4:"Four dimensions — time, the one the others are made of. Watch the forest grow, session by session, thread by thread."
};
const HINTS={
  1:"hover a bead · click for their story",
  2:"drag to wander · scroll to lean in · double-click to step back",
  3:"drag to orbit · scroll to approach · click a person, then stand with them",
  4:"press play, or scrub the sessions · drag to orbit"
};
let capT=null;
function setDim(d){
  if(d===MODE) return;
  const wasCanvas = MODE!==2;
  MODE=d;
  document.querySelectorAll(".dimbar button").forEach(b=>b.classList.toggle("on", +b.dataset.d===d));
  document.body.classList.toggle("d1",d===1);
  document.body.classList.toggle("d3",d===3);
  document.body.classList.toggle("d4",d===4);
  document.body.classList.toggle("dcanvas",d!==2);
  dimcap.textContent=CAPS[d]; dimcap.classList.add("on");
  clearTimeout(capT); capT=setTimeout(()=>dimcap.classList.remove("on"), 9000);
  hintEl.textContent=HINTS[d];
  if(STAND>=0){ STAND=-1; YEAR=-1; unstandBtn.classList.remove("on"); whisper.classList.remove("on"); }
  if(d===2){ stopLoop(); playing=false; updPlay(); return; }
  if(d===1){
    cam={yaw:0,pitch:0,dist:1500,tx:0,ty:0,tz:0}; camTween=null;
  } else {
    zuFrom = wasCanvas? zUnfold : 0;
    if(!wasCanvas){ cam={yaw:0,pitch:0,dist:1500,tx:0,ty:0,tz:0}; camTo(CAM0, 1500); }
    zuT0=performance.now(); zuAnim=true;
  }
  if(d===4){ T4=0; scrub.value="0"; playing=!REDUCED; lastStep=performance.now(); updPlay(); updTlabel(); }
  else { playing=false; updPlay(); }
  requestAnimationFrame(sizeCanvas);
  startLoop();
}
document.querySelectorAll(".dimbar button").forEach(b=>b.addEventListener("click",()=>setDim(+b.dataset.d)));
document.addEventListener("keydown",(e)=>{
  if(e.target && e.target.tagName==="INPUT") return;
  if(e.key>="1" && e.key<="4") setDim(+e.key);
  if(e.key==="Escape" && STAND>=0) unstand();
});

// ---- time controls ----
const scrub=document.getElementById("tscrub"); scrub.max=String(Math.max(0,S_COUNT-1));
const tplay=document.getElementById("tplay");
const tlabel=document.getElementById("tlabel");
function updPlay(){ tplay.textContent = playing? "⏸" : "▶"; }
function updTlabel(){ tlabel.textContent = SESS[T4]+" · "+(bySess[T4]?bySess[T4].length:0)+" present · "+(T4+1)+"/"+S_COUNT; yearCaption(); }
tplay.addEventListener("click",()=>{ playing=!playing; if(playing && T4>=S_COUNT-1){ T4=0; scrub.value="0"; updTlabel(); } lastStep=performance.now(); updPlay(); });
scrub.addEventListener("input",()=>{ T4=+scrub.value; playing=false; updPlay(); updTlabel(); });

// ---- stand with them: the relativist camera ----
const standBtn=document.getElementById("stand");
const unstandBtn=document.getElementById("unstand");
function standWith(idx){
  if(MODE===1||MODE===2) setDim(3);
  STAND=idx;
  const p=W3[idx];
  const d=Math.max(760, Math.hypot(p.x,p.y,p.z)*1.55+430);
  const pitch=Math.asin(Math.max(-0.85,Math.min(0.85,-p.y/d)));
  const yaw=Math.atan2(-p.x,-p.z);
  camTo({yaw, pitch, dist:d, tx:0, ty:0, tz:0}, 1150);
  unstandBtn.classList.add("on");
  whisper.textContent="the room as "+N[idx].name+" sees it — their closest companions nearest";
  whisper.classList.add("on");
}
function unstand(){
  if(STAND<0) return;
  STAND=-1; YEAR=-1; unstandBtn.classList.remove("on"); whisper.classList.remove("on");
  camTo(CAM0, 900);
}
standBtn.addEventListener("click",()=>{ if(locked>=0) standWith(locked); });
unstandBtn.addEventListener("click",unstand);

// ---- watch their year: time played from inside their seat ----
const yearBtn=document.getElementById("year");
function ordinal(k){ const j=k%10,q=k%100; if(j===1&&q!==11)return k+"st"; if(j===2&&q!==12)return k+"nd"; if(j===3&&q!==13)return k+"rd"; return k+"th"; }
function watchYear(idx){
  if(!N[idx].sess.length) return;
  if(MODE!==4) setDim(4);
  YEAR=idx; STAND=idx;
  const p=W3[idx];
  const d=Math.max(760, Math.hypot(p.x,p.y,p.z)*1.55+430);
  const pitch=Math.asin(Math.max(-0.85,Math.min(0.85,-p.y/d)));
  const yaw=Math.atan2(-p.x,-p.z);
  camTo({yaw, pitch, dist:d, tx:0, ty:0, tz:0}, 1150);
  unstandBtn.classList.add("on");
  T4=Math.max(0, first[idx]-1); scrub.value=String(T4);
  playing=!REDUCED; lastStep=performance.now(); updPlay(); updTlabel();
}
function yearCaption(){
  if(YEAR<0||MODE!==4) return;
  const n=N[YEAR];
  let msg;
  if(T4>=S_COUNT-1 && !playing){
    msg="the year as "+n.name+" lived it — present "+n.att+" of "+S_COUNT+" sessions · "+nbr[YEAR].length+" companion"+(nbr[YEAR].length===1?"":"s");
  } else if(T4<first[YEAR]){
    msg=SESS[T4]+" — the room before you arrived · "+(bySess[T4]?bySess[T4].length:0)+" present";
  } else if(n.sess.indexOf(T4)>=0){
    let ord=0; for(let q=0;q<n.sess.length;q++) if(n.sess[q]<=T4) ord++;
    const comp=(bySess[T4]||[]).filter(i=>i!==YEAR);
    const str=(i)=>{ const x=nbr[YEAR].find(y=>y.o===i); return x?x.s:0; };
    comp.sort((a,b)=>str(b)-str(a));
    const names=comp.slice(0,2).map(i=>N[i].name);
    msg=SESS[T4]+" — your "+ordinal(ord)+" time in the room"+(names.length? " · beside "+names.join(", ")+(comp.length>2? " +"+(comp.length-2) : "") : " · alone in the record");
  } else {
    msg=SESS[T4]+" — you weren't in the room · "+(bySess[T4]?bySess[T4].length:0)+" were";
  }
  whisper.textContent=msg; whisper.classList.add("on");
}
yearBtn.addEventListener("click",()=>{ if(locked>=0) watchYear(locked); });

// ---- interaction ----
canvas.addEventListener("pointerdown",(e)=>{ dragC={x:e.clientX,y:e.clientY,yaw:cam.yaw,pitch:cam.pitch}; movedC=false; canvas.classList.add("panning"); lastUser=performance.now(); });
addEventListener("pointermove",(e)=>{
  if(dragC){
    lastUser=performance.now();
    const dx=e.clientX-dragC.x, dy=e.clientY-dragC.y;
    if(Math.abs(dx)+Math.abs(dy)>4) movedC=true;
    if(MODE!==1){ cam.yaw=dragC.yaw+dx*0.0042; cam.pitch=Math.max(-0.9,Math.min(0.9,dragC.pitch+dy*0.003)); }
    return;
  }
  if(!document.body.classList.contains("dcanvas")) return;
  const r=canvas.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
  let best=-1, bd=1e9;
  for(let i=0;i<N.length;i++){
    const s=SCR[i]; if(!s.vis) continue;
    if(MODE===4 && first[i]>T4) continue;
    const d2=(s.x-mx)*(s.x-mx)+(s.y-my)*(s.y-my);
    const rad=Math.max(16, 30*s.k);
    if(d2<rad*rad && d2<bd){ bd=d2; best=i; }
  }
  if(best!==hoverC){
    hoverC=best; canvas.style.cursor=best>=0?"pointer":"grab";
    if(best>=0 && locked<0 && STAND<0){
      const n=N[best];
      whisper.textContent=n.name+" — "+(n.att>0?("present "+n.att+" time"+(n.att===1?"":"s")):"faint in the record")+" · "+nbr[best].length+" companion"+(nbr[best].length===1?"":"s");
      whisper.classList.add("on");
    } else if(best<0 && locked<0 && STAND<0) whisper.classList.remove("on");
  }
});
addEventListener("pointerup",()=>{
  if(!dragC) return;
  dragC=null; canvas.classList.remove("panning");
  if(!movedC){ if(hoverC>=0) select(hoverC); else if(STAND<0) deselect(); }
});
canvas.addEventListener("wheel",(e)=>{ if(MODE===1) return; e.preventDefault(); lastUser=performance.now();
  cam.dist=Math.max(320,Math.min(3600,cam.dist*(e.deltaY>0?1.09:1/1.09))); },{passive:false});
canvas.addEventListener("dblclick",()=>{ if(MODE===1) return; if(STAND>=0){ unstand(); } else camTo(CAM0,800); });

// ---- render ----
const SCR = N.map(()=>({x:0,y:0,k:0,d:0,vis:false}));
function hasTopic(i,tp){ return N[i].topics.some(t=>t.topic===tp); }
function frame(t){
  rafId=requestAnimationFrame(frame);
  if(camTween) camTween(t);
  if(zuAnim){ const k=Math.min(1,(t-zuT0)/1300); zUnfold=zuFrom+(1-zuFrom)*(1-Math.pow(1-k,3)); if(k>=1) zuAnim=false; }
  const dt = frame._lt? t-frame._lt : 16; frame._lt=t;
  if((MODE===3||MODE===4) && !REDUCED && STAND<0 && !camTween && !dragC && t-lastUser>5000) cam.yaw+=0.00006*dt;
  if(MODE===4 && playing && t-lastStep>1650){
    lastStep=t;
    if(T4<S_COUNT-1){ T4++; scrub.value=String(T4); updTlabel(); }
    else { playing=false; updPlay(); updTlabel(); }
  }
  draw(t);
}
function startLoop(){ if(rafId==null){ frame._lt=undefined; rafId=requestAnimationFrame(frame); } }
function stopLoop(){ if(rafId!=null){ cancelAnimationFrame(rafId); rafId=null; } }

function draw(t){
  cx2.clearRect(0,0,CW,CH);
  const zu = MODE===1? 0 : zUnfold;
  const POS = MODE===1? W1 : W3;
  const cy=Math.cos(cam.yaw), sy=Math.sin(cam.yaw), cp=Math.cos(cam.pitch), sp=Math.sin(cam.pitch);
  for(let i=0;i<N.length;i++){
    const p=POS[i];
    const x=p.x-cam.tx, y=p.y-cam.ty, z=p.z*zu-cam.tz*zu;
    const x1=x*cy - z*sy, z1=x*sy + z*cy;
    const y2=y*cp - z1*sp, z2=y*sp + z1*cp;
    const depth=z2+cam.dist, s=SCR[i];
    if(depth<80){ s.vis=false; continue; }
    s.k=FL/depth; s.x=CW/2+x1*s.k; s.y=CH/2+y2*s.k; s.d=depth; s.vis=true;
  }
  const baseK=FL/CAM0.dist;
  const focus = STAND>=0? STAND : (locked>=0? locked : hoverC);
  let conn=null;
  if(focus>=0){ conn={}; nbr[focus].forEach(x=>conn[x.o]=1); }

  // the 1D baseline — the single axis everyone is flattened onto
  if(MODE===1){
    const anyv=SCR.find(s=>s.vis);
    if(anyv){
      const ly=anyv.y;
      const lg=cx2.createLinearGradient(0,0,CW,0);
      lg.addColorStop(0,"rgba(224,179,86,0)"); lg.addColorStop(0.08,"rgba(224,179,86,.3)");
      lg.addColorStop(0.92,"rgba(224,179,86,.3)"); lg.addColorStop(1,"rgba(224,179,86,0)");
      cx2.strokeStyle=lg; cx2.lineWidth=1;
      cx2.beginPath(); cx2.moveTo(0,ly); cx2.lineTo(CW,ly); cx2.stroke();
      cx2.fillStyle="rgba(164,157,139,.75)"; cx2.font='10.5px "JetBrains Mono",monospace'; cx2.textAlign="left";
      cx2.fillText("← most present", 24, ly-14);
      cx2.textAlign="right"; cx2.fillText("least present →", CW-24, ly-14);
      cx2.textAlign="left";
    }
  }

  // threads
  cx2.globalCompositeOperation="lighter";
  cx2.lineCap="round";
  for(let ei=0;ei<E.length;ei++){
    const a=E[ei][0], b=E[ei][1], sh=E[ei][2];
    const A=SCR[a], B=SCR[b];
    if(!A.vis||!B.vis) continue;
    let w=sh;
    if(MODE===4){
      if(first[a]>T4||first[b]>T4) continue;
      w=0; for(let q=0;q<eSess[ei].length;q++) if(eSess[ei][q]<=T4) w++;
      if(!w) continue;
    }
    const tt=Math.sqrt(w/maxShared);
    const km=Math.max(0.35,Math.min(1.6,((A.k+B.k)/2)/baseK));
    let alpha=(0.09+0.4*tt)*km;
    let lw=(0.6+2.4*tt)*km;
    let hue=mixHue(N[a].aura,N[b].aura);
    if(focus>=0){
      if(a===focus||b===focus){ hue=N[focus].aura; alpha=Math.min(0.8,(0.4+0.5*(w/maxShared))*Math.min(1,km)); lw=Math.min(4,(1.1+3*(w/maxShared))*km); }
      else alpha*=0.05;
    }
    if(lens && !(hasTopic(a,lens)&&hasTopic(b,lens))) alpha*=0.1;
    cx2.strokeStyle="hsla("+hue+",82%,64%,"+(alpha*0.32).toFixed(3)+")";
    cx2.lineWidth=lw*3;
    if(MODE===1){
      const cxm=(A.x+B.x)/2, cym=A.y-(Math.abs(A.x-B.x)*0.3+26);
      cx2.beginPath(); cx2.moveTo(A.x,A.y); cx2.quadraticCurveTo(cxm,cym,B.x,B.y); cx2.stroke();
      cx2.strokeStyle="hsla("+hue+",86%,68%,"+alpha.toFixed(3)+")"; cx2.lineWidth=Math.max(0.5,lw);
      cx2.beginPath(); cx2.moveTo(A.x,A.y); cx2.quadraticCurveTo(cxm,cym,B.x,B.y); cx2.stroke();
    } else {
      cx2.beginPath(); cx2.moveTo(A.x,A.y); cx2.lineTo(B.x,B.y); cx2.stroke();
      cx2.strokeStyle="hsla("+hue+",86%,68%,"+alpha.toFixed(3)+")"; cx2.lineWidth=Math.max(0.5,lw);
      cx2.beginPath(); cx2.moveTo(A.x,A.y); cx2.lineTo(B.x,B.y); cx2.stroke();
      // the fourth dimension made visible: flow along this session's threads
      if(MODE===4 && eSess[ei].indexOf(T4)>=0 && !REDUCED){
        for(let f=0;f<2;f++){
          const ph=((t*0.00035)+(ei%9)/9+f*0.5)%1;
          const fx=A.x+(B.x-A.x)*ph, fy=A.y+(B.y-A.y)*ph;
          cx2.fillStyle="hsla("+N[f?b:a].aura+",92%,75%,0.9)";
          cx2.beginPath(); cx2.arc(fx,fy,Math.max(1.4,2.1*((A.k+B.k)/2/baseK)),0,7); cx2.fill();
        }
      }
    }
  }
  cx2.globalCompositeOperation="source-over";

  // organisms, far → near
  const ord=N.map((_,i)=>i).filter(i=>SCR[i].vis).sort((a,b)=>SCR[b].d-SCR[a].d);
  for(const i of ord){
    const s=SCR[i], n=N[i];
    if(MODE===4 && first[i]>T4){
      cx2.globalAlpha=0.1; cx2.fillStyle="#d8d2c2";
      cx2.beginPath(); cx2.arc(s.x,s.y,Math.max(1,1.6*s.k),0,7); cx2.fill();
      cx2.globalAlpha=1; continue;
    }
    let scale=Math.min(s.k, baseK*2.2), alpha=1;
    if(MODE===4){
      let attT=0; for(let q=0;q<n.sess.length;q++) if(n.sess[q]<=T4) attT++;
      scale*=0.5+0.5*Math.sqrt(attT/Math.max(1,n.att));
    }
    if(focus>=0 && i!==focus && !(conn&&conn[i])) alpha*=0.13;
    if(STAND===i) alpha*=0.08; // you are the viewpoint — you don't see yourself
    if(lens && !hasTopic(i,lens)) alpha*=0.13;
    const br=REDUCED?1:(1+0.018*Math.sin(t*0.001*(1.1+(n.rot%0.9))+n.rot*7));
    cx2.globalAlpha=alpha;
    if(MODE===1){
      const bs=120*s.k*br;
      cx2.drawImage(BEADS[i].c, s.x-bs/2, s.y-bs/2, bs, bs);
    } else {
      const S=300*scale*br;
      cx2.drawImage(SPRITES[i].c, s.x-S/2, s.y-(SPRITES[i].baseY/300)*S, S, S);
      if(MODE===4 && bySess[T4] && bySess[T4].indexOf(i)>=0 && !REDUCED){
        const ph=(t%1400)/1400;
        cx2.strokeStyle="hsla("+n.aura+",90%,70%,"+(0.55*(1-ph)).toFixed(2)+")";
        cx2.lineWidth=1.4;
        cx2.beginPath(); cx2.arc(s.x,s.y,(6+22*ph)*s.k,0,7); cx2.stroke();
      }
    }
    cx2.globalAlpha=1;
  }

  // names
  cx2.textAlign="center";
  if(MODE===1){
    for(const i of order1){
      const s=SCR[i]; if(!s.vis) continue;
      const hot = focus===i || (conn&&conn[i]);
      cx2.save(); cx2.translate(s.x, s.y+16); cx2.rotate(0.66);
      cx2.font=(hot?"600 ":"")+'9.5px "JetBrains Mono",monospace'; cx2.textAlign="left";
      cx2.strokeStyle="rgba(3,4,2,.9)"; cx2.lineWidth=3;
      cx2.globalAlpha = focus>=0? (hot?0.95:0.18) : 0.7;
      cx2.strokeText(N[i].name, 0, 0);
      cx2.fillStyle = hot? "#f4eeda" : "#c9c3b1";
      cx2.fillText(N[i].name, 0, 0);
      cx2.restore();
    }
    cx2.globalAlpha=1;
  } else {
    const byAtt=N.map((_,i)=>i).sort((a,b)=>N[b].att-N[a].att).slice(0,12);
    const want=new Set(byAtt);
    if(focus>=0){ want.add(focus); nbr[focus].slice().sort((a,b)=>b.s-a.s).slice(0,8).forEach(x=>want.add(x.o)); }
    for(const i of want){
      const s=SCR[i]; if(!s.vis) continue;
      if(i===STAND) continue; // you don't see your own name from inside your view
      if(MODE===4 && first[i]>T4) continue;
      const rel=s.k/baseK;
      const px=Math.max(8,Math.min(15,11*rel));
      let alpha=Math.max(0.15,Math.min(0.95,0.85*rel));
      if(focus>=0 && i!==focus && !(conn&&conn[i])) alpha*=0.2;
      if(lens && !hasTopic(i,lens)) alpha*=0.2;
      cx2.font="600 "+px.toFixed(1)+"px Inter,sans-serif";
      cx2.globalAlpha=alpha;
      cx2.strokeStyle="rgba(3,4,2,.9)"; cx2.lineWidth=3;
      const ly=s.y-(SPRITES[i].L0+16)*s.k;
      cx2.strokeText(N[i].name.toUpperCase(), s.x, ly);
      cx2.fillStyle="#e9e4d6";
      cx2.fillText(N[i].name.toUpperCase(), s.x, ly);
    }
    cx2.globalAlpha=1;
  }
}
</script>
</body></html>`;
}
