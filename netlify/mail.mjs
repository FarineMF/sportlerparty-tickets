// Mailversand über Gmail (oder ein anderes SMTP-Postfach).
// Umgebungsvariablen:
//   TICKETS_MAIL_ADRESSE   – z. B. sportlerparty.unisport@gmail.com
//   TICKETS_MAIL_PASSWORT  – Gmail-App-Passwort (16 Zeichen, NICHT das normale Gmail-Passwort)
//   TICKETS_MAIL_NAME      – optional, Absendername (Standard: UNI:Sport Kassel)
//   TICKETS_MAIL_SERVER    – optional, Standard smtp.gmail.com
//   TICKETS_MAIL_PORT      – optional, Standard 465
import nodemailer from "nodemailer";
import QRCode from "qrcode";

export const mailConfigured = () => !!(process.env.TICKETS_MAIL_ADRESSE && process.env.TICKETS_MAIL_PASSWORT);
export const mailSender = () => process.env.TICKETS_MAIL_ADRESSE || "";

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.TICKETS_MAIL_SERVER || "smtp.gmail.com",
      port: Number(process.env.TICKETS_MAIL_PORT || 465),
      secure: Number(process.env.TICKETS_MAIL_PORT || 465) === 465,
      auth: { user: process.env.TICKETS_MAIL_ADRESSE, pass: String(process.env.TICKETS_MAIL_PASSWORT).replace(/\s+/g, "") },
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transport;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fill(tpl, order, n) {
  return String(tpl || "")
    .replace(/\{vorname\}/g, order.vorname || "")
    .replace(/\{nachname\}/g, order.nachname || "")
    .replace(/\{anzahl\}/g, n === 1 ? "dein Ticket" : `deine ${n} Tickets`);
}

// Fließtext → HTML: Zeilen mit "•" oder "-" am Anfang werden zu einer Liste
function textToHtml(text) {
  const out = [];
  let list = [], afterList = false;
  const flush = () => { if (list.length) { afterList = true; out.push(`<ul style="margin:6px 0 12px;padding-left:20px;">${list.map((l) => `<li style="margin:2px 0;">${esc(l)}</li>`).join("")}</ul>`); list = []; } };
  for (const line of String(text).split("\n")) {
    const m = line.match(/^\s*[•\-–]\s+(.*)$/);
    if (m) { list.push(m[1]); continue; }
    flush();
    if (!line.trim() && afterList) { afterList = false; continue; }
    afterList = false;
    out.push(line.trim() ? `${esc(line)}<br>` : "<br>");
  }
  flush();
  return out.join("\n");
}

/**
 * Baut Betreff, Text und HTML der Ticket-Mail.
 * img: { qr: (i) => src, logo: src|null } – beim Versand cid:-Verweise, in der Vorschau data:-URLs
 */
