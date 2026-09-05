import os

os.makedirs("static/css", exist_ok=True)
os.makedirs("static/js",  exist_ok=True)

# ── index.html ────────────────────────────────────────────────────────────────
html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Migration QA Checker</title>
  <link rel="stylesheet" href="/static/css/styles.css"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
</head>
<body>
<div id="app">

  <header class="header">
    <div class="header-inner">
      <div class="logo">
        <span class="logo-icon">&#9889;</span>
        <span class="logo-text">Migration QA</span>
        <span class="logo-badge">v2.0</span>
      </div>
      <span class="domain-badge">PLE &#8594; EVONA</span>
    </div>
  </header>

  <main class="main">

    <section class="card">
      <h2 class="card-title">Compare Sites</h2>
      <form id="qa-form">
        <div class="url-grid">
          <div class="field">
            <label for="ple-url">&#128200; PLE URL (Original / Baseline)</label>
            <input id="ple-url" type="url" class="input"
              placeholder="https://original-ple-site.com/" required/>
          </div>
          <div class="field">
            <label for="evona-url">&#128640; EVONA URL (Migrated)</label>
            <input id="evona-url" type="url" class="input"
              placeholder="https://brand.evona.app/" required/>
          </div>
        </div>

        <div class="toggles">
          <label class="toggle">
            <input type="checkbox" id="tog-screenshots" checked/>
            <span class="toggle-label">&#128247; Side-by-Side Screenshots</span>
          </label>
          <label class="toggle">
            <input type="checkbox" id="tog-pages" checked/>
            <span class="toggle-label">&#128203; Page Coverage Scan</span>
          </label>
          <label class="toggle">
            <input type="checkbox" id="tog-cta" checked/>
            <span class="toggle-label">&#128279; CTA Link Check</span>
          </label>
          <label class="toggle">
            <input type="checkbox" id="tog-ai" checked/>
            <span class="toggle-label">&#129302; Gemini AI Analysis</span>
          </label>
        </div>

        <button type="submit" id="run-btn" class="btn-primary">
          &#9654; Run Migration QA Check
        </button>
      </form>
    </section>

    <section class="card loading-card" id="loading-card" style="display:none">
      <div class="spinner"></div>
      <p class="loading-title">Running Migration QA&#8230;</p>
      <p class="loading-sub">This takes 60&#8211;120 seconds. Please wait.</p>
      <div class="steps-list">
        <div class="step" id="step-scrape">Scraping both homepages</div>
        <div class="step" id="step-screenshots">Taking full-page screenshots</div>
        <div class="step" id="step-pages">Scanning page inventories</div>
        <div class="step" id="step-cta">Checking CTA links</div>
        <div class="step" id="step-ai">Running Gemini AI analysis</div>
      </div>
    </section>

    <section class="card error-card" id="error-card" style="display:none">
      <span class="error-icon">&#10060;</span>
      <div>
        <strong>Something went wrong</strong>
        <p id="error-msg"></p>
      </div>
    </section>

    <div id="results" style="display:none">

      <section class="card score-banner" id="score-banner">
        <div class="score-left">
          <div class="big-score" id="big-score">--</div>
          <div class="big-label">Overall Similarity</div>
        </div>
        <div class="score-breakdown" id="score-breakdown"></div>
        <div class="score-summary"   id="score-summary"></div>
      </section>

      <section class="card" id="screenshots-card" style="display:none">
        <h2 class="card-title">&#128247; Homepage Screenshots &#8212; Full Page</h2>
        <p class="ss-sync-note">
          Scroll either panel to scroll both sides together.
          Click Full Size to open the complete screenshot in a new tab.
        </p>
        <div class="screenshot-grid">
          <div class="screenshot-wrap">
            <div class="ss-header">
              <div class="screenshot-label ple-label">PLE (Original)</div>
              <button class="view-full-btn" id="ple-view-btn"
                style="display:none" onclick="viewFullSize('ple-ss')">
                &#128269; Full Size
              </button>
            </div>
            <div id="ple-ss" class="screenshot-container">
              <p class="ss-placeholder">Loading&#8230;</p>
            </div>
          </div>
          <div class="screenshot-wrap">
            <div class="ss-header">
              <div class="screenshot-label evona-label">EVONA (Migrated)</div>
              <button class="view-full-btn" id="evona-view-btn"
                style="display:none" onclick="viewFullSize('evona-ss')">
                &#128269; Full Size
              </button>
            </div>
            <div id="evona-ss" class="screenshot-container">
              <p class="ss-placeholder">Loading&#8230;</p>
            </div>
          </div>
        </div>
      </section>

      <section class="card" id="pages-card" style="display:none">
        <h2 class="card-title">&#128203; Page Coverage</h2>
        <div class="coverage-stats" id="coverage-stats"></div>
        <div id="missing-section"></div>
      </section>

      <section class="card" id="cta-card" style="display:none">
        <h2 class="card-title">&#128279; CTA Link Check</h2>
        <div class="cta-stats" id="cta-stats"></div>
        <div id="cta-table-section"></div>
      </section>

      <section class="card" id="ai-card" style="display:none">
        <h2 class="card-title">&#129302; AI Analysis</h2>
        <div id="ai-body"></div>
      </section>

    </div>
  </main>
