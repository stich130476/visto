// Visto! — voto IMDb di riserva per i titoli che MYmovies non ha. Usa l'elenco ufficiale dei voti IMDb (datasets.imdbws.com).
import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import {Readable} from 'stream';
const leggi = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dati = leggi('visto.json', {series: {}, movies: {}});
const out = leggi('imdb.json', {});
// 1) codici IMDb: serie da TVmaze (già nei dati), film da TMDB
for (const s of Object.values(dati.series || {})) if (s.imdb) out['s' + s.id] = Object.assign(out['s' + s.id] || {}, {id: s.imdb});
for (const m of Object.values(dati.movies || {})){
  if (typeof m.id !== 'number') continue;
  const k = 'm' + m.id; if (out[k]?.id || out[k]?.nessuno) continue;
  if (!dati.tmdbKey) break;
  try { const r = await fetch(`https://api.themoviedb.org/3/movie/${m.id}/external_ids?api_key=${dati.tmdbKey}`); if (r.ok){ const j = await r.json(); out[k] = j.imdb_id ? {id: j.imdb_id} : {nessuno: true}; } } catch {}
  await sleep(120);
}
// 2) voti dall'elenco ufficiale
const cerco = new Map(Object.entries(out).filter(([, v]) => v.id).map(([k, v]) => [v.id, k]));
const r = await fetch('https://datasets.imdbws.com/title.ratings.tsv.gz');
if (!r.ok) { console.log('IMDb non raggiungibile', r.status); process.exit(0); }
const rl = readline.createInterface({input: Readable.fromWeb(r.body).pipe(zlib.createGunzip())});
let trovati = 0;
for await (const riga of rl){
  const tab = riga.indexOf('\t'); const id = riga.slice(0, tab);
  if (!cerco.has(id)) continue;
  const [, v, n] = riga.split('\t'); const k = cerco.get(id);
  out[k] = Object.assign(out[k], {v: +v, n: +n, at: Date.now()}); trovati++;
}
fs.writeFileSync('imdb.json', JSON.stringify(out));
console.log(`IMDb: ${trovati} voti su ${cerco.size} codici`);
