# Pot: TestSprite Season 4 submission

## What it is
Pot is a Telegram bot (t.me/pantapotbot) that turns group-chat arguments into prediction markets. When friends argue ("Arsenal win Sunday", "BTC hits $100k by Friday"), Pot drafts a clear yes/no market on Panta (Solana), and anyone in the group can back a side from a market page or a Solana Blink. The leaderboard credits whoever's link brought in the buys, and a daily job settles markets. Receipts can be shared to X or Telegram in one tap. It runs in practice mode, where a buy is a free signed message and no real money moves.

## Links
- Repo: https://github.com/Baheet18/pot
- Live site: https://pot-navy.vercel.app
- Bot: https://t.me/pantapotbot
- PR with TestSprite check (blocking, passed): https://github.com/Baheet18/pot/pull/1 (share receipts + blank-amount validation fix)
- TestSprite run (4/4 passed): https://www.testsprite.com/dashboard-v3/o/415350c9-f7ec-5282-be9e-1aafce445cb7/projects/6f7b3451-bae0-4dd0-a8c3-10a05930615e/execution/003980a8-7c5e-47ad-9f1a-cef0996bb640
- Test plan: submission/testsprite/test-plan.md

## Test coverage
- **TestSprite:** a 4-test end-to-end suite that runs against the live site on every PR as the blocking `TestSprite V3` status check. A PR can't merge until the suite passes.
- **Unit tests:** 212 Vitest tests in 19 files (`npm test`). They cover market drafting, odds and payout maths, amount validation (blank, zero, negative or over-max amounts are rejected with BAD_AMOUNT), the share helpers, the server routes with mocked fetch, and the bot handling fake Telegram updates.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) runs typecheck and the unit tests on every PR and every push to main.
- **Found and fixed:** blank amount input used to be read as a number. Now it returns a 400 in the buy API and in Blinks, and tests cover it.

## What's innovative
- Markets come straight out of group chat. No one has to open an app to start one.
- Solana Blinks let people back a side from any link.
- Group referral credit turns a market into a social game.
- For sports, the bot looks up the real fixture (ESPN public scoreboard) so the market matches the actual game.
- A testing tool checks a crypto app end to end against its live URL, with merges blocked on failure.

## X post draft
I entered @Test_Sprite Season 4 with Pot, my Telegram bot that turns group-chat arguments into prediction markets on Solana.

Every PR now runs TestSprite against the live site, and it can't merge until the check passes. It also has 212 unit tests and caught a blank-amount bug along the way.

Try it: t.me/pantapotbot
Code: github.com/Baheet18/pot

What argument should I turn into a market first?