</div>
<script src="/static/js/app.js"></script>
</body>
</html>"""

# ── styles.css ────────────────────────────────────────────────────────────────
css = """:root {
  --bg0:           #0d0f18;
  --bg1:           #141720;
  --bg2:           #1b1e2e;
  --border:        #252840;
  --txt1:          #e2e4f0;
  --txt2:          #8890aa;
  --txt3:          #4e5570;
  --purple:        #6366f1;
  --purple-dim:    rgba(99,102,241,.12);
  --purple-border: rgba(99,102,241,.25);
  --green:         #22c55e;
  --green-dim:     rgba(34,197,94,.12);
  --green-border:  rgba(34,197,94,.25);
  --yellow:        #f59e0b;
  --yellow-dim:    rgba(245,158,11,.12);
  --yellow-border: rgba(245,158,11,.25);
  --red:           #ef4444;
  --red-dim:       rgba(239,68,68,.12);
  --red-border:    rgba(239,68,68,.25);
  --blue:          #3b82f6;
  --radius:        12px;
  --font:          'Inter', system-ui, sans-serif;
  --mono:          'JetBrains Mono', monospace;
}

*,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
body { font-family:var(--font); background:var(--bg0); color:var(--txt1); min-height:100vh; line-height:1.6; }

.header { background:var(--bg1); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:100; }
.header-inner { max-width:1200px; margin:0 auto; padding:14px 24px; display:flex; align-items:center; justify-content:space-between; }
.logo { display:flex; align-items:center; gap:10px; }
.logo-icon { font-size:22px; }
.logo-text { font-size:18px; font-weight:700; background:linear-gradient(135deg,#6366f1,#8b5cf6); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.logo-badge { font-family:var(--mono); font-size:11px; color:var(--txt3); background:var(--bg2); border:1px solid var(--border); padding:2px 8px; border-radius:20px; }
.domain-badge { font-family:var(--mono); font-size:12px; color:var(--purple); background:var(--purple-dim); border:1px solid var(--purple-border); padding:4px 12px; border-radius:20px; }

.main { max-width:1200px; margin:0 auto; padding:28px 24px; display:flex; flex-direction:column; gap:20px; }
.card { background:var(--bg2); border:1px solid var(--border); border-radius:var(--radius); padding:28px; }
.card-title { font-size:16px; font-weight:600; margin-bottom:20px; }

.url-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
@media(max-width:760px) { .url-grid { grid-template-columns:1fr; } }
.field { display:flex; flex-direction:column; gap:6px; }
.field label { font-size:11px; font-weight:600; color:var(--txt2); text-transform:uppercase; letter-spacing:.06em; }
.input { background:var(--bg1); border:1px solid var(--border); border-radius:10px; color:var(--txt1); font-family:var(--mono); font-size:13px; padding:10px 14px; outline:none; width:100%; transition:border-color .2s,box-shadow .2s; }
.input:focus { border-color:var(--purple); box-shadow:0 0 0 3px var(--purple-dim); }

.toggles { display:flex; gap:20px; flex-wrap:wrap; margin:0 0 20px; }
.toggle { display:flex; align-items:center; gap:8px; cursor:pointer; }
.toggle input { accent-color:var(--purple); width:15px; height:15px; }
.toggle-label { font-size:13px; color:var(--txt2); }

.btn-primary { background:linear-gradient(135deg,var(--purple),#8b5cf6); border:none; border-radius:10px; color:#fff; cursor:pointer; font-family:var(--font); font-size:14px; font-weight:600; padding:13px 28px; width:100%; transition:opacity .15s,transform .1s; }
.btn-primary:hover:not(:disabled) { opacity:.9; transform:translateY(-1px); }
.btn-primary:disabled { opacity:.45; cursor:not-allowed; }

.loading-card { text-align:center; padding:48px 28px; }
.spinner { width:44px; height:44px; border:3px solid var(--border); border-top-color:var(--purple); border-radius:50%; animation:spin 1s linear infinite; margin:0 auto 20px; }
@keyframes spin { to { transform:rotate(360deg); } }
.loading-title { font-size:18px; font-weight:600; margin-bottom:6px; }
.loading-sub { font-size:13px; color:var(--txt3); margin-bottom:24px; }
.steps-list { display:flex; flex-direction:column; gap:8px; max-width:420px; margin:0 auto; text-align:left; }
.step { padding:10px 14px; background:var(--bg1); border:1px solid var(--border); border-radius:8px; font-size:13px; color:var(--txt2); transition:all .3s; }
.step.active { border-color:var(--purple); color:var(--txt1); background:var(--purple-dim); }
.step.done   { border-color:var(--green);  color:var(--green); background:var(--green-dim); }

.error-card { display:flex; align-items:flex-start; gap:12px; border-color:var(--red-border); background:var(--red-dim); }
.error-icon { font-size:20px; flex-shrink:0; }
.error-card strong { color:var(--red); }
.error-card p { font-size:13px; color:var(--txt2); margin-top:4px; }

.score-banner { display:flex; align-items:center; gap:32px; flex-wrap:wrap; }
.score-left { text-align:center; flex-shrink:0; }
.big-score { font-family:var(--mono); font-size:72px; font-weight:700; line-height:1; }
.big-label { font-size:12px; color:var(--txt2); text-transform:uppercase; letter-spacing:.06em; margin-top:4px; }
.score-breakdown { display:flex; flex-direction:column; gap:10px; flex:1; min-width:220px; }
.breakdown-row { display:flex; align-items:center; gap:10px; }
.breakdown-label { font-size:12px; color:var(--txt2); width:180px; flex-shrink:0; }
.breakdown-bar-wrap { flex:1; height:6px; background:var(--bg1); border-radius:3px; overflow:hidden; }
.breakdown-bar { height:100%; border-radius:3px; transition:width .6s ease; }
.breakdown-val { font-family:var(--mono); font-size:12px; font-weight:700; width:40px; text-align:right; }
.score-summary { flex:2; font-size:13px; color:var(--txt2); line-height:1.6; min-width:200px; }

.ss-sync-note { font-size:12px; color:var(--txt3); margin-bottom:16px; font-style:italic; line-height:1.5; }
.screenshot-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; }
@media(max-width:760px) { .screenshot-grid { grid-template-columns:1fr; } }
.screenshot-wrap { display:flex; flex-direction:column; gap:0; }
.ss-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
.screenshot-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:6px 12px; border-radius:6px; display:inline-block; }
.ple-label   { background:var(--green-dim);  color:var(--green);  }
.evona-label { background:var(--purple-dim); color:var(--purple); }
.view-full-btn { background:var(--bg1); border:1px solid var(--border); border-radius:6px; color:var(--txt2); cursor:pointer; font-size:11px; font-family:var(--font); padding:5px 12px; transition:all .2s; white-space:nowrap; }
.view-full-btn:hover { border-color:var(--purple); color:var(--purple); }

/* ── Screenshot container ──────────────────────────────────────────────
   Uses a fixed 700px height for synchronized scrolling.
   The image inside is full-width so a tall full-page capture
   will overflow and become scrollable.
   ────────────────────────────────────────────────────────────────── */
.screenshot-container {
  border:          1px solid var(--border);
  border-radius:   8px;
  overflow-y:      scroll;
  height:          700px;
  background:      var(--bg1);
  scroll-behavior: smooth;
  position:        relative;
}
.screenshot-container img {
  width:       100%;
  display:     block;
  height:      auto;
  object-fit:  cover;
  object-position: top;
}
.ss-placeholder { padding:40px; text-align:center; color:var(--txt3); font-size:13px; }
.ss-error { padding:20px; color:var(--red); font-size:13px; text-align:center; line-height:1.6; }
.ss-loading-bar {
  position:   absolute;
  bottom:     0;
  left:       0;
  height:     3px;
  width:      100%;
  background: linear-gradient(90deg, var(--purple), #8b5cf6);
  animation:  loading-bar 2s ease-in-out infinite;
}
@keyframes loading-bar {
  0%   { transform: scaleX(0); transform-origin: left; }
  50%  { transform: scaleX(1); transform-origin: left; }
  51%  { transform: scaleX(1); transform-origin: right; }
  100% { transform: scaleX(0); transform-origin: right; }
}

.coverage-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px; }
@media(max-width:760px) { .coverage-stats { grid-template-columns:repeat(2,1fr); } }
.stat-box { background:var(--bg1); border:1px solid var(--border); border-radius:8px; padding:14px; text-align:center; }
.stat-val   { font-family:var(--mono); font-size:22px; font-weight:700; line-height:1; margin-bottom:4px; }
.stat-label { font-size:10px; color:var(--txt3); text-transform:uppercase; letter-spacing:.04em; }

.sub-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--txt3); margin-bottom:8px; margin-top:20px; }
.page-list { list-style:none; display:flex; flex-direction:column; gap:4px; max-height:260px; overflow-y:auto; }
.page-list li { font-family:var(--mono); font-size:12px; color:var(--txt2); padding:6px 10px; background:var(--bg1); border-radius:6px; border-left:3px solid var(--red); }
.page-list li.extra { border-left-color:var(--blue); }

