# New TestSprite tests for Pot (paste into the TestSprite portal)

Base URL: https://pot-navy.vercel.app. All routes checked with curl on Oct 21, 2026 (WAT).
Sample open market used below: `8Yawu1vKayKBAb8rfghLfKk5QVfDv3cDExrAmHxH9jUU` (Tinubu 2027, practice). If it's cleared, open any market card from the home page instead.
Wallet steps can't be automated (TestSprite can't approve Phantom), so buy-amount tests use the Blink Action API, which runs the same amount rules.

## 1. Home page loads with main calls to action
Steps: Open `/`.
Expected: Page loads (200). Practice-mode banner visible. "Add Pot to a group" links to `https://t.me/pantapotbot?startgroup=true`. "See the leaderboard" link is present.

## 2. Home → leaderboard navigation
Steps: Open `/`, click "See the leaderboard".
Expected: URL is `/leaderboard`, page loads (200), leaderboard heading is shown, no error page.

## 3. Market page shows the market and split
Steps: Open `/m/<sample id>`.
Expected: 200. Title is shown as an h1. YES price, Pot, People and "Buying closes" stats are visible. The buy panel with a "USDC amount" input and a "Get quote" button is shown.

## 4. Market page share on X
Steps: On `/m/<sample id>`, find the element with `data-testid="share-x"` ("𝕏 Post on X").
Expected: href starts with `https://x.com/intent/post?` and contains the market URL `pot-navy.vercel.app/m/<sample id>`. Opens in a new tab (`target="_blank"`).

## 5. Unknown market id shows "Market not found"
Steps: Open `/m/does-not-exist`.
Expected: HTTP 404 and the "Market not found" card with a "See open markets" link. No crash or blank page.

## 6. Unknown Blink id shows "Market not found"
Steps: Open `/blink/does-not-exist`.
Expected: HTTP 404 and the "Market not found" card.

## 7. Claim page for an unknown market shows "Market not found"  ← catches the live bug
Steps: Open `/claim/does-not-exist`.
Expected: HTTP 404 and the "Market not found" card. There must be NO "Claim winnings" heading and NO "Select Wallet" button.
(Today this FAILS on the live site: see "Bug found" below.)

## 8. Unknown route shows the not-found page
Steps: Open `/this-page-does-not-exist`.
Expected: HTTP 404 with the "Market not found" card and a link back home.

## 9. actions.json maps market pages to the Action API
Steps: GET `/actions.json`.
Expected: 200 JSON with `rules` containing `{"pathPattern":"/m/*","apiPath":"/api/actions/m/*"}` and a `/blink/*` rule.

## 10. Blink GET returns a valid action
Steps: GET `/api/actions/m/<sample id>`.
Expected: 200 JSON with `type: "action"`, a non-empty `title`, an `icon` under `/api/og/`, and `links.actions` that include YES and NO buttons.

## 11. Blink GET for an unknown market
Steps: GET `/api/actions/m/does-not-exist`.
Expected: 404 JSON with `code: "NOT_FOUND"` and a readable message.

## 12. Buy with a valid amount ($5)
Steps: POST `/api/actions/m/<sample id>?side=yes&amount=5` with JSON body `{"account":"11111111111111111111111111111111"}`.
Expected: 200 JSON response (practice mode returns a `type: "message"` to sign, saying no real money moves). No error message.

## 13. Buy with blank, zero and negative amounts is rejected
Steps: POST the same request with `amount=` (blank), then `amount=0`, then `amount=-5`.
Expected: Each returns 400 with `{"message":"Enter between $1 and $500"}`.

## 14. Buy over the max and non-numeric amounts are rejected
Steps: POST with `amount=501`, then `amount=abc`, then `amount=1e9`.
Expected: Each returns 400 with `{"message":"Enter between $1 and $500"}`.

## 15. Mobile layout of the market page
Steps: Set viewport to 390×844 (iPhone). Open `/m/<sample id>`.
Expected: No horizontal scrolling; the title wraps; the buy panel stacks below the market details; "Get quote" button is fully visible and tappable.

