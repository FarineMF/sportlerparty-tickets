// Ticket-PDFs und ZIP-Export – läuft im Browser (wird mit esbuild zu public/vendor/tickets.bundle.js gebündelt).
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import JSZip from 'jszip';

const MM = 72 / 25.4;
const W = 105 * MM;
const H = 215 * MM;
const PAD = 22;


// Brand-Kit UNI:Sport, Farbwelt Winter
const C = {
  surface: '#9FBBD8',   // Fläche
  infobox: '#E1F2FF',   // Infobox
  onSurface: '#22324A', // Schrift auf Fläche
  accent: '#CC178D',    // Schrift auf Weiß
  magenta: '#C80A85',
  spray: '#EC40A6',     // Pink hell – nur als Spray-Rand
  white: '#FFFFFF',
};

function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function wrap(text, font, size, maxW) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
      else { if (line) out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

function fitSize(text, font, maxSize, minSize, maxW) {
  let s = maxSize;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxW) s -= 0.5;
  return s;
}

function drawQr(page, text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: hex(C.white) });
  const dark = hex('#111111');
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) {
        page.drawRectangle({
          x: x + (c + quiet) * cell,
          y: y + size - (r + quiet + 1) * cell,
          width: cell + 0.15,
          height: cell + 0.15,
          color: dark,
        });
      }
    }
  }
}

// Spray-Rand (Brand-Kit: Pink hell #EC40A6 nur als Spray-Rand) – feine, nach außen ausdünnende Punkte
function drawSpray(page, edgeY, seed) {
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
  const gauss = () => { let u = 0; for (let k = 0; k < 4; k++) u += rnd(); return (u - 2) / 0.58; };
  const pink = hex(C.spray);
  for (let k = 0; k < 2400; k++) {
    const px = rnd() * W;
    const d = gauss() * 4.5;                 // Abstand zur Kante
    const fall = Math.max(0, 1 - Math.abs(d) / 16);
    if (rnd() > fall) continue;
    const r = 0.15 + rnd() * rnd() * 1.0 * fall;
    page.drawCircle({ x: px, y: edgeY + d, size: r, color: pink, opacity: 0.35 + 0.6 * fall });
  }
}

async function buildTicketsPdf(order, tickets, s, assets) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bold = await doc.embedFont(assets.bold, { subset: false });
  const reg = await doc.embedFont(assets.regular, { subset: false });
  let logo = null;
  if (assets.logo) {
    try { logo = await doc.embedPng(assets.logo); } catch (_) { logo = null; }
  }
  doc.setTitle(`${s.party_name || 'Party'} – Ticket ${order.vorname} ${order.nachname}`);
  doc.setAuthor('UNI:Sport Kassel');

  const name = [order.vorname, order.nachname].filter(Boolean).join(' ');
  const inner = W - PAD * 2;
  const ink = hex(C.onSurface);

  tickets.forEach((t, i) => {
    const page = doc.addPage([W, H]);

    // ---- Kopf: Fläche Winter-Blau
    const surfaceH = 232;
    const edgeY = H - surfaceH;
    page.drawRectangle({ x: 0, y: edgeY, width: W, height: surfaceH, color: hex(C.surface) });

    // Kopfzeile
    const topY = H - PAD - 9;
    page.drawText(s.kicker || 'UNI:Sport Kassel', { x: PAD, y: topY, size: 8.5, font: bold, color: ink });
    const counter = tickets.length > 1 ? `Ticket ${i + 1} von ${tickets.length}` : 'Ticket';
    page.drawText(counter, { x: W - PAD - reg.widthOfTextAtSize(counter, 8.5), y: topY, size: 8.5, font: reg, color: ink });

    // Headline + Subline
    const hl = s.headline || 'Sportlerparty.';
    const hlSize = fitSize(hl, bold, 42, 22, inner);
    page.drawText(hl, { x: PAD, y: H - 104, size: hlSize, font: bold, color: ink });
    page.drawText(s.subline || '', { x: PAD, y: H - 126, size: 12.5, font: reg, color: ink });

    // Name
    page.drawText('Ticket für', { x: PAD, y: edgeY + 52, size: 8.5, font: reg, color: ink });
    const nSize = fitSize(name || 'Gast', bold, 18, 10, inner - 60);
    page.drawText(name || 'Gast', { x: PAD, y: edgeY + 31, size: nSize, font: bold, color: ink });
    if (order.kategorie) {
      const k = String(order.kategorie);
      page.drawText(k, { x: W - PAD - reg.widthOfTextAtSize(k, 8.5), y: edgeY + 52, size: 8.5, font: reg, color: ink });
    }

    // Spray-Rand + Ticket-Kerben
    let seed = 0; for (const ch of t.code) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    drawSpray(page, edgeY, seed);
    page.drawCircle({ x: 0, y: edgeY, size: 9, color: hex(C.white) });
    page.drawCircle({ x: W, y: edgeY, size: 9, color: hex(C.white) });

    // ---- Infobox
    const rows = [['Datum', s.date], ['Einlass', s.time], ['Ort', s.location], ['Preis', s.price]].filter(r => r[1]);
    const labelW = 50;
    const valW = inner - 24 - labelW;
    const rowLines = rows.map(r => wrap(r[1], bold, 10.5, valW));
    const boxH = 16 + rowLines.reduce((a, l) => a + l.length * 13 + 7, 0) + 4;
    const boxTop = edgeY - 18;
    page.drawRectangle({ x: PAD, y: boxTop - boxH, width: inner, height: boxH, color: hex(C.infobox) });
    let ry = boxTop - 22;
    rows.forEach((r, idx) => {
      page.drawText(r[0], { x: PAD + 12, y: ry + 1, size: 8.5, font: reg, color: ink });
      rowLines[idx].forEach((ln, li) => {
        page.drawText(ln, { x: PAD + 12 + labelW, y: ry - li * 13, size: 10.5, font: bold, color: ink });
      });
      ry -= rowLines[idx].length * 13 + 7;
    });

    // ---- Fußbereich (von unten aufgebaut): Unterstützt durch + Logo · Claim · Hinweis
    const footBase = 18;
    const logoMaxH = 24, logoMaxW = 120;
    page.drawText('Unterstützt durch', { x: PAD, y: footBase + logoMaxH + 7, size: 7, font: reg, color: ink });
    if (logo) {
      const sc = Math.min(logoMaxH / logo.height, logoMaxW / logo.width);
      page.drawImage(logo, { x: PAD, y: footBase, width: logo.width * sc, height: logo.height * sc });
    } else {
      page.drawText('UNI:Sport Kassel', { x: PAD, y: footBase + 6, size: 11, font: bold, color: ink });
    }
    const claim = 'Sport, Bewegung & Gesundheit.';
    page.drawText(claim, { x: W - PAD - bold.widthOfTextAtSize(claim, 7.5), y: footBase + 2, size: 7.5, font: bold, color: hex(C.accent) });
    const lineY = footBase + logoMaxH + 20;
    page.drawLine({ start: { x: PAD, y: lineY }, end: { x: W - PAD, y: lineY }, thickness: 0.6, color: hex(C.magenta), opacity: 0.6 });
    const noteLines = wrap(s.note, reg, 7.2, inner).slice(0, 3);
    const noteTop = lineY + 10 + (noteLines.length - 1) * 9.5;
    noteLines.forEach((ln, li) => page.drawText(ln, { x: PAD, y: noteTop - li * 9.5, size: 7.2, font: reg, color: ink }));

    // ---- QR-Code (füllt den Platz zwischen Infobox und Hinweis)
    const qrTop = boxTop - boxH - 14;
    const space = qrTop - (noteTop + 12) - 24;
    const qrSize = Math.max(96, Math.min(150, space));
    const qrX = (W - qrSize) / 2;
    drawQr(page, t.code, qrX, qrTop - qrSize, qrSize);
    page.drawText(t.code, { x: (W - reg.widthOfTextAtSize(t.code, 9)) / 2, y: qrTop - qrSize - 11, size: 9, font: reg, color: ink });
  });

  return doc.save();
}

