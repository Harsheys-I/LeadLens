# AGENTS.md

## Cursor Cloud specific instructions

LeadLens is a single, **static, dependency-free client-side web app** living in `web-app/` (vanilla JS ES modules + HTML + CSS). There is **no package manager, no build step, no backend, and no database service** — state lives in the browser (IndexedDB + session/local storage). The only third-party library, SheetJS (`xlsx`), is loaded from `cdn.jsdelivr.net` via a `<script>` tag in `web-app/index.html`.

### Run (dev)
Serve the repo root and open the `web-app/` sub-path (see `web-app/README.md`):
- `python3 -m http.server 8080`, then open `http://localhost:8080/web-app/` (note the trailing `web-app/` — opening the root will 404).

### Build / Lint / Test
- **Build:** none. Deployment (`.github/workflows/pages.yml`) just uploads `web-app/` to GitHub Pages as-is.
- **Lint / automated tests:** none exist in this repo (no linter config, no test framework, no CI test job). Verify changes by loading the app in a browser.

### Non-obvious gotchas
- The service worker (`web-app/service-worker.js`) intentionally does **not** cache app code, but browsers still cache the ES modules. After editing JS/CSS, do a hard reload (`Ctrl+Shift+R`); asset URLs are cache-busted with `?v=<version>` query strings tied to `web-app/version.json`.
- **AI audit requires a user-supplied OpenAI API key** entered at runtime in Settings → "OpenAI connection" (it is NOT an environment variable and is never committed). Without a key you can still fully exercise upload/parse/validation, but "Start audit" will not call the model.
- End-to-end use needs outbound HTTPS to `cdn.jsdelivr.net` (Excel parsing) and `api.openai.com` (the audit).
- Uploaded Excel workbooks must contain **Mobile** and **Project Name** columns (aliases configurable in Settings); a lead is identified by Mobile + Project. Mobile numbers are validated as Indian mobiles (10 digits starting 6–9).
