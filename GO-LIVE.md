# Pot: going live (real money)

Pot runs in **practice mode** (`PANTA_MODE=test`) right now. Nothing real can move: no live key on Vercel,
`POT_ALLOW_LIVE_WRITES` is not set, and practice markets never build a transaction. This page is the checklist
for switching to real USDC on Solana mainnet, and for switching back.

## 1. What you (Baheet) need to fund

| Who | What | Why |
|---|---|---|
| Market creator wallet (Phantom, whoever taps **Create**) | **$20 USDC** per breaking market (starts within 72h), **$50 USDC** per standard market, plus **~0.02 SOL** | Panta's creation fee. Of the $20, $5 goes into the market as starting liquidity and $15 is Panta's fee (seen on the live quote). Not refundable, even if the market is cancelled. SOL pays network fees and account rent. |
| Each buyer | The USDC they want to bet (min $1) **+ 2%** Panta fee, plus **~0.005–0.01 SOL** | Pot checks this before asking them to sign and says what's missing in plain words. |
| You, for the smoke test | One creator wallet with ~$25 USDC + 0.05 SOL; one buyer wallet with ~$3 USDC + 0.01 SOL | Enough for one breaking market and one $1 buy. |
| A mainnet RPC (Helius / Triton / QuickNode, free tier is fine to start) | Free | The public `api.mainnet-beta` RPC rate-limits wallets and Pot's balance check. |

Pot never holds anyone's keys or money. Every payment is signed in the user's own wallet.

## 2. The one-step switch

Before you flip, check all of these:
- [ ] The wallets above are funded.
- [ ] You have a private mainnet RPC URL.
- [ ] `~/.panta/api_key` on the box holds the live key (`pk_live_…`). It's already there.
- [ ] You accept the risks in section 5.

Then run, from `/workspace/pot` on the box:

```bash
scripts/go-live.sh --yes-real-money "https://mainnet.helius-rpc.com/?api-key=…"
```

It sets these **Vercel production env vars** and redeploys. Values are piped in, never printed.

| Env var | Value | Notes |
|---|---|---|
| `PANTA_MODE` | `live` | The switch. Any other value means practice. |
| `POT_ALLOW_LIVE_WRITES` | `1` | Second lock. Without it, every live quote, build, create and claim is refused before reaching Panta. |
| `POT_PANTA_LIVE_KEY` | from `~/.panta/api_key` | Server-only, marked sensitive. |
| `SOLANA_RPC_URL` | your mainnet RPC | Without it, live mode falls back to the public mainnet RPC. |

Already set, so leave these alone: `DATABASE_URL`, `CRON_SECRET`, `POT_TELEGRAM_TOKEN`, `POT_TELEGRAM_WEBHOOK_SECRET`,
`POT_HMAC_SECRET`, `POT_PUBLIC_URL`, `POT_GEMINI_KEY`.
Optional: `POT_DEFAULT_IMAGE_URL`. Live mode otherwise uses `<site>/market-default.png`, which Pot hosts.

Doing it by hand instead? Set the four vars in Vercel → Project `pot` → Settings → Environment Variables (Production),
then redeploy.

**Check it worked.** Look for `"ready": true` from:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/pot/ready
```

This lists each setting as ok or not. It shows names only, never values.

The Telegram webhook doesn't change, because it's the same bot and URL. The `/settle` command is hidden and refused in live
mode. Real markets settle from Panta's result.

## 3. Smoke test (about $21 total)

1. In a test group, draft a market that starts within 72h → **Create**. Phantom should show **$20.00 USDC**.
   Pot refuses to continue if Panta quotes any other amount.
2. Check the card shows in the group and the market appears on panta.market.
3. Buy **$1 YES** from the second wallet on the web page, then once through the Blink. You should see a
   "bought" message in the group, and the buy listed on the market page.
4. Try a buy from an empty wallet. You should get a plain "not enough USDC / SOL" message, with nothing to sign.
5. Cancel a signature in Phantom. You should see "You cancelled in your wallet. Nothing was sent or charged."
6. After the result is posted: Panta's 1-hour dispute window passes, then the group gets the receipt.
   The winner can then claim on `/claim`, and the creator can claim the royalty there too.

## 4. Roll back to practice

```bash
scripts/rollback-to-practice.sh
```

This removes `POT_ALLOW_LIVE_WRITES`, `POT_PANTA_LIVE_KEY` and `SOLANA_RPC_URL`, sets `PANTA_MODE=test`, and redeploys.
Once the deploy finishes (about a minute), no real-money action is possible. Database rows are tagged by mode, so live data is kept,
but it's hidden in practice mode and comes back if you go live again. Real markets that already exist on Panta keep running
on Panta. Users can still claim winnings at panta.market.

## 5. What's checked and what isn't

Already checked against the **live** API, read-only, with nothing signed or submitted:
- The shapes of buy quotes and builds (2% fee, instructions, blockhash) match Pot's code.
- Create quotes and builds work: $20 = `20000000` base units, of which $5 is liquidity; Pot's request body is accepted.
- Market lists, details and trades parse correctly.
- Error codes come back without messages (`NOT_CLAIMABLE`, `NOT_MARKET_CREATOR`, `DUPLICATE_MARKET`), so Pot now explains them in plain words.

Can only be checked with real money:
- Phantom signing and sending on mainnet, and Panta's `submit` → `verify` → `confirmed` sequence.
- Trade attribution (`/trades/`) and group credit.
- Market registration after a real create.
- Real resolution timing, the dispute window, and the receipt that follows.
- Claiming winnings and the creator royalty.

## 6. Known risks

- **Receipts in quiet groups**: Vercel Hobby only allows a daily cron (09:00). Pot also checks results on any bot or web
  activity, at most every 5 minutes. For prompt receipts, point a free pinger (e.g. cron-job.org) at `/api/cron/settle` with the
  `CRON_SECRET` bearer, every 10 minutes.
- **One-sided markets**: under Panta's rules, buyers on the only side get back less than they put in (e.g. $10 → about $6.88).
  Receipts say this clearly. Tell groups before they play.
- **Creation fee is final**: no refund, even if Panta cancels the market.
- **Slow confirmations**: if Solana hasn't confirmed after about 20 seconds, the buyer sees "Check again" instead of
  paying twice. Pot records the buy once it's confirmed.

## Note: PANTA_READ_KEY (already set, read-only)
Production has `PANTA_READ_KEY` so practice mode can show real Panta markets (`/panta`, home page). It is used only by
`livepanta.ts`, which can only send GETs. It does not turn on live mode or live writes; leave it in place when rolling back.