.cta-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px; }
@media(max-width:760px) { .cta-stats { grid-template-columns:repeat(2,1fr); } }
.cta-table { width:100%; border-collapse:collapse; font-size:12px; }
.cta-table th { text-align:left; padding:8px 12px; color:var(--txt3); font-size:10px; text-transform:uppercase; border-bottom:1px solid var(--border); white-space:nowrap; }
.cta-table td { padding:8px 12px; border-bottom:1px solid rgba(37,40,64,.4); color:var(--txt2); font-family:var(--mono); font-size:11px; word-break:break-all; }
.cta-table td:first-child { color:var(--txt1); font-family:var(--font); font-size:12px; word-break:normal; }
.cta-table tr:last-child td { border-bottom:none; }

.badge { display:inline-flex; align-items:center; font-size:9px; font-weight:700; padding:2px 8px; border-radius:20px; text-transform:uppercase; letter-spacing:.04em; white-space:nowrap; }
.b-ok   { background:var(--green-dim);  color:var(--green);  }
.b-warn { background:var(--yellow-dim); color:var(--yellow); }
.b-bad  { background:var(--red-dim);    color:var(--red);    }

.ai-scores { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:24px; }
@media(max-width:760px) { .ai-scores { grid-template-columns:repeat(2,1fr); } }
.ai-score-box { background:var(--bg1); border:1px solid var(--border); border-radius:8px; padding:14px; text-align:center; }
.ai-score-val { font-family:var(--mono); font-size:22px; font-weight:700; line-height:1; margin-bottom:4px; }
.ai-score-lbl { font-size:10px; color:var(--txt3); text-transform:uppercase; letter-spacing:.04em; }

