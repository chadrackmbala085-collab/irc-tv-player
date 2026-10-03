// Tests : parser M3U, filtre SSRF, comportement du proxy. Lancer : npm test
const assert = require('assert'), http = require('http');
const { parseM3U } = require('./parser.js');
const { isPrivate, server } = require('./server.js');
server.listen(0);
let ok = 0; const t = (n, f) => Promise.resolve().then(f).then(() => { ok++; console.log('OK  ', n); }, e => { console.log('FAIL', n, '-', e.message); process.exitCode = 1; });
const post = (body) => new Promise(r => { const q = http.request({ port: server.address().port, path: '/api/fetch', method: 'POST' }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => r([s.statusCode, d])); }); q.end(JSON.stringify(body)); });
(async () => {
  await t('M3U valide : 2 chaînes + attributs', () => {
    const l = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-id="a" tvg-logo="http://x/l.png" group-title="News",Chaîne, Un\nhttp://h/1.m3u8\n#EXTINF:-1,Deux\nhttps://h/2.ts\n');
    assert.equal(l.length, 2); assert.equal(l[0].group, 'News'); assert.equal(l[0].logo, 'http://x/l.png'); assert.equal(l[0].name, 'Chaîne, Un'); assert.equal(l[1].group, 'Sans catégorie');
  });
  await t('Fichier sans #EXTM3U refusé', () => assert.throws(() => parseM3U('hello'), /EXTM3U/));
  await t('Playlist vide refusée', () => assert.throws(() => parseM3U('#EXTM3U\n'), /Aucune chaîne/));
  await t('BOM + fins de ligne Windows', () => assert.equal(parseM3U('\uFEFF#EXTM3U\r\n#EXTINF:-1,A\r\nhttp://a/b\r\n').length, 1));
  await t('10 000 chaînes parsées < 1 s', () => { let s = '#EXTM3U\n'; for (let i = 0; i < 10000; i++) s += `#EXTINF:-1 group-title="g${i % 50}",C${i}\nhttp://h/${i}.m3u8\n`; const a = Date.now(); assert.equal(parseM3U(s).length, 10000); assert(Date.now() - a < 1000); });
  await t('IP privées détectées', () => ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1'].forEach(ip => assert(isPrivate(ip), ip)));
  await t('IP publiques acceptées', () => ['8.8.8.8', '172.32.0.1', '1.1.1.1'].forEach(ip => assert(!isPrivate(ip), ip)));
  await t('Proxy refuse localhost', async () => { const [c] = await post({ url: 'http://127.0.0.1:1/' }); assert.equal(c, 502); });
  await t('Proxy refuse file://', async () => { const [c, b] = await post({ url: 'file:///etc/passwd' }); assert.equal(c, 502); assert(/http/.test(b)); });
  await t('Proxy refuse une IP interne (192.168)', async () => { const [c, b] = await post({ url: 'http://192.168.1.10/get.php' }); assert(/interne/.test(b)); });
  await t('Hôte inexistant : message clair', async () => { const [c, b] = await post({ url: 'http://serveur-inexistant.invalid/' }); assert(/introuvable|Erreur réseau|interne/i.test(b), b); });
  console.log(ok + ' tests réussis'); process.exit(process.exitCode || 0);
})();
