#!/usr/bin/env bash
# Back to practice (test) mode: no real money can move after the redeploy. Live rows stay in the DB (mode-scoped) for later.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
for v in POT_ALLOW_LIVE_WRITES POT_PANTA_LIVE_KEY PANTA_MODE SOLANA_RPC_URL; do vercel env rm "$v" production --yes </dev/null >/dev/null 2>&1 && echo "removed $v" || true; done
printf 'test' | vercel env add PANTA_MODE production >/dev/null && echo "set PANTA_MODE=test"
vercel deploy --prod --yes </dev/null | tail -1
