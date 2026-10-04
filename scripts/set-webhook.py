#!/usr/bin/env python3
"""Point @pantapotbot at the hosted webhook. Reads token + secret from chmod-600 files; prints only Telegram's answers."""
import json, os, sys, urllib.request
url = sys.argv[1] if len(sys.argv) > 1 else "https://pot-navy.vercel.app/api/telegram/webhook"
tok = open(os.path.expanduser("~/.pot/telegram_token")).read().strip()
sec = open(os.path.expanduser("~/.pot/webhook_secret")).read().strip()
def call(method, payload=None):
    req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/{method}", data=json.dumps(payload or {}).encode(), headers={"content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        return json.load(e)
if "--info" not in sys.argv:
    print("setWebhook:", call("setWebhook", {"url": url, "secret_token": sec, "drop_pending_updates": True, "allowed_updates": ["message", "callback_query", "my_chat_member"], "max_connections": 20}))
info = call("getWebhookInfo")["result"]
print("getWebhookInfo:", {k: info.get(k) for k in ["url", "pending_update_count", "last_error_date", "last_error_message", "max_connections", "allowed_updates"]})
