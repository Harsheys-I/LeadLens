# LeadLens web app

A static, privacy-first telecalling audit app designed for GitHub Pages.

## What stays local

- The uploaded workbook is parsed in the browser.
- The API key is stored in session storage by default. "Remember on this device" uses local storage.
- Checkpoints, audit results and logs are stored in IndexedDB for this browser profile.
- No workbook, API key, audit or log is committed to GitHub.

The lead history is sent directly from the browser to the OpenAI API for analysis. This is intentionally a browser-only JavaScript app: GitHub Pages serves the UI, SheetJS parses the workbook, and the browser calls OpenAI directly with the key entered by that user. There is no Python runtime, local-processing fallback, server proxy, or shared API key. Users should use their own trusted device/browser and remove the key when finished.

The audit request keeps the stable system instructions at the beginning and puts each batch's unique lead data afterward, which allows OpenAI's automatic prompt caching to reuse the repeated prefix when eligible. The console reports input, cached-input, and output token counts; only the cached portion receives cached-input pricing, and unique lead data still consumes normal input tokens.

## Latest-call audit rules

- Rows are grouped by Project Name + valid Indian mobile number. Only 10-digit numbers beginning with 6–9 are processed.
- By default, AI receives only the latest call’s Lead Status, Comments, Next Followup Date, Customer Location, Customer Requirement, Estimated Budget, and derived Connected value. Individual AI fields can be switched to all-history in Settings.
- The four configured project/location exceptions are blanked only in the AI context; the exported Customer Location remains the original latest value.
- Missed follow-up, empty connected-call data, and missing Analysis Parameter are verified in the browser. AI checks comment/status alignment, comment quality, buying intent, observation, and recommendation.
- The Settings page controls Excel header aliases, AI fields, AI rules and allowable errors, output columns, Connected Yes/No values, batch size, and cost rates per million tokens.

## Preview before publishing

For a local preview only, serve the repository root so module imports and the service worker work correctly:

```powershell
python -m http.server 8080
```

Open `http://localhost:8080/web-app/`.

## Deploy

1. Create a private or public GitHub repository and add it as this project's remote.
2. Push the project to the `main` branch. Excel files, audit outputs and `.env` files are ignored.
3. In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Run the **Deploy LeadLens to GitHub Pages** workflow, or push a change under `web-app/`.

## Expected Excel fields

The app auto-detects the sheet with the best matching columns. Required meanings are Mobile, Project Name, Lead Update Date, Lead Status, Comments and Next Followup Date. It also recognizes common variants such as `Mobile Number`, `Next Follow-up Date`, `Remarks`, `Telecaller Name` and `Agent Name`.
