"""Log into Strategic ERP, download reports, and upload them to LeadLens.

Environment:
  ERP_USER, ERP_PASS                 Strategic ERP login (company is ERP_COMPANY, default gurupunvaanii)
  GMAIL_USER, GMAIL_APP_PASSWORD     Inbox that receives the ERP OTP mail (read over IMAP)
  LEADLENS_USER, LEADLENS_PASS       LeadLens account with Bucket 1, Performance, and Sales Graph upload access
  JOBS                               Comma list of bucket1, perf, sales (default bucket1,sales)
  SALES_LEADS_URL                    Optional override for Sales Graph Leads getreportjsondata URL
  SALES_VISITS_URL                   Optional override for Sales Graph Visits getreportjsondata URL
  SALES_BOOKED_URL                   Optional override for Sales Graph Booked getreportjsondata URL
  DRY_RUN=1                          Download and check the reports but do not upload
  HEADLESS=0                         Show the browser window
  OTP_FILE                           Optional path; a code written there is used if Gmail has none (local runs)
  OTP_WAIT_SECONDS                   How long to wait for each OTP (default 120)
"""
import base64
import hashlib
import imaplib
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
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
AUDIT_BATCH = 20
AUDIT_PARALLEL = 4
COST_CAP_INR = 20.0
COST_STOP_MESSAGE = "Stopped: estimated cost exceeded Rs 20"
AUDIT_JS = Path(__file__).resolve().parents[1] / "web-app" / "audit.js"
CHECKPOINT = OUT / "bucket1-audit-checkpoint.json"

AI_ALLOWED = {
    "Lead Status Not Aligned With Comments",
    "Customer Requirement Empty",
    "Incorrect Customer Requirement",
    "Customer Comment Quality Not Appropriate",
}
LOCAL_OWNED = {
    "Follow-up Missed",
    "Analysis Parameter Empty",
    "Customer Location Empty",
    "Estimate Budget Empty",
    "Customer Requirement Empty",
}
CONNECTED_ONLY = {
    "Customer Location Empty",
    "Customer Requirement Empty",
    "Estimate Budget Empty",
    "Incorrect Customer Requirement",
    "Customer Comment Quality Not Appropriate",
}
ERROR_TYPES = [
    "Lead Status Not Aligned With Comments",
    "Follow-up Missed",
    "Estimate Budget Empty",
    "Customer Requirement Empty",
    "Customer Location Empty",
    "Analysis Parameter Empty",
    "Incorrect Customer Requirement",
    "Customer Comment Quality Not Appropriate",
]
HIGH_SEVERITY = {
    "Follow-up Missed",
    "Customer Requirement Empty",
    "Customer Comment Quality Not Appropriate",
}
USER_AUDIT_NOTE = (
    "Echo each id. c=full history — judge Lead Status with STATUS Rules 1–5 "
    "(pure RNR / 5+ trailing RNR → Cold aligned; 1–4 RNR after interest → Warm; "
    "positive no-visit → Hot; Prospect needs last-comment site visit). "
    'Put mismatches in e as "Lead Status Not Aligned With Comments"; freeform Error: lines are ignored. '
    "le=local errors — explain in o/r, never copy into e. Judge non-blank rq empty-vs-wrong when k=Yes; "
    "comment quality + q; buying intent. Never emit Follow-up Missed, Budget/Location/Parameter Empty, or any TAT label. "
    "o (18-28 words): quote facts from c only. r (20-40 words): only coach status changes when that label is in e; "
    "NEVER recommend Status→Lost (Cold is the floor); Cold+close on ACTIVE NI; never Cold→Lost for RNRs alone under Rules 1–2; "
    'never "set a follow-up" when n is set; for overdue n say call/proceed now.'
)
RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["a"],
    "properties": {
        "a": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "q", "e", "i", "o", "r"],
                "properties": {
                    "id": {"type": "string"},
                    "q": {"type": "integer", "minimum": 0, "maximum": 10},
                    "e": {"type": "array", "items": {"type": "string"}},
                    "i": {"type": "integer", "enum": [0, 1]},
                    "o": {"type": "string"},
                    "r": {"type": "string"},
                },
            },
        }
    },
}

