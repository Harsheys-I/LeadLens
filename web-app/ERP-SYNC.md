# ERP Sync (Hostinger `/dev` only)

**Primary path:** fetch ERP report (cURL + Cookie) → store raw payload under `api/storage/erp-sync/` → map leads → **hand off to Bucket 1 TeleCaller Audit** (same Start Audit / progress / Stop / Publish as Excel RAW).

Server-side OpenAI audit + cron remain optional/advanced (can hit Hostinger time limits).

UI and API are active only under **`/dev`**. Production site root `/` is unchanged until you promote.

## Super User setup (once)

1. Open **https://ai.gurupunvaanii.com/dev/TeleCallerAudit/** and sign in as Super User.
2. Open **ERP Sync** in the Bucket 1 nav (visible only on `/dev` for Super User).
3. Paste:
   - **Report URL** — the `getFunction.do` (or JSON report) URL that works in cURL
   - **Cookie header** — full `Cookie:` value from a working authenticated cURL (session lasts until ERP rejects it)
   - Optional **Extra headers** as JSON (do not put Cookie here)
4. Click **Save**, then **Test fetch**.
5. Check preview: **keys**, **row count**, and **mapped columns**. Adjust the field map aliases to match ERP keys, Save again, Test fetch until Mobile + Project map and lead count looks right.
6. Click **Fetch & send to Audit** — stores full raw JSON + mapped leads, then opens Bucket 1 with leads staged like a workbook upload.
7. Click **Start Audit →** and use the normal progress bar / Stop. After review, **Publish** from Audit as usual.

### Cookie refresh

When Test fetch / Fetch shows **session expired**:

1. Log into ERP in a browser and copy a fresh Cookie from DevTools or a new cURL.
2. Paste into **Cookie header** → **Save** → **Test fetch**.
3. No Playwright / OTP automation — refresh is always manual.

## API (Super User session)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `erp-sync/fetch-for-audit` | Fetch once, store raw + `latest-leads.json` |
| GET | `erp-sync/latest-leads` | Download mapped leads for Audit UI |
| GET | `erp-sync/latest-leads?meta=1` | Counts only |
| POST | `erp-sync/test-fetch` | Preview without Audit handoff |
| POST | `erp-sync/run` | Optional advanced server OpenAI loop |
| POST | `erp-sync/publish` | Publish last **server-audit** results |

## Hostinger cron (optional / advanced)

In **hPanel → Advanced · Cron Jobs**, add a job that hits **only** the `/dev` API:

```bash
curl -sS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" -H "Content-Type: application/json" -d '{}' "https://ai.gurupunvaanii.com/dev/api/erp-sync/run"
```

Notes:

- Replace `YOUR_CRON_SECRET` with the secret saved in ERP Sync.
- Cron is ignored while **Enable cron** is off.
- Prefer the main Audit UI for large fetches; cron server audit may only process a batch per invocation.
- Alternative header if `Authorization` is stripped by the proxy: `-H "X-ERP-Sync-Secret: YOUR_CRON_SECRET"`.

## Risk controls

- Cookies are encrypted at rest (`session.secret` / `app.secrets_key`); never logged.
- Auto-publish defaults **off** on the advanced server path.
- All `erp-sync/*` routes return **404** outside `/dev`.
- Raw payloads + `latest-leads.json` land under `api/storage/erp-sync/` (blocked by `.htaccess`, gitignored).

## Related

- Deploy / promote flow: [HOSTINGER.md](./HOSTINGER.md)
- OpenAI key: TeleCallerAudit → Settings (client key for main Audit; server key for advanced path)
