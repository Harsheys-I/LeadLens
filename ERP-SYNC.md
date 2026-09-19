# ERP Sync (production + `/dev`)

**Primary path:** fetch ERP report (cURL + Cookie) → store raw payload under `api/storage/erp-sync/` → map leads → **hand off to Bucket 1 TeleCaller Audit** (same Start Audit / progress / Stop / Publish as Excel RAW).

Server-side OpenAI audit + cron remain optional/advanced (can hit Hostinger time limits).

UI and API are available on **production `/`** and **`/dev`**, gated to **Super User** (plus cron bearer for keep-alive / scheduled jobs).

## Super User setup (once)

1. Open **https://ai.gurupunvaanii.com/TeleCallerAudit/** (or `/dev/TeleCallerAudit/` for staging) and sign in as Super User.
2. Open **ERP Sync** in the Bucket 1 nav (Super User only; visible as soon as auth resolves).
3. Paste:
   - **Report URL** — the `getFunction.do` (or JSON report) URL that works in cURL
   - **Cookie header** — full `Cookie:` value from a working authenticated cURL (session lasts until ERP rejects it)
   - Optional **Extra headers** as JSON (do not put Cookie here)
4. Click **Save**, then **Test fetch**.
5. Check preview: **keys**, **row count**, and **mapped columns**. Adjust the field map aliases to match ERP keys, Save again, Test fetch until Mobile + Project map and lead count looks right.
6. Click **Fetch & send to Audit** — stores full raw JSON + mapped leads, then opens Bucket 1 with leads staged like a workbook upload.
7. Click **Start Audit →** and use the normal progress bar / Stop. After review, **Publish** from Audit as usual.

### Cookie refresh

When Test fetch / Fetch / keep-alive shows **session expired**:

1. Log into ERP in a browser and copy a fresh Cookie from DevTools or a new cURL.
2. Paste into **Cookie header** → **Save** → **Test fetch** (or **Ping keep-alive now**).
3. No Playwright / OTP automation — refresh is always manual.

## Session keep-alive (experiment)

Periodically HTTP-request the ERP with the saved Cookie so **idle** sessions may last longer. This does **not** help if the ERP uses an absolute session TTL.

1. In ERP Sync → **4 · Cron & advanced**, check **Enable session keep-alive**.
2. Ensure a **Cron bearer secret** is set (same secret as other ERP cron jobs).
3. Optional: set **Keep-alive URL** to a lighter same-host page; leave blank to use the Report URL.
4. Save, then optionally click **Ping keep-alive now** to verify.
5. Add a Hostinger cron job every 30 minutes (see below).

Last keep-alive result (`ok` / `session_expired` / `error` + timestamp) appears in the status area. Cookies are never logged.

## API (Super User session)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `erp-sync/fetch-for-audit` | Fetch once, store raw + `latest-leads.json` |
| GET | `erp-sync/latest-leads` | Download mapped leads for Audit UI |
| GET | `erp-sync/latest-leads?meta=1` | Counts only |
| POST | `erp-sync/test-fetch` | Preview without Audit handoff |
| POST | `erp-sync/keepalive` | Session keep-alive ping (also `erp-sync/ping`) |
| POST | `erp-sync/run` | Optional advanced server OpenAI loop |
| POST | `erp-sync/publish` | Publish last **server-audit** results |

## Hostinger cron — session keep-alive (every 30 minutes)

In **hPanel → Advanced · Cron Jobs**, schedule `*/30 * * * *` (or the hPanel UI equivalent “every 30 minutes”) and run:

```bash
# every 30 minutes (production)
curl -sS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://ai.gurupunvaanii.com/api/erp-sync/keepalive"
```

Staging equivalent: use `https://ai.gurupunvaanii.com/dev/api/erp-sync/keepalive`.

Notes:

- Replace `YOUR_CRON_SECRET` with the secret saved in ERP Sync.
- Cron is ignored while **Enable session keep-alive** is off.
- Only helps if the ERP renews idle sessions; absolute TTL sessions still expire.
- Alternative header if `Authorization` is stripped by the proxy: `-H "X-ERP-Sync-Secret: YOUR_CRON_SECRET"`.

## Hostinger cron (optional / advanced server audit)

```bash
curl -sS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" -H "Content-Type: application/json" -d '{}' "https://ai.gurupunvaanii.com/api/erp-sync/run"
```

Notes:

- Cron is ignored while **Enable cron** is off.
- Prefer the main Audit UI for large fetches; cron server audit may only process a batch per invocation.

## Risk controls

- Cookies are encrypted at rest (`session.secret` / `app.secrets_key`); never logged.
- Keep-alive samples a small response body only — it does not store payloads or run Audit.
- Auto-publish defaults **off** on the advanced server path.
- `erp-sync/*` requires Super User session or a valid cron bearer secret.
- Raw payloads + `latest-leads.json` land under `api/storage/erp-sync/` (blocked by `.htaccess`, gitignored).

## Related

- Deploy / promote flow: [HOSTINGER.md](./HOSTINGER.md)
- OpenAI key: TeleCallerAudit → Settings (client key for main Audit; server key for advanced path)