REPORTS = {
    "bucket1": ERP_BASE + "getFunction.do?actn=getreportjsondata&reportid=10000063"
    "&nameofcompany=%25&projectname=%25&startdate=01/04/2026&enddate=31/03/2027",
    "master": ERP_BASE + "getFunction.do?actn=getreportjsondata&reportid=10000022"
    "&nameofcompany=%25&projectname=%25&startdate=01%2F04%2F2026&enddate=31%2F03%2F2027"
    "&loadnewdata=false&customfilters=",
    "history": ERP_BASE + "getFunction.do?actn=getreportjsondata&reportid=10000026"
    "&nameofcompany=%25&projectname=%25&startdate=01/04/2026&enddate=31/03/2027",
    # Paste real Strategic ERP getreportjsondata cURLs here (or set SALES_*_URL env vars).
    "sales_leads": "",
    "sales_visits": "",
    "sales_booked": "",
}

SALES_REPORT_KEYS = ("sales_leads", "sales_visits", "sales_booked")
SALES_URL_ENV = {
    "sales_leads": "SALES_LEADS_URL",
    "sales_visits": "SALES_VISITS_URL",
    "sales_booked": "SALES_BOOKED_URL",
}


# Master is ~30 MB with every column; LeadLens rejects uploads over 25 MB and reads only these.
KEEP_CODES = {
    "master": ["A2", "A3", "A5", "A6", "A7", "A9", "A10"],
}


class Fail(Exception):
    pass


class CostCap(Fail):
    """Bucket 1 hit the rupee cap. Checkpoint is kept; dashboards were not published."""


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


def sales_report_url(name: str) -> str:
    if name not in SALES_URL_ENV:
        return (REPORTS.get(name) or "").strip()
    env_val = (os.environ.get(SALES_URL_ENV[name]) or "").strip()
    if env_val:
        return env_val
    return (REPORTS.get(name) or "").strip()


def require_sales_report_urls() -> None:
    missing = [name for name in SALES_REPORT_KEYS if not sales_report_url(name)]
    if missing:
        raise Fail(
            "sales job selected but Sales Graph ERP report URLs are not configured — "
            "paste real getreportjsondata cURLs into REPORTS "
            f"({', '.join(missing)}) or set SALES_LEADS_URL / SALES_VISITS_URL / SALES_BOOKED_URL"
        )


def fetch_report(page, name: str, url: str | None = None) -> Path:
    report_url = (url or REPORTS.get(name) or "").strip()
    if not report_url:
        raise Fail(f"{name}: report URL is not configured")
    resp = page.context.request.get(report_url, timeout=300_000)
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


def _leadlens_session() -> requests.Session:
    session = requests.Session()
    user, password = env("LEADLENS_USER"), env("LEADLENS_PASS")
    resp = session.post(
        f"{LEADLENS}/auth/login",
        json={"username": user, "password": password},
        timeout=60,
    )
    if resp.status_code >= 400:
        raise Fail(f"auth/login failed: HTTP {resp.status_code} {resp.text[:500]}")
    session.auth = (user, password)
    # Re-prove the password on every API call. Cookie-only browser sessions stay behind
    # must_change_password; this header is what the API accepts when Authorization is stripped.
    session.headers["X-LeadLens-Script-Auth"] = base64.b64encode(f"{user}:{password}".encode()).decode()
    return session


def _auth_params() -> dict[str, str]:
    return {"username": env("LEADLENS_USER"), "password": env("LEADLENS_PASS")}


def _read_audit_js_const(name: str) -> str:
    text = AUDIT_JS.read_text(encoding="utf-8")
    marker = f"const {name} = `"
    start = text.find(marker)
    if start < 0:
        raise Fail(f"Could not find {name} in {AUDIT_JS}")
    start += len(marker)
    end = text.find("`", start)
    if end < 0:
        raise Fail(f"Could not close {name} in {AUDIT_JS}")
    return text[start:end]


def _app_version() -> str:
    text = AUDIT_JS.read_text(encoding="utf-8")
    match = re.search(r'export const APP_VERSION = "([^"]+)"', text)
    return match.group(1) if match else "10.0.7.stable"


