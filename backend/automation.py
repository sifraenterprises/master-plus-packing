import os
import re
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


class DropdownMatchError(AutomationError):
    pass


class AsnNotFoundError(AutomationError):
    pass


class AlreadyAcknowledgedError(AutomationError):
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

    async def select_by_label(self, selector, label):
        """Select a dropdown option by exact visible text and verify it. Never by index."""
        loc = self.page.locator(selector).first
        await loc.wait_for(state="visible")
        try:
            await self.page.wait_for_function(
                "sel => { const el = document.querySelector(sel); return el && el.options && el.options.length > 0 && !el.disabled; }",
                arg=selector, timeout=30000)
        except Exception:
            pass
        try:
            await loc.select_option(label=label, timeout=10000)
        except Exception:
            raise DropdownMatchError(f"'{label}' not found in dropdown")
        selected = (await loc.evaluate("el => el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : ''")).strip()
        if selected != label.strip():
            raise DropdownMatchError(f"Dropdown verification failed: expected '{label}', portal selected '{selected}'")

    async def capture_screenshot(self, name):
        SCREENSHOT_DIR.mkdir(exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        path = SCREENSHOT_DIR / f"{'test' if self.is_test else 'live'}_{name}_{ts}.png"
        if self.is_test:
            import base64
            path.write_bytes(base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))
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
        cc = self.page.locator(s["company_code"]).first
        try:
            cc_editable = await cc.is_editable(timeout=3000)
        except Exception:
            cc_editable = False
        if cc_editable:
            await self.fill_and_verify(s["company_code"], data["company_code"])
        else:
            await self.log("Field Check", "Company Code is read-only on the portal (pre-filled) - fill skipped")
        await self.fill_and_verify(s["eway_bill_no"], data["eway_bill_number"])
        await self.fill_date(s["from_validity"], data["eway_from_validity"])
        await self.fill_date(s["to_validity"], data["eway_to_validity"])

    async def fill_date(self, selector, value):
        """Date inputs with calendar widgets can reject fill(); falls back to JS value set."""
        loc = self.page.locator(selector).first
        await loc.wait_for(state="visible")
        try:
            await loc.fill(value)
        except Exception:
            pass
        actual = (await loc.input_value()).strip()
        if actual != value.strip():
            await loc.evaluate(
                "(el, v) => { el.removeAttribute('readonly'); el.value = v;"
                " el.dispatchEvent(new Event('input', {bubbles: true}));"
                " el.dispatchEvent(new Event('change', {bubbles: true})); }", value)
            actual = (await loc.input_value()).strip()
        if actual != value.strip():
            raise AutomationError(f"Date field verification failed for {selector}: expected '{value}', got '{actual}'")

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


