// popup.js
const CALC_URL = 'https://klu-attendance.in';
const W = {L:100, P:50, T:25, S:25};

const $ = id => document.getElementById(id);

function calcPct(s) {
  let wa=0, wt=0;
  if(s.hasL && s.L[1]>0){ wa+=s.L[0]*W.L; wt+=s.L[1]*W.L; }
  if(s.hasP && s.P[1]>0){ wa+=s.P[0]*W.P; wt+=s.P[1]*W.P; }
  if(s.hasT && s.T[1]>0){ wa+=s.T[0]*W.T; wt+=s.T[1]*W.T; }
  if(s.hasS && s.S[1]>0){ wa+=s.S[0]*W.S; wt+=s.S[1]*W.S; }
  return wt===0 ? null : Math.round(wa/wt*10000)/100;
}

function pctCls(v) {
  if(v===null) return '';
  if(v>=75) return 'pct-safe';
  if(v>=65) return 'pct-warn';
  return 'pct-dng';
}

function setStatus(dotCls, title, desc) {
  $('statusDot').className = 'status-dot ' + dotCls;
  $('statusTitle').textContent = title;
  $('statusDesc').textContent  = desc;
}

function showError(msg) {
  $('errorBox').textContent    = msg;
  $('errorBox').style.display  = 'block';
}

function hideError() {
  $('errorBox').style.display = 'none';
}

function renderPreview(subjects) {
  const el = $('preview');
  if(!subjects || subjects.length===0){ el.classList.remove('show'); return; }
  el.innerHTML = subjects.map(s => {
    const p   = calcPct(s);
    const cls = pctCls(p);
    // Shorten name if too long
    const name = s.name.length > 28 ? s.name.substring(0,26)+'…' : s.name;
    return `<div class="prev-row">
      <span class="prev-name">${name}</span>
      <span class="prev-pct ${cls}">${p!==null?p+'%':'—'}</span>
    </div>`;
  }).join('');
  el.classList.add('show');
}

// ── Scraper — runs inside the ERP tab ────────────────────────────────────────
function scrapeAttendancePage() {
  const subjectMap = {};

  // Find attendance table — the one with "Total Conducted" column
  let targetTable = null;
  document.querySelectorAll('table').forEach(table => {
    const txt = (table.innerText||'').toLowerCase();
    if(txt.includes('total conducted') || txt.includes('coursedesc') || txt.includes('coursecode')) {
      targetTable = table;
    }
  });

  if(!targetTable) return [];

  // Get column indices from <th> headers
  const ths = targetTable.querySelectorAll('th');
  const headers = Array.from(ths).map(h => h.innerText.trim().toLowerCase());

  function findCol(keywords) {
    for(let i=0;i<headers.length;i++){
      if(keywords.some(k => headers[i].includes(k))) return i;
    }
    return -1;
  }

  const col = {
    desc:      findCol(['coursedesc','subject name','description','course name']),
    ltps:      findCol(['ltps','type','l/t/p/s','ltp']),
    conducted: findCol(['total conducted','conducted']),
    attended:  findCol(['total attended','attended']),
  };

  // Parse rows
  targetTable.querySelectorAll('tr').forEach(row => {
    const cells = row.querySelectorAll('td');
    if(cells.length < 4) return;

    const get = i => (i>=0 && cells[i]) ? cells[i].innerText.trim() : '';

    const name      = get(col.desc);
    const ltps      = get(col.ltps).toUpperCase().replace(/\s/g,'');
    const conducted = parseInt(get(col.conducted)) || 0;
    const attended  = parseInt(get(col.attended))  || 0;

    if(!name || !ltps || conducted===0) return;
    if(!['L','T','P','S'].includes(ltps)) return;

    if(!subjectMap[name]){
      subjectMap[name]={
        name,
        L:[0,0],T:[0,0],P:[0,0],S:[0,0],
        hasL:false,hasT:false,hasP:false,hasS:false,
      };
    }
    subjectMap[name][ltps]       = [attended, conducted];
    subjectMap[name]['has'+ltps] = true;
  });

  return Object.values(subjectMap);
}