def _fnv_cache_key(settings: dict) -> str:
    material = json.dumps({
        "v": _app_version(),
        "model": settings.get("model"),
        "rules": settings.get("rules") or [],
        "additionalInstructions": settings.get("additionalInstructions") or "",
        "aiFields": [
            {"id": f.get("id"), "enabled": f.get("enabled") is not False, "history": bool(f.get("history"))}
            for f in (settings.get("aiFields") or [])
            if isinstance(f, dict)
        ],
    }, ensure_ascii=False, separators=(",", ":"))
    hash_value = 2166136261
    for ch in material:
        hash_value ^= ord(ch)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return f"leadlens-{_app_version()}-{hash_value:x}"


def _status_for_ai(value) -> str:
    text = str(value or "").strip()
    if text.lower() == "prospect":
        return "Qualified"
    return text


def _build_model_input(leads: list) -> list:
    out = []
    for lead in leads:
        ctx = {"id": lead.get("leadId"), **(lead.get("auditContext") or {})}
        if "s" in ctx:
            ctx["s"] = _status_for_ai(ctx.get("s"))
        day = ctx.get("day")
        if isinstance(day, list):
            ctx["day"] = [
                {**snap, "s": _status_for_ai(snap.get("s"))} if isinstance(snap, dict) else snap
                for snap in day
            ]
        ordered = {"id": ctx.pop("id")}
        ordered.update(ctx)
        out.append(ordered)
    return out


def _build_prompt(settings: dict) -> str:
    rules = []
    rule_no = 0
    for rule in settings.get("rules") or []:
        if not isinstance(rule, dict):
            continue
        instruction = str(rule.get("instruction") or "").strip()
        if not instruction:
            continue
        rule_no += 1
        field = str(rule.get("field") or "check").strip() or "check"
        errors = [p.strip() for p in re.split(r"\s*\|\s*", str(rule.get("errors") or "")) if p.strip()]
        line = f"{rule_no}. {field}: {instruction}"
        if errors:
            line += " errors:" + " | ".join(errors)
        rules.append(line)
    extra = str(settings.get("additionalInstructions") or "").strip()
    handbook = _read_audit_js_const("CACHE_HANDBOOK")
    legend = " | ".join(sorted(AI_ALLOWED, key=lambda label: [
        "Lead Status Not Aligned With Comments",
        "Customer Requirement Empty",
        "Incorrect Customer Requirement",
        "Customer Comment Quality Not Appropriate",
    ].index(label)))
    body = f"{handbook}\n\nALLOWED ERROR TYPES: {legend}\n\nRUN CHECKS:\n{chr(10).join(rules) or 'none'}"
    if extra:
        body += f"\n\nEXTRA:\n{extra}"
    return body


def _needs_max_completion_tokens(model: str) -> bool:
    ident = (model or "").strip().lower()
    if not ident or "gpt-5-chat" in ident:
        return False
    return bool(re.search(r"(^|[^a-z])(gpt-5|o1|o3|o4)([.-]|$)", ident) or re.match(r"^o[134]", ident))


def build_audit_chat_body(settings: dict, leads: list) -> dict:
    """Same chat body as audit.js requestAudit / auditBatch."""
    model = str(settings.get("model") or "gpt-4o-mini")
    max_tokens = max(500, len(leads) * 140)
    model_input = _build_model_input(leads)
    user = (
        f"Audit {len(leads)} call(s). {USER_AUDIT_NOTE}\n"
        + json.dumps({"L": model_input}, ensure_ascii=False, separators=(",", ":"))
    )
    body: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": _build_prompt(settings)},
            {"role": "user", "content": user},
        ],
        "prompt_cache_key": _fnv_cache_key(settings),
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "ll_audit", "strict": True, "schema": RESPONSE_SCHEMA},
        },
    }
    if _needs_max_completion_tokens(model):
        body["max_completion_tokens"] = max_tokens
    else:
        body["max_tokens"] = max_tokens
        body["temperature"] = 0
    return body


def _clip_words(text: str, max_words: int) -> str:
    words = str(text or "").split()
    return " ".join(words[:max_words])


