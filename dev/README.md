# LeadLens web app

Login-gated multi-module app for Hostinger (PHP + MySQL) with browser-side AI audits.

**Current version:** see `version.json` (5.0.3+).

## Routes

| Path | Purpose |
|------|---------|
| `/` | Login, request access, home module tiles |
| `/TeleCallerAudit/` | Bucket 1 audit, Run console (permission), published dashboards, History, Settings |
| `/admin/` | Users, Roles, access-request queue, notifications |
| `/api/` | PHP session auth, admin CRUD, published dashboards |

CRM / HR tiles are **Coming soon** only.

## What stays local (audits)

- Workbooks parse in the browser; OpenAI key stays in this browser.
- Checkpoints / results / logs remain in IndexedDB.
- **Published dashboards** are stored on the server (MySQL) and scoped by TeleCaller name.

## Hostinger

See [HOSTINGER.md](HOSTINGER.md). Sync of `web-app/` → `hostinger` branch includes `api/`.

## Local static preview

```powershell
python -m http.server 8080
```

Open `http://localhost:8080/web-app/`. Login/API need PHP+MySQL (or Hostinger). Hard-reload after deploy (`Ctrl+Shift+R`).
