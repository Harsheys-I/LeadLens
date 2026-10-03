"""Log into Strategic ERP, download the Bucket 1 and Performance reports, upload them to LeadLens.

Environment:
  ERP_USER, ERP_PASS                 Strategic ERP login (company is ERP_COMPANY, default gurupunvaanii)
  GMAIL_USER, GMAIL_APP_PASSWORD     Inbox that receives the ERP OTP mail (read over IMAP)
  LEADLENS_USER, LEADLENS_PASS       LeadLens account with Bucket 1 + Upload Dashboard + Upload Performance access
  JOBS                               Comma list of bucket1, perf (default both)
  DRY_RUN=1                          Download and check the reports but do not upload
  HEADLESS=0                         Show the browser window
  OTP_FILE                           Optional path; a code written there is used if Gmail has none (local runs)
  OTP_WAIT_SECONDS                   How long to wait for each OTP (default 120)
"""
import imaplib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from email import message_from_bytes
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

ERP_BASE = "https://24.strategicerpcloud.com/strategicerp/"
LEADLENS = os.environ.get("LEADLENS_API", "https://ai.gurupunvaanii.com/api").rstrip("/")
OUT = Path(os.environ.get("OUT_DIR", "erp-out"))
SHOTS = Path(os.environ.get("SHOT_DIR", "screenshots"))
OTP_FROM = os.environ.get("OTP_FROM", "support@gurupunvaanii.com")

REPORTS = {
    "bucket1": ERP_BASE + "getFunction.do?actn=getreportjsondata&reportid=10000063"
    "&nameofcompany=%25&projectname=%25&startdate=01/04/2026&enddate=31/03/2027",
    "master": ERP_BASE + "getFunction.do?actn=getreportjsondata&reportid=10000022"
    "&nameofcompany=%25&projectname=%25&startdate=01%2F04%2F2026&enddate=31%2F03%2F2027"
    "&loadnewdata=false&customfilters=",
    "history": ERP_BASE + "getFunction.do?actn=getreportjsondata&reportid=10000026"
    "&nameofcompany=%25&projectname=%25&startdate=01/04/2026&enddate=31/03/2027",
}


# Master is ~30 MB with every column; LeadLens rejects uploads over 25 MB and reads only these.
KEEP_CODES = {
    "master": ["A2", "A3", "A5", "A6", "A7", "A9", "A10"],
}


class Fail(Exception):
    pass


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if not value:
        raise Fail(f"Missing environment variable {name}")
    return value


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}Z] {msg}", flush=True)


def mail_body(msg) -> str:
    parts = msg.walk() if msg.is_multipart() else [msg]
    text, html = "", ""
    for part in parts:
        if part.get_filename():
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        decoded = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        if part.get_content_type() == "text/plain":
            text += decoded
        elif part.get_content_type() == "text/html":
            html += re.sub(r"<[^>]+>", " ", decoded)
    return text or html


def otp_from_text(body: str) -> str | None:
    near = re.search(r"(?i)(?:otp|code|password)\D{0,60}?\b(\d{4,8})\b", body)
    if near:
        return near.group(1)
    any_code = re.search(r"\b(\d{4})\b", body)
    return any_code.group(1) if any_code else None


def read_gmail_otp(after: datetime, skip: set[str]) -> str | None:
    user, password = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    if not user or not password:
        return None
    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(user, password.replace(" ", ""))
    try:
        mail.select("INBOX")
        _, data = mail.search(None, "FROM", f'"{OTP_FROM}"')
        for msg_id in reversed(data[0].split()[-10:]):
            _, fetched = mail.fetch(msg_id, "(RFC822)")
            msg = message_from_bytes(fetched[0][1])
            when = parsedate_to_datetime(msg.get("Date"))
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            if when < after:
                continue
            code = otp_from_text(mail_body(msg))
            if code and code not in skip:
                return code
        return None
    finally:
        mail.logout()


def read_file_otp(skip: set[str]) -> str | None:
    path = os.environ.get("OTP_FILE")
    if not path or not Path(path).exists():
        return None
    code = Path(path).read_text(encoding="utf-8").strip()
    return code if re.fullmatch(r"\d{4,8}", code) and code not in skip else None