def _merge_audited_row(lead: dict, ai: dict) -> dict:
    static = dict(lead.get("staticValues") or {})
    connected = str(static.get("connected") or "") == "Yes"
    ai_errors = []
    for label in ai.get("e") or []:
        label = str(label).strip()
        if label in AI_ALLOWED:
            ai_errors.append(label)
    if not connected:
        ai_errors = [label for label in ai_errors if label not in CONNECTED_ONLY]
    local_raw = lead.get("localErrors")
    if not isinstance(local_raw, list):
        local_raw = lead.get("deterministicErrors") or []
    local = [str(label) for label in local_raw if str(label) in LOCAL_OWNED]
    if not connected:
        local = [label for label in local if label not in CONNECTED_ONLY]
    merged = []
    for label in [*local, *ai_errors]:
        if label in ERROR_TYPES and label not in merged:
            merged.append(label)
    if "Customer Requirement Empty" in merged:
        merged = [label for label in merged if label != "Incorrect Customer Requirement"]
    intent_raw = ai.get("i")
    intent = "Yes" if intent_raw in (1, "1", "Yes", "yes") else "No"
    try:
        quality = int(ai.get("q") if ai.get("q") is not None else 0)
    except (TypeError, ValueError):
        quality = 0
    quality = max(0, min(10, quality))
    severity = "NONE" if not merged else ("HIGH" if any(label in HIGH_SEVERITY for label in merged) else "MEDIUM")
    overdue = static.get("overdue", "")
    return {
        **static,
        "overdue": overdue,
        "commentQuality": quality,
        "errorTypes": ", ".join(merged) if merged else "None",
        "errorSeverity": severity,
        "buyingIntent": intent,
        "observation": _clip_words(ai.get("o") or "", 28),
        "recommendation": _clip_words(ai.get("r") or "", 40),
    }


def _openai_chat(session: requests.Session, body: dict) -> dict:
    last = ""
    for attempt in range(1, 4):
        resp = session.post(
            f"{LEADLENS}/openai/chat/completions",
            json=body,
            headers={"Accept": "application/json"},
            timeout=180,
        )
        if resp.status_code == 429:
            log("OpenAI proxy 429. Waiting 30s then retrying…")
            time.sleep(30)
            continue
        if resp.status_code >= 400:
            last = f"HTTP {resp.status_code} {resp.text[:800]}"
            log(f"OpenAI proxy attempt {attempt} failed: {last}")
            if attempt >= 3:
                break
            time.sleep(attempt * 1.5)
            continue
        data = resp.json()
        content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content"))
        if not content:
            last = "OpenAI returned no audit content"
            if attempt >= 3:
                break
            time.sleep(attempt * 1.5)
            continue
        parsed = json.loads(content)
        if not isinstance(parsed.get("a"), list):
            raise Fail("OpenAI response did not contain results array")
        usage = data.get("usage") or {}
        details = usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or {}
        return {
            "a": parsed["a"],
            "usage": {
                "input": int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
                "cached": int(details.get("cached_tokens") or 0),
                "output": int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
            },
        }
    raise Fail(f"OpenAI proxy failed: {last}")


def _audit_slice(session: requests.Session, settings: dict, leads: list) -> tuple[list, dict]:
    def once(batch: list) -> tuple[list, dict]:
        payload = _openai_chat(session, build_audit_chat_body(settings, batch))
        by_id = {}
        for item in payload["a"]:
            if isinstance(item, dict) and item.get("id") is not None:
                by_id[str(item["id"]).strip()] = item
        return by_id, payload["usage"]

    by_id, usage = once(leads)
    missing = [lead for lead in leads if str(lead.get("leadId") or "").strip() not in by_id]
    if missing:
        log(f"Model omitted {len(missing)} lead(s); retrying only those leads.")
        recovered, extra = once(missing)
        for key, item in recovered.items():
            by_id[key] = item
        usage = {k: usage[k] + extra[k] for k in usage}
        missing = [lead for lead in leads if str(lead.get("leadId") or "").strip() not in by_id]
    if missing:
        raise Fail(f"OpenAI still omitted {len(missing)} lead(s). Checkpoint is safe; retry the job.")
    rows = []
    for lead in leads:
        rows.append(_merge_audited_row(lead, by_id[str(lead.get("leadId") or "").strip()]))
    return rows, usage


