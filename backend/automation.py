import os
import json
import asyncio
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
SCREENSHOT_DIR = ROOT / "screenshots"
SELECTORS_FILE = ROOT / "portal_selectors.json"

REQUIRED_ENV = ("TAFE_PORTAL_URL", "TAFE_USERNAME", "TAFE_PASSWORD")


class AutomationError(Exception):
    pass


def load_selectors():
    return json.loads(SELECTORS_FILE.read_text())


def save_selectors(data):
    SELECTORS_FILE.write_text(json.dumps(data, indent=2))


class PortalAutomationBase:
    """Shared TAFE portal automation engine: browser/session management, login,
    intelligent waits, retry support, screenshots, selector config.
    Subclasses only implement page-specific logic."""

    module = "base"

    def __init__(self, mode="test", headless=True, log=None):
        self.mode = mode
        self.is_test = mode != "live"
        self.headless = headless
        self._log = log
        self.selectors = load_selectors()
        self.pw = None
        self.browser = None
        self.page = None

    async def log(self, event, message, dispatch_id=None, level="INFO"):
        if self._log:
            await self._log(event, message, dispatch_id=dispatch_id, level=level)

    def require_env(self):
        for var in REQUIRED_ENV:
            if not os.environ.get(var):
                raise AutomationError(f"Missing required environment variable: {var}")

    async def start(self):
        if self.is_test:
            return
        self.require_env()
        from playwright.async_api import async_playwright
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch(headless=self.headless)
        self.page = await self.browser.new_page()
        self.page.set_default_timeout(30000)

    async def login(self):
        await self.log("Login Started", "Connecting to TAFE Vendor Portal")
        if self.is_test:
            await asyncio.sleep(0.3)
            await self.log("Login Success", "[TEST] Login simulated successfully")
            return
        s = self.selectors["login"]
        url = os.environ["TAFE_PORTAL_URL"]
        if not url.startswith("https://"):
            raise AutomationError("Portal URL must use HTTPS")
        await self.page.goto(url, wait_until="domcontentloaded")
        await self.page.wait_for_selector(s["username"], state="visible")
        await self.page.fill(s["username"], os.environ["TAFE_USERNAME"])
        await self.page.fill(s["password"], os.environ["TAFE_PASSWORD"])
        await self.page.click(s["submit"])
        try:
            await self.page.wait_for_selector(s["logged_in_indicator"], state="visible", timeout=20000)
        except Exception:
            if await self.page.locator(s["error_indicator"]).count() > 0:
                raise AutomationError("Login failed: portal rejected credentials")
            raise AutomationError("Login failed: could not verify logged-in state")
        await self.log("Login Success", "Login verified")

    async def fill_and_verify(self, selector, value):
        loc = self.page.locator(selector).first
        await loc.wait_for(state="visible")
        await loc.fill(value)
        actual = await loc.input_value()
        if actual.strip() != value.strip():
            raise AutomationError(f"Field verification failed for {selector}: expected '{value}', got '{actual}'")

    async def capture_screenshot(self, name):
        SCREENSHOT_DIR.mkdir(exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        path = SCREENSHOT_DIR / f"{name}_{ts}.png"
        if self.is_test:
            path.write_bytes(b"TEST_SCREENSHOT")
        else:
            try:
                await self.page.screenshot(path=str(path))
            except Exception:
                return None
        return f"screenshots/{path.name}"

    async def close(self):
        for obj, closer in ((self.page, "close"), (self.browser, "close"), (self.pw, "stop")):
            if obj:
                try:
                    await getattr(obj, closer)()
                except Exception:
                    pass


class EWayBillAutomation(PortalAutomationBase):
    module = "eway"

    async def navigate_to_entry(self):
        if self.is_test:
            await asyncio.sleep(0.2)
            await self.log("Navigation", "[TEST] Navigated to E-Way Bill -> E-Way Bill Entry")
            return
        s = self.selectors["eway"]
        await self.page.click(s["menu_eway_bill"])
        await self.page.click(s["menu_eway_entry"])
        await self.page.wait_for_selector(s["company_code"], state="visible")
        await self.log("Navigation", "Opened E-Way Bill Entry page")

    async def fill_form(self, data):
        if self.is_test:
            await asyncio.sleep(0.3)
            if "ERR" in (data.get("eway_bill_number") or "").upper():
                raise AutomationError("Invalid E-Way Bill")
            return
        s = self.selectors["eway"]
        await self.fill_and_verify(s["company_code"], data["company_code"])
        await self.fill_and_verify(s["eway_bill_no"], data["eway_bill_number"])
        await self.fill_and_verify(s["from_validity"], data["eway_from_validity"])
        await self.fill_and_verify(s["to_validity"], data["eway_to_validity"])

    async def submit(self):
        if self.is_test:
            await asyncio.sleep(0.2)
            return
        await self.page.click(self.selectors["eway"]["submit"])

    async def verify_success(self):
        if self.is_test:
            return True
        s = self.selectors["eway"]
        try:
            await self.page.wait_for_selector(s["success_indicator"], state="visible", timeout=20000)
            return True
        except Exception:
            err = self.page.locator(s["error_indicator"])
            if await err.count() > 0:
                msg = (await err.first.inner_text()).strip()
                raise AutomationError(msg or "Unknown portal error")
            raise AutomationError("Unexpected Error: no confirmation received from portal")


class SimpleFormAutomation(PortalAutomationBase):
    """Generic selector-config-driven module: menu_path navigation + fields dict."""
    section = None

    async def navigate_to_entry(self):
        if self.is_test:
            await asyncio.sleep(0.2)
            await self.log("Navigation", f"[TEST] Navigated to {self.section} entry page")
            return
        s = self.selectors[self.section]
        for sel in s["menu_path"]:
            await self.page.click(sel)
        first_field = next(iter(s["fields"].values()))
        await self.page.wait_for_selector(first_field, state="visible")
        await self.log("Navigation", f"Opened {self.section} entry page")

    async def fill_form(self, data):
        if self.is_test:
            await asyncio.sleep(0.3)
            if "ERR" in str(data.get("invoice_no", "")).upper():
                raise AutomationError("Invalid data rejected by portal")
            return
        s = self.selectors[self.section]
        for key, sel in s["fields"].items():
            if key in data and data[key] is not None:
                await self.fill_and_verify(sel, str(data[key]))

    async def submit(self):
        if self.is_test:
            await asyncio.sleep(0.2)
            return
        await self.page.click(self.selectors[self.section]["submit"])

    async def verify_success(self):
        if self.is_test:
            return True
        s = self.selectors[self.section]
        try:
            await self.page.wait_for_selector(s["success_indicator"], state="visible", timeout=20000)
            return True
        except Exception:
            err = self.page.locator(s["error_indicator"])
            if await err.count() > 0:
                raise AutomationError((await err.first.inner_text()).strip() or "Unknown portal error")
            raise AutomationError("Unexpected Error: no confirmation received from portal")


class PackingSlipAutomation(SimpleFormAutomation):
    module = "packing_slip"
    section = "packing_slip"


class ASNAutomation(SimpleFormAutomation):
    module = "asn"
    section = "asn"


class VendorAckAutomation(SimpleFormAutomation):
    module = "vendor_ack"
    section = "vendor_ack"


class DQMSAutomation(SimpleFormAutomation):
    module = "dqms"
    section = "dqms"


async def validate_portal(attempt_login=False, headless=True, log=None, dry_run_fill=False):
    """Non-destructive live portal validation: connects, verifies selector presence,
    optionally logs in and checks navigation/form selectors. With dry_run_fill it also
    fills the entry form with sample data and verifies values. NEVER submits any form."""
    results = []

    def add(step, status, message):
        results.append({"step": step, "status": status, "message": message})

    async def emit(event, message, level="INFO"):
        if log:
            await log(event, message, level=level)

    missing = [v for v in REQUIRED_ENV if not os.environ.get(v)]
    if missing:
        add("env", "fail", f"Missing required environment variable: {missing[0]}")
        return results
    add("env", "ok", "All required environment variables present")

    selectors = load_selectors()
    url = os.environ["TAFE_PORTAL_URL"]
    if not url.startswith("https://"):
        add("connect", "fail", "Portal URL must use HTTPS")
        return results

    await emit("Validation Started", f"Non-destructive portal validation against {url}")
    from playwright.async_api import async_playwright
    pw = await async_playwright().start()
    browser = None
    try:
        try:
            browser = await pw.chromium.launch(headless=headless)
        except Exception as e:
            add("browser", "fail", f"Could not launch browser: {type(e).__name__}")
            await emit("Validation Error", "Browser launch failed", "ERROR")
            return results
        page = await browser.new_page()
        page.set_default_timeout(15000)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=25000)
            add("connect", "ok", f"Portal reachable ({url})")
            await emit("Validation", "Portal reachable")
        except Exception as e:
            add("connect", "fail", f"Portal unreachable: {type(e).__name__}. Retry when network access to the portal is available.")
            await emit("Validation Error", "Portal unreachable", "ERROR")
            return results

        for name, sel in selectors["login"].items():
            found = await page.locator(sel).count() > 0
            add(f"login.{name}", "ok" if found else "fail",
                f"Selector '{sel}' {'found' if found else 'NOT found'} on login page")

        if attempt_login:
            s = selectors["login"]
            try:
                await page.fill(s["username"], os.environ["TAFE_USERNAME"])
                await page.fill(s["password"], os.environ["TAFE_PASSWORD"])
                await page.click(s["submit"])
                await page.wait_for_selector(s["logged_in_indicator"], state="visible", timeout=20000)
                add("login", "ok", "Login successful (session verified)")
                await emit("Validation", "Login verified")
            except Exception:
                add("login", "fail", "Login could not be verified - check login selectors / credentials")
                return results

            e = selectors["eway"]
            try:
                await page.click(e["menu_eway_bill"], timeout=10000)
                await page.click(e["menu_eway_entry"], timeout=10000)
                add("eway.navigation", "ok", "Navigated to E-Way Bill -> E-Way Bill Entry")
            except Exception:
                add("eway.navigation", "fail", "Could not navigate via menu selectors")
                return results

            for name in ("company_code", "eway_bill_no", "from_validity", "to_validity", "submit"):
                found = await page.locator(e[name]).count() > 0
                add(f"eway.{name}", "ok" if found else "fail",
                    f"Selector '{e[name]}' {'found' if found else 'NOT found'} on entry page (presence check only - nothing submitted)")

            if dry_run_fill:
                from datetime import timedelta
                today = datetime.now(timezone.utc)
                sample = {
                    "company_code": "TMTL",
                    "eway_bill_no": "351099999901",
                    "from_validity": today.strftime("%d/%m/%Y"),
                    "to_validity": (today + timedelta(days=5)).strftime("%d/%m/%Y"),
                }
                await emit("Dry Run", "Filling entry form with sample data (Submit will NOT be clicked)")
                for name, value in sample.items():
                    try:
                        loc = page.locator(e[name]).first
                        await loc.fill(value)
                        actual = (await loc.input_value()).strip()
                        ok = actual == value
                        add(f"eway.fill.{name}", "ok" if ok else "fail",
                            f"Sample value entered and verified (dry run - not submitted)" if ok
                            else f"Value mismatch after fill: expected '{value}', field shows '{actual}'")
                    except Exception as ex:
                        add(f"eway.fill.{name}", "fail", f"Could not fill field: {type(ex).__name__}")
                add("eway.dry_run", "ok", "Dry run complete - form filled and verified, Submit was never clicked")
    finally:
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        try:
            await pw.stop()
        except Exception:
            pass
        await emit("Validation Finished", f"{sum(1 for r in results if r['status']=='ok')}/{len(results)} checks passed")
    return results
