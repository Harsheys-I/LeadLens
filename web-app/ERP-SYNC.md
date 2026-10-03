# ERP Sync (GitHub Actions only)

ERP data ingest is **GitHub Actions only**. The Super User home module **[ERP Sync](./ERPSync/)** dispatches `erp-daily-upload.yml`, shows live GHA + Lead Audit status (tokens, elapsed, estimated cost), and can stop an in-flight server audit.

There is **no** Cookie / Report URL / Hostinger keep-alive / daily fetch path in the UI. Those API actions return **410** with a clear “replaced by GitHub Actions” message.

## Schedules (IST)

| Pipeline | When | UTC cron (workflow) |
|----------|------|---------------------|
| Bucket 1 (Lead Audit) | Every day **00:00 IST** | `30 18 * * *` |
| Sales Graph | Every day **00:00 IST** | same |
| Performance | **1st of month 00:00 IST** | same schedule; workflow adds `perf` when IST day is `01` |

Scheduled pick: `bucket1,sales` daily; on the 1st → `bucket1,sales,perf`.

Manual **Run now** on the ERP Sync module (or Actions → workflow_dispatch) can select any of `bucket1`, `perf`, `sales`.

## Super User setup

1. Open **https://ai.gurupunvaanii.com/ERPSync/** (or `/dev/ERPSync/`) as Super User.
2. On Hostinger, set in `api/config.local.php` (see [config.example.php](./api/config.example.php)):

```php
'github' => [
  'token' => 'github_pat_…',  // fine-grained: Actions write + Contents read
  'owner' => 'Harsheys-I',
  'repo'  => 'LeadLens',
  'workflow' => 'erp-daily-upload.yml',
  'ref' => 'main',
],
```

3. Select pipelines → **Run now**. Status polls every ~4s while a GHA run or server audit is active, else ~15s.
4. Lead Audit after GHA `audit/upload` continues via PHP **self-chain** (`erp-sync/continue`). Optional Hostinger continue cron remains a safety net.

## What GHA uploads

| Job | LeadLens API | Notes |
|-----|--------------|--------|
| `bucket1` | `POST /api/audit/upload` | Starts server OpenAI audit + publish |
| `perf` | `POST /api/perf-dashboards/upload` | Master + History → Perf boards |
| `sales` | `POST /api/sales-graph/upload` | Needs shaped Sales Graph JSON (or full publish payload). **Report cURLs are placeholders** in `automation/erp_upload.py` until you paste real URLs / secrets |

Repo secrets (unchanged): `ERP_USER`, `ERP_PASS`, `GMAIL_*`, `LEADLENS_USER`, `LEADLENS_PASS`.

Optional sales URL overrides: `SALES_LEADS_URL`, `SALES_VISITS_URL`, `SALES_BOOKED_URL` (or fill `REPORTS` in `erp_upload.py`). If `sales` is selected and URLs are empty, the job **fails clearly** so `bucket1`/`perf` can still run alone.

## API (kept)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `erp-sync/trigger` | Super User → `workflow_dispatch` (`jobs`, optional `dry_run`) |
| GET | `erp-sync/gha-status` | Latest runs, next schedules, last dispatch |
| GET | `erp-sync/status` | Audit progress (tokens/cost/elapsed) + api_uploads + GHA summary |
| POST | `erp-sync/continue` | Resume server audit (self-chain / optional cron) |
| POST | `erp-sync/publish` | Publish last server-audit results |
| POST | `audit/upload` | Terminal / GHA Bucket 1 |
| GET | `audit/status` | Progress including usage |
| POST | `audit/cancel` | Stop server audit |
| POST | `perf-dashboards/upload` | Terminal / GHA Performance |
| POST | `sales-graph/upload` | Terminal / GHA Sales Graph publish |

## Retired API (410)

`erp-sync/config`, `test-fetch`, `fetch-for-audit`, `latest-leads`, `run`, `daily`, `keepalive`, `ping`.

## Hostinger cron — remove after deploy

Remove these if still configured (they no longer ingest ERP data; cookie endpoints return 410):

- `*/1 * * * *` → `erp-sync/keepalive` (session keep-alive + 6 AM kickoff)
- `30 0 * * *` → `erp-sync/daily` (optional daily backup)

**Optional keep:** continue safety net for long server audits:

```bash
# every 10 minutes →  */10 * * * *
curl -sS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" -H "Content-Type: application/json" -d '{}' \
  "https://ai.gurupunvaanii.com/api/erp-sync/continue"
```

Self-chain is primary; this cron only helps if a handoff fails. Idle responses are harmless.

> Note: `continue` still accepts the cron bearer secret. Cookie/config UI is gone — if you already stored a cron secret, it remains in the DB until rotated via settings APIs or a future ops tool.

## Manual Excel uploads

Removed from the website (Bucket 1 Review, TeleCalling Performance, Sales Graph). Terminal multipart APIs above remain for GHA / automation.

## Related

- Deploy / promote: [HOSTINGER.md](./HOSTINGER.md)
- OpenAI key: TeleCallerAudit → Settings (server key for GHA/server audit)