def _pricing_from_settings(settings: dict) -> dict[str, float]:
    """₹/1M tokens from Settings, same fields as ll_erp_sync_audit_pricing."""
    raw = settings.get("pricing") if isinstance(settings.get("pricing"), dict) else {}
    return {
        "input": float(raw.get("input") or 0),
        "cached": float(raw.get("cached") or 0),
        "output": float(raw.get("output") or 0),
    }


def _estimate_cost(usage: dict, pricing: dict[str, float]) -> float:
    """Same ₹ formula as ll_erp_sync_estimate_cost / the Run console."""
    incoming = float(usage.get("input") or 0)
    cached = float(usage.get("cached") or 0)
    output = float(usage.get("output") or 0)
    billable = max(0.0, incoming - cached)
    return max(
        0.0,
        billable * pricing["input"] / 1e6
        + cached * pricing["cached"] / 1e6
        + output * pricing["output"] / 1e6,
    )


def _checkpoint_load(file_hash: str) -> dict | None:
    if not CHECKPOINT.exists():
        return None
    try:
        data = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    if data.get("file_sha256") != file_hash:
        return None
    return data


def _checkpoint_save_local(data: dict) -> None:
    CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    tmp = CHECKPOINT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(CHECKPOINT)


def _checkpoint_push(session: requests.Session, data: dict) -> None:
    """Keep resume state on the server. A midnight runner disk does not survive the job."""
    sha = str(data.get("file_sha256") or "")
    try:
        resp = session.post(
            f"{LEADLENS}/audit/checkpoint",
            json={**_auth_params(), "file_sha256": sha, "checkpoint": data},
            timeout=180,
        )
    except requests.RequestException as exc:
        log(f"audit/checkpoint store failed: {exc}")
        return
    if resp.status_code >= 400:
        log(f"audit/checkpoint store failed: HTTP {resp.status_code} {resp.text[:400]}")
        return
    log("audit/checkpoint stored")


def _checkpoint_save(session: requests.Session | None, data: dict) -> None:
    _checkpoint_save_local(data)
    if session is not None:
        _checkpoint_push(session, data)


def _checkpoint_fetch(session: requests.Session, file_hash: str) -> dict | None:
    try:
        resp = session.get(
            f"{LEADLENS}/audit/checkpoint",
            params={"sha256": file_hash, **_auth_params()},
            timeout=120,
        )
    except requests.RequestException as exc:
        log(f"audit/checkpoint fetch failed: {exc}")
        return None
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        log(f"audit/checkpoint fetch failed: HTTP {resp.status_code} {resp.text[:400]}")
        return None
    data = (resp.json() or {}).get("checkpoint")
    if not isinstance(data, dict) or data.get("file_sha256") != file_hash:
        return None
    return data


def _checkpoint_resolve(session: requests.Session, file_hash: str) -> dict | None:
    local = _checkpoint_load(file_hash)
    remote = _checkpoint_fetch(session, file_hash)

    def score(data: dict | None) -> int:
        if not data:
            return -1
        return len(data.get("done") or {})

    if score(remote) > score(local):
        log("Using server audit checkpoint (more slices than the local file)")
        _checkpoint_save_local(remote)
        return remote
    return local


def _record_cost_stop(session: requests.Session, saved: dict, pricing: dict[str, float]) -> None:
    usage = saved.get("usage") or {}
    done = saved.get("done") or {}
    audited = sum(len(v) for v in done.values() if isinstance(v, list))
    elapsed = max(0, int(time.time() - float(saved.get("started_at") or time.time())))
    cost = _estimate_cost(usage, pricing)
    saved["stopped"] = COST_STOP_MESSAGE
    saved["estimated_cost"] = cost
    _checkpoint_save(session, saved)
    body = {
        **_auth_params(),
        "stage_id": saved.get("stage_id"),
        "message": COST_STOP_MESSAGE,
        "usage": usage,
        "elapsed_seconds": elapsed,
        "audited": audited,
    }
    try:
        resp = session.post(f"{LEADLENS}/audit/stop-log", json=body, timeout=60)
    except requests.RequestException as exc:
        log(f"{COST_STOP_MESSAGE} (upload log request failed: {exc}; estimated Rs {cost:.4f})")
        return
    if resp.status_code >= 400:
        log(f"{COST_STOP_MESSAGE} (upload log HTTP {resp.status_code} {resp.text[:400]}; estimated Rs {cost:.4f})")
        return
    log(f"{COST_STOP_MESSAGE} · estimated Rs {cost:.4f} · audited {audited} · checkpoint kept")


