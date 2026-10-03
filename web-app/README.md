# LeadLens web app

Login-gated multi-module app for Hostinger (PHP + MySQL) with browser-side AI audits.

**Current version:** see `version.json` (10.0.0.stable).

## Routes

| Path | Purpose |
|------|---------|
| `/` | Login, request access, home module tiles |
| `/TeleCallerAudit/` | Bucket 1 audit, Run console (permission), published dashboards, History, Settings |
| `/ERPSync/` | Super User — GitHub Actions ERP sync (Lead Audit / Perf / Sales Graph) |
| `/SalesGraph/` | Sales Graph — published multi-chart dashboard (synced via ERP Sync) |
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
curl.exe -sS -X POST "https://ai.gurupunvaanii.com/api/audit/upload" -F "username=YOUR_USER" -F "password=YOUR_PASSWORD" -F "file=@C:\path\to\leads.xlsx" -F "batch_size=25" -F "concurrency=8"
```

| Field | Required | Meaning |
|-------|----------|---------|
| `username`, `password` | yes | Your LeadLens login (same check as the website; the password is not stored). The account must be active and have Bucket 1 (`telecaller.bucket1` or `module.telecaller_audit`) plus Upload Dashboard, or be Super User. |
| `file` | yes | `.xlsx` (first sheet) or a Strategic ERP `.json` report (`A1` mobile through `A13` budget). Mobile and Project are required. |
| `batch_size` | no | Leads per OpenAI request, 1–40 (recommended 25). Omit to use the saved Settings value. |
| `concurrency` | no | Parallel batches (requests in flight at once), 1–50 (recommended 8). Omit to use the saved Settings value. |

`batch_size` and `concurrency` apply to that run only and are never saved to Settings; out-of-range values are clamped. Everything else (model, fields, rules, yes/no values) comes from the saved Settings.

These are ceilings. On an OpenAI 429 the server honors `Retry-After` / `x-ratelimit-reset-*`, pauses, halves the parallel requests (then the batch size once at 1, never below 5), and steps back up after a run of successes; the reduced level is kept in the job so the next chained worker continues at it. 5xx, timeouts, and network errors retry with exponential backoff. A batch that keeps failing is split and retried, and only a single lead OpenAI keeps rejecting is marked errored (local checks only). The job only stops on account-level errors (invalid key, no quota, unknown model) or Stop. The **ERP Sync** module and the Bucket 1 banner show the current parallel / batch level, rate-limit hits, tokens/cost, and any pause.

The command returns `202` as soon as the file is accepted and the audit has started, with `lead_count`, `batch_size`, `concurrency`, and `total_batches`. The server keeps auditing in the background (self-chain continue) and publishes the dashboards when it finishes. If another server Bucket 1 audit is still running, the call returns `409` with its progress and nothing is replaced — try again later.

## Performance upload API

`POST /api/perf-dashboards/upload` does what the TeleCalling Performance upload does on the website, in one request: parse the Master and History reports, reconcile them on the server, and publish one Performance dashboard per TeleCaller (replacing all current Performance boards, credited to you). There is no OpenAI step, so the call finishes before it responds.

```bash
curl -sS -D - -o /tmp/leadlens-perf-upload.json -X POST "https://ai.gurupunvaanii.com/api/perf-dashboards/upload" \
  -F "username=YOUR_USER" -F "password=YOUR_PASSWORD" \
  -F "master=@/tmp/erp-perf-master.json" \
  -F "history=@/tmp/erp-perf-history.json"
cat /tmp/leadlens-perf-upload.json
```

| Field | Required | Meaning |
|-------|----------|---------|
| `username`, `password` | yes | Your LeadLens login. The account must be active and have Upload Performance Dashboard (`telecaller.perf_upload`), or be Super User. |
| `master` | yes | `.xlsx` (first sheet) or Strategic ERP `.json` report 10000022 (`A3` Mobile, `A2` Project, `A10` Source, `A9` Registration, `A7` Next Followup, `A5` Status, `A6` Telecaller). |
| `history` | yes | `.xlsx` (first sheet) or Strategic ERP `.json` report 10000026 (`A1` Lead Update Date, `A2` Mobile, `A3` Project, `A4` Telecaller, `A5` Status, `A6` Source). |
| `telecallers` | no | Comma-separated TeleCaller names to publish. Omit to publish every TeleCaller in the reports. Names not found are returned in `unmatched_telecallers`. |

| Status | Meaning |
|--------|---------|
| `201` | Published. The body has `telecaller_count`, `published`, `cleared`, `summary`, `date_min`, `date_max`, `report_days`, `master_rows`, `history_rows`. |
| `400` | A report could not be used (bad JSON, no rows, or the ERP layout changed). The error starts with `Master report:` or `History report:` and lists missing columns by name. Nothing is replaced. |
| `401` / `403` | Wrong username or password, or the account lacks Upload Performance Dashboard. |
| `409` | Another Performance upload is running. Try again shortly. |
| `413` | A file is larger than the server upload limit. |

Each call (success or failure after login) is listed under **ERP Sync → API uploads** as a Performance row.

## Hostinger

See [HOSTINGER.md](HOSTINGER.md). Sync of `web-app/` → `hostinger` branch includes `api/`.

## Local static preview

```powershell
python -m http.server 8080
```

Open `http://localhost:8080/web-app/`. Login/API need PHP+MySQL (or Hostinger). Hard-reload after deploy (`Ctrl+Shift+R`).
