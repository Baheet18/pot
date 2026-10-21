# dev.to post

**Title:** TestSprite caught a bug on my live app before I did

I'm Baheet, a builder in Lagos. For TestSprite Season 4 I entered Pot, a Telegram bot that turns group-chat arguments into prediction markets on Solana, powered by Panta. You type something like "Tinubu wins in 2027", Pot makes a market, and your friends pick YES or NO from a link that works as a web page and as a Solana Blink.

Live app: https://pot-navy.vercel.app · Bot: https://t.me/pantapotbot · Repo: https://github.com/Baheet18/pot

## The setup

Pot already had a lot of unit tests (219 now), and they all passed. Unit tests check my functions. They don't check what a person actually sees when they open a link from a group chat.

So I connected the TestSprite GitHub App. Every pull request now gets a blocking "TestSprite V3" check. It waits for CI to pass, then runs a browser test suite against the live site. If it fails, the PR can't merge.

I started with 4 tests. That proved the wiring worked, but it wasn't much coverage. So I wrote 13 tests covering the parts people actually touch:

- the home page and leaderboard
- the market page: title, split, price, buy panel, and the "Post on X" share link
- the Blink Action API: valid buys, plus blank, zero, negative, over-the-limit and non-number amounts
- every page that takes a market id, opened with an id that doesn't exist
- the mobile layout at phone width

Most of them passed straight away. One didn't.

## The bug

Pot sends winners a link like `/claim/<market id>`. I wrote a test that opens `/claim/` with a market id that doesn't exist. I expected the same "Market not found" page that `/m/` shows.

Instead the live site returned a 200 and a full claim page. The heading said "Claim winnings", the title was just the raw id, and there was a "Select Wallet" button. So if someone opens an old or mistyped claim link, Pot asks them to connect a wallet and claim from a market that isn't there. Nobody can lose money in practice mode, but it's confusing and it looks broken.

The TestSprite check went red on the PR: 12/13 passed, and the claim test failed ([report](https://www.testsprite.com/dashboard-v3/o/415350c9-f7ec-5282-be9e-1aafce445cb7/projects/6f7b3451-bae0-4dd0-a8c3-10a05930615e/execution/b81633f4-8e11-4b63-9231-80096eb91af7)). Merging was blocked.

The cause was one line. The claim page fell back to showing the id when it couldn't find the market, and it always rendered the claim form. The market page calls `notFound()` in that case, but the claim page didn't.

## The fix

The fix is small: if the market isn't found, or looking it up fails, the claim page shows the same "Market not found" page as everywhere else, with a 404. I added unit tests for both cases and for a real market. Then I deployed and re-ran the check. It went green: 13/13 ([report](https://www.testsprite.com/dashboard-v3/o/415350c9-f7ec-5282-be9e-1aafce445cb7/projects/6f7b3451-bae0-4dd0-a8c3-10a05930615e/execution/802b70df-0e27-4205-bffb-0549b1223847)), and the PR merged.

PR with red, then green: https://github.com/Baheet18/pot/pull/2

## Not everything went to plan

My first run had 14 tests and came back 10/14. Only one failure was the real bug. Two were badly worded tests: one opened the wrong address for the actions manifest, and one picked a market where buying had already closed, so "no YES/NO buttons" was the correct answer. I reworded both.

The fourth was a phone-layout test. It caught something real: on a 390px-wide phone the market page laid out at 635px and scrolled sideways, because the grid column stretched to its content. I fixed it in the same PR (`minmax(0,1fr)` grid columns, plus unit tests) and checked it in headless Chrome: 390px wide after the fix. But TestSprite's browser runner can't change screen size, so it couldn't check this, and I removed that test. That left 13.

## What I took from it

- Unit tests passing doesn't mean the app works. My tests checked the market lookup itself. They never asked what the claim page does when the lookup comes back empty.
- Test every page with bad input, not only the happy path. All three pages that take a market id needed the same check, and only two had it.
- A check that blocks merging changes how you work. I couldn't ship around the red X. I had to fix it.

One honest note: TestSprite runs against my live production URL, so the red run was against the real, buggy site. I deployed the fix from the PR branch and re-ran the check before merging. Per-PR preview URLs would be cleaner, and that's next.

This was built with AI help. I reviewed the tests and the fix myself.

---

# X thread (tag @Test_Sprite)

1/
I added 13 @Test_Sprite tests to Pot, my Telegram bot that turns group-chat arguments into prediction markets on Solana.

One of them caught a real bug on the live site before any user hit it 🧵

2/
Every PR on Pot gets a blocking TestSprite check that runs against the live app. The tests cover the market page, the leaderboard, the Blink buy API (blank, zero, negative and over-the-limit amounts), bad market ids and the mobile layout.

3/
The bug: opening a claim link for a market that doesn't exist showed a "Claim winnings" page with a wallet button, instead of "Market not found".

The check went red: 12/13. Merging was blocked.

4/
The fix was one missing notFound() check, plus unit tests. I deployed it and the check went green: 13/13.

I also fixed the market page scrolling sideways on phones.

PR, red then green: https://github.com/Baheet18/pot/pull/2

5/
Live: https://pot-navy.vercel.app
Repo: https://github.com/Baheet18/pot
Write-up: [DEVTO_LINK]

#TestSprite