class VendorAckAutomation(PortalAutomationBase):
    """Vendor -> E Way Bill Acknowledgement automation. Uses actionability auto-waits
    (click/fill wait for visible+enabled) and explicit waits for dropdowns/grids - no fixed delays in live mode."""
    module = "vendor_ack"

    async def navigate_to_entry(self):
        if self.is_test:
            await asyncio.sleep(0.2)
            await self.log("Navigation", "[TEST] Navigated to Vendor -> E Way Bill Acknowledgement")
            return
        s = self.selectors["vendor_ack"]
        await self.page.click(s["menu_vendor_ack"])
        await self.page.wait_for_selector(s["company_code"], state="visible")
        await self.log("Navigation", "Opened Vendor E Way Bill Acknowledgement page")

    async def acknowledge(self, data):
        """Full flow: select dropdowns, enter ASN, search, tick grid row, submit.
        Returns {'before_submit': path|None, 'message': str}. Raises typed errors."""
        if self.is_test:
            await asyncio.sleep(0.3)
            asn = (data.get("asn_number") or "").upper()
            combo = f"{data.get('transporter', '')} {data.get('plant', '')}".upper()
            if "BADDROP" in combo:
                raise DropdownMatchError(f"'{data.get('transporter')}' not found in dropdown")
            if "NOTFOUND" in asn:
                raise AsnNotFoundError(f"ASN Details Not Found for {data.get('asn_number')}")
            if "ACKED" in asn:
                raise AlreadyAcknowledgedError("E-Way Bill already acknowledged for this ASN")
            if "ERR" in asn:
                raise AutomationError("Portal server error (simulated)")
            await self.log("Dropdown Selected", f"[TEST] Company Code = {data['company_code']}")
            await self.log("Dropdown Selected", f"[TEST] Transporter = {data['transporter']}")
            await self.log("Dropdown Selected", f"[TEST] Plant = {data['plant']}")
            await self.log("Field Entered", f"[TEST] ASN No = {data['asn_number']}")
            await self.log("Button Clicked", "[TEST] Search clicked - ASN Details grid loaded")
            await self.log("Checkbox Ticked", "[TEST] ASN Details row selected")
            before = await self.capture_screenshot(f"vack_before_{data['asn_number']}")
            await self.log("Button Clicked", "[TEST] Submit clicked")
            return {"before_submit": before, "message": "E-Way Bill Acknowledged successfully"}

        s = self.selectors["vendor_ack"]
        await self.select_by_label(s["company_code"], data["company_code"])
        await self.log("Dropdown Selected", f"Company Code = {data['company_code']}")
        await self.select_by_label(s["transporter"], data["transporter"])
        await self.log("Dropdown Selected", f"Transporter = {data['transporter']}")
        await self.select_by_label(s["plant"], data["plant"])
        await self.log("Dropdown Selected", f"Plant = {data['plant']}")

        asn_loc = self.page.locator(s["asn_no"]).first
        await asn_loc.wait_for(state="visible")
        await self.page.wait_for_function(
            "sel => { const el = document.querySelector(sel); return el && !el.disabled; }",
            arg=s["asn_no"], timeout=30000)
        await asn_loc.fill(data["asn_number"])
        actual = (await asn_loc.input_value()).strip()
        if actual != data["asn_number"].strip():
            raise AutomationError(f"ASN field verification failed: expected '{data['asn_number']}', got '{actual}'")
        await self.log("Field Entered", f"ASN No = {data['asn_number']}")

        await self.page.locator(s["search"]).first.click()
        await self.log("Button Clicked", "Search clicked - waiting for ASN Details")
        grid = self.page.locator(s["grid"]).first
        try:
            await grid.wait_for(state="visible", timeout=30000)
        except Exception:
            if await self.page.locator(s["already_ack_indicator"]).count() > 0:
                raise AlreadyAcknowledgedError("Portal reports: Already Acknowledged")
            if await self.page.locator(s["no_details_indicator"]).count() > 0:
                raise AsnNotFoundError("ASN Details Not Found")
            raise AutomationError("ASN Details grid did not appear (portal timeout)")
        await self.log("Grid Loaded", "ASN Details grid visible")

        checkbox = self.page.locator(s["grid_checkbox"]).first
        await checkbox.check()
        await self.log("Checkbox Ticked", "ASN Details row selected")

        before = await self.capture_screenshot(f"vack_before_{data['asn_number']}")
        await self.page.locator(s["submit"]).first.click()
        await self.log("Button Clicked", "Submit clicked - waiting for confirmation")
        try:
            await self.page.wait_for_selector(s["success_indicator"], state="visible", timeout=30000)
            msg = (await self.page.locator(s["success_indicator"]).first.inner_text()).strip()
        except Exception:
            err = self.page.locator(s["error_indicator"])
            if await err.count() > 0:
                msg = (await err.first.inner_text()).strip()
                if "already" in msg.lower():
                    raise AlreadyAcknowledgedError(msg)
                raise AutomationError(msg or "Portal returned an error after Submit")
            raise AutomationError("No confirmation received from portal after Submit")
        if "already" in msg.lower():
            raise AlreadyAcknowledgedError(msg)
        return {"before_submit": before, "message": msg or "E-Way Bill Acknowledged successfully"}


class AsnValidationError(AutomationError):
    pass


class BatchAllocationError(AutomationError):
    """No-retry error for cancelled/timed-out batch allocations."""
    pass