def _fetch_stage_slice(session: requests.Session, stage_id: str, offset: int) -> list:
    resp = session.get(
        f"{LEADLENS}/audit/stage",
        params={"id": stage_id, "offset": offset, "limit": AUDIT_BATCH, **_auth_params()},
        timeout=120,
    )
    if resp.status_code >= 400:
        raise Fail(f"audit/stage GET failed: HTTP {resp.status_code} {resp.text[:800]}")
    body = resp.json()
    leads = body.get("leads")
    if not isinstance(leads, list):
        raise Fail("audit/stage GET did not return leads")
    return leads


def _fetch_audit_settings(session: requests.Session) -> dict:
    resp = session.get(f"{LEADLENS}/settings/audit", timeout=60)
    if resp.status_code >= 400:
        raise Fail(f"settings/audit failed: HTTP {resp.status_code} {resp.text[:500]}")
    settings = (resp.json() or {}).get("settings") or {}
    if not isinstance(settings, dict):
        settings = {}
    return settings


def _post_stage(path: Path) -> dict:
    """POST audit/stage. Accept any 2xx — the route may answer 200 or 201."""
    data = {**_auth_params()}
    last = ""
    for attempt in (1, 2):
        handle = path.open("rb")
        try:
            resp = requests.post(
                f"{LEADLENS}/audit/stage",
                data=data,
                files={"file": (path.name, handle, "application/json")},
                timeout=600,
            )
        finally:
            handle.close()
        log(f"audit/stage: HTTP {resp.status_code}")
        if 200 <= resp.status_code < 300:
            return resp.json()
        last = f"HTTP {resp.status_code} {resp.text[:1000]}"
        if attempt == 2 or resp.status_code in (400, 401, 403, 413):
            break
        time.sleep(60 if resp.status_code == 409 else 20)
    raise Fail(f"audit/stage failed: {last}")


def _audit_complete(lead_count: int, done: dict) -> bool:
    if lead_count <= 0:
        return True
    return all(str(offset) in done for offset in range(0, lead_count, AUDIT_BATCH))