.issues-list { list-style:none; display:flex; flex-direction:column; gap:8px; }
.issue-item { display:flex; gap:10px; padding:10px 14px; background:var(--bg1); border-radius:8px; border-left:3px solid var(--border); font-size:12px; color:var(--txt2); line-height:1.5; }
.issue-item.critical { border-left-color:var(--red);    }
.issue-item.warning  { border-left-color:var(--yellow); }
.issue-item.info     { border-left-color:var(--blue);   }
.issue-sev { font-size:9px; font-weight:700; text-transform:uppercase; color:var(--txt3); flex-shrink:0; margin-top:2px; width:54px; }

.good-list, .rec-list { list-style:none; display:flex; flex-direction:column; gap:6px; }
.good-list li, .rec-list li { display:flex; gap:8px; font-size:12px; color:var(--txt2); line-height:1.5; }

.c-good { color:var(--green);  }
.c-mid  { color:var(--yellow); }
.c-bad  { color:var(--red);    }
.c-na   { color:var(--txt3);   }"""

# ── app.js ────────────────────────────────────────────────────────────────────
js = """/* =====================================================================
   Migration QA Checker - Frontend Application
   ===================================================================== */

var form        = document.getElementById('qa-form');
var runBtn      = document.getElementById('run-btn');
var loadingCard = document.getElementById('loading-card');
var errorCard   = document.getElementById('error-card');
var errorMsg    = document.getElementById('error-msg');
var results     = document.getElementById('results');

