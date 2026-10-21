// Lokaler Testserver (ohne Netlify): Speicher im Arbeitsspeicher, statische Dateien aus public/.
// Start: TICKETS_ADMIN_PASSWORT=test TICKETS_SCAN_PIN=1234 node scripts/dev-server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import api, { _setStoreFactory } from "../netlify/functions/api.mjs";

const stores = new Map();
function memStore(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  let v = 0;
  const etag = () => String(++v);
  const conflict = (key, o) => (o?.onlyIfNew && m.has(key)) || (o?.onlyIfMatch && m.get(key)?.etag !== o.onlyIfMatch);
  return {
    async get(key, o) { const e = m.get(key); if (!e) return null;
      if (o?.type === "json") return JSON.parse(e.data); if (o?.type === "arrayBuffer") return e.raw; return e.data; },
    async getWithMetadata(key, o) { const e = m.get(key); if (!e) return null; return { data: await this.get(key, o), etag: e.etag, metadata: {} }; },
    async getMetadata(key) { const e = m.get(key); return e ? { etag: e.etag, metadata: {} } : null; },
    async setJSON(key, val, o) { if (conflict(key, o)) return { modified: false }; const t = etag(); m.set(key, { data: JSON.stringify(val), etag: t }); return { modified: true, etag: t }; },
    async set(key, val, o) { if (conflict(key, o)) return { modified: false }; const t = etag();
      m.set(key, typeof val === "string" ? { data: val, etag: t } : { raw: val, data: null, etag: t }); return { modified: true, etag: t }; },
    async delete(key) { m.delete(key); },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), directories: [] }; },
  };
}
_setStoreFactory(memStore);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".png": "image/png" };
const PUB = path.resolve("public");
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body }),
      { deploy: { context: "production" }, ip: req.socket.remoteAddress });
    const headers = {}; r.headers.forEach((v, k) => headers[k] = v);
    res.writeHead(r.status, headers); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : url.pathname === "/scan" ? "/scan.html" : url.pathname;
  const f = path.join(PUB, path.normalize(p));
  if (!f.startsWith(PUB) || !fs.existsSync(f)) { res.writeHead(404); res.end("404"); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 8888, () => console.log(`Test: http://localhost:${process.env.PORT || 8888}`));
