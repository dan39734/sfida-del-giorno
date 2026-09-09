# Sfida (sfida-del-giorno)

App «Sfida: Daily Challenge»: una piccola sfida al giorno, timbro «Fatto», serie di giorni di fila.
Web app bilingue (it/en) in un solo file, pubblicata su GitHub Pages (https://dan39734.github.io/sfida-del-giorno/)
e impacchettata come app Android (WebView con Capacitor) per Google Play, pacchetto `io.github.dan39734.sfidadelgiorno`.

## File
- `index.html`: tutta l'app (HTML + CSS + JS, nessuna libreria). Testi dell'interfaccia nell'oggetto `T` (it/en), 84 sfide in `RAW.it` / `RAW.en`, stato salvato in localStorage (chiave `sfida-del-giorno-v1`), `var VERSION = '…'`.
- `sw.js`: service worker (rete prima, poi cache); il nome della cache contiene la versione.
- `manifest.json`, `icon-192.png`, `icon-512.png`, `privacy.html`, `.nojekyll`; `.well-known/assetlinks.json` qui è solo una copia (quello valido è alla radice del dominio, repository `dan39734.github.io`).
- `.github/workflows/android.yml`: costruisce con GitHub Actions l'AAB firmato per Play e un APK di debug (avvio manuale).
- `docs-privati/`: stato, decisioni, link (fuori da git).

## Regole
- Ogni modifica all'app: alzare `VERSION` in `index.html` e la versione nel nome della cache in `sw.js` (devono coincidere), altrimenti i telefoni non ricevono l'aggiornamento.
- Il sito si aggiorna da solo a ogni push su `main` (GitHub Pages, 1–2 minuti).
- Pacchetto Android: su GitHub → Actions → «Android» → Run workflow, con `version_name` (es. `1.1.2`) e `version_code` intero sempre più alto dell'ultimo caricato su Play (ultimo: 2 = 1.1.1, 8 set 2026). Non cambiare mai `appId`.
- La chiave di firma sta nei 4 secret del repository (KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD) e nei backup di Dan: mai copiarla nel repository, mai rigenerarla.
- Il repository è pubblico: niente email, chiavi, impronte o dati personali nei file committati (usare `docs-privati/`).
- Prima di ogni commit o push mostra a Dan cosa cambia e aspetta il suo ok; messaggi di commit brevi, in italiano.
- Test minimo dopo una modifica: aprire `index.html` nel browser e provare italiano/inglese, tema scuro e larghezza 320 px.
