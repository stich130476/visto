// Visto! — controllo giornaliero delle novità e invio delle notifiche push
import fs from 'fs';
import webpush from 'web-push';

const leggi = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const fData = d => { const [y, m, g] = d.split('-').map(Number); return `${g} ${MESI[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`; };
const oggi = new Date().toLocaleDateString('sv', {timeZone: 'Europe/Rome'});

const vapid = leggi('.github/scripts/vapid.json');
if (!vapid?.privateKey){ console.log('Chiavi delle notifiche non ancora create: avvia "Prepara le notifiche"'); process.exit(0); }
webpush.setVapidDetails('https://github.com/stich130476/visto', vapid.publicKey, vapid.privateKey);

const dati = leggi('visto.json', {series: {}, movies: {}});
const push = leggi('push.json', {subs: {}});
const stato = Object.assign({init: false, maxS: {}, prov: {}, sent: {}, welcomed: {}}, leggi('notifiche-stato.json', {}));
const msgs = [];
let pushCambiato = false;

async function invia(sub, msg){
  try { await webpush.sendNotification(sub, JSON.stringify(msg), {TTL: 86400 * 3}); return true; }
  catch(e){ console.log('Invio fallito', e.statusCode, e.body); return e.statusCode === 404 || e.statusCode === 410 ? 'scaduta' : false; }
}

// 1) Benvenuto ai dispositivi appena attivati
for (const [dev, s] of Object.entries(push.subs || {})){
  if (stato.welcomed[dev] === s.at) continue;
  const r = await invia(s.sub, {title: 'Visto! 🔔', body: `Notifiche attive su ${s.name || 'questo dispositivo'}. Ti avviserò delle nuove stagioni e dei film in uscita.`, tag: 'benvenuto'});
  if (r === true) stato.welcomed[dev] = s.at;
  if (r === 'scaduta'){ delete push.subs[dev]; pushCambiato = true; }
}

// 2) Serie: nuove stagioni annunciate e prime puntate di stagione in uscita oggi
for (const sh of Object.values(dati.series || {})){
  if (sh.dropped || sh.stopped) continue; // serie bocciate o chiuse: nessun avviso
  let t;
  try { const r = await fetch(`https://api.tvmaze.com/shows/${sh.id}?embed[]=episodes`); if (!r.ok) continue; t = await r.json(); }
  catch { continue; }
  await sleep(700);
  const nome = sh.itName && sh.itName !== sh.name ? sh.itName : sh.name;
  const eps = (t._embedded?.episodes || []).filter(e => e.number != null);
  const maxS = Math.max(0, ...eps.map(e => e.season));
  const noto = stato.maxS[sh.id] ?? Math.max(0, ...(sh.eps || []).map(e => e.s));
  if (stato.init && maxS > noto && noto > 0){
    const prima = eps.find(e => e.season === maxS && e.number === 1);
    msgs.push({id: `ss-${sh.id}-${maxS}`, tag: `ss-${sh.id}`, title: `Nuova stagione di: ${nome}`,
      body: prima?.airdate && prima.airdate >= oggi ? `La stagione ${maxS} arriva il ${fData(prima.airdate)} 🍿` : `È arrivata la stagione ${maxS} 🍿`});
  }
  stato.maxS[sh.id] = Math.max(maxS, noto);
  const prem = eps.find(e => e.number === 1 && e.season > 1 && e.airdate === oggi);
  if (prem) msgs.push({id: `prem-${sh.id}-${prem.season}`, tag: `prem-${sh.id}`, title: `Oggi torna ${nome}!`, body: `Esce il primo episodio della stagione ${prem.season}`});
  // nuove puntate uscite dall'ultimo controllo (serie seguite e non in pausa)
  const seguita = !sh.paused && Object.keys(sh.watched || {}).length > 0;
  if (stato.init && seguita){
    const da = Date.parse(stato.ultimo || 0) || (Date.now() - 864e5);
    const nuove = eps.filter(e => e.airstamp && Date.parse(e.airstamp) > da && Date.parse(e.airstamp) <= Date.now() && !(e.number === 1 && e.season > 1) && !(sh.watched || {})[e.id]);
    const cod = e => `S${e.season}E${String(e.number).padStart(2, '0')}`;
    if (nuove.length === 1) msgs.push({id: `ep-${sh.id}-${nuove[0].id}`, tag: `ep-${sh.id}`, title: `Nuovo episodio di ${nome}`, body: `${cod(nuove[0])} · ${nuove[0].name} è disponibile 📺`});
    else if (nuove.length > 1) msgs.push({id: `ep-${sh.id}-${nuove[nuove.length - 1].id}`, tag: `ep-${sh.id}`, title: `${nuove.length} nuovi episodi di ${nome}`, body: `Da ${cod(nuove[0])} a ${cod(nuove[nuove.length - 1])} 📺`});
  }
}

