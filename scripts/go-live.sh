#!/usr/bin/env bash
# ONE-STEP SWITCH to real money. Do not run until GO-LIVE.md "Before you flip" is done.
# Sets the live env vars on Vercel production and redeploys. The key is piped from the file, never printed.
#   usage: scripts/go-live.sh --yes-real-money https://<mainnet-rpc-url>
set -euo pipefail
[ "${1:-}" = "--yes-real-money" ] || { echo "Refusing: pass --yes-real-money <mainnet RPC URL> (see GO-LIVE.md)."; exit 1; }
RPC="${2:-}"; case "$RPC" in https://*) ;; *) echo "Need a private https mainnet RPC URL as 2nd argument."; exit 1;; esac
KEY_FILE="${PANTA_KEY_FILE:-$HOME/.panta/api_key}"
grep -qE '^pk_live_[A-Za-z0-9_-]+$' "$KEY_FILE" || { echo "Live key file missing or malformed: $KEY_FILE"; exit 1; }
export PATH="$HOME/.local/bin:$PATH"
setvar() { vercel env rm "$1" production --yes </dev/null >/dev/null 2>&1 || true; printf '%s' "$2" | vercel env add "$1" production --sensitive >/dev/null; echo "set $1"; }
vercel env rm POT_PANTA_LIVE_KEY production --yes </dev/null >/dev/null 2>&1 || true
tr -d '\n' < "$KEY_FILE" | vercel env add POT_PANTA_LIVE_KEY production --sensitive >/dev/null && echo "set POT_PANTA_LIVE_KEY (value not shown)"
setvar SOLANA_RPC_URL "$RPC"
setvar PANTA_MODE live
setvar POT_ALLOW_LIVE_WRITES 1
vercel deploy --prod --yes </dev/null | tail -1
echo "Now: curl -H \"Authorization: Bearer \$CRON_SECRET\" <site>/api/pot/ready  → expect ready:true"
