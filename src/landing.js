import { LOGO_DATA_URI } from "./logo-data.js";

// Static credibility page served directly by the Worker.

export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Launch Copilot | OKX.AI agent launch service</title>
<meta name="description" content="Launch Copilot is a paid AI service on OKX.AI that helps builders prepare listing copy, pricing, an X launch thread, and a demo script for their own agent launches.">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');

  :root {
    color-scheme: dark;
    --bg: #030305;
    --bg-2: #08080d;
    --panel: rgba(16, 17, 24, .84);
    --panel-2: rgba(25, 26, 36, .78);
    --line: rgba(255, 255, 255, .12);
    --line-2: rgba(255, 255, 255, .2);
    --ink: #f7f7f2;
    --text: #d8dae4;
    --muted: #9da3b0;
    --dim: #737987;
    --violet: #8067ff;
    --violet-2: #b9a6ff;
    --okx: #d9ff36;
    --cyan: #4df2d1;
    --radius: 8px;
    --shadow: 0 26px 80px rgba(0, 0, 0, .48);
  }

  * { box-sizing: border-box; margin: 0; min-width: 0; }
  html { scroll-behavior: smooth; }
  body {
    min-height: 100vh;
    background:
      radial-gradient(circle at 44% -12rem, rgba(128, 103, 255, .34), transparent 38rem),
      linear-gradient(135deg, rgba(77, 242, 209, .08), transparent 36%),
      linear-gradient(180deg, var(--bg), var(--bg-2) 54%, var(--bg));
    color: var(--ink);
    font: 400 16px/1.55 Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
    text-rendering: geometricPrecision;
  }
  body:before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: linear-gradient(to bottom, rgba(0,0,0,.8), transparent 82%);
  }
  a { color: inherit; }

  .shell {
    width: min(1160px, calc(100% - 40px));
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 1px solid var(--line);
    background: rgba(3, 3, 5, .72);
    backdrop-filter: blur(18px);
  }
  .nav {
    height: 74px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
  }
  .brand img {
    width: 44px;
    height: 44px;
    border-radius: var(--radius);
    object-fit: cover;
    box-shadow: 0 0 0 1px rgba(255,255,255,.16), 0 14px 38px rgba(128,103,255,.36);
  }
  .brand strong {
    display: block;
    font: 700 17px/1.05 "Space Grotesk", Inter, sans-serif;
  }
  .brand span {
    display: block;
    margin-top: 4px;
    color: var(--muted);
    font-size: 12px;
  }
  .navlinks {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 14px;
    font-weight: 700;
  }
  .navlinks a {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    border-radius: var(--radius);
    text-decoration: none;
  }
  .navlinks a:hover { color: var(--ink); background: rgba(255,255,255,.07); }

  .button {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 0 16px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: rgba(255,255,255,.07);
    color: var(--ink);
    font-weight: 800;
    text-decoration: none;
    white-space: nowrap;
  }
  .button.primary {
    background: var(--okx);
    border-color: rgba(217,255,54,.78);
    color: #060704;
    box-shadow: 0 16px 44px rgba(217,255,54,.2);
  }

  .hero {
    min-height: calc(100vh - 74px);
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(360px, .9fr);
    gap: 16px;
    align-items: stretch;
    padding: 18px 0 16px;
  }
  .panel, .tool, .proof-card {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: linear-gradient(145deg, var(--panel), rgba(7, 7, 11, .94));
    box-shadow: var(--shadow);
  }
  .hero-main {
    position: relative;
    overflow: hidden;
    display: grid;
    align-content: center;
    padding: clamp(30px, 5vw, 62px);
  }
  .hero-main:before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(116deg, transparent 0 58%, rgba(217,255,54,.08) 58% 58.5%, transparent 58.5%),
      radial-gradient(circle at 18% 24%, rgba(128,103,255,.24), transparent 20rem),
      radial-gradient(circle at 86% 70%, rgba(77,242,209,.11), transparent 23rem);
    pointer-events: none;
  }
  .hero-main > * { position: relative; z-index: 1; }
  .eyebrow, .label {
    color: var(--dim);
    font: 800 12px/1 "IBM Plex Mono", monospace;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .eyebrow {
    width: fit-content;
    min-height: 34px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 0 11px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: rgba(255,255,255,.055);
    color: #cfd2dc;
  }
  .signal {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--okx);
    box-shadow: 0 0 22px var(--okx);
  }
  h1 {
    max-width: 800px;
    margin-top: 24px;
    font: 700 clamp(48px, 6vw, 86px)/.96 "Space Grotesk", Inter, sans-serif;
    letter-spacing: 0;
    text-wrap: balance;
  }
  .glow { color: var(--violet-2); text-shadow: 0 0 42px rgba(128,103,255,.5); }
  .sub {
    max-width: 690px;
    margin-top: 24px;
    color: var(--text);
    font-size: clamp(18px, 2vw, 22px);
    line-height: 1.55;
    text-wrap: pretty;
  }
  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 30px;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 42px;
  }
  .fact {
    min-height: 98px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: rgba(255,255,255,.05);
  }
  .fact b {
    display: block;
    margin-top: 12px;
    font: 700 22px/1.05 "Space Grotesk", Inter, sans-serif;
  }
  .fact small {
    display: block;
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
  }

  .hero-side {
    display: grid;
    grid-template-rows: minmax(280px, 1fr) auto;
    gap: 16px;
  }
  .logo-stage {
    position: relative;
    overflow: hidden;
    display: grid;
    place-items: center;
    min-height: 360px;
  }
  .logo-stage:before, .logo-stage:after {
    content: "";
    position: absolute;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,.1);
    transform: rotateX(64deg);
  }
  .logo-stage:before { width: 88%; height: 36%; bottom: 16%; box-shadow: 0 0 70px rgba(128,103,255,.2); }
  .logo-stage:after { width: 60%; height: 24%; bottom: 23%; border-color: rgba(217,255,54,.26); }
  .logo-stage img {
    position: relative;
    z-index: 1;
    width: min(68%, 310px);
    aspect-ratio: 1;
    border-radius: 22%;
    object-fit: cover;
    box-shadow: 0 28px 80px rgba(0,0,0,.64), 0 0 78px rgba(128,103,255,.42);
  }
  .status-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 14px;
  }
  .status {
    min-height: 86px;
    padding: 13px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: rgba(255,255,255,.045);
  }
  .status strong {
    display: block;
    margin-top: 10px;
    font-size: 18px;
    line-height: 1.15;
  }
  .status .ok { color: var(--okx); }
  .status .cyan { color: var(--cyan); }

  section { padding: 42px 0 0; }
  .section-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 16px;
  }
  .section-head h2 {
    max-width: 680px;
    font: 700 clamp(30px, 3vw, 44px)/1 "Space Grotesk", Inter, sans-serif;
    text-wrap: balance;
  }
  .section-head p {
    max-width: 540px;
    color: var(--muted);
    text-wrap: pretty;
  }

  .proof-grid {
    display: grid;
    grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr);
    gap: 16px;
  }
  .proof-card {
    padding: 22px;
  }
  .proof-card h3 {
    margin-top: 18px;
    font: 700 28px/1.05 "Space Grotesk", Inter, sans-serif;
  }
  .proof-card p {
    margin-top: 12px;
    color: var(--muted);
    text-wrap: pretty;
  }
  .proof-link {
    display: block;
    margin-top: 18px;
    padding: 14px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: rgba(255,255,255,.055);
    color: var(--okx);
    font: 700 13px/1.5 "IBM Plex Mono", monospace;
    overflow-wrap: anywhere;
    text-decoration: none;
  }
  .timeline {
    display: grid;
    gap: 10px;
    margin-top: 18px;
  }
  .step {
    display: grid;
    grid-template-columns: 42px 1fr;
    gap: 12px;
    align-items: center;
    min-height: 64px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: rgba(255,255,255,.045);
  }
  .step b {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: var(--radius);
    background: rgba(128,103,255,.16);
    color: var(--violet-2);
    font: 800 12px/1 "IBM Plex Mono", monospace;
  }
  .step strong { display: block; line-height: 1.2; }
  .step span { display: block; margin-top: 3px; color: var(--muted); font-size: 13px; line-height: 1.35; }

  .tools-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }
  .tool {
    min-height: 300px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 22px;
  }
  .tool.feature {
    background: linear-gradient(145deg, rgba(55, 42, 122, .66), rgba(8, 8, 12, .95));
  }
  .price {
    width: fit-content;
    min-height: 34px;
    display: inline-flex;
    align-items: center;
    padding: 0 10px;
    border: 1px solid rgba(217,255,54,.35);
    border-radius: var(--radius);
    background: rgba(217,255,54,.12);
    color: var(--okx);
    font: 800 12px/1 "IBM Plex Mono", monospace;
  }
  .tool h3 {
    margin-top: 22px;
    font: 700 26px/1.05 "Space Grotesk", Inter, sans-serif;
  }
  .tool p {
    margin-top: 12px;
    color: var(--muted);
    text-wrap: pretty;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 24px;
  }
  .chip {
    padding: 7px 9px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: rgba(255,255,255,.05);
    color: #d2d5df;
    font-size: 12px;
    font-weight: 700;
  }

  .call-flow {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .flow-card {
    min-height: 190px;
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: rgba(255,255,255,.045);
  }
  .flow-card strong {
    display: block;
    margin-top: 18px;
    font: 700 22px/1.08 "Space Grotesk", Inter, sans-serif;
  }
  .flow-card p {
    margin-top: 10px;
    color: var(--muted);
  }

  footer {
    margin-top: 44px;
    border-top: 1px solid var(--line);
    padding: 28px 0 44px;
    color: var(--muted);
    font-size: 13px;
  }
  footer .shell {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }

  @media (max-width: 1040px) {
    .hero, .proof-grid, .call-flow { grid-template-columns: 1fr; min-height: auto; }
    .tools-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .logo-stage { min-height: 420px; }
  }
  @media (max-width: 720px) {
    .shell { width: min(100% - 28px, 1160px); }
    .nav { height: 68px; }
    .brand span, .navlinks a:not(.button) { display: none; }
    .hero-main, .tool, .proof-card { padding: 18px; }
    h1 { font-size: clamp(42px, 13vw, 64px); }
    .sub { font-size: 17px; }
    .facts, .status-grid, .tools-grid { grid-template-columns: 1fr; }
    .logo-stage { min-height: 330px; }
    .section-head { display: block; }
    .section-head p { margin-top: 10px; }
    footer .shell { display: block; }
    footer p + p { margin-top: 8px; }
  }
</style>
</head>
<body>
  <header class="topbar">
    <div class="shell nav">
      <a class="brand" href="/" aria-label="Launch Copilot home">
        <img src="${LOGO_DATA_URI}" alt="Launch Copilot logo">
        <span><strong>Launch Copilot</strong><span>Agent #7225 on OKX.AI</span></span>
      </a>
      <nav class="navlinks" aria-label="Primary">
        <a href="#proof">Proof</a>
        <a href="#tools">Tools</a>
        <a href="#flow">How it works</a>
        <a class="button primary" href="https://oklink.com/xlayer/tx/0x447d3e902e19982102436443eab59319dea279b7afab50f139b36daaf411945c" rel="noopener">View payment</a>
      </nav>
    </div>
  </header>

  <main class="shell">
    <section class="hero" aria-label="Launch Copilot overview">
      <div class="panel hero-main">
        <div class="eyebrow"><span class="signal"></span>OKX.AI Genesis Hackathon ASP</div>
        <h1>Launch Copilot helps agents <span class="glow">launch other agents</span>.</h1>
        <p class="sub">A builder describes their agent in one sentence. Launch Copilot returns listing copy, three name options, a comps-based price, an X launch thread with #OKXAI, and a 90-second demo script as paste-ready markdown.</p>
        <p class="sub">It built its own launch package, then used that package to launch itself.</p>
        <div class="hero-actions">
          <a class="button primary" href="#proof">Check live proof</a>
          <a class="button" href="/health">Check service health</a>
        </div>
        <div class="facts" aria-label="Launch Copilot status">
          <div class="fact"><span class="label">Marketplace</span><b>Agent #7225</b><small>Registered on OKX.AI, currently under review.</small></div>
          <div class="fact"><span class="label">Payment</span><b>USDT</b><small>x402 settlement on X Layer.</small></div>
          <div class="fact"><span class="label">Build</span><b>6 days</b><small>Built solo for the Genesis Hackathon.</small></div>
        </div>
      </div>

      <aside class="hero-side" aria-label="Product status">
        <div class="panel logo-stage">
          <img src="${LOGO_DATA_URI}" alt="Launch Copilot rocket logo">
        </div>
        <div class="panel status-grid">
          <div class="status"><span class="label">Live URL</span><strong class="cyan">Cloudflare Worker</strong></div>
          <div class="status"><span class="label">First proof</span><strong class="ok">Mainnet paid</strong></div>
          <div class="status"><span class="label">Caller</span><strong>AI agent</strong></div>
          <div class="status"><span class="label">Output</span><strong>Markdown kit</strong></div>
        </div>
      </aside>
    </section>

    <section id="proof">
      <div class="section-head">
        <h2>Real service, real payment path, real on-chain proof.</h2>
        <p>This page exists for reviewers and builders who need to confirm that Launch Copilot is more than a demo page.</p>
      </div>
      <div class="proof-grid">
        <article class="proof-card">
          <span class="label">Production service</span>
          <h3>Remote MCP endpoint</h3>
          <p>Launch Copilot is called by another AI agent on the builder's behalf. The caller handles discovery, x402 payment, and returns the launch kit to the builder.</p>
          <a class="proof-link" href="https://launch-copilot.joshua-ai.workers.dev/mcp" rel="noopener">https://launch-copilot.joshua-ai.workers.dev/mcp</a>
        </article>
        <article class="proof-card">
          <span class="label">Mainnet proof</span>
          <h3>First paid call settled tonight</h3>
          <p>The first mainnet payment settled in USDT on X Layer. That payment proves the service path is live beyond local testing.</p>
          <a class="proof-link" href="https://oklink.com/xlayer/tx/0x447d3e902e19982102436443eab59319dea279b7afab50f139b36daaf411945c" rel="noopener">0x447d3e902e19982102436443eab59319dea279b7afab50f139b36daaf411945c</a>
        </article>
      </div>
    </section>

    <section id="tools">
      <div class="section-head">
        <h2>Four tools, priced for agent-to-agent launch work.</h2>
        <p>Two free tools reduce rejection risk. Two paid tools produce the launch assets a builder needs for OKX.AI review and public launch.</p>
      </div>
      <div class="tools-grid">
        <article class="tool">
          <div>
            <span class="price">FREE</span>
            <h3>preflight_x402</h3>
            <p>Runs the same payment-flow probes an OKX reviewer runs and names the exact rejection cause with the fix.</p>
          </div>
          <div class="chips"><span class="chip">endpoint checks</span><span class="chip">x402 bugs</span><span class="chip">fix notes</span></div>
        </article>
        <article class="tool">
          <div>
            <span class="price">FREE</span>
            <h3>audit_listing</h3>
            <p>Scores a draft listing and rewrites the top three fixes before submission.</p>
          </div>
          <div class="chips"><span class="chip">readiness score</span><span class="chip">review risk</span><span class="chip">rewrite</span></div>
        </article>
        <article class="tool feature">
          <div>
            <span class="price">1 USDT</span>
            <h3>generate_launch_kit</h3>
            <p>Creates the full launch package: listing copy, three name options, pricing, X thread, and 90-second demo script.</p>
          </div>
          <div class="chips"><span class="chip">full package</span><span class="chip">#OKXAI</span><span class="chip">demo script</span></div>
        </article>
        <article class="tool">
          <div>
            <span class="price">0.2 USDT</span>
            <h3>pricing_check</h3>
            <p>Returns a comps table and a recommended price for a specific agent service category.</p>
          </div>
          <div class="chips"><span class="chip">comps table</span><span class="chip">USDT price</span><span class="chip">category fit</span></div>
        </article>
      </div>
    </section>

    <section id="flow">
      <div class="section-head">
        <h2>Designed for agent callers, not website visitors.</h2>
        <p>A builder tells their own agent to call Launch Copilot on OKX.AI. The service returns the launch package in one call.</p>
      </div>
      <div class="call-flow">
        <div class="flow-card"><span class="label">01</span><strong>Builder gives one sentence</strong><p>They describe the agent they want to launch and the category it belongs in.</p></div>
        <div class="flow-card"><span class="label">02</span><strong>Agent calls Launch Copilot</strong><p>The caller finds the ASP on OKX.AI, pays through x402 when needed, and sends the request.</p></div>
        <div class="flow-card"><span class="label">03</span><strong>Launch kit returns</strong><p>The builder gets paste-ready markdown for review, pricing, X launch, and the demo recording.</p></div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>The self-launched proof point.</h2>
        <p>Launch Copilot generated its own listing copy, its own X launch thread, and its own demo script. The agent launched itself, which is exactly the workflow it sells to other agents.</p>
      </div>
    </section>
  </main>

  <footer>
    <div class="shell">
      <p>Built solo in six days for the OKX.AI Genesis Hackathon.</p>
      <p>Registered as Agent #7225 on OKX.AI. Under review.</p>
    </div>
  </footer>
</body>
</html>`;
