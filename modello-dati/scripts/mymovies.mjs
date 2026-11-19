// Visto! — recupera il voto (stelle) di MYmovies per i titoli in lista. Solo il voto e il link, nessun testo.
import fs from 'fs';
const leggi = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Accept-Language': 'it-IT,it;q=0.9'};
const dati = leggi('visto.json', {series: {}, movies: {}});
const mm = leggi('mymovies.json', {});
const log = [];

// Le pagine di MYmovies hanno indirizzi prevedibili: /film/ANNO/titolosenzaspazi/ — si prova direttamente
const slug = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '');
const slugT = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function provaDiretta(titoli, anno){
  const tit = [...new Set(titoli.filter(Boolean).flatMap(t => [t, t.split(/\s+[-–]\s+|:\s+/)[0]]).flatMap(t => [slug(t), slugT(t)]).filter(x => x.length > 1))];
  const anni = anno ? [anno, anno - 1, anno + 1, anno + 2] : [];
  for (const y of anni) for (const t of tit){
    const u = `https://www.mymovies.it/film/${y}/${t}/`;
    try { const r = await fetch(u, {headers: UA, redirect: 'follow'}); if (r.ok && r.url.includes(t)) /* trovato */{ log.push(`diretto ${u} OK`); return {url: u, html: await r.text()}; } } catch {}
    await sleep(350);
  }
  return null;
}
// Ricerca interna di MYmovies (la stessa del sito): restituisce titolo, anno e indirizzo
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, ' ').trim();
const latino = t => /[a-z]/i.test(t || '') && !/[^\u0000-\u024f\u2000-\u206f]/.test(t);
async function cercaMM(q){
  try {
    const r = await fetch('https://www.mymovies.it/ricerca/ricerca.php?limit=true&q=' + encodeURIComponent(q), {headers: {...UA, Referer: 'https://www.mymovies.it/ricerca/'}});
    const j = await r.json(); const out = [];
    for (const tipo of j.risultati?.tipi || []) for (const e of j.risultati[tipo].elenco || []){
      const u = String(e.url || '').split('?')[0];
      if (!/mymovies\.it\/film\/\d{4}\/[^/]+\/?$/.test(u)) continue;
      const y = +(String(e.descrizione || '').match(/^\s*(\d{4})/) || u.match(/\/film\/(\d{4})\//))[1];
      const tit = String(e.titolo || ''); const par = tit.match(/\(([^)]*)\)\s*$/);
      out.push({url: u, y, nomi: [tit.replace(/\s*\([^)]*\)\s*$/, ''), par ? par[1] : ''].map(norm).filter(Boolean)});
    }
    return out;
  } catch(e){ log.push(`ricerca "${q}" errore ${e.message}`); return []; }
}
// Punteggio: titolo uguale 3, il risultato comincia col titolo 2; l'anno deve essere vicino
function scegli(cand, titoli, anno){
  let best = null;
  for (const c of cand){
    let p = 0;
    for (const t of titoli) for (const n of c.nomi){
      if (n === t) p = Math.max(p, 3);
      else if (t.length > 3 && (n.startsWith(t + ' ') || t.startsWith(n + ' '))) p = Math.max(p, 2);
    }
    if (p < 2) continue;
    const dy = anno && c.y ? Math.abs(c.y - anno) : 0;
    if (dy > (p === 3 ? 2 : 1)) continue;
    const s = p * 10 - dy * 3;
    if (!best || s > best.s) best = {...c, s};
  }
  return best;
}
async function trovaUrl(titoli, anno){
  const nt = [...new Set(titoli.filter(latino).flatMap(t => [t, t.split(/\s+[-–]\s+|:\s+/)[0], t.split(/\s+[-–]\s+/).slice(1).join(' ')]).map(norm).filter(x => x.length > 1))];
  const domande = [...new Set(titoli.filter(latino).flatMap(t => [t.replace(/…/g, ' '), t.split(/\s+[-–]\s+|:\s+/)[0], norm(t)]).map(x => x.trim()).filter(x => x.length > 2))].slice(0, 5);
  for (const q of domande){
    const c = scegli(await cercaMM(q), nt, anno);
    log.push(`ricerca "${q}" -> ${c ? c.url + ' (' + c.y + ')' : '-'}`);
    if (c) return c.url;
    await sleep(700);
  }
  return null;
}
function votoDaPagina(h){
  for (const m of h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)){
    try {
      const arr = [].concat(JSON.parse(m[1].trim()));
      for (const j of arr){ const a = j.aggregateRating || (j['@graph'] || []).find(x => x.aggregateRating)?.aggregateRating;
        if (a && a.ratingValue) return {voto: +String(a.ratingValue).replace(',', '.'), max: +(a.bestRating || 5), n: +(a.ratingCount || a.reviewCount || 0)}; }
    } catch {}
  }
  const m2 = h.match(/itemprop="ratingValue"[^>]*content="([\d.,]+)"/) || h.match(/"ratingValue"\s*:\s*"?([\d.,]+)/);
  if (m2) return {voto: +m2[1].replace(',', '.'), max: 5, n: 0};
  return null;
}
const lista = [
  ...Object.values(dati.movies || {}).filter(m => typeof m.id === 'number').map(m => ({k: 'm' + m.id, t: [m.title, m.orig], y: +m.year || 0, q: `${m.title} ${m.year || ''} film`})),
  ...Object.values(dati.series || {}).map(s => ({k: 's' + s.id, t: [s.itName, s.name], y: +(s.premiered || '').slice(0, 4) || 0, q: `${s.itName || s.name} serie tv ${(s.premiered || '').slice(0, 4)}`}))
];
let fatti = 0;
const SOLO = process.env.SOLO || ''; // dal tasto nella scheda: un titolo solo, subito
for (const it of lista){
  if (SOLO && it.k !== SOLO) continue;
  const c = SOLO ? (mm[it.k]?.url ? mm[it.k] : null) : mm[it.k];
  if (!SOLO && c && c.v2 && (c.url || c.v3) && Date.now() - c.at < (c.voto ? 30 : 7) * 864e5) continue;
  if (fatti >= 200) break; // un po' alla volta, per non disturbare i siti
  fatti++;
  let url = c?.url, pre = null;
  if (!url){ url = await trovaUrl(it.t, it.y); if (!url){ pre = await provaDiretta(it.t, it.y); url = pre?.url; } }
  if (!url){ mm[it.k] = {at: Date.now(), url: null, v2: 1, v3: 1}; log.push(`  -> non trovato: ${it.t[0]}`); continue; }
  if (pre){ const v = votoDaPagina(pre.html); mm[it.k] = Object.assign({at: Date.now(), url, v2: 1, v3: 1}, v || {}); log.push(`  -> ${v ? v.voto + '/' + v.max : 'nessun voto'}`); await sleep(1000); continue; }
  try {
    const r = await fetch(url, {headers: UA}); const h = await r.text();
    const v = r.ok ? votoDaPagina(h) : null;
    mm[it.k] = Object.assign({at: Date.now(), url, v2: 1, v3: 1}, v || {});
    log.push(`  -> ${url} ${r.status} ${v ? v.voto + '/' + v.max : 'nessun voto'}`);
  } catch(e){ mm[it.k] = {at: Date.now(), url}; }
  await sleep(2000);
}
fs.writeFileSync('mymovies.json', JSON.stringify(mm, null, 1));
fs.writeFileSync('mymovies-log.txt', log.join('\n'));
console.log(log.join('\n'));
