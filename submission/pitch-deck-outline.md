# Pot: pitch deck outline (10 slides)

Deck file: `pot-pitch-deck.pptx` (16:9). Preview of all slides: `pitch-deck-preview.jpg`.
Google Slides: upload the .pptx to Drive and open it with Google Slides. The fonts (Russo One, Raleway) are Google Fonts, so it looks the same.
To change the deck, edit `pitch-deck-source.js` and rebuild (the images it uses are in `/workspace/slides/pot-deck-3pKWgb/img/`), or just edit in Slides.

| # | Title on the slide | What it says | Visual |
|---|---|---|---|
| 1 | **POT: Prediction markets for your group chat, powered by Panta** | Telegram groups turn their arguments into Panta markets, back a side from their phones, and get a receipt when they settle. Name, bot, website, GitHub. | Yellow and navy slanted bars |
| 2 | **Every group chat says "bet?" Then nothing happens.** | Real-sounding chat bets that never happen (nobody writes it down, agrees what counts, or holds the money). Panta has the markets and API, but most markets have very little money in them. The arguments live in group chats; the markets live on a website. | Three chat-bubble quotes, then the Panta side |
| 3 | **Four taps from argument to receipt** | Make it (/new + AI draft) → Create it (admin signs, becomes creator, earns the cut) → Join it (Buy YES/NO or Blink) → Settle it (receipt). Pot never holds keys or money. | Four numbered steps |
| 4 | **The AI writes a fair market, and says no to bad ones** | Buying closes at kick-off. Personal bets get a polite no. Big "who wins" questions get split into YES/NO markets. | Screenshot of a /new draft in Telegram |
| 5 | **Buy from the chat, the website, or a post on X** | Phantom on the web page; Blink on X with buy buttons in the post; every buy carries the group's or member's link for the leaderboard. | Buy panel and Blink preview screenshots |
| 6 | **The receipt is the product** | One receipt per market: result, pot, creator's cut, every member's side, stake and payout. Follows Panta's payout rules, honest wording for one-sided markets. | The receipt screenshot (demo data, labelled) |
| 7 | **Built on Panta's API for the whole life of a market** | 16 endpoints across reading, buying, creating and claiming. Rate-limited reads, allow-listed writes, a second lock on live writes. | Big "16" and a four-row table |
| 8 | **Every Telegram group becomes a Panta venue** | Football groups, crypto chats, campus and church groups, influencer communities → Pot → Panta. Community owner earns the creator's cut; members play with friends; Panta gets new people and local markets. | Flow diagram |
| 9 | **Practice mode today. Live mode is one command away.** | Practice vs live table (money, markets, result, what's been checked). Traction box with **[N] placeholders** for the community practice run. | Table + stats panel |
| 10 | **What's next** | Go live in one group (~$21 smoke test), bring in 2-3 communities then influencers, faster receipts and owner dashboard, WhatsApp and Discord. Links. | Numbered list + closing bars |

## Before you submit
- Slide 9: replace every `[N]`, `[GROUP NAME]` and `[MEMBERS]` with real numbers from the practice run. If a number is zero or you don't have it, delete that row instead of guessing.
- Slides 5 and 6 use screenshots from Pot's own test group (demo data). After the community run, consider swapping slide 6's receipt for a real one from the community group (with permission, and blur anything private).
