# Hostinger setup (LeadLens multi-page auth)

The `hostinger` Git branch is a flat copy of `web-app/` (including `api/`). Deploy that branch to the site document root for https://ai.gurupunvaanii.com/.

## One-time MySQL + install

1. In **hPanel → Databases**, create a MySQL database and user. Note host (often `localhost`), database name, username, and password.
2. On the server (File Manager or SSH), copy:
   - `api/config.example.php` → `api/config.local.php`
3. Edit `api/config.local.php`:
   - Set `db.host`, `db.name`, `db.user`, `db.pass`
   - Set `session.secret` to a long random string
4. Visit **https://ai.gurupunvaanii.com/api/install.php** once.
   - Creates tables and seeds Super User: username `super user`, password `12345` (bcrypt).
5. Log in at https://ai.gurupunvaanii.com/ and change the Super User password when prompted.
6. Set `app.install_locked` to `true` in `config.local.php` (or delete/rename `install.php`).

## Verify after sync

- `/api/` is present on the live tree (comes from `web-app/api/` via the hostinger sync workflow).
- `.htaccess` routes `/api/*` to `api/index.php` and blocks direct download of `config.local.php`.
- PHP and `mod_rewrite` are enabled (default on Hostinger shared hosting).

## Roles reminder

- **Super User**: all permissions, including Run console.
- **Admin**: users/roles/access requests; Run console **off** by default (enable in Roles).
- **TeleCaller**: own published Dashboard only (link user → exact Excel TeleCaller name).
