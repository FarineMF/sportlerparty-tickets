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

  tickets.forEach((t, i) => {
    const page = doc.addPage([W, H]);
    let y = H;

    // ---- Kopf: Fläche Winter-Blau
    const surfaceH = 255;
    page.drawRectangle({ x: 0, y: H - surfaceH, width: W, height: surfaceH, color: hex(C.surface) });

    // Logo bzw. Absender
    y = H - PAD;
    if (logo) {
      const maxH = 26, maxW = 120;
      const sc = Math.min(maxH / logo.height, maxW / logo.width);
      page.drawImage(logo, { x: PAD, y: y - logo.height * sc, width: logo.width * sc, height: logo.height * sc });
    } else {
      page.drawText('UNI:Sport Kassel', { x: PAD, y: y - 10, size: 10, font: bold, color: hex(C.onSurface) });
    }
    const counter = `Ticket ${i + 1} von ${tickets.length}`;
    page.drawText(counter, {
      x: W - PAD - reg.widthOfTextAtSize(counter, 8.5), y: y - 9, size: 8.5, font: reg, color: hex(C.onSurface),
    });

    // Headline + Subline
    const hl = s.headline || 'Sportlerparty.';
    const hlSize = fitSize(hl, bold, 40, 22, inner);
    y = H - 118;
    page.drawText(hl, { x: PAD, y, size: hlSize, font: bold, color: hex(C.onSurface) });
    y -= 22;
    page.drawText(s.subline || '', { x: PAD, y, size: 12.5, font: reg, color: hex(C.onSurface) });

    // Name auf der Fläche
    y = H - surfaceH + 46;
    page.drawText('Ticket für', { x: PAD, y, size: 8.5, font: reg, color: hex(C.onSurface) });
    y -= 20;
    const nSize = fitSize(name || 'Gast', bold, 17, 10, inner);
    page.drawText(name || 'Gast', { x: PAD, y, size: nSize, font: bold, color: hex(C.onSurface) });
    if (order.kategorie) {
      const k = String(order.kategorie);
      page.drawText(k, { x: W - PAD - reg.widthOfTextAtSize(k, 8.5), y: y + 22, size: 8.5, font: reg, color: hex(C.onSurface) });
    }

    // Ticket-Kerben an der Kante
    const edgeY = H - surfaceH;
    page.drawCircle({ x: 0, y: edgeY, size: 9, color: hex(C.white) });
    page.drawCircle({ x: W, y: edgeY, size: 9, color: hex(C.white) });

    // ---- Infobox
    const rows = [
      ['Datum', s.date],
      ['Einlass', s.time],
      ['Ort', s.location],
      ['Preis', s.price],
    ].filter(r => r[1]);
    const labelW = 50;
    const valW = inner - 24 - labelW;
    const rowLines = rows.map(r => wrap(r[1], bold, 10.5, valW));
    const boxH = 16 + rowLines.reduce((a, l) => a + l.length * 13 + 7, 0) + 6;
    const boxTop = edgeY - 16;
    page.drawRectangle({ x: PAD, y: boxTop - boxH, width: inner, height: boxH, color: hex(C.infobox) });
    let ry = boxTop - 22;
    rows.forEach((r, idx) => {
      page.drawText(r[0], { x: PAD + 12, y: ry + 1, size: 8.5, font: reg, color: hex(C.onSurface) });
      rowLines[idx].forEach((ln, li) => {
        page.drawText(ln, { x: PAD + 12 + labelW, y: ry - li * 13, size: 10.5, font: bold, color: hex(C.onSurface) });
      });
      ry -= rowLines[idx].length * 13 + 7;
    });

    // ---- QR-Code
    const qrTop = boxTop - boxH - 14;
    const qrSize = Math.max(100, Math.min(142, qrTop - 84));
    drawQr(page, t.code, (W - qrSize) / 2, qrTop - qrSize, qrSize);
    const codeLabel = t.code;
    page.drawText(codeLabel, {
      x: (W - reg.widthOfTextAtSize(codeLabel, 9)) / 2, y: qrTop - qrSize - 10, size: 9, font: reg, color: hex(C.onSurface),
    });

    // ---- Hinweis + Claim
    let fy = 50;
    const noteLines = wrap(s.note, reg, 7.5, inner).slice(0, 3);
    noteLines.forEach((ln, li) => {
      page.drawText(ln, { x: PAD, y: fy - li * 10, size: 7.5, font: reg, color: hex(C.onSurface) });
    });
    page.drawText('Sport, Bewegung & Gesundheit.', { x: PAD, y: 14, size: 8, font: bold, color: hex(C.accent) });
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
