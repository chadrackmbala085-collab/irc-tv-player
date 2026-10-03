// Parser M3U partagé (sources 2 et 3). Fonctionne dans le navigateur et dans Node.
(function (root) {
  function parseM3U(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Fichier invalide : la ligne #EXTM3U est absente.');
    const out = []; let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.trim(); if (!l) continue;
      if (l.startsWith('#EXTINF')) {
        const attr = {}; l.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => (attr[k.toLowerCase()] = v));
        let i = -1, q = false; for (let k = 0; k < l.length; k++) { if (l[k] === '"') q = !q; else if (l[k] === ',' && !q) { i = k; break; } }
        
        cur = { name: (i >= 0 ? l.slice(i + 1).trim() : '') || attr['tvg-name'] || 'Sans nom',
                logo: attr['tvg-logo'] || '', group: attr['group-title'] || 'Sans catégorie', tvgId: attr['tvg-id'] || '' };
      } else if (l[0] !== '#' && /^[a-z]+:\/\//i.test(l)) {
        out.push(Object.assign(cur || { name: l, logo: '', group: 'Sans catégorie', tvgId: '' }, { url: l, id: out.length })); cur = null;
      }
    }
    if (!out.length) throw new Error('Aucune chaîne trouvée dans cette playlist.');
    return out;
  }
  if (typeof module !== 'undefined') module.exports = { parseM3U }; else root.parseM3U = parseM3U;
})(this);