var STEPS = ['step-scrape','step-screenshots','step-pages','step-cta','step-ai'];
var STEP_LABELS = {
  'step-scrape':      'Scraping both homepages',
  'step-screenshots': 'Taking full-page screenshots',
  'step-pages':       'Scanning page inventories',
  'step-cta':         'Checking CTA links',
  'step-ai':          'Running Gemini AI analysis'
};
var stepTimer = null;

/* ── Helpers ────────────────────────────────────────────────────────── */
function scoreColor(n) {
  if (n==null) return 'var(--txt3)';
  if (n>=80)   return 'var(--green)';
  if (n>=60)   return 'var(--yellow)';
  return 'var(--red)';
}
function scoreClass(n) {
  if (n==null) return 'c-na';
  if (n>=80)   return 'c-good';
  if (n>=60)   return 'c-mid';
  return 'c-bad';
}
function statBox(val, label, color) {
  return '<div class="stat-box">'+
    '<div class="stat-val" style="color:'+(color||'var(--txt1)')+'">'+
      (val!=null?val:'--')+
    '</div>'+
    '<div class="stat-label">'+label+'</div>'+
  '</div>';
}
function aiScoreBox(label, val) {
  return '<div class="ai-score-box">'+
    '<div class="ai-score-val '+scoreClass(val)+'">'+
      (val!=null?val:'--')+
    '</div>'+
    '<div class="ai-score-lbl">'+label+'</div>'+
  '</div>';
}

/* ── Loading ────────────────────────────────────────────────────────── */
function startLoading(opts) {
  runBtn.disabled           = true;
  runBtn.textContent        = 'Running...';
  loadingCard.style.display = '';
  errorCard.style.display   = 'none';
  results.style.display     = 'none';

  STEPS.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.className   = 'step';
    el.textContent = STEP_LABELS[id];
    if (id==='step-screenshots' && !opts.screenshots) { el.style.display='none'; return; }
    if (id==='step-pages'       && !opts.pages)       { el.style.display='none'; return; }
    if (id==='step-cta'         && !opts.cta)         { el.style.display='none'; return; }
    if (id==='step-ai'          && !opts.ai)          { el.style.display='none'; return; }
    el.style.display = '';
  });

  var visible = STEPS
    .map(function(id){ return document.getElementById(id); })
    .filter(function(el){ return el && el.style.display!=='none'; });

  var idx = 0;
  function advance() {
    if (idx>0 && visible[idx-1]) {
      visible[idx-1].className   = 'step done';
      visible[idx-1].textContent = 'Done: '+STEP_LABELS[visible[idx-1].id];
    }
    if (idx<visible.length) {
      visible[idx].className = 'step active';
      idx++;
      stepTimer = setTimeout(advance, 25000/visible.length);
    }
  }
  advance();
}

function stopLoading() {
  clearTimeout(stepTimer);
  runBtn.disabled           = false;
  runBtn.textContent        = 'Run Migration QA Check';
  loadingCard.style.display = 'none';
}

/* ── API call ───────────────────────────────────────────────────────── */
async function runCheck() {
  var pleUrl        = document.getElementById('ple-url').value.trim();
  var evonaUrl      = document.getElementById('evona-url').value.trim();
  var doScreenshots = document.getElementById('tog-screenshots').checked;
  var doPages       = document.getElementById('tog-pages').checked;
  var doCTA         = document.getElementById('tog-cta').checked;
  var doAI          = document.getElementById('tog-ai').checked;

  startLoading({screenshots:doScreenshots,pages:doPages,cta:doCTA,ai:doAI});

  try {
    var resp = await fetch('/api/migration-check', {
      method:  'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        ple_url:             pleUrl,
        evona_url:           evonaUrl,
        include_screenshots: doScreenshots,
        include_page_scan:   doPages,
        include_cta_check:   doCTA,
        include_ai_analysis: doAI
      })
    });

    if (!resp.ok) {
      var detail = resp.statusText;
      try { var eb = await resp.json(); detail = eb.detail||detail; } catch(_) {}
      throw new Error(detail);
    }

    var data = await resp.json();
    stopLoading();
    renderResults(data);

  } catch(err) {
    stopLoading();
    errorCard.style.display = '';
    errorMsg.textContent    = err.message||'Unknown error occurred.';
  }
}