class ASNAutomation(PortalAutomationBase):
    """ASN Creation automation (ASNAutomationService): select PO, add parts, fill invoice,
    attach PDI, Create ASN and capture the generated ASN number. Configurable selectors, no fixed waits live."""
    module = "asn"
    allocation_cb = None  # async (part, asn_qty, batches) -> allocations; set by route layer
    pdi_wait_cb = None  # async () -> None; pauses until user confirms manual PDI upload; set by route layer

    async def _wait_pdi(self):
        if not self.pdi_wait_cb:
            raise AsnValidationError("Manual PDI upload required but no wait handler is attached")
        await self.pdi_wait_cb()

    def _simulate_batches(self, part, qty):
        up = part.upper()
        qty = float(qty or 0)
        if "LOW" in up:
            return [{"batch_no": f"TV-{part}-B1", "batch_qty": qty, "available_qty": max(1, int(qty) - 1), "considerable": ""}]
        if "MULTI" in up:
            half = max(1, int(qty // 2))
            return [{"batch_no": f"TV-{part}-B1", "batch_qty": half * 2, "available_qty": half, "considerable": ""},
                    {"batch_no": f"TV-{part}-B2", "batch_qty": half * 2, "available_qty": half, "considerable": ""},
                    {"batch_no": f"TV-{part}-B3", "batch_qty": qty * 2, "available_qty": qty, "considerable": ""}]
        return [{"batch_no": f"TV-{part}-B1", "batch_qty": qty * 3, "available_qty": qty * 2, "considerable": ""}]

    async def _allocate(self, part, qty, batches):
        if not self.allocation_cb:
            raise BatchAllocationError(f"Part {part} requires batch allocation but no allocation handler is attached")
        return await self.allocation_cb(part, qty, batches)

    async def read_batches(self, part):
        """Returns batch rows for the part's Batch Details section, or None when the portal shows none."""
        s = self.selectors["asn"]
        container = self.page.locator(s["batch_container"].replace("{part}", part)).first
        try:
            await container.wait_for(state="visible", timeout=5000)
        except Exception:
            return None
        rows = container.locator(s["batch_rows"])
        batches = []
        for i in range(await rows.count()):
            cells = rows.nth(i).locator("td")
            if await cells.count() < 3:
                continue
            texts = [(await cells.nth(j).inner_text()).strip() for j in range(3)]
            if not texts[0] or "batch no" in texts[0].lower():
                continue

            def num(t):
                try:
                    return float(re.sub(r"[^\d.]", "", t) or 0)
                except ValueError:
                    return 0.0
            batches.append({"batch_no": texts[0], "batch_qty": num(texts[1]),
                            "available_qty": num(texts[2]), "considerable": ""})
        return batches or None

    async def apply_allocations(self, part, allocations):
        """Fills 'Quantity To be Confirmed' and sets Batch Considerable Yes/No per batch row."""
        s = self.selectors["asn"]
        container = self.page.locator(s["batch_container"].replace("{part}", part)).first
        for a in allocations:
            row = container.locator(f"tr:has-text('{a['batch_no']}')").first
            alloc = float(a.get("allocate_qty") or 0)
            consider = bool(a.get("consider")) and alloc > 0
            if alloc > 0:
                qty_input = row.locator(s["batch_qty_input"]).first
                await qty_input.fill(str(int(alloc) if alloc.is_integer() else alloc))
            radios = row.locator(s["batch_radio"])
            try:
                await radios.nth(0 if consider else 1).check()
            except Exception:
                await self.log("Batch Allocated", f"Part {part}: could not set Batch Considerable radio for {a['batch_no']} - verify on portal", level="WARN")
            await self.log("Batch Allocated", f"Part {part}: batch {a['batch_no']} -> Qty To be Confirmed {alloc}, Batch Considerable {'Yes' if consider else 'No'}")

    async def navigate_to_entry(self):
        if self.is_test:
            await asyncio.sleep(0.2)
            await self.log("ASN Page Opened", "[TEST] Opened Create ASN tab - ASN Creation Form loaded")
            return
        s = self.selectors["asn"]
        await self.page.click(s["menu_create_asn"])
        await self.page.wait_for_selector(s["po_dropdown"], state="visible")
        await self.log("ASN Page Opened", "Opened Create ASN tab - ASN Creation Form loaded")

    def validate(self, data):
        missing = [k for k in ("po_number", "invoice_no", "invoice_date", "transporter")
                   if not str(data.get(k) or "").strip()]
        if not data.get("items"):
            missing.append("dispatch items")
        if float(data.get("basic_amount") or 0) <= 0:
            missing.append("basic_amount")
        if float(data.get("total_amount") or 0) <= 0:
            missing.append("total_amount")
        if missing:
            raise AsnValidationError("Validation failed - missing: " + ", ".join(missing))

    async def run_asn(self, data):
        """Full Create-ASN flow. Returns {'asn_number', 'before_submit'}."""
        self.validate(data)
        if self.is_test:
            await asyncio.sleep(0.3)
            po = str(data["po_number"]).upper()
            if "NOPO" in po:
                raise DropdownMatchError(f"PO Number '{data['po_number']}' not found in dropdown")
            if "ERR" in po:
                raise AutomationError("Portal server error (simulated)")
            await self.log("PO Selected", f"[TEST] PO {data['po_number']} selected and searched")
            for item in data["items"]:
                part, qty = item["part_number"], item["quantity"]
                if "BATCH" in str(part).upper():
                    batches = self._simulate_batches(part, qty)
                    await self.log("Batch Details", f"[TEST] Part {part}: {len(batches)} batch(es) found - awaiting allocation")
                    allocations = await self._allocate(part, float(qty or 0), batches)
                    for a in allocations:
                        consider = bool(a.get("consider")) and float(a.get("allocate_qty") or 0) > 0
                        await self.log("Batch Allocated", f"[TEST] Part {part}: batch {a['batch_no']} -> Qty To be Confirmed {a['allocate_qty']}, Batch Considerable {'Yes' if consider else 'No'}")
                else:
                    await self.log("Parts Added", f"[TEST] Part {part}: added to invoice, ASN Qty {qty}")
            await self.log("Invoice Filled", f"[TEST] Invoice {data['invoice_no']} dt {data['invoice_date']} basic {data['basic_amount']} total {data['total_amount']}")
            await self.log("Transporter Selected", f"[TEST] {data['transporter']}")
            await self.log("PDI Section", "[TEST] Reached PDI attachment stage - waiting for manual PDI upload")
            await self._wait_pdi()
            await self.log("PDI Uploaded", "[TEST] Manual PDI upload confirmed - clicking Create ASN")
            shot = await self.capture_screenshot(f"asn_before_{data['invoice_no'].replace('/', '-')}")
            import random
            asn_no = f"ASN{datetime.now(timezone.utc):%y}{random.randint(100000, 999999)}"
            await self.log("ASN Created", "[TEST] Create ASN clicked - success page loaded")
            await self.log("ASN Number Captured", f"[TEST] {asn_no}")
            return {"asn_number": asn_no, "before_submit": shot}

        s = self.selectors["asn"]
        await self.select_by_label(s["po_dropdown"], str(data["po_number"]))
        await self.page.locator(s["po_search"]).first.click()
        await self.log("PO Selected", f"PO {data['po_number']} selected and searched")
        await self.page.wait_for_selector(s["parts_table"], state="visible", timeout=30000)
        for item in data["items"]:
            part, qty = item["part_number"], item["quantity"]
            search_box = self.page.locator(s["part_search_input"]).first
            if await search_box.count() > 0:
                await search_box.fill(part)
                await self.page.locator(s["part_search_go"]).first.click()
            link = self.page.locator(s["part_add_link"].replace("{part}", part)).first
            try:
                await link.wait_for(state="visible", timeout=15000)
            except Exception:
                raise AutomationError(f"Part {part} not found in PO parts list")
            await link.click()
            await self.log("Parts Added", f"Part {part}: 'Click here to Add to Invoice' clicked")
            batches = await self.read_batches(part)
            if batches:
                await self.log("Batch Details", f"Part {part}: {len(batches)} batch(es) found - awaiting allocation")
                allocations = await self._allocate(part, float(qty or 0), batches)
                await self.apply_allocations(part, allocations)
            elif qty:
                try:
                    qty_input = self.page.locator(s["invoice_row_qty"].replace("{part}", part)).last
                    await qty_input.wait_for(state="visible", timeout=10000)
                    await qty_input.fill(str(int(qty) if float(qty) == int(qty) else qty))
                    await self.log("Parts Added", f"Part {part}: ASN Qty set to {qty}")
                except Exception:
                    await self.log("Parts Added", f"Part {part}: could not set ASN Qty automatically - verify on portal", level="WARN")
        await self.fill_and_verify(s["invoice_no"], data["invoice_no"])
        await self.fill_and_verify(s["invoice_date"], data["invoice_date"])
        await self.fill_and_verify(s["basic_amount"], str(data["basic_amount"]))
        await self.fill_and_verify(s["total_amount"], str(data["total_amount"]))
        for opt_field in ("cgst", "sgst", "igst", "no_of_cases"):
            value = data.get(opt_field)
            if value:
                try:
                    await self.fill_and_verify(s[opt_field], str(value))
                except Exception:
                    await self.log("Invoice Filled", f"Optional field {opt_field} could not be filled - verify on portal", level="WARN")
        await self.log("Invoice Filled", f"Invoice {data['invoice_no']} details entered")
        await self.select_by_label(s["transporter"], data["transporter"])
        await self.log("Transporter Selected", data["transporter"])
        try:
            await self.page.locator(s["pdi_file_input"]).first.scroll_into_view_if_needed()
        except Exception:
            pass
        await self.log("PDI Section", "Reached PDI attachment stage - browser session stays open; upload the PDI PDF directly on the portal")
        await self._wait_pdi()
        await self.log("PDI Uploaded", "Manual PDI upload confirmed - clicking Create ASN")
        shot = await self.capture_screenshot(f"asn_before_{data['invoice_no'].replace('/', '-')}")
        await self.page.locator(s["create_asn_button"]).first.click()
        try:
            await self.page.wait_for_selector(s["asn_number_indicator"], state="visible", timeout=60000)
        except Exception:
            err = self.page.locator(s["error_indicator"])
            if await err.count() > 0:
                raise AutomationError((await err.first.inner_text()).strip() or "Portal returned an error on Create ASN")
            raise AutomationError("ASN success page did not appear (portal timeout)")
        text = (await self.page.locator(s["asn_number_indicator"]).first.inner_text()).strip()
        match = re.search(r"ASN[A-Z0-9]+", text)
        asn_no = match.group(0) if match else text
        if not asn_no:
            raise AutomationError("Could not capture the generated ASN Number")
        await self.log("ASN Created", "Create ASN succeeded")
        await self.log("ASN Number Captured", asn_no)
        return {"asn_number": asn_no, "before_submit": shot}


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
                    "eway_bill_no": "3510 9999 9901",
                    "from_validity": today.strftime("%d/%m/%Y"),
                    "to_validity": (today + timedelta(days=5)).strftime("%d/%m/%Y"),
                }
                await emit("Dry Run", "Filling entry form with sample data (Submit will NOT be clicked)")
                for name, value in sample.items():
                    try:
                        loc = page.locator(e[name]).first
                        try:
                            editable = await loc.is_editable(timeout=3000)
                        except Exception:
                            editable = False
                        if not editable:
                            shown = ""
                            try:
                                shown = (await loc.inner_text()).strip()[:30]
                            except Exception:
                                pass
                            add(f"eway.fill.{name}", "ok",
                                f"Read-only field on portal{f' (shows: {shown})' if shown else ''} - fill not required (dry run)")
                            continue
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


class EwayPrintAutomation(PortalAutomationBase):
    """Read-only 'Print EWB' job on the government e-way bill portal.
    The user completes username/password/CAPTCHA/OTP manually in a VISIBLE browser;
    credentials are never stored or automated. This class only navigates Print EWB,
    verifies the number and downloads the PDF — it never generates, cancels,
    updates or submits e-way bills."""

    module = "eway_print"
    login_wait_cb = None   # async () -> None; pauses until the user confirms manual login
    review_wait_cb = None  # async () -> None; pauses before print/download when requested

    def _s(self):
        return self.selectors.get("eway_print", {})

    async def start_session(self):
        s = self._s()
        url = s.get("login_url", "https://ewaybillgst.gov.in/login.aspx")
        if not url.startswith("https://"):
            raise AutomationError("E-Way Bill portal URL must use HTTPS")
        if self.is_test:
            await self.log("Portal Opened", f"[TEST] Simulated opening of {url} in a visible browser")
        else:
            from playwright.async_api import async_playwright
            self.pw = await async_playwright().start()
            self.browser = await self.pw.chromium.launch(headless=False)  # must stay visible for manual login
            self.page = await self.browser.new_page()
            self.page.set_default_timeout(30000)
            await self.page.goto(url, wait_until="domcontentloaded")
            await self.log("Portal Opened", f"Login page opened in a visible browser: {url}")
        await self.log("Manual Login Wait",
                       ("[TEST] " if self.is_test else "") +
                       "Waiting for the user to complete username, password, CAPTCHA and OTP manually - never automated")
        if not self.login_wait_cb:
            raise AutomationError("Manual portal login required but no wait handler is attached")
        await self.login_wait_cb()
        if not self.is_test:
            try:
                await self.page.wait_for_selector(s.get("logged_in_indicator", "a"), state="visible", timeout=10000)
            except Exception:
                await self.log("Login Check", "Could not verify logged-in indicator - continuing on user confirmation", level="WARN")
        await self.log("Login Confirmed", ("[TEST] " if self.is_test else "") + "User confirmed portal login")

    async def print_one(self, ewb_display: str, stop_before_download: bool, download_dir, dispatch_no: str):
        digits = re.sub(r"\D", "", ewb_display or "")
        if len(digits) != 12:
            raise AutomationError(f"Invalid E-Way Bill number '{ewb_display}' - must be exactly 12 digits")
        result = {"shots": {}}
        if self.is_test:
            return await self._print_one_test(digits, stop_before_download, download_dir, dispatch_no, result)
        s = self._s()
        await self.page.goto(s["print_url"], wait_until="domcontentloaded")
        await self.log("Print EWB Opened", f"Print EWB page opened for {digits}", dispatch_no)
        await self.fill_and_verify(s["ewb_input"], digits)
        await self.page.click(s["go_button"])
        try:
            await self.page.wait_for_selector(f"{s['result_number']}, {s['not_found_indicator']}", timeout=30000)
        except Exception:
            raise AutomationError("Portal did not return a result for the E-Way Bill number")
        if await self.page.locator(s["not_found_indicator"]).count() > 0:
            raise AutomationError(f"E-Way Bill {digits} not found on the portal - stopping (nothing printed)")
        numbers = self.page.locator(s["result_number"])
        count = await numbers.count()
        if count == 0:
            raise AutomationError(f"E-Way Bill {digits}: result number not visible - stopping (ambiguous result)")
        if count > 1:
            texts = {re.sub(r"\D", "", (await numbers.nth(i).inner_text()) or "") for i in range(count)}
            texts.discard("")
            if len(texts) != 1:
                raise AutomationError(f"E-Way Bill {digits}: multiple different numbers on screen {sorted(texts)} - ambiguous, stopping")
            shown = texts.pop()
        else:
            shown = re.sub(r"\D", "", (await numbers.first.inner_text()) or "")
        if shown != digits:
            raise AutomationError(f"E-Way Bill mismatch: requested {digits} but portal shows {shown or 'nothing'} - stopping (nothing printed)")
        await self.log("Result Verified", f"Portal shows E-Way Bill {shown} - matches the requested number", dispatch_no)
        result["shots"]["result"] = await self.capture_screenshot(f"ewbprint_result_{digits}")
        if stop_before_download:
            await self.log("Review Wait", f"Paused before print/download of {digits} for user review", dispatch_no)
            if not self.review_wait_cb:
                raise AutomationError("Review pause requested but no wait handler is attached")
            await self.review_wait_cb()
            await self.log("Review Confirmed", f"User approved print/download of {digits}", dispatch_no)
        pdf_path = Path(download_dir) / f"EWB_{digits}.pdf"
        downloaded = False
        try:
            async with self.page.expect_download(timeout=20000) as dl_info:
                await self.page.click(s["print_button"])
            dl = await dl_info.value
            await dl.save_as(str(pdf_path))
            downloaded = True
            await self.log("PDF Downloaded", f"E-Way Bill {digits} PDF downloaded from the portal", dispatch_no)
        except Exception as e:
            await self.log("Download Fallback", f"No direct download offered ({str(e)[:80]}) - capturing the page as PDF", dispatch_no, "WARN")
        if not downloaded:
            png = Path(download_dir) / f"EWB_{digits}.png"
            await self.page.screenshot(path=str(png), full_page=True)
            _png_to_pdf(png, pdf_path)
            png.unlink(missing_ok=True)
            await self.log("PDF Captured", f"E-Way Bill {digits} page captured and saved as PDF", dispatch_no)
        result["shots"]["after_download"] = await self.capture_screenshot(f"ewbprint_done_{digits}")
        result["pdf_path"] = str(pdf_path)
        result["pdf_name"] = pdf_path.name
        return result

    async def _print_one_test(self, digits, stop_before_download, download_dir, dispatch_no, result):
        await self.log("Print EWB Opened", f"[TEST] Print EWB page opened for {digits}", dispatch_no)
        await self.log("Number Entered", f"[TEST] Entered {digits} and clicked GO", dispatch_no)
        await asyncio.sleep(0.2)
        if digits.startswith("999"):
            raise AutomationError(f"[TEST] E-Way Bill {digits} not found on the portal - stopping (nothing printed)")
        if digits.startswith("998"):
            raise AutomationError(f"[TEST] E-Way Bill mismatch: requested {digits} but portal shows different number - stopping (nothing printed)")
        await self.log("Result Verified", f"[TEST] Portal shows E-Way Bill {digits} - matches the requested number", dispatch_no)
        result["shots"]["result"] = await self.capture_screenshot(f"ewbprint_result_{digits}")
        if stop_before_download:
            await self.log("Review Wait", f"[TEST] Paused before print/download of {digits} for user review", dispatch_no)
            if not self.review_wait_cb:
                raise AutomationError("Review pause requested but no wait handler is attached")
            await self.review_wait_cb()
            await self.log("Review Confirmed", f"[TEST] User approved print/download of {digits}", dispatch_no)
        pdf_path = Path(download_dir) / f"EWB_{digits}.pdf"
        _placeholder_pdf(pdf_path, digits)
        await self.log("PDF Downloaded", f"[TEST] Simulated E-Way Bill PDF saved: {pdf_path.name}", dispatch_no)
        result["shots"]["after_download"] = await self.capture_screenshot(f"ewbprint_done_{digits}")
        result["pdf_path"] = str(pdf_path)
        result["pdf_name"] = pdf_path.name
        return result


def _placeholder_pdf(path, digits):
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(str(path))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, 780, "E-WAY BILL (TEST MODE SIMULATION)")
    c.setFont("Helvetica", 12)
    c.drawString(72, 750, f"E-Way Bill No: {digits}")
    c.drawString(72, 730, "This PDF was generated by the TEST simulation - no portal was contacted.")
    c.showPage()
    c.save()


def _png_to_pdf(png_path, pdf_path):
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
    img = ImageReader(str(png_path))
    w, h = img.getSize()
    c = canvas.Canvas(str(pdf_path), pagesize=(w, h))
    c.drawImage(img, 0, 0, width=w, height=h)
    c.showPage()
    c.save()
