// IRC TV PLAYER - serveur sans dépendance externe (Node >= 18).
// Rôles : 1) servir le client, 2) proxy /api/fetch (listes, API Xtream),
// 3) proxy /api/stream (flux vidéo, contourne CORS et contenu mixte).
const http = require('http'), https = require('https'), dns = require('dns');
const fs = require('fs'), path = require('path'), net = require('net');

const PORT = process.env.PORT || 3000;
const TIMEOUT = 20000, MAX_TEXT = 60 * 1024 * 1024, RATE = 600; // req/min/IP
const CLIENT = __dirname;
const PUBLIC = new Set(['/index.html', '/parser.js']); // seuls fichiers servis

// ---- Protection SSRF : refuse les adresses privées/internes ----
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}
// Le DNS est vérifié au moment de la connexion (anti DNS-rebinding).
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: false, family: opts && opts.family }, (err, addr, fam) => {
    if (err) return cb(err);
    if (isPrivate(addr)) return cb(new Error('PRIVATE_ADDRESS'));
    cb(null, addr, fam);
  });
}
function parseTarget(raw) {
  let u; try { u = new URL(raw); } catch { throw new Error('URL invalide'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Seuls http et https sont acceptés');
  if (net.isIP(u.hostname.replace(/[\[\]]/g, '')) && isPrivate(u.hostname.replace(/[\[\]]/g, ''))) throw new Error('Adresse interne refusée');
  return u;
}

// Requête sortante avec redirections (max 5), chaque saut revalidé.
function upstream(raw, headers, cb, hops = 0) {
  let u; try { u = parseTarget(raw); } catch (e) { return cb(e); }
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request(u, {
    method: 'GET', lookup: safeLookup, timeout: TIMEOUT,
    headers: Object.assign({ 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', Accept: '*/*' }, headers),
    rejectUnauthorized: false // beaucoup de serveurs IPTV ont des certificats auto-signés
  }, res => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      if (hops >= 5) return cb(new Error('Trop de redirections'));
      return upstream(new URL(res.headers.location, u).href, headers, cb, hops + 1);
    }
    cb(null, res, u.href);
  });
  req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
  req.on('error', e => cb(e));
  req.end();
}
function errInfo(e) {
  const m = e.message || '';
  if (m === 'PRIVATE_ADDRESS') return [403, 'Adresse interne refusée'];
  if (m === 'TIMEOUT') return [504, 'Le serveur ne répond pas (délai dépassé)'];
  if (e.code === 'ENOTFOUND') return [502, 'Serveur introuvable : vérifie l\'adresse'];
  if (e.code === 'ECONNREFUSED') return [502, 'Connexion refusée par le serveur'];
  return [502, m || 'Erreur réseau'];
}

// ---- Limite de requêtes par IP ----
const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();
function limited(req) {
  const ip = req.socket.remoteAddress; const n = (hits.get(ip) || 0) + 1; hits.set(ip, n); return n > RATE;
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

// POST /api/fetch {url} -> texte (les identifiants restent dans le corps, jamais dans les logs)
function handleFetch(req, res) {
  let body = ''; req.on('data', d => { body += d; if (body.length > 5000) req.destroy(); });
  req.on('end', () => {
    let url; try { url = JSON.parse(body).url; } catch { return send(res, 400, { error: 'Requête invalide' }); }
    upstream(url, {}, (err, up) => {
      if (err) { const [c, m] = errInfo(err); return send(res, c, { error: m }); }
      if (up.statusCode >= 400) { up.resume(); return send(res, 502, { error: 'Le serveur a répondu ' + up.statusCode, status: up.statusCode }); }
      const chunks = []; let size = 0;
      up.on('data', d => { size += d.length; if (size > MAX_TEXT) { up.destroy(); send(res, 413, { error: 'Réponse trop volumineuse' }); } else chunks.push(d); });
      up.on('end', () => { if (size <= MAX_TEXT) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(Buffer.concat(chunks)); } });
      up.on('error', () => send(res, 502, { error: 'Connexion interrompue' }));
    });
  });
}

// GET /api/stream?url=... -> flux vidéo ; les playlists HLS sont réécrites pour repasser par le proxy
const px = u => '/api/stream?url=' + encodeURIComponent(u);
function rewriteM3u8(text, base) {
  return text.split(/\r?\n/).map(l => {
    const t = l.trim(); if (!t) return l;
    if (t[0] !== '#') return px(new URL(t, base).href);
    return l.replace(/URI="([^"]+)"/g, (_, v) => 'URI="' + px(new URL(v, base).href) + '"');
  }).join('\n');
}
function handleStream(req, res, u) {
  const target = u.searchParams.get('url');
  const h = {}; if (req.headers.range) h.Range = req.headers.range;
  upstream(target, h, (err, up, finalUrl) => {
    if (err) { const [c, m] = errInfo(err); return send(res, c, { error: m }); }
    const ct = String(up.headers['content-type'] || '');
    const isPl = /mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(finalUrl);
    if (isPl && up.statusCode < 400) {
      const chunks = []; up.on('data', d => chunks.push(d));
      up.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        if (!txt.trimStart().startsWith('#EXTM3U')) { res.writeHead(502); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
        res.end(rewriteM3u8(txt, finalUrl));
      });
      return;
    }
    const out = { 'Content-Type': ct || 'video/mp2t', 'Cache-Control': 'no-store' };
    ['content-length', 'content-range', 'accept-ranges'].forEach(k => up.headers[k] && (out[k] = up.headers[k]));
    res.writeHead(up.statusCode, out);
    up.pipe(res);
    req.on('close', () => up.destroy());
    up.on('error', () => res.end());
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    if (limited(req)) return send(res, 429, { error: 'Trop de requêtes, réessaie dans une minute' });
    if (u.pathname === '/api/fetch' && req.method === 'POST') return handleFetch(req, res);
    if (u.pathname === '/api/stream' && req.method === 'GET') return handleStream(req, res, u);
    return send(res, 404, { error: 'Introuvable' });
  }
  const name = u.pathname === '/' ? '/index.html' : u.pathname;
  if (!PUBLIC.has(name)) { res.writeHead(404); return res.end('Not found'); }
  const f = path.join(CLIENT, name);
  fs.readFile(f, (e, data) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(data);
  });
});
// Aucun log d'URL ni d'identifiant.
if (require.main === module) server.listen(PORT, () => console.log('IRC TV PLAYER sur http://localhost:' + PORT));
module.exports = { isPrivate, server };
