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

export async function sendTicketMail({ to, order, tickets, settings: s, pdf, pdfName }) {
  const text = fill(s.mail_text, order, tickets.length);
  const qrs = await Promise.all(tickets.map((t) => QRCode.toBuffer(t.code, { errorCorrectionLevel: "M", margin: 2, width: 360 })));
  const qrHtml = tickets.map((t, i) => `
    <td style="padding:8px;text-align:center;">
      <img src="cid:qr${i}" width="170" height="170" alt="QR-Code ${esc(t.code)}" style="display:block;margin:0 auto;">
      <div style="font:12px Arial,sans-serif;color:#22324A;margin-top:4px;">${esc(t.code)}</div>
    </td>`).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#ffffff;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 12px;">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
    <tr><td style="background:#9FBBD8;padding:28px 24px;">
      <div style="font:bold 13px Arial,sans-serif;color:#22324A;">UNI:Sport Kassel</div>
      <div style="font:bold 32px Arial,sans-serif;color:#22324A;margin-top:18px;">${esc(s.headline)}</div>
      <div style="font:15px Arial,sans-serif;color:#22324A;margin-top:4px;">${esc(s.subline)}</div>
    </td></tr>
    <tr><td style="padding:24px;font:15px/1.5 Arial,sans-serif;color:#22324A;">${esc(text).replace(/\n/g, "<br>")}</td></tr>
    <tr><td style="padding:0 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#E1F2FF;"><tr><td style="padding:14px 16px;font:14px/1.7 Arial,sans-serif;color:#22324A;">
        ${s.date ? `<b>${esc(s.date)}</b><br>` : ""}${s.time ? `Einlass ${esc(s.time)}<br>` : ""}${esc(s.location || "")}
      </td></tr></table>
    </td></tr>
    <tr><td align="center" style="padding:16px 16px 4px;"><table cellpadding="0" cellspacing="0"><tr>${qrHtml}</tr></table></td></tr>
    <tr><td style="padding:8px 24px 24px;font:12px/1.5 Arial,sans-serif;color:#22324A;">${esc(s.note)}</td></tr>
    <tr><td style="padding:0 24px 24px;font:bold 13px Arial,sans-serif;color:#CC178D;">Sport, Bewegung &amp; Gesundheit.</td></tr>
  </table>
</td></tr></table></body></html>`;

  await getTransport().sendMail({
    from: { name: process.env.TICKETS_MAIL_NAME || "UNI:Sport Kassel", address: mailSender() },
    to,
    subject: fill(s.mail_subject, order, tickets.length),
    text: `${text}\n\nDeine Ticket-Codes: ${tickets.map((t) => t.code).join(", ")}`,
    html,
    attachments: [
      { filename: pdfName, content: pdf, contentType: "application/pdf" },
      ...qrs.map((b, i) => ({ filename: `qr${i}.png`, content: b, cid: `qr${i}` })),
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
