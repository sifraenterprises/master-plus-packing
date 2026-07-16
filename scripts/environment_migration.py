#!/usr/bin/env python3
"""One-time, repeatable Test/Live environment tagging migration.

Rules (approved):
- Existing genuine business records => environment=live, is_test=False
- Records with obvious test indicators => environment=test, is_test=True
  Indicators: TEST/DEMO/SAMPLE/DUMMY in key fields, is_test already true,
  mode=="test", dry-run flags, [TEST] simulated automation logs.
- Idempotent: records that already carry an `environment` field are never touched.
- Dry-run by default. Pass --apply to write. Take a MongoDB backup first.

Usage:  python3 scripts/environment_migration.py [--apply]
"""
import argparse
import asyncio
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")
from motor.motor_asyncio import AsyncIOMotorClient

TEST_RX = re.compile(r"TEST|DEMO|SAMPLE|DUMMY", re.I)

# collection -> string fields checked for test/demo indicators
COLLECTIONS = {
    "master_dispatch": ["invoice_number", "dispatch_no", "customer_name", "created_by"],
    "dispatch_entries": ["invoice_number", "customer_name", "created_by"],
    "packing_slips": ["invoice_number", "customer_name", "created_by"],
    "asn_creation": ["invoice_no", "dispatch_no", "po_number", "created_by"],
    "eway_submissions": ["dispatch_no", "created_by"],
    "vendor_eway_acknowledgement": ["dispatch_no", "invoice_number", "created_by"],
    "pdi_reports": ["invoice_number", "part_name", "report_no", "created_by"],
}


def is_test_doc(doc: dict, fields: list) -> tuple:
    """Return (is_test, reason) for an untagged document."""
    if doc.get("is_test") is True:
        return True, "already marked is_test"
    if str(doc.get("mode", "")).lower() == "test":
        return True, "mode=test"
    if doc.get("dry_run") is True:
        return True, "dry-run record"
    if doc.get("submitted") is False and str(doc.get("status", "")).lower() in (
            "validation", "validated", "validation_only", "test_completed"):
        return True, "validation-only, not submitted"
    for f in fields:
        v = str(doc.get(f) or "")
        if v and TEST_RX.search(v):
            return True, f"{f}='{v}' matches test indicator"
    # items array part names (master dispatch)
    for item in doc.get("items") or []:
        for f in ("part_number", "description"):
            v = str(item.get(f) or "")
            if v and TEST_RX.search(v):
                return True, f"item {f}='{v}' matches test indicator"
    return False, "genuine business record"


async def main(apply: bool):
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    now = datetime.now(timezone.utc).isoformat()
    print(f"{'APPLY' if apply else 'DRY-RUN'} — environment migration @ {now}\n")
    grand = {"live": 0, "test": 0, "skipped": 0}

    for coll, fields in COLLECTIONS.items():
        live_ids, test_docs, skipped = [], [], 0
        async for doc in db[coll].find({}):
            if "environment" in doc:
                skipped += 1
                continue
            test, reason = is_test_doc(doc, fields)
            if test:
                test_docs.append((doc["_id"], reason))
            else:
                live_ids.append(doc["_id"])
        print(f"[{coll}] live={len(live_ids)} test={len(test_docs)} already_tagged={skipped}")
        for _id, reason in test_docs:
            print(f"    -> TEST {_id}: {reason}")
        if apply:
            if live_ids:
                await db[coll].update_many({"_id": {"$in": live_ids}}, {"$set": {
                    "environment": "live", "is_test": False, "environment_migrated_at": now}})
            if test_docs:
                await db[coll].update_many({"_id": {"$in": [t[0] for t in test_docs]}}, {"$set": {
                    "environment": "test", "is_test": True, "environment_migrated_at": now}})
        grand["live"] += len(live_ids)
        grand["test"] += len(test_docs)
        grand["skipped"] += skipped

    # automation history: [TEST] simulated logs are test, the rest live
    q_untagged = {"environment": {"$exists": False}}
    n_test = await db.automation_logs.count_documents({**q_untagged, "message": {"$regex": r"\[TEST\]"}})
    n_live = await db.automation_logs.count_documents(q_untagged) - n_test
    print(f"[automation_logs] live={n_live} test={n_test} (by [TEST] marker)")
    if apply:
        await db.automation_logs.update_many({**q_untagged, "message": {"$regex": r"\[TEST\]"}}, {"$set": {
            "environment": "test", "is_test": True, "environment_migrated_at": now}})
        await db.automation_logs.update_many(q_untagged, {"$set": {
            "environment": "live", "is_test": False, "environment_migrated_at": now}})
    grand["live"] += n_live
    grand["test"] += n_test

    print(f"\nTOTAL: live={grand['live']} test={grand['test']} already_tagged={grand['skipped']}")
    if not apply:
        print("Dry-run only — nothing was written. Re-run with --apply after taking a backup.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    asyncio.run(main(ap.parse_args().apply))
