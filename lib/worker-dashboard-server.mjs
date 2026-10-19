import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPublicStatus } from './worker-dashboard-public-status.mjs';
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };

export function createDashboardServer({ controller, publicStatus = createPublicStatus({ readSnapshot: async () => { throw new Error('Not configured'); } }), assetDirectory = new URL('../dashboard/', import.meta.url) }) {
  const token = randomBytes(32).toString('hex');
  const status = () => ({ ...controller.status(), publicStatus: publicStatus.status(), csrf: token });
  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port;
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    if (!allowed.has(req.headers.host) || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return json(403, { error: 'Akses hanya dari halaman lokal.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return json(403, { error: 'Origin ditolak.' });
    try {
      if (req.method === 'GET' && req.url === '/api/status') return json(200, status());
      if (req.method === 'POST' && ['/api/start', '/api/stop', '/api/refresh'].includes(req.url)) {
        const received = req.headers['x-reset-token'];
        if (origin !== `http://${req.headers.host}` || typeof received !== 'string' || Buffer.byteLength(received) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(received), Buffer.from(token)) || req.headers['content-type'] !== 'application/json') return json(403, { error: 'Konfirmasi sesi lokal diperlukan.' });
        const parts = []; let size = 0;
        for await (const part of req) { size += part.length; if (size > 1024) { json(413, { error: 'Payload terlalu besar.' }); req.destroy(); return; } parts.push(part); }
        let payload; try { payload = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return json(400, { error: 'JSON tidak valid.' }); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(400, { error: 'Payload ditolak.' });
        if (req.url === '/api/stop' && Object.keys(payload).length) return json(400, { error: 'Payload stop harus kosong.' });
        if (req.url === '/api/refresh') {
          if (Object.keys(payload).length) return json(400, { error: 'Payload refresh harus kosong.' });
          await publicStatus.refresh();
          return json(200, status());
        }
        try { req.url === '/api/start' ? controller.start(payload) : controller.stop(); return json(200, status()); }
        catch { return json(409, { error: 'Aksi ditolak. Periksa konfirmasi, alamat, atau status worker/jurnal.' }); }
      }
      if (req.method === 'GET' && Object.hasOwn(assets, req.url)) {
        const [file, mime] = assets[req.url];
        const data = await readFile(new URL(file, assetDirectory));
        res.writeHead(200, { 'Content-Type': mime }); return res.end(data);
      }
      json(404, { error: 'Tidak ditemukan.' });
    } catch { if (!res.headersSent) json(500, { error: 'Permintaan gagal; periksa terminal lokal.' }); else res.end(); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxHeadersCount = 30;
  return server;
}
