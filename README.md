# 🍯 Pot — group prediction markets on Panta

**Pot** turns a Telegram group into a prediction-market crew:

1. An admin types `/new Will Super Eagles beat Ghana Sat 8pm?` in the group. `@pantapotbot` drafts a clear rule, sources, and times (WAT).
2. The admin taps **✅ Create**, opens the link, and signs/pays the Panta fee in their own wallet. They become the creator and earn the royalty.
3. Members tap **Buy YES / Buy NO** (or share a **Blink** on X). Every buy is credited to the group and to the member whose link was used (`/top`).
4. Every card and page shows the **Reading Layer verdict** (Thin / Crowded / Overconfident / Ordinary) and "pays about $X if right".

## Layout
| Path | What |
|---|---|
| `packages/core` | Pure logic: verdict, payout + royalty estimates, market drafting (chrono, WAT), Telegram card, Solana Actions payloads, refs |
| `packages/server` | Panta client (rate limit, cache, write allowlist + live-write guard), SQLite store, signed tokens, flows (buy/create/claim/link), devnet-memo sandbox tx |
| `apps/web` | Next.js 16 site on :3100: landing, `/m/[id]`, `/create/[draftId]`, `/claim/[id]`, `/link`, `/leaderboard`, `/actions.json`, `/api/actions/m/[id]` (Blinks), `/api/pot/*` |
| `apps/bot` | grammY bot: `/new /markets /post /market /share /top /mine /link /admin`, buy alerts, phase/result posts |
| `scripts/` | `sandbox-e2e.ts` (full flow vs local web), `record-sandbox-fixtures.ts`, `shot-prep.ts`, `secret-scan.py` |

## Modes
* `PANTA_MODE=test` (default): uses the `pk_test` key. Panta answers with **sandbox fixtures** (one test market, canned quote/build/submit/verify). Since the sandbox returns no instructions, Pot swaps in a **free devnet memo transaction** so the wallet sign → broadcast → submit path still runs. A "Simulate" button / `sandbox_…` signature works when devnet is unavailable.
* `PANTA_MODE=live`: mainnet reads with the live key. **All writes stay blocked** unless `POT_ALLOW_LIVE_WRITES=1` is also set (Phase 2, with approval).

## Secrets (files, chmod 600; never env, never committed)
| File | Used for |
|---|---|
| `~/.panta/api_key` | Panta `pk_live` key (override path: `PANTA_KEY_FILE`) |
| `~/.panta/test_key` | Panta `pk_test` key (`PANTA_TEST_KEY_FILE`) |
| `~/.pot/telegram_token` | Bot token for @pantapotbot (`POT_TELEGRAM_TOKEN_FILE`) |
| `~/.pot/hmac_secret` | Signs create/link tokens and group refs; auto-created (`POT_HMAC_SECRET_FILE`) |

The server refuses a key file that is not chmod 600. Turbopack's persistent cache is off so nothing is snapshotted to disk. Run `python3 scripts/secret-scan.py .` before committing (checks source, `.next`, `data/`).

## Commands
```bash
npm install
npm test                 # vitest: core + server (sandbox fixtures, fetch mocked) + bot (fake updates)
npm run typecheck
npm run dev:web          # http://localhost:3100  (PANTA_MODE=test by default)
npm run dev:bot          # long polling; exits politely if no token file
npx tsx scripts/sandbox-e2e.ts   # Blink GET→POST→sign→next, web buy w/ group ref, create, wallet link, leaderboard
npm run build
```

## Going live (not done in Phase 1)
* Host web on a public **https** URL (Telegram URL buttons and Blinks need it), set `POT_PUBLIC_URL`; swap SQLite for a hosted DB if on serverless; run the bot as webhook or on a small always-on host.
* Fund a real Phantom wallet, then `PANTA_MODE=live POT_ALLOW_LIVE_WRITES=1` only after approval.
