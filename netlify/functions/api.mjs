// Sportlerparty-Tickets – Server (Netlify Function + Netlify Blobs)
// Alle Regeln (Anmeldung, Einlass nur einmal pro Ticket) werden hier durchgesetzt, nicht nur in der Oberfläche.
//
// Speicher (Netlify Blobs, strong consistency):
//   orders          → Liste aller Bestellungen inkl. Tickets
//   checkin/<code>  → Einlass eines Tickets (wird nur einmal angelegt → kein doppelter Einlass)
//   settings        → Texte fürs Ticket
//   logo            → PNG
//   secret          → automatisch erzeugter Schlüssel für Anmelde-Cookies
//   mail/<id>       → Mailversand je Bestellung ({ at, to } bzw. { error })
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { mailConfigured, mailSender, sendTicketMail, previewMail, mailError } from "../mail.mjs";

export const config = { path: "/api/*" };

const COOKIE = "sp_session";
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

const DEFAULT_SETTINGS = {
  party_name: "Sportlerparty",
  headline: "Sportlerparty.",
  subline: "Wintersemester 26/27.",
  date: "Freitag, 27. November 2026",
  time: "ab 21:00 Uhr",
  location: "Location folgt",
  price: "8,00 €",
  note: "Zeig dieses Ticket am Einlass auf dem Handy oder ausgedruckt vor. Jeder QR-Code ist nur einmal gültig – bitte nicht weitergeben. Ausweis nicht vergessen.",
  mail_subject: "Dein Ticket für die Sportlerparty.",
  mail_text: "Hallo {vorname},\n\nschön, dass du dabei bist! Im Anhang findest du {anzahl} für die Sportlerparty.\n\nSo kommst du rein:\n• QR-Code am Einlass auf dem Handy zeigen (oder das PDF im Anhang ausdrucken)\n• Jeder Code ist nur einmal gültig – bitte nicht weitergeben\n• Studierenden- oder Mitarbeitendenausweis mitbringen\n\nWir freuen uns auf dich!\nDein UNI:Sport-Team",
  mail_footer: "UNI:Sport Kassel · Hochschulsport der Universität Kassel\nDu bekommst diese Mail, weil du ein Ticket für die Sportlerparty gebucht hast.",
  reply_to: "",
};

// Vorschau-Deploys bekommen einen eigenen, leeren Speicher (wie bei der Kasse).
let storeFactory = (name) => getStore({ name, consistency: "strong" });
export function _setStoreFactory(f) { storeFactory = f; } // nur für lokale Tests
const isPreview = (ctx, host) => (ctx?.deploy?.context && ctx.deploy.context !== "production") || host.includes("--");
const store = (ctx, host) => storeFactory(isPreview(ctx, host) ? "sportlerparty-vorschau" : "sportlerparty");

