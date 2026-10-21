const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (r.status === 401) { location.href = '/'; throw new Error('Nicht angemeldet'); }
  return r.json();
}

// ---------- Zähler ----------
async function refreshCount() {
  try { const s = await api('/api/stats'); $('count').textContent = `${s.drin} / ${s.tickets}`; } catch (_) {}
}
setInterval(refreshCount, 10000);

// ---------- Feedback (Ton + Vibration) ----------
let actx;
function beep(ok) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    o.frequency.value = ok ? 880 : 220; o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.15; o.start(); o.stop(actx.currentTime + (ok ? 0.15 : 0.45));
  } catch (_) {}
  if (navigator.vibrate) navigator.vibrate(ok ? 80 : [200, 80, 200]);
}

// ---------- Ergebnis anzeigen ----------
let busy = false, ovTimer = null;
const TEXT = {
  ok: ['✓', 'Gültig – rein damit!', 'ok'],
  bereits_eingelassen: ['✕', 'Schon eingelassen', 'bad'],
  storniert: ['✕', 'Ticket storniert', 'bad'],
  unbekannt: ['?', 'Unbekanntes Ticket', 'bad'],
  offline: ['!', 'Keine Verbindung', 'warn'],
};
function show(r, code) {
  const [icon, head, cls] = TEXT[r.result] || TEXT.unbekannt;
  $('ov').className = 'overlay ' + cls;
  $('ovIcon').textContent = icon;
  $('ovHead').textContent = head;
  $('ovName').textContent = r.name || code || '';
  const sub = [];
  if (r.kategorie) sub.push(r.kategorie);
  if (r.ticket) sub.push('Ticket ' + r.ticket);
  if (r.result === 'bereits_eingelassen' && r.checked_in_at) sub.push(`um ${new Date(r.checked_in_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr${r.checked_in_by ? ' (' + r.checked_in_by + ')' : ''}`);
  if (r.result === 'offline') sub.push('Bitte erneut versuchen oder Liste nutzen.');
  $('ovSub').textContent = sub.join(' · ');
  beep(r.result === 'ok');
  clearTimeout(ovTimer);
  ovTimer = setTimeout(hide, r.result === 'ok' ? 1800 : 4500);
}
function hide() { $('ov').className = 'overlay hidden'; busy = false; }
$('ov').onclick = hide;

async function check(code) {
  if (busy) return;
  busy = true;
  let r;
  try { r = await api('/api/scan', { code }); }
  catch (_) { r = { result: 'offline' }; }
  show(r, code);
  refreshCount();
}

// ---------- Kamera ----------
let qr = null, cams = [], camIdx = -1, lastCode = '', lastAt = 0;
function onScan(text) {
  const now = Date.now();
  if (text === lastCode && now - lastAt < 5000) return; // gleicher Code direkt nochmal → ignorieren
  lastCode = text; lastAt = now;
  check(text);
}
async function startCam() {
  if (!window.isSecureContext) { alert('Die Kamera funktioniert nur über https://.'); return; }
  try {
    qr = qr || new Html5Qrcode('reader', { verbose: false });
    const cfg = { fps: 12, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; } };
    const source = camIdx >= 0 && cams[camIdx] ? cams[camIdx].id : { facingMode: 'environment' };
    await qr.start(source, cfg, onScan, () => {});
    try { localStorage.setItem('sp_cam', '1'); } catch (_) {}
  } catch (e) {
    alert('Kamera konnte nicht gestartet werden: ' + (e.message || e));
  }
}
async function stopCam() {
  if (qr && qr.isScanning) await qr.stop();
  try { localStorage.removeItem('sp_cam'); } catch (_) {}
  location.reload();
}
$('startCam').onclick = startCam;
$('stopCam').onclick = stopCam;
$('switchCam').onclick = async () => {
  try {
    cams = cams.length ? cams : await Html5Qrcode.getCameras();
    if (cams.length < 2) { alert('Nur eine Kamera gefunden.'); return; }
    camIdx = (camIdx + 1) % cams.length;
    if (qr && qr.isScanning) await qr.stop();
    await startCam();
  } catch (e) { alert(e.message || e); }
};

// ---------- Manuell ----------
$('manual').onsubmit = e => {
  e.preventDefault();
  const c = $('code').value.trim(); if (!c) return;
  check(c); $('code').value = '';
};

// ---------- Namenssuche ----------
let sTimer;
$('search').oninput = () => {
  clearTimeout(sTimer);
  sTimer = setTimeout(async () => {
    const q = $('search').value.trim();
    if (q.length < 2) { $('hits').innerHTML = ''; return; }
    const list = await api('/api/lookup?q=' + encodeURIComponent(q));
    $('hits').innerHTML = list.length ? list.map(p => p.tickets.map(t => `
      <div class="hit"><div><b>${esc(p.name)}</b><br><span class="small muted">${esc(p.kategorie)} · Ticket ${t.nr}</span></div>
      ${t.drin ? '<span class="pill ok">schon drin</span>' : `<button class="btn sm" data-code="${esc(t.code)}">einlassen</button>`}</div>`).join('')).join('')
      : '<p class="muted small">Nichts gefunden.</p>';
  }, 250);
};
$('hits').onclick = async e => {
  const b = e.target.closest('button[data-code]'); if (!b) return;
  await check(b.dataset.code);
  $('search').dispatchEvent(new Event('input'));
};

$('logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/'; };

// Start
api('/api/me').then(m => {
  if (!m.role) { location.href = '/'; return; }
  $('dev').textContent = m.device ? '· ' + m.device : '';
  if (m.role !== 'admin') $('toAdmin').classList.add('hidden');
  refreshCount();
  let auto = false; try { auto = localStorage.getItem('sp_cam') === '1'; } catch (_) {}
  if (auto) startCam();
});