def wait_for_otp(after: datetime, skip: set[str], seconds: int) -> str:
    if not os.environ.get("GMAIL_USER") or not os.environ.get("GMAIL_APP_PASSWORD"):
        if not os.environ.get("OTP_FILE"):
            raise Fail("ERP asked for an OTP but the Gmail app password is not configured")
        log("Gmail is not configured; waiting for OTP_FILE only")
    deadline = time.time() + seconds
    while time.time() < deadline:
        code = read_gmail_otp(after, skip) or read_file_otp(skip)
        if code:
            return code
        time.sleep(15)
    raise Fail(f"No OTP arrived within {seconds // 60} minutes")


def shot(page, name: str) -> None:
    try:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"))
    except PlaywrightError:
        pass


def wait_after_password(page, timeout_s: int = 60) -> str:
    """Return "otp" when the 4-box OTP screen shows, "home" once the login form is gone."""
    deadline = time.time() + timeout_s
    settled_since = None
    while time.time() < deadline:
        if page.locator("#otp1").is_visible():
            return "otp"
        if "home.do" in page.url:
            return "home"
        if page.get_by_text(re.compile(r"invalid|incorrect", re.I)).first.is_visible():
            raise Fail("ERP rejected the username or password")
        # login.do can render the home screen without redirecting; only trust it once it stays OTP-free.
        if "login.do" in page.url and not page.locator("#passwd").is_visible():
            settled_since = settled_since or time.time()
            if time.time() - settled_since >= 10:
                return "home"
        else:
            settled_since = None
        time.sleep(1)
    raise Fail("ERP did not show the OTP screen or the home screen after login")


def enter_otp(page, code: str) -> bool:
    """Fill the four OTP boxes and click Verify; True once ERP has left the OTP and login screens."""
    for i, digit in enumerate(code[:4], start=1):
        page.fill(f"#otp{i}", digit)
    # ERP's form swallows Enter; verifyOTP() on the #verifyotp link reads the boxes and submits.
    page.click("#verifyotp")
    deadline = time.time() + 60
    clear_since = None
    while time.time() < deadline:
        time.sleep(1)
        if "home.do" in page.url:
            return True
        if page.locator("#companyName").is_visible() or page.locator("#passwd").is_visible():
            raise Fail("ERP went back to the login page after the OTP")
        if page.locator("#otp1").is_visible():
            if "otplogin.do" in page.url:
                return False
            clear_since = None
            continue
        clear_since = clear_since or time.time()
        if time.time() - clear_since >= 5:
            return True
    shot(page, "otp-after-verify")
    return False


def login(page) -> None:
    page.goto(ERP_BASE, wait_until="domcontentloaded", timeout=90_000)
    page.wait_for_selector("#companyName", state="visible", timeout=60_000)
    company = env("ERP_COMPANY", "gurupunvaanii")
    if page.input_value("#companyName").strip().lower() != company:
        page.fill("#companyName", company)
    page.click("#next_button")
    page.wait_for_selector("#loginNameTemp", state="visible", timeout=30_000)
    page.click("#loginNameTemp")
    page.keyboard.type(env("ERP_USER"))
    page.click("#passwd")
    page.keyboard.type(env("ERP_PASS"))
    # Enter races a plain-text form submit against ERP's hashed login(); the Login button runs
    # login() first, which needs the forge SHA-256 library from the CDN.
    page.wait_for_function("() => typeof forge !== 'undefined' && typeof login === 'function'",
                           timeout=60_000)
    page.evaluate("add_login_name(document.getElementById('loginNameTemp'))")
    pressed_at = datetime.now(timezone.utc)
    page.click("input#button[value='Login']")
    log("Submitted ERP password")

    if wait_after_password(page) == "home":
        log(f"No OTP requested ({page.url})")
        shot(page, "after-login")
        return

    if page.get_by_text("Mail Sending Failed", exact=False).first.is_visible():
        log("Warning: ERP reported 'Mail Sending Failed' for the OTP email")
    shot(page, "otp-screen")
    log("OTP requested; polling for the code")
    used: set[str] = set()
    for attempt in (1, 2):
        code = wait_for_otp(pressed_at, used, seconds=int(os.environ.get("OTP_WAIT_SECONDS", "120")))
        used.add(code)
        log(f"Entering OTP (attempt {attempt})")
        if enter_otp(page, code):
            log("Logged in")
            return
        log("OTP rejected")
    raise Fail("OTP rejected twice")