def audit_bucket1(path: Path) -> dict:
    """Stage the ERP file, audit slices of 20 with 4 in flight, then publish."""
    file_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    session = _leadlens_session()
    settings = _fetch_audit_settings(session)
    pricing = _pricing_from_settings(settings)
    log(
        "Audit pricing ₹/1M "
        f"input={pricing['input']} cached={pricing['cached']} output={pricing['output']} "
        f"(stop at Rs {COST_CAP_INR:.0f})"
    )
    saved = _checkpoint_resolve(session, file_hash)
    stage_id = str((saved or {}).get("stage_id") or "")
    if stage_id:
        try:
            _fetch_stage_slice(session, stage_id, 0)
            log(f"Resuming Bucket 1 audit stage {stage_id}")
        except Fail as exc:
            log(f"Checkpoint stage not usable ({exc}); staging again")
            stage_id = ""
            saved = None
    if not stage_id:
        staged = _post_stage(path)
        if staged.get("ok") is False:
            raise Fail(f"audit/stage failed: {staged}")
        stage_id = str(staged.get("stage_id") or "")
        if not stage_id:
            raise Fail(f"audit/stage returned no stage_id: {staged}")
        lead_count = int(staged.get("lead_count") or 0)
        saved = {
            "file_sha256": file_hash,
            "stage_id": stage_id,
            "source_file": staged.get("source_file") or path.name,
            "lead_count": lead_count,
            "done": {},
            "usage": {"input": 0, "cached": 0, "output": 0},
            "started_at": time.time(),
        }
        _checkpoint_save(session, saved)
        log(f"Bucket 1 staged: stage_id={stage_id} lead_count={lead_count} "
            f"batch={AUDIT_BATCH} parallel={AUDIT_PARALLEL}")
    lead_count = int(saved.get("lead_count") or 0)
    done: dict = saved.setdefault("done", {})
    usage = saved.setdefault("usage", {"input": 0, "cached": 0, "output": 0})
    lock = threading.Lock()
    pending = [n for n in range(0, lead_count, AUDIT_BATCH) if str(n) not in done]
    stopped_for_cost = False

    def over_cap() -> bool:
        return _estimate_cost(usage, pricing) >= COST_CAP_INR

    if pending and over_cap():
        log(f"{COST_STOP_MESSAGE} before launching more calls "
            f"(estimated Rs {_estimate_cost(usage, pricing):.4f})")
        _record_cost_stop(session, saved, pricing)
        raise CostCap(COST_STOP_MESSAGE)

    def work(offset: int) -> None:
        worker = requests.Session()
        worker.cookies.update(session.cookies)
        worker.auth = session.auth
        leads = _fetch_stage_slice(worker, stage_id, offset)
        if not leads:
            with lock:
                done[str(offset)] = []
                _checkpoint_save_local(saved)
            return
        rows, slice_usage = _audit_slice(worker, settings, leads)
        with lock:
            done[str(offset)] = rows
            for key in ("input", "cached", "output"):
                usage[key] = int(usage.get(key) or 0) + int(slice_usage.get(key) or 0)
            finished = sum(len(v) for v in done.values())
            cost = _estimate_cost(usage, pricing)
            _checkpoint_save_local(saved)
            log(f"Audited {finished}/{lead_count} (offset {offset}, {len(rows)} leads) "
                f"est. Rs {cost:.4f}")

    if pending:
        workers = min(AUDIT_PARALLEL, len(pending))
        inflight: dict = {}
        with ThreadPoolExecutor(max_workers=workers) as pool:
            def fill() -> None:
                while pending and len(inflight) < workers and not stopped_for_cost:
                    offset = pending.pop(0)
                    inflight[pool.submit(work, offset)] = offset

            fill()
            while inflight:
                finished, _ = wait(set(inflight), return_when=FIRST_COMPLETED)
                for future in finished:
                    inflight.pop(future)
                    future.result()
                _checkpoint_push(session, saved)
                cost = _estimate_cost(usage, pricing)
                if not stopped_for_cost and cost >= COST_CAP_INR:
                    stopped_for_cost = True
                    log(f"{COST_STOP_MESSAGE} (estimated Rs {cost:.4f}). "
                        f"In-flight batches will finish; no further OpenAI calls.")
                if not stopped_for_cost:
                    fill()

    if not _audit_complete(lead_count, done):
        _record_cost_stop(session, saved, pricing)
        raise CostCap(COST_STOP_MESSAGE)

    results: list = []
    for offset in range(0, lead_count, AUDIT_BATCH):
        results.extend(done.get(str(offset)) or [])
    elapsed = max(0, int(time.time() - float(saved.get("started_at") or time.time())))
    publish_body = {
        **_auth_params(),
        "stage_id": stage_id,
        "results": results,
        "usage": usage,
        "elapsed_seconds": elapsed,
    }
    resp = session.post(f"{LEADLENS}/audit/publish-results", json=publish_body, timeout=300)
    log(f"audit/publish-results: HTTP {resp.status_code}")
    if resp.status_code >= 400:
        raise Fail(f"audit/publish-results failed: HTTP {resp.status_code} {resp.text[:1000]}")
    published = resp.json()
    log(f"Bucket 1 published: leads={len(results)} elapsed={elapsed}s "
        f"tokens in={usage.get('input')} cached={usage.get('cached')} out={usage.get('output')} "
        f"est. Rs {_estimate_cost(usage, pricing):.4f}")
    return published