export function buildMail({ order, tickets, settings: s, img }) {
  const subject = fill(s.mail_subject, order, tickets.length);
  const text = fill(s.mail_text, order, tickets.length);
  const qrHtml = tickets.map((t, i) => `
          <td style="padding:6px 10px;text-align:center;vertical-align:top;">
            <img src="${img.qr(i)}" width="168" height="168" alt="QR-Code ${esc(t.code)}" style="display:block;margin:0 auto;border:0;">
            <div style="font:12px Arial,Helvetica,sans-serif;color:#22324A;margin-top:4px;">${tickets.length > 1 ? `Ticket ${i + 1} · ` : ""}${esc(t.code)}</div>
          </td>`).join("");
  const rows = [["Datum", s.date], ["Einlass", s.time], ["Ort", s.location]].filter((r) => r[1])
    .map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;font:13px Arial,Helvetica,sans-serif;color:#22324A;white-space:nowrap;vertical-align:top;">${k}</td>
      <td style="padding:3px 0;font:bold 14px Arial,Helvetica,sans-serif;color:#22324A;">${esc(v)}</td></tr>`).join("");
  const logo = img.logo
    ? `<img src="${img.logo}" alt="UNI:Sport Kassel" height="34" style="display:block;height:34px;width:auto;border:0;">`
    : `<div style="font:bold 16px Arial,Helvetica,sans-serif;color:#22324A;">UNI:Sport Kassel</div>`;
  const spray = `<div style="height:6px;line-height:6px;font-size:0;background:#9FBBD8;border-bottom:3px dotted #EC40A6;"></div>`;

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(s.headline)} – dein Ticket mit QR-Code ist im Anhang.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:20px 12px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
    <tr><td style="background:#9FBBD8;padding:26px 26px 22px;">
      <div style="font:bold 13px Arial,Helvetica,sans-serif;color:#22324A;">UNI:Sport Kassel</div>
      <div style="font:bold 34px/1.1 Arial,Helvetica,sans-serif;color:#22324A;margin-top:20px;">${esc(s.headline)}</div>
      <div style="font:16px Arial,Helvetica,sans-serif;color:#22324A;margin-top:6px;">${esc(s.subline)}</div>
    </td></tr>
    <tr><td>${spray}</td></tr>
    <tr><td style="padding:24px 26px 8px;font:15px/1.55 Arial,Helvetica,sans-serif;color:#22324A;">${textToHtml(text)}</td></tr>
    <tr><td style="padding:4px 26px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E1F2FF;"><tr><td style="padding:14px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr></table>
    </td></tr>
    <tr><td align="center" style="padding:20px 16px 6px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${qrHtml}</tr></table></td></tr>
    <tr><td style="padding:6px 26px 18px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#22324A;text-align:center;">${tickets.length > 1 ? "Die Tickets hängen" : "Das Ticket hängt"} zusätzlich als PDF an dieser Mail.</td></tr>
    <tr><td style="padding:0 26px;"><div style="border-top:1px solid #C80A85;height:0;line-height:0;font-size:0;">&nbsp;</div></td></tr>
    <tr><td style="padding:16px 26px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:bottom;">
          <div style="font:12px Arial,Helvetica,sans-serif;color:#22324A;margin-bottom:6px;">Unterstützt durch</div>
          ${logo}
        </td>
        <td style="vertical-align:bottom;text-align:right;font:bold 13px Arial,Helvetica,sans-serif;color:#CC178D;">Sport, Bewegung &amp; Gesundheit.</td>
      </tr></table>
    </td></tr>
    ${s.mail_footer ? `<tr><td style="padding:10px 26px 24px;font:11px/1.5 Arial,Helvetica,sans-serif;color:#5B6B80;">${esc(s.mail_footer).replace(/\n/g, "<br>")}</td></tr>` : ""}
  </table>
</td></tr></table></body></html>`;

  const plain = `${text}\n\n${[s.date, s.time && `Einlass ${s.time}`, s.location].filter(Boolean).join(" · ")}\n` +
    `Deine Ticket-Codes: ${tickets.map((t) => t.code).join(", ")}\n\nUnterstützt durch UNI:Sport Kassel – Sport, Bewegung & Gesundheit.` +
    (s.mail_footer ? `\n\n${s.mail_footer}` : "");
  return { subject, html, text: plain };
}

const qrPng = (code) => QRCode.toBuffer(code, { errorCorrectionLevel: "M", margin: 2, width: 360 });

// HTML-Vorschau mit eingebetteten Bildern (für die Verwaltung)
export async function previewMail({ order, tickets, settings, logo }) {
  const qrs = await Promise.all(tickets.map((t) => qrPng(t.code)));
  const m = buildMail({ order, tickets, settings, img: {
    qr: (i) => `data:image/png;base64,${qrs[i].toString("base64")}`,
    logo: logo ? `data:image/png;base64,${Buffer.from(logo).toString("base64")}` : null,
  } });
  return m;
}

export async function sendTicketMail({ to, order, tickets, settings, pdf, pdfName, logo }) {
  const qrs = await Promise.all(tickets.map((t) => qrPng(t.code)));
  const m = buildMail({ order, tickets, settings, img: { qr: (i) => `cid:qr${i}`, logo: logo ? "cid:logo" : null } });
  const replyTo = String(settings.reply_to || "").trim();
  await getTransport().sendMail({
    from: { name: process.env.TICKETS_MAIL_NAME || "UNI:Sport Kassel", address: mailSender() },
    ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo) ? { replyTo } : {}),
    to,
    subject: m.subject,
    text: m.text,
    html: m.html,
    attachments: [
      { filename: pdfName, content: pdf, contentType: "application/pdf" },
      ...qrs.map((b, i) => ({ filename: `qr${i}.png`, content: b, cid: `qr${i}` })),
      ...(logo ? [{ filename: "unisport.png", content: Buffer.from(logo), cid: "logo" }] : []),
    ],
  });
}

// Verständliche Fehlermeldungen
export function mailError(e) {
  const m = String(e?.message || e);
  if (/Invalid login|Username and Password not accepted|535/i.test(m))
    return { auth: true, text: "Gmail hat die Anmeldung abgelehnt. Adresse und App-Passwort prüfen (nicht das normale Gmail-Passwort)." };
  if (/limit|quota|550 5\.4\.5|421|454/i.test(m))
    return { limit: true, text: "Gmail-Tageslimit erreicht oder Versand gedrosselt. Morgen weiter senden." };
  if (/timeout|ECONN|ETIMEDOUT/i.test(m)) return { text: "Mailserver nicht erreichbar (Zeitüberschreitung). Bitte erneut versuchen." };
  return { text: m.slice(0, 200) };
}
