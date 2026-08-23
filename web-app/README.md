# LeadLens web app

A static, privacy-first telecalling audit app designed for GitHub Pages.

**Current version:** see `version.json` / Settings → Backup & version.

## What stays local

- The uploaded workbook is parsed in the browser.
- The API key is stored in session storage by default. "Remember on this device" uses local storage.
- Checkpoints, audit results and logs are stored in IndexedDB for this browser profile and survive page reloads.
- Settings can be exported/imported as JSON (API key excluded).
- No workbook, API key, audit or log is committed to GitHub.

## Token design

- Stable compact handbook + short field keys (`s`,`c`,`n`,…) at the front for prompt caching; lead payloads last.
- AI returns short keys and **full error type labels** in `e[]` (no numeric codes). Severity is computed in-app.
- Console shows total input, cached input, and **billable input** (total − cached).

## Parallel batches

Settings → **Parallel batches** keeps that many API requests in flight continuously. When one batch finishes, the next starts immediately. Checkpoints append in order via a save lock (out-of-order completions are buffered in `pendingBatches`).

## Preview / deploy

```powershell
python -m http.server 8080
```

Open `http://localhost:8080/web-app/`. Deploy via GitHub Actions from `web-app/` as before. Hard-reload after deploy (`Ctrl+Shift+R`) so `version.json` updates.