def kick_audit_continue(chain_token: str, continue_url: str | None = None) -> None:
    """Start the server audit worker. Hostinger fire-and-forget after upload is unreliable."""
    urls = []
    if continue_url and continue_url.strip():
        urls.append(continue_url.strip())
    urls.append(f"{LEADLENS}/erp-sync/continue")
    # Dedupe while preserving order
    seen: set[str] = set()
    urls = [u for u in urls if not (u in seen or seen.add(u))]
    last_err = ""
    for attempt in (1, 2, 3):
        url = urls[(attempt - 1) % len(urls)]
        log(f"Kicking audit continue (attempt {attempt}/3) → {url}")
        try:
            resp = requests.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "X-ERP-Sync-Chain": chain_token,
                },
                json={},
                timeout=600,
            )
        except Exception as exc:
            last_err = str(exc)
            log(f"erp-sync/continue: network error {exc}")
            time.sleep(5)
            continue
        log(f"erp-sync/continue: HTTP {resp.status_code}")
        if resp.status_code < 400:
            try:
                body = resp.json()
            except Exception:
                body = {}
            status = body.get("status") or body.get("phase") or body.get("message") or "ok"
            done = body.get("done") or body.get("audited")
            total = body.get("total") or body.get("lead_count")
            if done is not None and total is not None:
                log(f"Continue worker: {status} · {done}/{total}")
            else:
                log(f"Continue worker: {status}")
            return
        last_err = f"HTTP {resp.status_code} {resp.text[:1000]}"
        time.sleep(5)
    raise Fail(f"erp-sync/continue failed after retries: {last_err}")


def main() -> int:
    jobs = {j.strip() for j in os.environ.get("JOBS", "bucket1,sales").split(",") if j.strip()}
    unknown = jobs - {"bucket1", "perf", "sales"}
    if unknown or not jobs:
        raise Fail(f"JOBS must be bucket1, perf, and/or sales, got {sorted(jobs)}")
    dry_run = os.environ.get("DRY_RUN") == "1"
    sales_error: str | None = None
    if "sales" in jobs:
        try:
            require_sales_report_urls()
        except Fail as exc:
            # Do not block bucket1/perf when Sales Graph cURLs are still placeholders.
            sales_error = str(exc)
            jobs = jobs - {"sales"}
            log(f"SKIP sales: {sales_error}")
            if not jobs:
                raise

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
            if "sales" in jobs:
                files["leads"] = fetch_report(page, "sales_leads", sales_report_url("sales_leads"))
                files["visits"] = fetch_report(page, "sales_visits", sales_report_url("sales_visits"))
                files["booked"] = fetch_report(page, "sales_booked", sales_report_url("sales_booked"))
        except (Fail, PlaywrightError):
            shot(page, "failure")
            raise
        finally:
            browser.close()

    if dry_run:
        log("DRY_RUN=1: reports downloaded, skipping uploads")
        if sales_error:
            log(f"WARNING (sales skipped): {sales_error}")
        return 0

    bucket1_stopped: str | None = None
    if "bucket1" in jobs:
        try:
            audit_bucket1(files["bucket1"])
        except CostCap as exc:
            # Performance and Sales still run. The process exits non-zero afterwards
            # so a cost stop is not mistaken for a full dashboard publish.
            bucket1_stopped = str(exc)
            log(f"FAILED: {exc}")
    if "perf" in jobs:
        r = upload("perf-dashboards/upload", {"master": files["master"], "history": files["history"]},
                   {}, ok=201, busy_wait=60)
        log(f"Performance published: telecallers={r.get('telecaller_count')} "
            f"{r.get('date_min')}..{r.get('date_max')} ({r.get('report_days')} days)")
    if "sales" in jobs:
        # Upload accepts shaped Sales Graph sheet JSON (or a full publish payload), not raw ERP rows.
        # Once real cURLs are known, build that payload here before posting.
        r = upload(
            "sales-graph/upload",
            {"leads": files["leads"], "visits": files["visits"], "booked": files["booked"]},
            {},
            ok=201,
            busy_wait=60,
        )
        pub = r.get("published") or {}
        log(f"Sales Graph published: id={pub.get('id')} title={pub.get('title')!r} "
            f"prior_deleted={pub.get('prior_deleted')}")
    if sales_error:
        log(f"WARNING (sales skipped): {sales_error}")
    if bucket1_stopped:
        log(f"FAILED: {bucket1_stopped}")
        return 1
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
