# Sfida (sfida-del-giorno)

App «Sfida: Daily Challenge»: una piccola sfida al giorno, timbro «Fatto», serie di giorni di fila.
Web app bilingue (it/en) in un solo file, pubblicata su GitHub Pages (https://dan39734.github.io/sfida-del-giorno/)
e impacchettata come app Android (WebView con Capacitor) per Google Play, pacchetto `io.github.dan39734.sfidadelgiorno`.

## File
- `index.html`: tutta l'app (HTML + CSS + JS, nessuna libreria). Testi dell'interfaccia nell'oggetto `T` (it/en), 84 sfide in `RAW.it` / `RAW.en`, stato salvato in localStorage (chiave `sfida-del-giorno-v1`), `var VERSION = '…'`.
- Promemoria giornaliero (dalla 1.3.0): notifiche locali con il plugin `@capacitor/local-notifications` (lo installa il workflow); in `index.html` sezione «promemoria», impostazioni in localStorage `sfida-notif`; sul sito il riquadro resta nascosto. Icona piccola `ic_stat_sfida` generata dal workflow. Niente sveglie esatte (dalla 1.3.1): `isExactNotification: false` in `index.html` e SCHEDULE_EXACT_ALARM tolto dal manifest nel workflow (`tools:node="remove"`), che fallisce se il permesso ricompare.
- `sw.js`: service worker (rete prima, poi cache); il nome della cache contiene la versione.
- `manifest.json`, `icon-192.png`, `icon-512.png`, `privacy.html`, `.nojekyll`; `.well-known/assetlinks.json` qui è solo una copia (quello valido è alla radice del dominio, repository `dan39734.github.io`).
- `.github/workflows/android.yml`: costruisce con GitHub Actions l'AAB firmato per Play e un APK di debug (avvio manuale). Poi due job di prova (dal 17 ott 2026): «Prove su emulatore» installa l'APK di debug su un emulatore Android 14 e lancia `prove/prove.mjs`; «Prova di controllo» compila un APK con due difetti voluti (salvataggio spento, SCHEDULE_EXACT_ALARM lasciato) e passa solo se le prove lo bocciano come dice `prove/atteso-difettoso.json`. Rapporto ✅/❌/⚠️ nella scheda Summary dell'esecuzione.
- `prove/prove.mjs`: le 9 prove (apertura, sfida, Fatto, progresso dopo riapertura, permessi del pacchetto, promemoria con finestra del permesso, notifica programmata, nessuna schermata «Sveglie e promemoria»). Parla con l'app via `adb` e via DevTools della WebView (solo APK di debug). Se cambiano gli id degli elementi in `index.html` o il testo della funzione `save()`, aggiornare script e job «controllo».
- `docs-privati/`: stato, decisioni, link (fuori da git).

## Regole
- Ogni modifica all'app: alzare `VERSION` in `index.html` e la versione nel nome della cache in `sw.js` (devono coincidere), altrimenti i telefoni non ricevono l'aggiornamento.
- Il sito si aggiorna da solo a ogni push su `main` (GitHub Pages, 1–2 minuti).
- Pacchetto Android: su GitHub → Actions → «Android» → Run workflow, con `version_name` (es. `1.1.2`) e `version_code` intero sempre più alto dell'ultimo caricato su Play (ultimo caricato: 3 = 1.2.0 (2 ott 2026); prossimo: 4 = 1.3.1; il build 1.3.0/4 non è mai stato caricato). Non cambiare mai `appId`.
- La chiave di firma sta nei 4 secret del repository (KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD) e nei backup di Dan: mai copiarla nel repository, mai rigenerarla.
- Il repository è pubblico: niente email, chiavi, impronte o dati personali nei file committati (usare `docs-privati/`).
- Prima di ogni commit o push mostra a Dan cosa cambia e aspetta il suo ok; messaggi di commit brevi, in italiano.
- Test minimo dopo una modifica: aprire `index.html` nel browser e provare italiano/inglese, tema scuro e larghezza 320 px.
