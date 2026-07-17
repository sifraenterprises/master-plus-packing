import asyncio
import os
import socket
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT.parent / "backend"
sys.path.insert(0, str(BACKEND))
load_dotenv(ROOT / ".env")

from playwright.async_api import async_playwright


def show(name, ok, detail):
    print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")
    return ok


async def main():
    api = os.environ.get("API_BASE_URL", "").rstrip("/")
    token = os.environ.get("DESKTOP_WORKER_TOKEN", "")
    portal = os.environ.get("TAFE_PORTAL_URL", "")
    all_ok = True
    try:
        r = requests.get(api + "/health", timeout=20)
        all_ok &= show("VPS API", r.ok, f"HTTP {r.status_code}")
    except Exception as exc:
        all_ok &= show("VPS API", False, str(exc))
    try:
        r = requests.post(api + "/worker/register", timeout=20,
                          headers={"X-Worker-Token": token},
                          json={"worker_name": os.environ.get("WORKER_NAME", socket.gethostname()),
                                "hostname": socket.gethostname(), "version": "1.0.0", "capabilities": ["test"]})
        all_ok &= show("Worker token", r.ok, f"HTTP {r.status_code}")
    except Exception as exc:
        all_ok &= show("Worker token", False, str(exc))
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=False)
            page = await browser.new_page()
            await page.goto(portal, wait_until="domcontentloaded", timeout=30000)
            all_ok &= show("TAFE portal", True, page.url)
            await browser.close()
    except Exception as exc:
        all_ok &= show("TAFE portal", False, f"{type(exc).__name__}: {exc}")
    raise SystemExit(0 if all_ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