// ---------- Schriften & Logo laden (Univers, falls vorhanden, sonst Inter) ----------
let assetCache = null;
async function fetchFirst(urls) {
  for (const u of urls) {
    try { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch (_) {}
  }
  throw new Error('Schrift konnte nicht geladen werden.');
}
async function loadAssets(force) {
  if (assetCache && !force) return assetCache;
  const [bold, regular] = await Promise.all([
    fetchFirst(['/fonts/UniversLTPro-65Bold.ttf', '/fonts/Inter-Bold.ttf']),
    fetchFirst(['/fonts/UniversLTPro-55Roman.ttf', '/fonts/Inter-Regular.ttf']),
  ]);
  let logo = null;
  try {
    const r = await fetch('/api/logo', { cache: 'no-store' });
    if (r.status === 200) logo = new Uint8Array(await r.arrayBuffer());
  } catch (_) {}
  assetCache = { bold, regular, logo };
  return assetCache;
}

const TR = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };
function fileBase(o) {
  return `${o.nachname || ''}_${o.vorname || ''}`.replace(/[äöüÄÖÜß]/g, c => TR[c])
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-') || 'Ticket';
}

async function orderPdf(order, settings) {
  const assets = await loadAssets();
  const tickets = order.tickets.filter(t => t.status !== 'storniert');
  return buildTicketsPdf(order, tickets.length ? tickets : order.tickets, settings, assets);
}

// Baut eine ZIP mit einem PDF pro Person + uebersicht.csv
async function buildZip(orders, settings, onProgress) {
  const assets = await loadAssets();
  const zip = new JSZip();
  const used = new Set();
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Nachname', 'Vorname', 'E-Mail', 'Kategorie', 'Anzahl Tickets', 'Datei', 'Ticket-Codes'].join(';')];
  let n = 0;
  for (const o of orders) {
    const tickets = o.tickets.filter(t => t.status !== 'storniert');
    if (!tickets.length) continue;
    const base = fileBase(o);
    let file = `${base}.pdf`, k = 2;
    while (used.has(file)) file = `${base}_${k++}.pdf`;
    used.add(file);
    zip.file(`tickets/${file}`, await buildTicketsPdf(o, tickets, settings, assets));
    lines.push([o.nachname, o.vorname, o.email, o.kategorie, tickets.length, file, tickets.map(t => t.code).join(' ')].map(q).join(';'));
    n++;
    if (onProgress) onProgress(n, orders.length);
  }
  zip.file('uebersicht.csv', '\uFEFF' + lines.join('\r\n'));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export { buildTicketsPdf, orderPdf, buildZip, loadAssets, download, fileBase };