// Injected into calculator tab to post the message
function injectToCalculator(subjects) {
  window.postMessage({ type: 'KL_ATTENDANCE_DATA', subjects }, '*');
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
let scrapedSubjects = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if(!tab) return;

  const url = tab.url || '';

  if(!url.includes('newerp.kluniversity.in')) {
    setStatus('dot-idle', 'Not on ERP page', 'Open newerp.kluniversity.in and go to Attendance Register.');
    $('syncBtn').disabled = true;
    $('syncLabel').textContent = 'Open ERP first';
    $('hintText').innerHTML = `
      <div class="steps">
        <div class="step-row"><div class="step-num">1</div><div class="step-txt">Go to newerp.kluniversity.in</div></div>
        <div class="step-row"><div class="step-num">2</div><div class="step-txt">Log in and click <strong style="color:#e2e6f3">Attendance Register</strong></div></div>
        <div class="step-row"><div class="step-num">3</div><div class="step-txt">Press <strong style="color:#e2e6f3">Search</strong> to load your attendance</div></div>
        <div class="step-row"><div class="step-num">4</div><div class="step-txt">Come back here and click <strong style="color:#5b52ff">Send to Calculator</strong></div></div>
      </div>`;
    return;
  }

  // On ERP — try to scrape
  setStatus('dot-warn', 'Reading attendance…', 'Scanning your attendance table…');
  $('syncBtn').disabled = true;
  $('syncLabel').textContent = 'Reading…';
  $('spinner').style.display = 'block';

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeAttendancePage,
    });

    $('spinner').style.display = 'none';
    const subjects = results[0]?.result;

    if(!subjects || subjects.length===0) {
      setStatus('dot-warn', 'No data found', 'Make sure you pressed Search on the attendance page.');
      $('syncLabel').textContent = 'No data found';
      $('syncBtn').disabled = true;
      $('hintText').textContent = 'Select Academic Year & Semester → press Search → try again.';
      return;
    }

    scrapedSubjects = subjects;
    setStatus('dot-ok', subjects.length+' subjects found ✓', 'Ready to send to your calculator.');
    $('syncBtn').disabled = false;
    $('syncLabel').textContent = 'Send to Calculator ⚡';
    $('hintText').textContent = 'Click the button to auto-fill all subjects instantly.';
    renderPreview(subjects);

  } catch(err) {
    $('spinner').style.display = 'none';
    setStatus('dot-idle', 'Could not read page', 'Make sure you are on the attendance page and pressed Search.');
    showError('Error: ' + err.message);
    $('syncLabel').textContent = 'Retry';
    $('syncBtn').disabled = false;
    $('syncBtn').onclick = init;
  }
}

async function sendToCalculator() {
  if(!scrapedSubjects || scrapedSubjects.length===0) return;
  hideError();
  $('spinner').style.display = 'block';
  $('syncLabel').textContent = 'Opening…';
  $('syncBtn').disabled = true;

  try {
    // Find existing calculator tab or open new one
    const tabs = await chrome.tabs.query({ url: CALC_URL+'*' });
    let calcTab;

    if(tabs.length>0) {
      calcTab = tabs[0];
      await chrome.tabs.update(calcTab.id, { active: true });
      // Small delay to ensure tab is focused
      await new Promise(r => setTimeout(r, 300));
    } else {
      calcTab = await chrome.tabs.create({ url: CALC_URL });
      // Wait for page to fully load
      await new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if(tabId===calcTab.id && info.status==='complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, 800); // extra wait for JS to init
          }
        });
      });
    }

    // Inject data into calculator tab
    await chrome.scripting.executeScript({
      target: { tabId: calcTab.id },
      func: injectToCalculator,
      args: [scrapedSubjects],
    });

    await chrome.tabs.update(calcTab.id, { active: true });

    $('spinner').style.display = 'none';
    $('syncLabel').textContent = '✓ Synced!';
    setStatus('dot-ok', 'Synced successfully! 🎉', scrapedSubjects.length+' subjects sent to calculator.');

    setTimeout(() => {
      $('syncLabel').textContent = 'Send to Calculator ⚡';
      $('syncBtn').disabled = false;
    }, 2500);

  } catch(err) {
    $('spinner').style.display = 'none';
    showError('Failed to open calculator: ' + err.message);
    $('syncLabel').textContent = 'Send to Calculator ⚡';
    $('syncBtn').disabled = false;
  }
}

// ── Events ────────────────────────────────────────────────────────────────────
$('syncBtn').addEventListener('click', sendToCalculator);
$('openCalcBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: CALC_URL });
});

init();
