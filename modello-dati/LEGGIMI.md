# Modello per il repository dei dati di Visto!

Questi file servono a chi usa Visto! con un **repository privato su GitHub** e vuole anche:

- 🔔 **le notifiche push** (nuove stagioni, puntate in uscita, film al cinema e sulle piattaforme, sfide del mese);
- ⭐ **i voti MYmovies e IMDb** cercati ogni notte;
- 💾 **un backup** ogni domenica notte.

Non serve copiarli a mano: in **Visto! → Io → Impostazioni → Automatismi su GitHub** c'è il pulsante **Prepara**, che li copia nel tuo repository e crea le chiavi per le notifiche. La guida completa è nel [README](../README.md#sincronizzazione-notifiche-e-voti-passo-passo).

| File | A cosa serve |
|---|---|
| `workflows/prepara.yml` | si avvia una volta: crea le chiavi delle notifiche |
| `workflows/notifiche.yml` + `scripts/notifiche.mjs` | ogni sera controlla le novità e manda le notifiche |
| `workflows/mymovies.yml` + `scripts/mymovies.mjs`, `scripts/imdb.mjs` | ogni notte cerca i voti MYmovies e IMDb |
| `workflows/backup.yml` | ogni domenica notte salva una copia di `visto.json` |