def fetch_report(page, name: str) -> Path:
    resp = page.context.request.get(REPORTS[name], timeout=300_000)
    body = resp.text()
    if "Session expired" in body:
        raise Fail(f"{name}: ERP says Session expired")
    if not body.lstrip().startswith(("[", "{")):
        raise Fail(f"{name}: response is not JSON (HTTP {resp.status}): {body[:200]!r}")
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"erp-{name}.json"
    keep = KEEP_CODES.get(name)
    if keep:
        rows = json.loads(body)
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise Fail(f"{name}: expected a JSON list of rows")
        missing = [code for code in keep if code not in rows[0]]
        if missing:
            raise Fail(f"{name}: report layout changed, missing {', '.join(missing)}")
        body = json.dumps([{code: row.get(code, "") for code in keep} for row in rows],
                          ensure_ascii=False, separators=(",", ":"))
        log(f"{name}: {len(rows):,} rows")
    path.write_text(body, encoding="utf-8")
    log(f"{name}: {path.stat().st_size:,} bytes")
    return path


def upload(endpoint: str, files: dict[str, Path], extra: dict[str, str], ok: int, busy_wait: int) -> dict:
    data = {"username": env("LEADLENS_USER"), "password": env("LEADLENS_PASS"), **extra}
    for attempt in (1, 2):
        handles = {field: (p.name, p.open("rb"), "application/json") for field, p in files.items()}
        try:
            resp = requests.post(f"{LEADLENS}/{endpoint}", data=data, files=handles, timeout=600)
        finally:
            for _, fh, _ in handles.values():
                fh.close()
        log(f"{endpoint}: HTTP {resp.status_code}")
        if resp.status_code == ok:
            return resp.json()
        if attempt == 2 or resp.status_code in (400, 401, 403, 413):
            raise Fail(f"{endpoint} failed: HTTP {resp.status_code} {resp.text[:1000]}")
        wait = busy_wait if resp.status_code == 409 else 20
        log(f"{endpoint}: retrying in {wait}s")
        time.sleep(wait)
    raise Fail(f"{endpoint} failed")


def main() -> int:
    jobs = {j.strip() for j in os.environ.get("JOBS", "bucket1,perf").split(",") if j.strip()}
    unknown = jobs - {"bucket1", "perf"}
    if unknown or not jobs:
        raise Fail(f"JOBS must be bucket1 and/or perf, got {sorted(jobs)}")
    dry_run = os.environ.get("DRY_RUN") == "1"

    files: dict[str, Path] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=os.environ.get("HEADLESS", "1") != "0")
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        try:
            login(page)
            if "bucket1" in jobs:
                files["bucket1"] = fetch_report(page, "bucket1")
            if "perf" in jobs:
                files["master"] = fetch_report(page, "master")
                files["history"] = fetch_report(page, "history")
        except (Fail, PlaywrightError):
            shot(page, "failure")
            raise
        finally:
            browser.close()

    if dry_run:
        log("DRY_RUN=1: reports downloaded, skipping uploads")
        return 0

    if "bucket1" in jobs:
        r = upload("audit/upload", {"file": files["bucket1"]},
                   {"batch_size": "20", "concurrency": "2"}, ok=202, busy_wait=180)
        log(f"Bucket 1 started: lead_count={r.get('lead_count')} batch_size={r.get('batch_size')} "
            f"concurrency={r.get('concurrency')}")
    if "perf" in jobs:
        r = upload("perf-dashboards/upload", {"master": files["master"], "history": files["history"]},
                   {}, ok=201, busy_wait=60)
        log(f"Performance published: telecallers={r.get('telecaller_count')} "
            f"{r.get('date_min')}..{r.get('date_max')} ({r.get('report_days')} days)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fail as exc:
        log(f"FAILED: {exc}")
        sys.exit(1)
    except PlaywrightError as exc:
        log(f"FAILED: browser error: {exc}")
        sys.exit(1)
