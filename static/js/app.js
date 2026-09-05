/* =====================================================================
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

    /* Always keep scroll enabled so full page is accessible */
    el.style.overflowY = 'scroll';
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
}