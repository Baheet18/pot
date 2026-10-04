#!/usr/bin/env python3
"""Scan the repo (incl. .next build output and data/, excluding node_modules) for any of our secret values. Prints only file names."""
import os, json, sys
secrets = {}
for name, path in [("panta live key", "~/.panta/api_key"), ("panta test key", "~/.panta/test_key"), ("telegram token", "~/.pot/telegram_token"), ("hmac secret", "~/.pot/hmac_secret"), ("webhook secret", "~/.pot/webhook_secret"), ("cron secret", "~/.pot/cron_secret")]:
    try:
        v = open(os.path.expanduser(path)).read().strip()
        if v: secrets[name] = v.encode()
    except FileNotFoundError:
        pass
try:
    import base64
    arr = json.load(open(os.path.expanduser("~/.panta/sandbox_wallet.json")))
    secrets["wallet secret (json)"] = json.dumps(arr).replace(" ", "").encode()[:60]
    secrets["wallet secret (b64)"] = base64.b64encode(bytes(arr)).rstrip(b"=")[:40]
except Exception:
    pass
root = sys.argv[1] if len(sys.argv) > 1 else "."
hits = 0
for dp, dn, fn in os.walk(root):
    dn[:] = [d for d in dn if d not in ("node_modules", ".git")]
    for f in fn:
        p = os.path.join(dp, f)
        try:
            b = open(p, "rb").read()
        except Exception:
            continue
        for name, v in secrets.items():
            if v in b:
                print(f"HIT {name}: {p}"); hits += 1
print(f"checked {len(secrets)} secrets; hits={hits}")
sys.exit(1 if hits else 0)