form.addEventListener('submit', function(e){ e.preventDefault(); runCheck(); });

/* ── Render results ─────────────────────────────────────────────────── */
function renderResults(data) {
  results.style.display = '';
  renderScoreBanner(data);
  renderScreenshots(data.screenshots);
  renderPageScan(data.page_scan);
  renderCTACheck(data.cta_check);
  renderAIAnalysis(data.ai_analysis);
}

/* ── Score banner ───────────────────────────────────────────────────── */
function renderScoreBanner(data) {
  var score = data.overall_similarity;
  var bigEl = document.getElementById('big-score');
  bigEl.textContent = score!=null ? score+'%' : '--';
  bigEl.style.color = scoreColor(score);

  var breakdown = document.getElementById('score-breakdown');
  breakdown.innerHTML = '';

  var aiA = (data.ai_analysis && data.ai_analysis.success && data.ai_analysis.analysis)
              ? data.ai_analysis.analysis : null;
  var ps  = data.page_scan||null;
  var cta = (data.cta_check && data.cta_check.comparison) ? data.cta_check.comparison : null;

  function addRow(label, val) {
    var row = document.createElement('div');
    row.className = 'breakdown-row';
    row.innerHTML =
      '<span class="breakdown-label">'+label+'</span>'+
      '<div class="breakdown-bar-wrap">'+
        '<div class="breakdown-bar" style="width:'+(val||0)+'%;background:'+scoreColor(val)+'"></div>'+
      '</div>'+
      '<span class="breakdown-val '+scoreClass(val)+'">'+(val!=null?val+'%':'--')+'</span>';
    breakdown.appendChild(row);
  }

  if (aiA) {
    addRow('Content Match',        aiA.content_match);
    addRow('Structure Match',      aiA.structure_match);
    addRow('Metadata Match',       aiA.metadata_match);
    addRow('Feature Completeness', aiA.feature_completeness);
  }
  if (ps)  { addRow('Page Coverage',  ps.coverage_percent); }
  if (cta) { addRow('CTA Match Rate', cta.match_rate); }

  document.getElementById('score-summary').textContent =
    (aiA && aiA.summary) ? aiA.summary : '';
}

/* ── Screenshots ────────────────────────────────────────────────────── */
function renderScreenshots(screenshots) {
  var card = document.getElementById('screenshots-card');
  if (!screenshots) { card.style.display='none'; return; }
  card.style.display = '';

  setImage('ple-ss',   'ple-view-btn',  screenshots.ple);
  setImage('evona-ss', 'evona-view-btn', screenshots.evona);

  /* Set up synchronized scrolling after images are placed */
  setupSyncScroll();
}

function setImage(containerId, btnId, ssData) {
  var el  = document.getElementById(containerId);
  var btn = document.getElementById(btnId);

  /* Show a loading bar while we wait for the image */
  el.innerHTML = '<div class="ss-loading-bar"></div><p class="ss-placeholder">Loading full-page screenshot&#8230;</p>';

  if (!ssData || !ssData.success || !ssData.image_base64) {
    el.innerHTML =
      '<p class="ss-error">Screenshot unavailable: '+
      (ssData && ssData.error ? ssData.error : 'No image data returned')+
      '</p>';
    if (btn) btn.style.display = 'none';
    return;
  }

  var img    = document.createElement('img');
  img.alt    = 'Full page screenshot';
  img.style.display = 'none'; /* Hide until loaded */

  img.onload = function() {
    /* Remove loading bar and show image */
    el.innerHTML = '';
    el.appendChild(img);
    img.style.display = 'block';
    if (btn) btn.style.display = '';

    /* If image is shorter than container remove scrollbar */
    if (img.naturalHeight < 700) {
      el.style.overflowY = 'hidden';
    } else {
      el.style.overflowY = 'scroll';
    }
  };

  img.onerror = function() {
    el.innerHTML = '<p class="ss-error">Image failed to render.</p>';
    if (btn) btn.style.display = 'none';
  };

  img.src = 'data:image/png;base64,' + ssData.image_base64;
}

