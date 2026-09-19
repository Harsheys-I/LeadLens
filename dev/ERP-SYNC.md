# ERP Sync (production + `/dev`)

**Two paths:**

1. **Manual (primary for interactive work):** fetch ERP report → store raw payload → map leads → **hand off to Bucket 1 TeleCaller Audit** (browser Start Audit / progress / Stop / Publish).
2. **Unattended daily (cron):** at **6:00 AM IST** the server fetches with the saved Cookie/URL, runs **server-side OpenAI audit** in chunks, and **auto-publishes TeleCaller dashboards** when the job finishes. No browser tab required.

UI and API are available on **production `/`** and **`/dev`**, gated to **Super User** (plus cron bearer for keep-alive / daily / continue).

## Super User setup (once)

1. Open **https://ai.gurupunvaanii.com/TeleCallerAudit/** (or `/dev/TeleCallerAudit/` for staging) and sign in as Super User.
2. Open **ERP Sync** in the Bucket 1 nav (Super User only).
3. Paste:
   - **Report URL** — the `getFunction.do` (or JSON report) URL that works in cURL
   - **Cookie header** — full `Cookie:` value from a working authenticated cURL
   - Optional **Extra headers** as JSON (do not put Cookie here)
4. Click **Save**, then **Test fetch**.
5. Check preview: **keys**, **row count**, and **mapped columns**. Adjust the field map until Mobile + Project map correctly.
6. For interactive audits: **Fetch & send to Audit** → Bucket 1 **Start Audit**.
7. For unattended mornings: section **4 · Daily automation & cron** (below).

### Cookie refresh

When Test fetch / Fetch / keep-alive / daily run shows **session expired**:

1. Log into ERP in a browser and copy a fresh Cookie from DevTools or a new cURL.
2. Paste into **Cookie header** → **Save** → **Test fetch** (or **Ping keep-alive now**).
3. No Playwright / OTP automation — refresh is always manual.

**Important for daily automation:** if the Cookie is dead at 6 AM, the daily job **fails clearly**, does **not** publish, and writes status for Super User. Keep-alive every 30 minutes is strongly recommended so idle sessions last overnight.

## Daily auto pipeline (recommended for production)

1. In ERP Sync → **4 · Daily automation & cron**:
   - Check **Enable daily auto pipeline (6:00 AM IST)**
   - Leave **Cron auto-publish dashboards when daily audit completes** **on** (default) so TeleCaller boards upload when audit finishes
   - Check **Enable session keep-alive** and set a **Cron bearer secret**
2. Save settings.
3. Add Hostinger cron jobs (see below): daily kickoff + continue + keep-alive.
4. Watch **Last scheduled run** on the ERP Sync panel after 6 AM (or after a manual Super User `POST …/daily`).

### Resume / Hostinger time limits

Each PHP invocation audits a limited batch (`Max leads / invocation`, default 40). Large reports need **continue**:

- **Daily cron (6:00 AM IST)** → `POST /api/erp-sync/daily` — always starts a **fresh fetch** and begins audit.
- **Continue cron (every 10 minutes)** → `POST /api/erp-sync/continue` — resumes only if a job is `auditing` (`needs_continue`); **no-ops when idle**.

## API (Super User session or cron bearer where noted)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `erp-sync/fetch-for-audit` | Fetch once, store raw + `latest-leads.json` (manual handoff) |
| GET | `erp-sync/latest-leads` | Download mapped leads for Audit UI |
| GET | `erp-sync/latest-leads?meta=1` | Counts only |
| POST | `erp-sync/test-fetch` | Preview without Audit handoff |
| POST | `erp-sync/keepalive` | Session keep-alive ping (also `erp-sync/ping`) |
| POST | `erp-sync/daily` | **Cron daily:** fetch + server AI audit + cron auto-publish |
| POST | `erp-sync/continue` | **Cron continue:** resume audit if in progress; idle no-op |
| POST | `erp-sync/run` | Advanced/manual server OpenAI loop (uses `auto_publish`, not cron flag) |
| POST | `erp-sync/publish` | Publish last **server-audit** results |
| GET | `erp-sync/status` | Config + last_status + last_daily_status + job progress |

## Timezone: 6:00 AM India Standard Time

India is **UTC+5:30** (no DST).

| Local (IST) | Cron expression if Hostinger uses **UTC** | Cron if Hostinger is set to **IST / Asia/Kolkata** |
|-------------|-------------------------------------------|-----------------------------------------------------|
| 6:00 AM IST | `30 0 * * *` (00:30 UTC) | `0 6 * * *` |

Confirm the timezone shown in **hPanel → Advanced · Cron Jobs**. Most Hostinger shared plans schedule in **UTC** — use **`30 0 * * *`** for 6:00 AM IST.

## Hostinger cron — daily kickoff (6:00 AM IST)

```bash
# 6:00 AM IST = 00:30 UTC  →  schedule: 30 0 * * *  (when cron is UTC)
curl -sS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" -H "Content-Type: application/json" -d '{}' \
  "https://ai.gurupunvaanii.com/api/erp-sync/daily"
```

## Hostinger cron — continue incomplete audits (every 10 minutes)

```bash
# every 10 minutes →  */10 * * * *
curl -sS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" -H "Content-Type: application/json" -d '{}' \
  "https://ai.gurupunvaanii.com/api/erp-sync/continue"
```

Idle response is harmless (`idle: true`). Only runs audit work when a job needs continue.

## Hostinger cron — session keep-alive (every 30 minutes)

```bash
# every 30 minutes →  */30 * * * *
curl -sS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://ai.gurupunvaanii.com/api/erp-sync/keepalive"
```

Staging: replace `/api/` with `/dev/api/`.

Notes:

- Replace `YOUR_CRON_SECRET` with the secret saved in ERP Sync.
- Daily / continue are ignored while **Enable daily auto pipeline** is off.
- Keep-alive is ignored while **Enable session keep-alive** is off.
- Alternative header if `Authorization` is stripped: `-H "X-ERP-Sync-Secret: YOUR_CRON_SECRET"`.
- Cookies are never logged.

## Risk controls

- Cookies are encrypted at rest (`session.secret` / `app.secrets_key`); never logged.
- Keep-alive samples a small response body only — it does not store payloads or run Audit.
- **Cron auto-publish** defaults **on** for the daily/continue path; manual **Auto-publish after server audit** stays separate (defaults off).
- Session expired at fetch → clear error status, **no publish**.
- `erp-sync/*` requires Super User session or a valid cron bearer secret.
- Raw payloads + `latest-leads.json` land under `api/storage/erp-sync/` (blocked by `.htaccess`, gitignored).
- Manual **Fetch & send to Audit** is unchanged and still preferred for interactive review.

## Related

- Deploy / promote flow: [HOSTINGER.md](./HOSTINGER.md)
- OpenAI key: TeleCallerAudit → Settings (client key for main Audit; server key for daily/server path)
