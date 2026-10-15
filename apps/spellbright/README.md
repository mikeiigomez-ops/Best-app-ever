# Spellbright

A word puzzle with match-3 energy and a story: trace words through a grid of letter tiles, clear them, and watch new letters fall in. The stars you earn relight Lumen City's neon signs.

## The story (Episode 1: Main Street)

A storm knocked every letter off every neon sign in Lumen City. You're the sign-maker's new apprentice. A three-panel cold open sets this up the first time you play; after that the **city screen** is home: three chapter cards and a Play bar pinned to the bottom.

- **Chapters:** Mo's Diner is Chapter 1 (levels 1-3), the Bijou Chapter 2 (4-6) and Rosa's Bakery Chapter 3 (7-10). Tapping a chapter opens a sheet with its sign, the three parts to relight in order, its levels with your stars (tap one to replay it) and one Play button. After a winning level you land back in that chapter if you can afford a part.
- **Main Street** has three dark signs, each in three parts: Mo's Diner (name, coffee cup, OPEN ALL NIGHT), the Bijou cinema (name, marquee bulbs, tonight's movie) and Rosa's Bakery (name, croissant, FRESH BREAD DAILY). Parts cost 2-3 stars each, 21 in all, so a player averaging two stars a level finishes the episode in about ten levels.
- **Stars come from levels.** Only stars beyond a level's previous best go in the purse, so replaying levels can't farm them.
- **Characters:** Mo (diner), the twins Pip and Pia (cinema) and Rosa (bakery) greet you, react as each part lights up with a neon flicker, and hand you on to the next sign.
- **Every chapter plays differently.** Mo's Diner brings **orders** (spell words whose letters fill orders like 5 E and 3 A; pink dots mark letters still wanted). The Bijou brings **dim bulbs** (dark tiles light up when a word passes through them; light them all). Rosa's Bakery brings **loaves** (not letters; they fall when the tiles under them clear, and any word touching one nudges it down; get them to the bottom row). Each chapter's last level mixes its goal with the previous one, and the owner explains each goal the first time.
- **Goal levels end when the goal is done.** Every move left over is a 1,000-point encore, and stars come from moves to spare (shown live under the goal).
- **Theme words** count double the first time: menu words at the diner, movie words at the Bijou, baking words at the bakery.
- **Finale:** Wren the lighthouse keeper notes that storms knock letters down but don't carry them off. Someone took the lighthouse's letters; Episode 2, The Harbour, is teased.

Story text lives in `SIGNS`, `CAST`, `FINALE` and `INTRO` in `src/spellbright.html`; the signs are CSS neon type and three small inline SVGs, no image assets.

## How it plays

- **Trace** a word of 3 to 8 letters by dragging through touching tiles (diagonals count, each tile once). You can also tap letters one at a time and tap the last one again to play it. A trace that isn't a word costs nothing.
- **Every word is yours.** The word clears, tiles above fall and new letters drop in; the game never spells words by itself.
- **Special tiles** appear where a long word ends: 5 letters leave a ×2 tile, 6 a bomb (it clears the 3×3 around it when used in a word, and bombs set each other off), 7+ a ★ wild that stands for any letter.
- **Combo:** words of 4+ letters in a row build a multiplier (×1.5, ×2, ×2.5, ×3); a 3-letter word resets it.
- **Powerups:** every letter cleared charges the power meter. Each fill earns Shuffle, Line clear, Bomb or Wild, and using one costs no move. Unused ones are worth 1,500 points at the end.
- **Score** = letter values × 100 × length factor (3: ×1, 4: ×2, 5: ×3, 6: ×5, 7: ×8, 8: ×12) × multiplier tiles × combo.
- **Levels** (played from the city): score levels (level 1, then every fourth level after 10) want a target score for one star, and 1.5× and 2× it for two and three; goal levels are above. Levels 1-10 use an easy letter mix (no J, Q, X, Z, K, V), a powerup to start, a faster meter, and a word glows when you're stuck. From level 11 the normal letters come in; after level 20 there are fewer moves. Moves, targets and star thresholds come from `test/calibrate.mjs`, using a bot that looks at a few common words and plays the one that helps the goal most: it finishes 76-100% of episode levels, with each chapter's mixed finale the hardest. Later levels (30+) still need tuning.
- **Daily:** the same board for everyone (seeded by the date), 20 words, and a shareable result with one square per word from 🟦 (few points) to 🟥 (many).
- **Feel:** a trail follows your finger and turns green on a real word, points pop up where words clear, sounds climb as you trace, and powerups and stars get their own callouts. Sound can be turned off in settings.

**Readability:** tile letters are set in Atkinson Hyperlegible (designed by the Braille Institute so similar letters stay distinct), vowels get a soft blue tint, and the point numbers are quiet. Settings turn the tint and points off or make the letters bigger.

Progress, the daily streak and the in-progress game are saved in the browser. Saved games are stored as the list of actions and replayed, since the rules are deterministic.

## Build and test

```sh
node apps/spellbright/build.mjs      # dist/index.html (open in any browser) and dist/spellbright.html (artifact body)
node apps/spellbright/test/sim.mjs         # rule checks + 1,000 bot games with balance stats
node apps/spellbright/test/calibrate.mjs   # score spread and star rates per level
```

## Layout

```
src/engine.js        the rules (no DOM): board, word solver, tracing, specials, scoring, levels, seeded randomness
src/spellbright.html  the page: city and story, board, tracing input (drag, tap, keyboard), animation, results, sharing
src/words.txt        24k words of 3-8 letters; * marks common words, which hints prefer
test/sim.mjs         rule checks (paths, specials, replay) and balance stats from casual and greedy bots
test/calibrate.mjs   score spread and star rates per level
```

## Tuning (from `test/sim.mjs`)

A typical board has well over 100 traceable words, and boards with fewer than 12 are reshuffled, so the player is never stuck. A casual bot (common 3-5 letter words) earns about 2 powerups and 3 special tiles per 20-word game; a greedy bot that always finds the longest word scores far more, which is the skill ceiling.

## Word list

`src/words.txt` is SCOWL (size 35, American and common English, 3-8 letters, lowercase only) with offensive words removed; words from SCOWL sizes 10-20 are marked common. SCOWL is copyright Kevin Atkinson and others; its license is in `src/WORDS-LICENSE.txt`.