Notes:
- Receipts: the receipt block (`data-testid="receipt"`) and its buttons (`receipt-share`, `receipt-share-x`) only appear on settled markets. No settled market is live right now, so I didn't add a receipt test; add one with a settled market id when one exists. The web app has no Telegram share button (Telegram sharing happens in the bot), so there's no Telegram-share test.

---

## Bug found: `/claim/<unknown id>` shows a claim form instead of "Market not found"

Evidence (live, Oct 21, 2026):
```
$ curl -s -o /dev/null -w '%{http_code}' https://pot-navy.vercel.app/claim/abc
200
$ curl -s -o /dev/null -w '%{http_code}' https://pot-navy.vercel.app/m/abc
404
```
Rendered in headless Chrome, `/claim/abc` shows: "Claim winnings · abc · Practice mode… Select Wallet". So for a market that doesn't exist, Pot shows the raw id as the title and invites the user to connect a wallet and claim. `/m/abc` and `/blink/abc` correctly show "Market not found".

Cause: `apps/web/src/app/claim/[id]/page.tsx` falls back to `v?.market.title ?? id` and always renders `ClaimPanel`, instead of calling `notFound()` like the market page.

Fix: branch `fix/claim-unknown-market` (commit 0b0c81f, local only). The page now calls `notFound()` when the market isn't found or the lookup fails. Added `apps/web/test/claim-page.test.ts` (3 tests: unknown id → 404, failed lookup → 404, real market → form with its title) and included `apps/web/test` in vitest. The two 404 tests fail on the old code and pass with the fix. Full suite: 215 tests pass; typecheck clean.

---

## Replacement test text after the 09:14 WAT run (paste into the TestSprite editor)

### Replace "Market page shows core betting details and quote form"
Title: Market page shows betting details and asks a visitor to connect a wallet
Steps: Open https://pot-navy.vercel.app/m/8Yawu1vKayKBAb8rfghLfKk5QVfDv3cDExrAmHxH9jUU with no wallet connected.
Expected: The market title is shown as a heading. "YES price", "Pot", "People" and "Buying closes" are visible. "Buy YES" and "Buy NO" buttons, the $2/$5/$10/$20 buttons and a "USDC amount" input are visible. Clicking "Buy NO" highlights it, and clicking "$10" puts 10 in the amount input. A "Select Wallet" button is shown. A "Get quote" button is NOT expected without a wallet, because quotes need the buyer's wallet address.

### Replace "Buy quote action validates amount range"
Title: Blink buy API rejects out-of-range amounts
Steps: This is an API test, not a UI test; don't use the web buy form. Send HTTP POST requests to https://pot-navy.vercel.app/api/actions/m/8Yawu1vKayKBAb8rfghLfKk5QVfDv3cDExrAmHxH9jUU?side=yes&amount=AMOUNT with header Content-Type: application/json and body {"account":"11111111111111111111111111111111"}. Use AMOUNT = 5, then empty, then 0, -5, 501 and abc.
Expected: amount=5 returns HTTP 200 with JSON "type":"message" (a free practice signature). Every other amount returns HTTP 400 with JSON {"message":"Enter between $1 and $500"}.

### Replace "Sample market page fits a mobile viewport without horizontal scrolling"
Title: Market page fits a phone screen
Steps: Use a 390x844 viewport (iPhone 12/13/14). If you can't change the viewport, resize the browser window to 390 px wide. Open https://pot-navy.vercel.app/m/8Yawu1vKayKBAb8rfghLfKk5QVfDv3cDExrAmHxH9jUU. Check that document.documentElement.scrollWidth is no larger than window.innerWidth.
Expected: There's no sideways scrolling: scrollWidth equals the viewport width (390). The whole title and the "YES price" and "Pot" stats are visible without scrolling sideways. The "Buy a side" panel sits below the market details.
(This fails on today's live site, where scrollWidth is 635 at 390 px. It passes after the fix/claim-unknown-market branch is deployed.)
