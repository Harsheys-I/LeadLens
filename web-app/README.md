# LeadLens web app

Login-gated multi-module app for Hostinger (PHP + MySQL) with browser-side AI audits.

**Current version:** see `version.json` (8.0.1.kpi-fix).

## Routes

| Path | Purpose |
|------|---------|
| `/` | Login, request access, home module tiles |
| `/TeleCallerAudit/` | Bucket 1 audit, Run console (permission), published dashboards, History, Settings |
| `/SalesGraph/` | Sales Graph — Leads/Visits upload, published multi-chart dashboard |
| `/SEO/` | SEO — technical audit command center, live scanner, schema studio, 30-day action plan |
| `/admin/` | Users, Roles, access-request queue, notifications |
| `/api/` | PHP session auth, admin CRUD, published dashboards |

CRM / HR tiles are **Coming soon** only.

## What stays local (audits)

- Workbooks parse in the browser; OpenAI key stays in this browser.
- Checkpoints / results / logs remain in IndexedDB.
- **Published dashboards** are stored on the server (MySQL) and scoped by TeleCaller name.

## Bucket 1 from the terminal

`POST /api/audit/upload` does what Bucket 1 + Upload Dashboard do on the website, in one command: parse the workbook, audit it on the server with the saved Settings and the server OpenAI key, then publish the TeleCaller dashboards (replacing the current boards, credited to you).

```powershell
curl.exe -sS -X POST "https://ai.gurupunvaanii.com/api/audit/upload" -F "username=YOUR_USER" -F "password=YOUR_PASSWORD" -F "file=@C:\path\to\leads.xlsx" -F "batch_size=20" -F "concurrency=2"
```

| Field | Required | Meaning |
|-------|----------|---------|
| `username`, `password` | yes | Your LeadLens login (same check as the website; the password is not stored). The account must be active and have Bucket 1 (`telecaller.bucket1` or `module.telecaller_audit`) plus Upload Dashboard, or be Super User. |
| `file` | yes | `.xlsx` only; the first sheet is read. Mobile and Project columns are required (ERP Sync field map). |
| `batch_size` | no | Leads per OpenAI request, 1–20. Omit to use the saved Settings value. |
| `concurrency` | no | Parallel batches (requests in flight at once), 1–50. Omit to use the saved Settings value. |

`batch_size` and `concurrency` apply to that run only and are never saved to Settings; out-of-range values are clamped. Everything else (model, fields, rules, yes/no values) comes from the saved Settings.

The command returns `202` as soon as the file is accepted and the audit has started, with `lead_count`, `batch_size`, `concurrency`, and `total_batches`. The server keeps auditing in the background (one-time internal continue step, no cron secret) and publishes the dashboards when it finishes. If another server Bucket 1 audit (including the 6:00 AM ERP job) is still running, the call returns `409` with its progress and nothing is replaced — try again later.

## Hostinger

See [HOSTINGER.md](HOSTINGER.md). Sync of `web-app/` → `hostinger` branch includes `api/`.

## Local static preview

```powershell
python -m http.server 8080
```

Open `http://localhost:8080/web-app/`. Login/API need PHP+MySQL (or Hostinger). Hard-reload after deploy (`Ctrl+Shift+R`).
