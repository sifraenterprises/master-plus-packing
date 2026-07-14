import os
import time
import asyncio
import logging
import smtplib
from email.mime.text import MIMEText
import requests

logger = logging.getLogger("alerts")
_THROTTLE = int(os.environ.get("ALERT_THROTTLE_SECONDS", "1800"))
_last_sent = {}


def alert_channels():
    return {
        "telegram": bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID")),
        "email": bool(os.environ.get("SMTP_HOST") and os.environ.get("ALERT_EMAIL_TO")),
    }


def _telegram(text: str):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      json={"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": text},
                      timeout=15)
    r.raise_for_status()


def _email(subject: str, body: str):
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = os.environ.get("ALERT_EMAIL_FROM") or os.environ.get("SMTP_USER", "alerts@grewal.local")
    msg["To"] = os.environ["ALERT_EMAIL_TO"]
    with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "587")), timeout=20) as s:
        s.ehlo()
        if os.environ.get("SMTP_TLS", "true").lower() != "false":
            s.starttls()
        if os.environ.get("SMTP_USER"):
            s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
        s.sendmail(msg["From"], [e.strip() for e in msg["To"].split(",")], msg.as_string())


def send_alert_sync(subject: str, message: str, force: bool = False) -> dict:
    now = time.time()
    if not force and now - _last_sent.get(subject, 0) < _THROTTLE:
        return {"throttled": True}
    _last_sent[subject] = now
    text = f"🚨 Grewal Engineering Works\n{subject}\n\n{message}"
    channels = alert_channels()
    results = {}
    senders = {"telegram": lambda: _telegram(text),
               "email": lambda: _email(f"[GEW Alert] {subject}", message)}
    for name, fn in senders.items():
        if not channels[name]:
            results[name] = "not configured"
            continue
        try:
            fn()
            results[name] = "sent"
        except Exception as e:
            results[name] = f"error: {str(e)[:100]}"
            logger.error("Alert via %s failed: %s", name, e)
    return results


async def send_alert(subject: str, message: str, force: bool = False) -> dict:
    """Fire-and-forget safe alert dispatch (never raises)."""
    try:
        return await asyncio.to_thread(send_alert_sync, subject, message, force)
    except Exception as e:
        logger.error("send_alert failed: %s", e)
        return {"error": str(e)[:100]}
