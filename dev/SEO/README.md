# SEO module (GPP AI)

Guru Punvaanii SEO Audit & Command Center, integrated as a LeadLens workspace module.

## Open

Sign in → home tile **SEO** (requires `module.seo` permission), or go to `/SEO/`.

## What’s included

- Live URL / sitemap scanner UI
- Technical, on-page, schema, off-page, CWV, traffic, and 30-day roadmap views
- Bundled audit dataset (`data.js`) plus GA4/GSC JSON fallbacks
- Theme aligned with GPP AI (green shell, DM Sans / Fraunces, shared `leadlens.theme`)

## Live APIs (optional)

Static dashboard works without a Python backend. Live crawl / PageSpeed / fresh GA4·GSC sync need the Python server from this folder:

```bash
cd web-app/SEO
pip install -r requirements.txt
python server.py
```

Or deploy `api/*.py` with the included `vercel.json`. On Hostinger, prefer the bundled JSON until a Python endpoint is wired separately from the PHP `/api/`.

## Auth

Gated by LeadLens session + `module.seo`. Assign the permission under **Admin → Roles**.
