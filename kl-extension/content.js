// content.js — runs on newerp.kluniversity.in
// Injects a floating "Send to Calculator" button on the attendance page

(function () {
  const CALC_URL = 'https://klu-attendance.in';

  // Only inject on attendance page
  const isAttendancePage =
    window.location.href.includes('studentattendance') ||
    document.title.toLowerCase().includes('attendance') ||
    !!document.querySelector('table');

  if (!isAttendancePage) return;
  if (document.getElementById('klu-calc-btn')) return;

  // ── Floating button ───────────────────────────────────────────────────────
  const btn = document.createElement('div');
  btn.id = 'klu-calc-btn';
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0">
      <rect x="1" y="1" width="14" height="14" rx="3" stroke="white" stroke-width="1.4"/>
      <path d="M4 5h4M4 8h6M4 11h4" stroke="white" stroke-width="1.3" stroke-linecap="round"/>
      <circle cx="12" cy="4.5" r="1.2" fill="white"/>
    </svg>
    <span>Send to Calculator</span>
  `;

  btn.style.cssText = `
    position: fixed;
    bottom: 28px;
    right: 28px;
    z-index: 999999;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #5b52ff;
    color: #fff;
    border: none;
    border-radius: 100px;
    padding: 12px 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(91,82,255,0.5);
    transition: transform 0.2s, background 0.2s, box-shadow 0.2s;
    user-select: none;
    letter-spacing: 0.02em;
  `;

  btn.addEventListener('mouseenter', () => {
    btn.style.background    = '#7068ff';
    btn.style.transform     = 'translateY(-2px)';
    btn.style.boxShadow     = '0 6px 28px rgba(91,82,255,0.6)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background    = '#5b52ff';
    btn.style.transform     = 'translateY(0)';
    btn.style.boxShadow     = '0 4px 20px rgba(91,82,255,0.5)';
  });

  btn.addEventListener('click', () => {
    const subjects = scrapeAttendance();
    if (!subjects || subjects.length === 0) {
      showToast('No attendance data found. Make sure you pressed Search first.', 'error');
      return;
    }
    // Open calculator and pass data
    const calcTab = window.open(CALC_URL, '_blank');
    // Wait for calculator to load then send data
    const payload = { type: 'KL_ATTENDANCE_DATA', subjects };
    const tryPost = setInterval(() => {
      try {
        calcTab.postMessage(payload, CALC_URL);
      } catch(e) {}
    }, 500);
    // Stop trying after 8 seconds
    setTimeout(() => clearInterval(tryPost), 8000);

    // Also store in sessionStorage as fallback
    sessionStorage.setItem('klu_attendance_data', JSON.stringify(payload));
    showToast(`✓ ${subjects.length} subjects sent to calculator!`, 'success');
  });

  document.body.appendChild(btn);

  // ── SCRAPER ───────────────────────────────────────────────────────────────
  function scrapeAttendance() {
    const subjectMap = {};

    // Find the attendance table — look for table with "Total Conducted" header
    let targetTable = null;
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
      const text = table.innerText || '';
      if (
        text.includes('Total Conducted') ||
        text.includes('Coursedesc') ||
        text.includes('Coursecode')
      ) {
        targetTable = table;
      }
    });

    if (!targetTable) {
      // Fallback: try finding any table with attendance data
      tables.forEach(table => {
        const headers = table.querySelectorAll('th');
        const headerTexts = Array.from(headers).map(h => h.innerText.trim().toLowerCase());
        if (headerTexts.some(h => h.includes('attended') || h.includes('conducted'))) {
          targetTable = table;
        }
      });
    }

    if (!targetTable) return [];

    // Get column indices from headers
    const headers = targetTable.querySelectorAll('th');
    const headerTexts = Array.from(headers).map(h => h.innerText.trim().toLowerCase());

    const colIdx = {
      coursedesc:     findCol(headerTexts, ['coursedesc', 'subject', 'course desc', 'description']),
      ltps:           findCol(headerTexts, ['ltps', 'type', 'l/t/p/s', 'comp']),
      conducted:      findCol(headerTexts, ['total conducted', 'conducted', 'total classes']),
      attended:       findCol(headerTexts, ['total attended', 'attended', 'classes attended']),
    };

    // Parse each data row
    const rows = targetTable.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) return;

      const getName  = (i) => i >= 0 && cells[i] ? cells[i].innerText.trim() : '';

      const subjectName = getName(colIdx.coursedesc);
      const ltps        = getName(colIdx.ltps).toUpperCase().trim();
      const conductedStr= getName(colIdx.conducted);
      const attendedStr = getName(colIdx.attended);

      if (!subjectName || !ltps) return;

      const conducted = parseInt(conductedStr) || 0;
      const attended  = parseInt(attendedStr)  || 0;

      // Only valid component types
      if (!['L','T','P','S'].includes(ltps)) return;
      if (conducted === 0) return;

      // Group by subject name
      if (!subjectMap[subjectName]) {
        subjectMap[subjectName] = {
          name: subjectName,
          L: [0,0], T: [0,0], P: [0,0], S: [0,0],
          hasL: false, hasT: false, hasP: false, hasS: false,
        };
      }

      const s = subjectMap[subjectName];
      s[ltps]       = [attended, conducted];
      s['has'+ltps] = true;
    });

    return Object.values(subjectMap);
  }

  function findCol(headers, keywords) {
    for (let i = 0; i < headers.length; i++) {
      if (keywords.some(k => headers[i].includes(k))) return i;
    }
    return -1;
  }

  // ── Toast notification ────────────────────────────────────────────────────
  function showToast(msg, type) {
    const existing = document.getElementById('klu-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'klu-toast';
    toast.textContent = msg;
    toast.style.cssText = `
      position: fixed;
      bottom: 90px;
      right: 28px;
      z-index: 999999;
      background: ${type === 'success' ? '#0e111a' : '#1a0a0a'};
      border: 1px solid ${type === 'success' ? '#5b52ff' : '#ff4560'};
      color: ${type === 'success' ? '#e2e6f3' : '#ff4560'};
      border-radius: 100px;
      padding: 9px 18px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      transition: opacity 0.3s ease;
      max-width: 320px;
    `;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
  }
})();
