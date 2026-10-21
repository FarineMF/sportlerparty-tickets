const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { location.href = '/'; throw new Error('Nicht angemeldet'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Fehler');
  return d;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ---------- Tabs ----------
let currentTab = 'uebersicht';
function showTab(name) {
  currentTab = name;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('main > section').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + name));
  if (name === 'uebersicht' || name === 'versand') loadStats();
  if (name === 'teilnehmer') loadOrders();
  if (name === 'einstellungen') loadSettings();
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/'; };

// ---------- Übersicht ----------
async function loadStats() {
  const s = await api('/api/stats');
  const tiles = [
    ['Tickets gültig', s.tickets, true], ['Eingelassen', s.drin, true],
    ['Personen', s.personen], ['Noch nicht heruntergeladen', s.nicht_exportiert],
    ['Ohne E-Mail', s.keine_mail], ['Storniert', s.storniert],
  ];
  $('stats').innerHTML = tiles.map(([l, n, hl]) => `<div class="stat ${hl ? 'hl' : ''}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  const pct = s.tickets ? Math.round(s.drin / s.tickets * 100) : 0;
  $('einlassText').textContent = `${s.drin} von ${s.tickets} Gästen sind drin (${pct} %).`;
  $('einlassBar').style.width = pct + '%';
  $('exportInfo').textContent = s.nicht_exportiert
    ? `${s.nicht_exportiert} Person(en) haben noch kein Ticket heruntergeladen bekommen.`
    : 'Alle Tickets wurden schon heruntergeladen.';
  $('zipNew').disabled = !s.nicht_exportiert;
  $('zipAll').disabled = !s.personen;
}

// ---------- Tickets als ZIP ----------
let settingsCache = null;
async function getSettings() { settingsCache = settingsCache || await api('/api/settings'); return settingsCache; }
async function exportZip(onlyNew) {
  const btns = [$('zipNew'), $('zipAll')];
  btns.forEach(b => b.disabled = true);
  $('zipProg').classList.remove('hidden'); $('zipBar').style.width = '0';
  try {
    const all = await api('/api/orders');
    const list = all.filter(o => (!onlyNew || !o.exported_at) && o.tickets.some(t => t.status !== 'storniert'));
    if (!list.length) { toast('Keine Tickets zum Herunterladen.'); return; }
    const blob = await SPTicket.buildZip(list, await getSettings(), (n, total) => {
      $('zipBar').style.width = Math.round(n / total * 100) + '%';
      $('exportInfo').textContent = `Erstelle Tickets … ${n} von ${total}`;
    });
    const stamp = new Date().toLocaleString('sv-SE').slice(0, 16).replace(/[-: ]/g, '');
    SPTicket.download(blob, `sportlerparty-tickets-${onlyNew ? 'neu-' : ''}${stamp}.zip`);
    await api('/api/mark-exported', { method: 'POST', body: { ids: list.map(o => o.id) } });
    toast(`${list.length} Person(en) als ZIP heruntergeladen.`);
  } catch (e) { toast('Fehler beim Erstellen: ' + e.message); }
  finally { $('zipProg').classList.add('hidden'); loadStats(); }
}
$('zipNew').onclick = () => exportZip(true);
$('zipAll').onclick = () => exportZip(false);

// ---------- Import ----------
const FIELDS = [
  ['vorname', 'Vorname', /^vor ?name|first/i],
  ['nachname', 'Nachname', /^nach ?name|^familienname|last|surname/i],
  ['name', 'Name (kombiniert, z. B. "Becker, Lena")', /^(teilnehmer|name|teilnehmer ?name)$/i],
  ['anrede', 'Anrede', /anrede|geschlecht|salut/i],
  ['email', 'E-Mail', /mail/i],
  ['kategorie', 'Status / Kategorie', /status|kategorie|gruppe|tarif/i],
  ['anzahl', 'Anzahl Tickets', /anzahl|menge|tickets|qty/i],
  ['zahlung', 'Zahlung', /zahlung|bezahlt|payment/i],
];
let grid = [], headers = [], headerRow = 0;

function loadGrid(rows) {
  grid = rows.filter(r => r.some(c => String(c).trim() !== ''));
  if (!grid.length) { toast('Keine Daten gefunden.'); return; }
  headerRow = grid.findIndex(r => r.some(c => /name|mail/i.test(String(c))));
  if (headerRow < 0) headerRow = 0;
  headers = grid[headerRow].map((h, i) => String(h).trim() || `Spalte ${i + 1}`);
  $('mapInfo').textContent = `${grid.length - headerRow - 1} Zeilen gefunden. Kopfzeile: Zeile ${headerRow + 1}.`;
  $('mapGrid').innerHTML = FIELDS.map(([key, label, re]) => {
    let guess = headers.findIndex(h => re.test(h));
    if (key === 'name' && (headers.some(h => FIELDS[0][2].test(h)) || headers.some(h => FIELDS[1][2].test(h)))) guess = -1;
    if (key === 'kategorie' && guess >= 0 && /zahlung/i.test(headers[guess])) guess = -1;
    const opts = ['<option value="-1">– nicht vorhanden –</option>', ...headers.map((h, i) =>
      `<option value="${i}" ${i === guess ? 'selected' : ''}>${esc(h)}</option>`)].join('');
    return `<div><label for="m_${key}">${label}</label><select id="m_${key}">${opts}</select></div>`;
  }).join('');
  FIELDS.forEach(([key]) => $('m_' + key).onchange = () => { if (key === 'zahlung') buildPayFilter(); renderPreview(); });
  buildPayFilter();
  $('mapCard').classList.remove('hidden');
  $('importResult').innerHTML = '';
  renderPreview();
  $('mapCard').scrollIntoView({ behavior: 'smooth' });
}
function col(key) { return parseInt($('m_' + key).value, 10); }
function buildPayFilter() {
  const c = col('zahlung');
  if (c < 0) { $('payFilter').classList.add('hidden'); return; }
  const vals = [...new Set(grid.slice(headerRow + 1).map(r => String(r[c] ?? '').trim()))];
  $('payValues').innerHTML = vals.map((v, i) =>
    `<label style="flex:0 0 auto;color:var(--ink);font-size:14px"><input type="checkbox" class="payv" value="${esc(v)}" checked> ${esc(v || '(leer)')}</label>`).join('');
  document.querySelectorAll('.payv').forEach(cb => cb.onchange = renderPreview);
  $('payFilter').classList.remove('hidden');
}
function splitName(full) {
  let s = String(full || '').trim(), anrede = '';
  const m = s.match(/^(Frau|Herr|Divers|Mx\.?)\s+/i);
  if (m) { anrede = m[1]; s = s.slice(m[0].length); }
  if (s.includes(',')) { const [n, v] = s.split(','); return { nachname: n.trim(), vorname: (v || '').trim(), anrede }; }
  const parts = s.split(/\s+/);
  return { vorname: parts.slice(0, -1).join(' '), nachname: parts.slice(-1)[0] || '', anrede };
}
function buildRows() {
  const get = (r, k) => { const c = col(k); return c >= 0 ? String(r[c] ?? '').trim() : ''; };
  const allowed = new Set([...document.querySelectorAll('.payv:checked')].map(cb => cb.value));
  const payCol = col('zahlung');
  return grid.slice(headerRow + 1).map(r => {
    if (payCol >= 0 && !allowed.has(String(r[payCol] ?? '').trim())) return null;
    let o = { vorname: get(r, 'vorname'), nachname: get(r, 'nachname'), anrede: get(r, 'anrede'),
      email: get(r, 'email'), kategorie: get(r, 'kategorie'), anzahl: get(r, 'anzahl') || 1 };
    if (!o.vorname && !o.nachname && col('name') >= 0) {
      const s = splitName(get(r, 'name'));
      o = { ...o, vorname: s.vorname, nachname: s.nachname, anrede: o.anrede || s.anrede };
    }
    return (o.vorname || o.nachname) ? o : null;
  }).filter(Boolean);
}
function renderPreview() {
  const rows = buildRows();
  const noMail = rows.filter(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)).length;
  const tickets = rows.reduce((a, r) => a + (parseInt(r.anzahl, 10) || 1), 0);
  $('previewInfo').className = 'notice' + (noMail ? ' bad' : '');
  $('previewInfo').innerHTML = `<b>${rows.length}</b> Personen, <b>${tickets}</b> Tickets.` +
    (noMail ? ` <b>${noMail}</b> ohne gültige E-Mail – diese bekommen trotzdem Tickets, die Adresse kannst du später nachtragen.` : '');
  $('previewTable').innerHTML = '<tr><th>Anrede</th><th>Vorname</th><th>Nachname</th><th>E-Mail</th><th>Kategorie</th><th>Anzahl</th></tr>' +
    rows.slice(0, 15).map(r => `<tr><td>${esc(r.anrede)}</td><td>${esc(r.vorname)}</td><td>${esc(r.nachname)}</td>
      <td>${r.email ? esc(r.email) : '<span class="pill bad">fehlt</span>'}</td><td>${esc(r.kategorie)}</td><td>${esc(r.anzahl)}</td></tr>`).join('') +
    (rows.length > 15 ? `<tr><td colspan="6" class="muted">… und ${rows.length - 15} weitere</td></tr>` : '');
  $('doImport').disabled = !rows.length;
}
$('file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', codepage: 65001 });
  loadGrid(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }));
};
$('readPaste').onclick = () => {
  const t = $('paste').value.trim(); if (!t) return;
  const sep = t.includes('\t') ? '\t' : (t.split('\n')[0].includes(';') ? ';' : ',');
  loadGrid(t.split(/\r?\n/).map(l => l.split(sep).map(c => c.replace(/^"|"$/g, ''))));
};
$('doImport').onclick = async () => {
  const rows = buildRows();
  if (!confirm(`${rows.length} Personen importieren und Tickets erzeugen?`)) return;
  try {
    const r = await api('/api/import', { method: 'POST', body: { rows } });
    $('importResult').innerHTML = `<div class="card"><h3>Import fertig.</h3>
      <p><b>${r.added}</b> neue Personen, <b>${r.tickets}</b> Tickets erzeugt.${r.noEmail ? ` ${r.noEmail} ohne E-Mail.` : ''}</p>
      ${r.skipped.length ? `<p class="muted small">${r.skipped.length} schon vorhanden und übersprungen: ${esc(r.skipped.slice(0, 20).join(', '))}${r.skipped.length > 20 ? ' …' : ''}</p>` : ''}
      <div class="actions"><button class="btn" id="goTickets">Weiter zu den Tickets</button></div></div>`;
    $('goTickets').onclick = () => showTab('versand');
    $('mapCard').classList.add('hidden');
    $('file').value = ''; $('paste').value = '';
  } catch (e) { toast(e.message); }
};

// ---------- Teilnehmende ----------
let qTimer, ordersCache = [];
$('q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(renderOrders, 150); };
async function loadOrders() { ordersCache = await api('/api/orders'); renderOrders(); }
function renderOrders() {
  const q = $('q').value.trim().toLowerCase();
  const list = !q ? ordersCache : ordersCache.filter(o =>
    `${o.vorname} ${o.nachname} ${o.nachname} ${o.vorname} ${o.email} ${o.tickets.map(t => t.code).join(' ')}`.toLowerCase().includes(q));
  if (!list.length) { $('ordersTable').innerHTML = `<tr><td class="muted" style="padding:18px">${ordersCache.length ? 'Nichts gefunden.' : 'Noch keine Teilnehmenden.'}</td></tr>`; return; }
  $('ordersTable').innerHTML = '<tr><th>Name</th><th>E-Mail</th><th>Tickets</th><th>Ticket</th><th></th></tr>' + list.map(o => `
    <tr>
      <td><b>${esc(o.nachname)}, ${esc(o.vorname)}</b><br><span class="muted small">${esc(o.kategorie)}</span></td>
      <td class="small">${o.email ? esc(o.email) : '<span class="pill warn">fehlt</span>'}<br><button class="btn ghost sm" data-act="email" data-id="${o.id}" data-email="${esc(o.email)}">ändern</button></td>
      <td>${o.tickets.map(t => `<div style="margin-bottom:4px"><span class="code">${esc(t.code)}</span>
        ${t.status === 'storniert' ? '<span class="pill bad">storniert</span>' : t.drin ? '<span class="pill ok">drin</span>' : ''}
        <select class="tact" data-code="${esc(t.code)}" style="width:auto;padding:2px 4px;font-size:12px">
          <option value="">Aktion …</option>
          ${t.status === 'storniert' ? '<option value="reaktivieren">reaktivieren</option>' : '<option value="stornieren">stornieren</option>'}
          ${t.drin ? '<option value="zuruecksetzen">Einlass zurücksetzen</option>' : '<option value="einlassen">manuell einlassen</option>'}
        </select></div>`).join('')}</td>
      <td>${o.exported_at ? `<span class="pill ok" title="${esc(new Date(o.exported_at).toLocaleString('de-DE'))}">heruntergeladen</span>` : '<span class="pill">neu</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn ghost sm" data-act="pdf" data-id="${o.id}">PDF</button>
        <button class="btn ghost sm" data-act="del" data-id="${o.id}" title="Löschen">✕</button>
      </td>
    </tr>`).join('');
}
$('ordersTable').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = Number(b.dataset.id);
  try {
    if (b.dataset.act === 'email') {
      const v = prompt('E-Mail-Adresse:', b.dataset.email || '');
      if (v === null) return;
      await api(`/api/orders/${id}`, { method: 'PATCH', body: { email: v } });
    } else if (b.dataset.act === 'pdf') {
      const o = ordersCache.find(x => x.id === id);
      b.disabled = true;
      const bytes = await SPTicket.orderPdf(o, await getSettings());
      SPTicket.download(new Blob([bytes], { type: 'application/pdf' }), SPTicket.fileBase(o) + '.pdf');
      b.disabled = false;
      return;
    } else if (b.dataset.act === 'del') {
      if (!confirm('Diese Person inkl. aller Tickets löschen?')) return;
      await api(`/api/orders/${id}`, { method: 'DELETE' });
    }
  } catch (err) { toast(err.message); }
  loadOrders();
});
$('ordersTable').addEventListener('change', async e => {
  const s = e.target.closest('select.tact'); if (!s || !s.value) return;
  try { await api(`/api/tickets/${encodeURIComponent(s.dataset.code)}/${s.value}`, { method: 'POST' }); }
  catch (err) { toast(err.message); }
  loadOrders();
});

// ---------- Einstellungen ----------
const SKEYS = ['headline', 'subline', 'date', 'time', 'location', 'price', 'note', 'party_name'];
async function loadSettings() {
  const s = await api('/api/settings');
  SKEYS.forEach(k => { $('s_' + k).value = s[k] || ''; });
  $('logoState').textContent = s.has_logo ? 'Logo ist hinterlegt.' : 'Noch kein Logo – auf dem Ticket steht vorerst "UNI:Sport Kassel" als Text.';
}
async function saveSettings() {
  const body = {}; SKEYS.forEach(k => body[k] = $('s_' + k).value);
  await api('/api/settings', { method: 'PUT', body });
  settingsCache = null;
}
$('saveSettings').onclick = async () => { try { await saveSettings(); toast('Gespeichert.'); } catch (e) { toast(e.message); } };
$('previewPdf').onclick = async () => {
  try {
    await saveSettings();
    const bytes = await SPTicket.orderPdf({ vorname: 'Lena', nachname: 'Beispiel', kategorie: 'S-UNIK',
      tickets: [{ nr: 1, code: 'SP-TEST-TEST-00', status: 'gueltig' }] }, await getSettings());
    window.open(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), '_blank');
  } catch (e) { toast(e.message); }
};
$('logoFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const r = await fetch('/api/logo', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: f });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { toast(d.error || 'Fehler'); return; }
  await SPTicket.loadAssets(true);
  toast('Logo gespeichert.'); loadSettings();
};
$('logoDel').onclick = async () => { await api('/api/logo', { method: 'DELETE' }); await SPTicket.loadAssets(true); loadSettings(); };
$('wipe').onclick = async () => {
  const v = prompt('Wirklich ALLE Teilnehmerdaten löschen? Zum Bestätigen LÖSCHEN eintippen.');
  if (v !== 'LÖSCHEN') return;
  try { await api('/api/wipe', { method: 'POST', body: { confirm: v } }); toast('Alle Teilnehmerdaten gelöscht.'); }
  catch (e) { toast(e.message); }
};

// Start
api('/api/me').then(m => { if (m.role !== 'admin') location.href = '/'; else loadStats(); });