/* ── Synchronized scrolling ─────────────────────────────────────────── */
function setupSyncScroll() {
  var pleEl   = document.getElementById('ple-ss');
  var evonaEl = document.getElementById('evona-ss');
  if (!pleEl || !evonaEl) return;

  var syncing = false;

  pleEl.addEventListener('scroll', function() {
    if (syncing) return;
    syncing = true;
    evonaEl.scrollTop = pleEl.scrollTop;
    syncing = false;
  });

  evonaEl.addEventListener('scroll', function() {
    if (syncing) return;
    syncing = true;
    pleEl.scrollTop = evonaEl.scrollTop;
    syncing = false;
  });
}

/* ── Open full size in new tab ───────────────────────────────────────── */
function viewFullSize(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var img = container.querySelector('img');
  if (!img || !img.src) return;
  var win = window.open('','_blank');
  if (!win) return;
  win.document.write(
    '<html><head><title>Full Page Screenshot</title>'+
    '<style>body{margin:0;background:#0d0f18;} img{width:100%;display:block;}</style></head>'+
    '<body><img src="'+img.src+'" alt="Full page screenshot"/></body></html>'
  );
  win.document.close();
}

/* ── Page scan ──────────────────────────────────────────────────────── */
function renderPageScan(ps) {
  var card = document.getElementById('pages-card');
  if (!ps) { card.style.display='none'; return; }
  card.style.display = '';

  var missingColor = (ps.missing_count && ps.missing_count>0) ? 'var(--red)' : 'var(--green)';
  document.getElementById('coverage-stats').innerHTML =
    statBox(ps.ple_page_count,   'PLE Pages',   'var(--green)') +
    statBox(ps.evona_page_count, 'EVONA Pages', 'var(--purple)') +
    statBox(ps.missing_count,    'Missing',      missingColor) +
    statBox(ps.coverage_percent!=null?ps.coverage_percent+'%':'--','Coverage',scoreColor(ps.coverage_percent));

  var sec = document.getElementById('missing-section');
  sec.innerHTML = '';

  if (ps.missing_from_evona && ps.missing_from_evona.length) {
    var mh = document.createElement('p');
    mh.className   = 'sub-title';
    mh.textContent = 'Pages in PLE missing from EVONA ('+ps.missing_from_evona.length+')';
    sec.appendChild(mh);
    var mul = document.createElement('ul');
    mul.className = 'page-list';
    ps.missing_from_evona.forEach(function(path) {
      var li = document.createElement('li');
      li.textContent = path;
      mul.appendChild(li);
    });
    sec.appendChild(mul);
  }

  if (ps.extra_in_evona && ps.extra_in_evona.length) {
    var eh = document.createElement('p');
    eh.className   = 'sub-title';
    eh.textContent = 'Pages in EVONA not found in PLE ('+ps.extra_in_evona.length+')';
    sec.appendChild(eh);
    var eul = document.createElement('ul');
    eul.className = 'page-list';
    ps.extra_in_evona.forEach(function(path) {
      var li2 = document.createElement('li');
      li2.className   = 'extra';
      li2.textContent = path;
      eul.appendChild(li2);
    });
    sec.appendChild(eul);
  }
}

