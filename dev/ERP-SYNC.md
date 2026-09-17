# ERP Sync (Hostinger `/dev` only)

Automated pipeline: **fetch ERP report (cURL + Cookie) → map rows → server OpenAI audit → optional TeleCaller dashboard publish**.

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
6. Click **Run sync** (uses the server OpenAI key from Settings). Leave **Auto-publish** unchecked for the first dry-run.
7. Review status / sample results. When satisfied, either **Publish last results** or enable **Auto-publish dashboards after audit**.
8. Set a long random **Cron bearer secret**, Save, then enable **Enable cron / scheduled runs**.

### Cookie refresh

When Test fetch / Run shows **session expired**:

1. Log into ERP in a browser and copy a fresh Cookie from DevTools or a new cURL.
2. Paste into **Cookie header** → **Save** → **Test fetch**.
3. No Playwright / OTP automation — refresh is always manual.

## Hostinger cron

In **hPanel → Advanced → Cron Jobs**, add a daily (or hourly) job that hits **only** the `/dev` API:

```bash
curl -sS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" -H "Content-Type: application/json" -d '{}' "https://ai.gurupunvaanii.com/dev/api/erp-sync/run"
```

Notes:

- Replace `YOUR_CRON_SECRET` with the secret saved in ERP Sync.
- Cron is ignored while **Enable cron** is off.
- If a run audits only part of the leads (Hostinger time limits), the same cron URL resumes the job on the next invocation until complete.
- Alternative header if `Authorization` is stripped by the proxy: `-H "X-ERP-Sync-Secret: YOUR_CRON_SECRET"`.

## Risk controls

- Cookies are encrypted at rest (`session.secret` / `app.secrets_key`); never logged.
- Auto-publish defaults **off** — published boards use the **same MySQL** as production TeleCaller dashboards.
- All `erp-sync/*` routes return **404** outside `/dev`.
- Raw payloads land under `api/storage/erp-sync/` (blocked by `.htaccess`, gitignored binaries).

## Related

- Deploy / promote flow: [HOSTINGER.md](./HOSTINGER.md)
- OpenAI server key: TeleCallerAudit → Settings (Super User)