const json = (d, s = 200, extra = {}) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
const fail = (m, s = 400) => json({ error: m }, s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Konfliktsicheres Schreiben ---------- */
async function mutateJSON(st, key, fallback, fn) {
  for (let i = 0; i < 10; i++) {
    const cur = await st.getWithMetadata(key, { type: "json" });
    const data = cur ? cur.data : structuredClone(fallback);
    const out = await fn(data);
    if (out && out.__abort) return out;
    const res = cur ? await st.setJSON(key, data, { onlyIfMatch: cur.etag }) : await st.setJSON(key, data, { onlyIfNew: true });
    if (res?.modified !== false) return out ?? data;
    await sleep(30 + Math.random() * 120);
  }
  throw new Error("CONFLICT");
}

/* ---------- Anmeldung (signiertes Cookie) ---------- */
async function getSecret(st) {
  if (process.env.TICKETS_SECRET && process.env.TICKETS_SECRET.length >= 16) return process.env.TICKETS_SECRET;
  let s = await st.get("secret", { type: "text" });
  if (!s) {
    await st.set("secret", crypto.randomBytes(32).toString("hex"), { onlyIfNew: true });
    s = await st.get("secret", { type: "text" });
  }
  return s;
}
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}
function verify(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const exp = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const readCookie = (req) => {
  const m = (req.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
};
const safeEq = (a, b) => crypto.timingSafeEqual(
  crypto.createHash("sha256").update(String(a)).digest(),
  crypto.createHash("sha256").update(String(b)).digest());

/* ---------- Ticket-Codes ---------- */
const ALPH = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function newCode() {
  const b = crypto.randomBytes(10);
  let s = "";
  for (const x of b) s += ALPH[x % ALPH.length];
  return `SP-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 10)}`;
}
function normalizeCode(c) {
  let s = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("SP")) s = s.slice(2);
  if (s.length !== 10) return String(c || "").trim().toUpperCase().slice(0, 40);
  return `SP-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 10)}`;
}
const norm = (v) => String(v ?? "").trim().slice(0, 200);
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const now = () => new Date().toISOString();

async function loadOrders(st) { return (await st.get("orders", { type: "json" })) || []; }
async function mailStatus(st) {
  const { blobs } = await st.list({ prefix: "mail/" });
  const out = new Map();
  await Promise.all(blobs.map(async (b) => out.set(Number(b.key.slice(5)), await st.get(b.key, { type: "json" }))));
  return out;
}
async function checkinKeys(st) {
  const { blobs } = await st.list({ prefix: "checkin/" });
  return new Set(blobs.map((b) => b.key.slice("checkin/".length)));
}
function findTicket(orders, code) {
  for (const o of orders) for (const t of o.tickets) if (t.code === code) return { o, t };
  return null;
}

/* ---------- Einstieg ---------- */
const fails = new Map();

export default async (req, context) => {
  try { return await handler(req, context); }
  catch (e) {
    if (e?.message === "CONFLICT") return fail("Gerade wurde gleichzeitig gespeichert. Bitte noch einmal versuchen.", 409);
    console.error(e);
    return fail("Unerwarteter Fehler auf dem Server. Bitte noch einmal versuchen.", 500);
  }
};

async function handler(req, context) {
  const ADMIN = process.env.TICKETS_ADMIN_PASSWORT || "";
  const PIN = process.env.TICKETS_SCAN_PIN || "";
  if (!ADMIN || !PIN) return fail("Server nicht eingerichtet: Umgebungsvariablen TICKETS_ADMIN_PASSWORT und TICKETS_SCAN_PIN fehlen.", 500);

  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = req.method;
  const st = store(context, url.hostname);
  const secret = await getSecret(st);
  const secure = url.protocol === "https:";

  let body = {};
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    if (route === "logo") body = null;
    else { try { body = await req.json(); } catch { body = {}; } }
    if (body !== null && (typeof body !== "object" || Array.isArray(body))) body = {};
  }

  /* --- Öffentlich: Anmelden --- */
  if (route === "login" && method === "POST") {
    const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "x";
    const f = fails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) return fail("Zu viele Versuche. Bitte kurz warten.", 429);
    const role = body.role === "admin" ? "admin" : "scan";
    const ok = role === "admin" ? safeEq(body.secret || "", ADMIN) : safeEq(body.secret || "", PIN);
    if (!ok) {
      f.n++; if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
      fails.set(ip, f);
      await sleep(400);
      return fail("Falsches Passwort bzw. falsche PIN.", 401);
    }
    fails.delete(ip);
    const hours = role === "admin" ? 12 : 24;
    const token = sign({ role, device: norm(body.device).slice(0, 40), exp: Date.now() + hours * 3600_000 }, secret);
    return json({ ok: true, role }, 200, {
      "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${hours * 3600}${secure ? "; Secure" : ""}`,
    });
  }
  if (route === "logout") {
    return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}` });
  }

  const me = verify(readCookie(req), secret);
  if (route === "me") return json(me ? { role: me.role, device: me.device } : { role: null });
  if (!me) return fail("Nicht angemeldet.", 401);
  const isAdmin = me.role === "admin";

  /* --- Einlass (Scanner + Verwaltung) --- */
  if (route === "scan" && method === "POST") {
    const code = normalizeCode(body.code);
    const device = me.device || (isAdmin ? "Verwaltung" : "Scanner");
    const hit = findTicket(await loadOrders(st), code);
    if (!hit) return json({ result: "unbekannt" });
    const info = { name: `${hit.o.vorname} ${hit.o.nachname}`.trim(), kategorie: hit.o.kategorie, ticket: `${hit.t.nr}/${hit.o.tickets.length}` };
    if (hit.t.status === "storniert") return json({ result: "storniert", ...info });
    const entry = { at: now(), by: device };
    const res = await st.setJSON(`checkin/${code}`, entry, { onlyIfNew: true });
    if (res?.modified === false) {
      const prev = await st.get(`checkin/${code}`, { type: "json" });
      return json({ result: "bereits_eingelassen", ...info, checked_in_at: prev?.at, checked_in_by: prev?.by });
    }
    return json({ result: "ok", ...info, checked_in_at: entry.at });
  }

  if (route === "stats" && method === "GET") {
    const orders = await loadOrders(st);
    const inside = await checkinKeys(st);
    let tickets = 0, drin = 0, storniert = 0, offen = 0;
    for (const o of orders) {
      if (!o.exported_at) offen++;
      for (const t of o.tickets) {
        if (t.status === "storniert") { storniert++; continue; }
        tickets++; if (inside.has(t.code)) drin++;
      }
    }
    const res = { tickets, drin, storniert, personen: orders.length, nicht_exportiert: offen,
      keine_mail: orders.filter((o) => !isEmail(o.email)).length, mail: mailConfigured() };
    if (isAdmin && res.mail) {
      const ms = await mailStatus(st);
      res.mail_absender = mailSender();
      res.gemailt = [...ms.values()].filter((m) => m?.at).length;
      res.mail_fehler = [...ms.values()].filter((m) => m?.error).length;
      res.mail_offen = orders.filter((o) => isEmail(o.email) && !ms.get(o.id)?.at && o.tickets.some((t) => t.status !== "storniert")).length;
    }
    return json(res);
  }

  if (route === "lookup" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (q.length < 2) return json([]);
    const orders = await loadOrders(st);
    const inside = await checkinKeys(st);
    const hits = orders.filter((o) => `${o.vorname} ${o.nachname} ${o.nachname} ${o.vorname}`.toLowerCase().includes(q)).slice(0, 15);
    return json(hits.map((o) => ({
      name: `${o.vorname} ${o.nachname}`, kategorie: o.kategorie,
      tickets: o.tickets.filter((t) => t.status !== "storniert").map((t) => ({ code: t.code, nr: t.nr, drin: inside.has(t.code) })),
    })));
  }

  if (route === "logo" && method === "GET") {
    const b = await st.get("logo", { type: "arrayBuffer" });
    if (!b) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    return new Response(b, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  }

  if (!isAdmin) return fail("Nur für die Verwaltung.", 403);

  /* --- Verwaltung --- */
  if (route === "settings" && method === "GET") {
    const s = { ...DEFAULT_SETTINGS, ...((await st.get("settings", { type: "json" })) || {}) };
    const logo = await st.getMetadata("logo");
    return json({ ...s, has_logo: !!logo });
  }
  if (route === "settings" && method === "PUT") {
    const s = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in body) s[k] = String(body[k] ?? "").slice(0, 600);
    await mutateJSON(st, "settings", {}, (d) => { Object.assign(d, s); });
    return json({ ok: true });
  }

  if (route === "logo" && method === "POST") {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > 2_000_000) return fail("Das Logo ist zu groß (max. 2 MB).");
    if (buf.subarray(1, 4).toString() !== "PNG") return fail("Bitte eine PNG-Datei hochladen.");
    await st.set("logo", buf);
    return json({ ok: true });
  }
  if (route === "logo" && method === "DELETE") { await st.delete("logo"); return json({ ok: true }); }

  if (route === "import" && method === "POST") {
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    const res = await mutateJSON(st, "orders", [], (orders) => {
      const out = { added: 0, tickets: 0, skipped: [], noEmail: 0 };
      const keys = new Set(orders.map((o) => o.key));
      const codes = new Set(orders.flatMap((o) => o.tickets.map((t) => t.code)));
      let nextId = orders.reduce((m, o) => Math.max(m, o.id), 0) + 1;
      for (const raw of rows) {
        const o = {
          anrede: norm(raw.anrede), vorname: norm(raw.vorname), nachname: norm(raw.nachname),
          email: norm(raw.email).toLowerCase(), kategorie: norm(raw.kategorie),
        };
        if (!o.vorname && !o.nachname) continue;
        const anzahl = Math.max(1, Math.min(20, parseInt(raw.anzahl, 10) || 1));
        o.key = [o.email, o.nachname.toLowerCase(), o.vorname.toLowerCase()].join("|");
        if (keys.has(o.key)) { out.skipped.push(`${o.vorname} ${o.nachname}`); continue; }
        keys.add(o.key);
        o.id = nextId++;
        o.created_at = now();
        o.exported_at = null;
        o.tickets = [];
        for (let i = 1; i <= anzahl; i++) {
          let c; do { c = newCode(); } while (codes.has(c));
          codes.add(c);
          o.tickets.push({ nr: i, code: c, status: "gueltig" });
        }
        if (!isEmail(o.email)) out.noEmail++;
        orders.push(o);
        out.added++; out.tickets += anzahl;
      }
      return out;
    });
    return json(res);
  }

  if (route === "orders" && method === "GET") {
    const orders = await loadOrders(st);
    const inside = await checkinKeys(st);
    const ms = await mailStatus(st);
    for (const o of orders) {
      for (const t of o.tickets) t.drin = inside.has(t.code);
      const m = ms.get(o.id);
      o.mailed_at = m?.at || null; o.mail_to = m?.to || null; o.mail_error = m?.error || null;
    }
    orders.sort((a, b) => (a.nachname + a.vorname).localeCompare(b.nachname + b.vorname, "de"));
    return json(orders);
  }

  if (route === "mark-exported" && method === "POST") {
    const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(Number));
    await mutateJSON(st, "orders", [], (orders) => {
      const t = now();
      for (const o of orders) if (ids.has(o.id) && !o.exported_at) o.exported_at = t;
    });
    return json({ ok: true });
  }

  let m;
  if ((m = route.match(/^orders\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === "PATCH") {
      const email = norm(body.email).toLowerCase();
      const r = await mutateJSON(st, "orders", [], (orders) => {
        const o = orders.find((x) => x.id === id);
        if (!o) return { __abort: true, missing: true };
        o.email = email;
      });
      return r?.missing ? fail("Nicht gefunden.", 404) : json({ ok: true });
    }
    if (method === "DELETE") {
      let removed = null;
      await mutateJSON(st, "orders", [], (orders) => {
        const i = orders.findIndex((x) => x.id === id);
        if (i >= 0) removed = orders.splice(i, 1)[0];
      });
      if (removed) await Promise.all([...removed.tickets.map((t) => st.delete(`checkin/${t.code}`)), st.delete(`mail/${removed.id}`)]);
      return json({ ok: true });
    }
  }

  if ((m = route.match(/^tickets\/([^/]+)\/(stornieren|reaktivieren|einlassen|zuruecksetzen)$/)) && method === "POST") {
    const code = normalizeCode(decodeURIComponent(m[1]));
    const action = m[2];
    if (action === "einlassen") {
      await st.setJSON(`checkin/${code}`, { at: now(), by: "manuell" }, { onlyIfNew: true });
    } else if (action === "zuruecksetzen") {
      await st.delete(`checkin/${code}`);
    } else {
      const r = await mutateJSON(st, "orders", [], (orders) => {
        const hit = findTicket(orders, code);
        if (!hit) return { __abort: true, missing: true };
        hit.t.status = action === "stornieren" ? "storniert" : "gueltig";
      });
      if (r?.missing) return fail("Ticket nicht gefunden.", 404);
    }
    return json({ ok: true });
  }

  if (route === "mail-preview" && method === "GET") {
    const settings = { ...DEFAULT_SETTINGS, ...((await st.get("settings", { type: "json" })) || {}) };
    const n = url.searchParams.get("n") === "2" ? 2 : 1;
    const tickets = n === 2 ? [{ code: "SP-TEST-TEST-01" }, { code: "SP-TEST-TEST-02" }] : [{ code: "SP-TEST-TEST-00" }];
    const m = await previewMail({ order: { vorname: "Lena", nachname: "Beispiel" }, tickets, settings, logo: await st.get("logo", { type: "arrayBuffer" }) });
    return json({ subject: m.subject, html: m.html, from: mailSender() || "(noch keine Absender-Adresse eingerichtet)", reply_to: settings.reply_to || "" });
  }

  /* --- Mailversand: der Browser erzeugt das PDF, der Server schickt es an die gespeicherte Adresse --- */
  if (route === "send-mail" && method === "POST") {
    if (!mailConfigured()) return fail("Mailversand ist nicht eingerichtet (TICKETS_MAIL_ADRESSE / TICKETS_MAIL_PASSWORT fehlen).");
    const pdf = Buffer.from(String(body.pdf || ""), "base64");
    if (pdf.length < 500 || pdf.length > 3_000_000 || pdf.subarray(0, 5).toString() !== "%PDF-") return fail("Ungültiges PDF.");
    const settings = { ...DEFAULT_SETTINGS, ...((await st.get("settings", { type: "json" })) || {}) };
    if (body.test) {
      const to = norm(body.to).toLowerCase();
      if (!isEmail(to)) return fail("Bitte eine gültige Adresse angeben.");
      try {
        await sendTicketMail({ to, order: { vorname: "Lena", nachname: "Beispiel" }, tickets: [{ code: "SP-TEST-TEST-00" }],
          settings, pdf, pdfName: "Ticket-Beispiel.pdf", logo: await st.get("logo", { type: "arrayBuffer" }) });
      } catch (e) { const er = mailError(e); return json({ error: er.text, auth: !!er.auth, limit: !!er.limit }, 502); }
      return json({ ok: true });
    }
    const id = Number(body.id);
    const o = (await loadOrders(st)).find((x) => x.id === id);
    if (!o) return fail("Person nicht gefunden.", 404);
    if (!isEmail(o.email)) return fail("Keine gültige E-Mail-Adresse hinterlegt.");
    const tickets = o.tickets.filter((t) => t.status !== "storniert");
    if (!tickets.length) return fail("Keine gültigen Tickets.");
    const prev = await st.get(`mail/${id}`, { type: "json" });
    if (prev?.at && !body.force) return json({ ok: true, skipped: true });
    try {
      await sendTicketMail({ to: o.email, order: o, tickets, settings, pdf, logo: await st.get("logo", { type: "arrayBuffer" }), pdfName: String(body.name || "Ticket.pdf").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) });
    } catch (e) {
      const er = mailError(e);
      await st.setJSON(`mail/${id}`, { error: er.text, tried: now() });
      return json({ error: er.text, auth: !!er.auth, limit: !!er.limit }, 502);
    }
    await st.setJSON(`mail/${id}`, { at: now(), to: o.email });
    return json({ ok: true });
  }

  if (route === "export.csv" && method === "GET") {
    const orders = await loadOrders(st);
    const { blobs } = await st.list({ prefix: "checkin/" });
    const times = new Map();
    await Promise.all(blobs.map(async (b) => {
      const v = await st.get(b.key, { type: "json" });
      times.set(b.key.slice(8), v);
    }));
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const fmt = (iso) => iso ? new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) : "";
    const lines = [["Nachname", "Vorname", "E-Mail", "Kategorie", "Ticket-Code", "Nr", "Status", "Eingelassen um", "Gerät"].join(";")];
    for (const o of orders) for (const t of o.tickets) {
      const c = times.get(t.code);
      lines.push([o.nachname, o.vorname, o.email, o.kategorie, t.code, t.nr, t.status, fmt(c?.at), c?.by].map(q).join(";"));
    }
    return new Response("﻿" + lines.join("\r\n"), { headers: {
      "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
      "content-disposition": 'attachment; filename="sportlerparty-tickets.csv"' } });
  }

  if (route === "wipe" && method === "POST") {
    if (body.confirm !== "LÖSCHEN") return fail("Bitte LÖSCHEN eintippen.");
    for (const prefix of ["checkin/", "mail/"]) {
      const { blobs } = await st.list({ prefix });
      await Promise.all(blobs.map((b) => st.delete(b.key)));
    }
    await st.delete("orders");
    return json({ ok: true });
  }

  return fail("Unbekannte Anfrage.", 404);
}