/* ── CTA check ──────────────────────────────────────────────────────── */
function renderCTACheck(cta) {
  var card = document.getElementById('cta-card');
  if (!cta) { card.style.display='none'; return; }
  card.style.display = '';

  var comp        = cta.comparison||{};
  var brokenColor = (cta.evona_broken_count && cta.evona_broken_count>0) ? 'var(--red)' : 'var(--green)';

  document.getElementById('cta-stats').innerHTML =
    statBox(cta.ple_cta_count,      'PLE CTAs',    'var(--green)') +
    statBox(cta.evona_cta_count,    'EVONA CTAs',  'var(--purple)') +
    statBox(cta.evona_broken_count, 'Broken Links', brokenColor) +
    statBox(comp.match_rate!=null?comp.match_rate+'%':'--','CTA Match',scoreColor(comp.match_rate));

  var sec = document.getElementById('cta-table-section');
  sec.innerHTML = '';

  if (comp.results && comp.results.length) {
    var table = document.createElement('table');
    table.className = 'cta-table';
    table.innerHTML =
      '<thead><tr>'+
        '<th>CTA Text</th><th>PLE Path</th><th>EVONA Path</th><th>Status</th>'+
      '</tr></thead>';
    var tbody = document.createElement('tbody');
    comp.results.forEach(function(row) {
      var tr  = document.createElement('tr');
      var bdg = row.status==='ok'
        ? '<span class="badge b-ok">OK</span>'
        : row.status==='path_mismatch'
          ? '<span class="badge b-warn">Mismatch</span>'
          : '<span class="badge b-bad">Missing</span>';
      tr.innerHTML =
        '<td>'+(row.text      ||'--')+'</td>'+
        '<td>'+(row.ple_path  ||'--')+'</td>'+
        '<td>'+(row.evona_path||'--')+'</td>'+
        '<td>'+bdg+'</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
  }

  if (cta.evona_broken && cta.evona_broken.length) {
    var bh = document.createElement('p');
    bh.className      = 'sub-title';
    bh.style.marginTop = '20px';
    bh.textContent    = 'Broken Links in EVONA ('+cta.evona_broken.length+')';
    sec.appendChild(bh);
    var bul = document.createElement('ul');
    bul.className = 'page-list';
    cta.evona_broken.forEach(function(item) {
      var li = document.createElement('li');
      li.textContent = (item.text||'')+'  --  '+(item.full_url||'')+'  ('+(item.status_code!=null?item.status_code:'error')+')';
      bul.appendChild(li);
    });
    sec.appendChild(bul);
  }
}

/* ── AI analysis ────────────────────────────────────────────────────── */
function renderAIAnalysis(ai) {
  var card = document.getElementById('ai-card');
  if (!ai) { card.style.display='none'; return; }
  card.style.display = '';

  var body = document.getElementById('ai-body');
  body.innerHTML = '';

  if (!ai.success || !ai.analysis) {
    body.innerHTML = '<p style="color:var(--red);font-size:13px">AI analysis failed: '+(ai.error||'Unknown error')+'</p>';
    return;
  }

  var a = ai.analysis;

  var scoresDiv = document.createElement('div');
  scoresDiv.className = 'ai-scores';
  scoresDiv.innerHTML =
    aiScoreBox('Content Match',        a.content_match) +
    aiScoreBox('Structure Match',      a.structure_match) +
    aiScoreBox('Metadata Match',       a.metadata_match) +
    aiScoreBox('Feature Completeness', a.feature_completeness);
  body.appendChild(scoresDiv);

  if (a.issues && a.issues.length) {
    var ih = document.createElement('p');
    ih.className   = 'sub-title';
    ih.textContent = 'Issues Found ('+a.issues.length+')';
    body.appendChild(ih);
    var iul = document.createElement('ul');
    iul.className = 'issues-list';
    a.issues.forEach(function(issue) {
      var li = document.createElement('li');
      li.className = 'issue-item '+(issue.severity||'info');
      li.innerHTML = '<span class="issue-sev">'+(issue.severity||'info')+'</span><span>'+(issue.description||'')+'</span>';
      iul.appendChild(li);
    });
    body.appendChild(iul);
  }

  if (a.whats_good && a.whats_good.length) {
    var gh = document.createElement('p');
    gh.className   = 'sub-title';
    gh.textContent = 'What Migrated Well';
    body.appendChild(gh);
    var gul = document.createElement('ul');
    gul.className = 'good-list';
    a.whats_good.forEach(function(item) {
      var li = document.createElement('li');
      li.innerHTML = '<span style="color:var(--green);font-weight:700;flex-shrink:0">+</span><span>'+item+'</span>';
      gul.appendChild(li);
    });
    body.appendChild(gul);
  }

  if (a.recommendations && a.recommendations.length) {
    var rh = document.createElement('p');
    rh.className   = 'sub-title';
    rh.textContent = 'Recommendations';
    body.appendChild(rh);
    var rul = document.createElement('ul');
    rul.className = 'rec-list';
    a.recommendations.forEach(function(item) {
      var li = document.createElement('li');
      li.innerHTML = '<span style="color:var(--purple);font-weight:700;flex-shrink:0">></span><span>'+item+'</span>';
      rul.appendChild(li);
    });
    body.appendChild(rul);
  }
}"""

# ── Write all three files ─────────────────────────────────────────────────────
with open("static/index.html", "w", encoding="utf-8") as f:
    f.write(html)
print("Written: static/index.html")

with open("static/css/styles.css", "w", encoding="utf-8") as f:
    f.write(css)
print("Written: static/css/styles.css")

with open("static/js/app.js", "w", encoding="utf-8") as f:
    f.write(js)
print("Written: static/js/app.js")

print("\nAll static files written successfully.")