# Hostinger setup (LeadLens multi-page auth)

The `hostinger` Git branch is what Hostinger serves at https://ai.gurupunvaanii.com/.

- **Site root `/`** = production (frozen until you promote)
- **`/dev/`** = full copy of `web-app/` from the latest `main` push (HTML, JS, CSS, PHP API)

`/dev` is not linked from live home tiles. Open it by URL. A **Preview** banner and `robots.txt` `Disallow: /dev` keep it unlisted, not secret.

## Deploy flow

1. **Push to `main`** (or run this workflow without Promote). The **Sync hostinger deploy branch** GitHub Action rsyncs `web-app/` → `hostinger` branch `dev/` only. Production `/` is left unchanged.
2. Try the new UI at **https://ai.gurupunvaanii.com/dev** (sign in with a real account).
3. When ready, run the same GitHub Action with **Promote /dev to live** checked (`workflow_dispatch`). That copies `dev/` over the site root, **keeps** the `dev/` folder, and pushes `hostinger`. Production `/` updates; `/dev` stays as the next preview.

Do not replace the entire `hostinger` tree on a normal push.

## Staging notes (`/dev`)

- **Same MySQL as production.** UI/CSS previews are safe. Creating users, changing passwords, publishing dashboards, or running audits on `/dev` writes live data. Treat it as a UI preview against real accounts, not a disposable sandbox.
- **Config:** `api/config.local.php` is gitignored and lives on the server at production `api/config.local.php`. Staging PHP falls back to that file (`/dev/api/lib` → `../../../api/config.local.php`) so you do not need a second FTP upload.
- **Sessions:** `/dev` uses cookie `leadlens_session_dev` with path `/dev/`. Logging into preview does not log you into (or out of) production.

## One-time MySQL + install

**Critical:** `api/config.local.php` is **gitignored**. Git/Hostinger auto-deploy will **never** upload it. After every fresh deploy (or if login shows placeholder / Access denied for `your_database_user`), create or re-upload this file **directly on the live server** via hPanel File Manager or FTP. Local-only `config.local.php` does nothing for production.

1. In **hPanel → Databases → MySQL Databases**, create a database and user, then **Add user to database** with full privileges. Note host (usually `localhost`), database name, username, and password.
2. On the **live** site document root (File Manager or FTP), open `api/`:
   - Copy `config.example.php` → `config.local.php` (same folder).
   - Or New File → `config.local.php` and paste the example contents.
3. Edit **live** `api/config.local.php` (replace placeholders — do not leave `your_database_*`):
   - `db.host` → usually `localhost`
   - `db.name` → exact database name from hPanel
   - `db.user` → exact MySQL username from hPanel
   - `db.pass` → exact MySQL password from hPanel
   - `session.secret` → a long random string (not `change-me-to-a-long-random-string`)
4. Visit **https://ai.gurupunvaanii.com/api/install.php** once **after** DB credentials work.
   - Creates tables and seeds Super User: username `super user`, password `12345` (bcrypt).
5. Log in at https://ai.gurupunvaanii.com/ and change the Super User password when prompted.
6. Set `app.install_locked` to `true` in `config.local.php` (or delete/rename `install.php`).

### If login says Access denied / `your_database_user`

The API fell back to `config.example.php` because live `config.local.php` is missing or still has placeholders. Fix steps 2–3 on Hostinger, then re-run step 4.

## Verify after sync

- After a `main` push: `/dev/` matches latest `web-app/`; live `/` is unchanged.
- After promote: live `/` matches what you just previewed; `/dev/` is still present.
- Live `api/config.local.php` exists with real credentials (check File Manager; Git will not create it).
- `.htaccess` routes `/api/*` to `api/index.php` (and `/dev/api/*` via the copy under `dev/`) and blocks direct download of `config.local.php`.
- PHP and `mod_rewrite` are enabled (default on Hostinger shared hosting).

## Roles reminder

- **Super User**: all permissions, including Run console.
- **Admin**: users/roles/access requests; Run console **off** by default (enable in Roles).
- **TeleCaller**: own published Dashboard only (link user → exact Excel TeleCaller name).
