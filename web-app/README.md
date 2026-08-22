# LeadLens web app

A static, privacy-first telecalling audit app designed for GitHub Pages.

## What stays local

- The uploaded workbook is parsed in the browser.
- The API key is stored in session storage by default. "Remember on this device" uses local storage.
- Checkpoints, audit results and logs are stored in IndexedDB for this browser profile.
- No workbook, API key, audit or log is committed to GitHub.

The lead history is sent directly from the browser to the OpenAI API for analysis. This is intentionally a browser-only JavaScript app: GitHub Pages serves the UI, SheetJS parses the workbook, and the browser calls OpenAI directly with the key entered by that user. There is no Python runtime, local-processing fallback, server proxy, or shared API key. Users should use their own trusted device/browser and remove the key when finished.

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