// 2b) Collane (antologie in cui ogni stagione è una serie a sé, es. Monster): nuova uscita annunciata
const collane = leggi('collane.json', {collane: []}).collane;
// collane automatiche: ogni serie seguita il cui titolo ha la forma "Nome: sottotitolo" (es. "Dexter: Resurrection")
// fa sorvegliare le nuove uscite che iniziano con lo stesso "Nome" sulla stessa piattaforma (nuovi capitoli e spin-off)
const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const sh of Object.values(dati.series || {})){
  if (sh.dropped || !Object.keys(sh.watched || {}).length) continue;
  const m = (sh.name || '').match(/^(.{3,}?)\s*(?::|\s[–-]\s)/);
  if (!m) continue;
  const base = m[1].trim();
  if (collane.some(c => new RegExp(c.regex, 'i').test(sh.name))) continue;
  if (!collane.some(c => c.nome === base)) collane.push({nome: base, regex: '^' + escRe(base) + '\\b', query: [base], rete: sh.net || null});
}
stato.collane = stato.collane || {};
for (const c of collane){
  const re = new RegExp(c.regex, 'i'), noti = new Set(stato.collane[c.nome] || []);
  Object.values(dati.series || {}).forEach(sh => { if (re.test(sh.name)) noti.add(sh.id); });
  const trovati = [];
  for (const q of c.query){
    try { const r = await fetch('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q)); if (r.ok) (await r.json()).forEach(x => trovati.push(x.show)); } catch {}
    await sleep(700);
  }
  for (const sh of trovati){
    if (!re.test(sh.name) || noti.has(sh.id)) continue;
    if (c.rete && ![(sh.webChannel || {}).name, (sh.network || {}).name].includes(c.rete)) continue;
    if (stato.init && (stato.collane[c.nome] || []).length) msgs.push({id: `col-${sh.id}`, tag: `col-${sh.id}`, title: `Nuova stagione di: ${c.nome}`, body: `${sh.name}${sh.premiered ? ' · dal ' + fData(sh.premiered) : ' · annunciata'} 🍿`});
    noti.add(sh.id);
  }
  stato.collane[c.nome] = [...noti];
}

// 3) Film in lista: uscita al cinema oggi e arrivo in streaming
if (dati.tmdbKey){
  for (const m of Object.values(dati.movies || {})){
    if (m.state !== 'todo' || m.dropped || typeof m.id !== 'number') continue;
    let d;
    try { const r = await fetch(`https://api.themoviedb.org/3/movie/${m.id}?api_key=${dati.tmdbKey}&language=it-IT&append_to_response=watch/providers,release_dates`); if (!r.ok) continue; d = await r.json(); }
    catch { continue; }
    await sleep(250);
    const rd = d.release_dates?.results?.find(r => r.iso_3166_1 === 'IT')?.release_dates || [];
    const cinema = rd.filter(r => r.type === 2 || r.type === 3).map(r => r.release_date.slice(0, 10)).sort()[0] || d.release_date;
    if (cinema === oggi) msgs.push({id: `cin-${m.id}`, tag: `cin-${m.id}`, title: `Oggi al cinema: ${d.title}`, body: 'Era nella tua lista "Da vedere" 🎬'});
    const flat = (d['watch/providers']?.results?.IT?.flatrate || []).map(p => p.provider_name);
    const prima = stato.prov[m.id];
    const nuovi = prima ? flat.filter(p => !prima.includes(p)) : [];
    const tolta = prima ? prima.find(p => !flat.includes(p)) : null;
    if (stato.init && tolta && !flat.length) msgs.push({id: `gone-${m.id}-${tolta}`, tag: `gone-${m.id}`, title: `Non più disponibile: ${d.title}`, body: `Non è più su ${tolta}. Era nella tua lista "Da vedere"`});
    if (stato.init && nuovi.length) msgs.push({id: `str-${m.id}-${nuovi[0]}`, tag: `str-${m.id}`, title: `Ora in streaming: ${d.title}`, body: `Disponibile su ${nuovi.join(', ')} 🍿`});
    stato.prov[m.id] = flat;
  }
}

// 4) Invio (senza doppioni)
// il 1° del mese: arrivano le nuove sfide del mese nell'app
{ const ora = new Date(new Date().toLocaleString('en-US', {timeZone: 'Europe/Rome'}));
  if (ora.getDate() <= 2){ const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
    msgs.push({id: `sfide-${ora.getFullYear()}-${ora.getMonth() + 1}`, tag: 'sfide-mese', title: `🗓️ Le sfide di ${MESI[ora.getMonth()]}`, body: 'Tre nuove sfide ti aspettano in Visto!: le trovi in Io, tra i traguardi 🍿'}); } }
for (const msg of msgs){
  if (stato.sent[msg.id]) continue;
  let ok = false;
  for (const [dev, s] of Object.entries(push.subs || {})){
    const r = await invia(s.sub, {title: msg.title, body: msg.body, tag: msg.tag, url: './'});
    if (r === true) ok = true;
    if (r === 'scaduta'){ delete push.subs[dev]; pushCambiato = true; }
  }
  if (ok || !Object.keys(push.subs || {}).length) stato.sent[msg.id] = oggi;
  console.log(ok ? 'Inviata:' : 'Non inviata:', msg.title);
}

// pulizia dei ricordi più vecchi di un anno
const limite = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
for (const [k, v] of Object.entries(stato.sent)) if (v < limite) delete stato.sent[k];

stato.init = true;
stato.ultimo = new Date().toISOString();
fs.writeFileSync('notifiche-stato.json', JSON.stringify(stato, null, 1));
if (pushCambiato) fs.writeFileSync('push.json', JSON.stringify(push, null, 1));
console.log(`Fatto: ${msgs.length} novità trovate.`);
