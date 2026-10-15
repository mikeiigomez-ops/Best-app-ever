# Letterfall

A word puzzle with match-3 energy: trace words through a grid of letter tiles, clear them, and watch new letters fall in.

- **Trace** a word of 3 to 8 letters by dragging through touching tiles (diagonals count, each tile once). You can also tap letters one at a time and tap the last one again to play it. A trace that isn't a word costs nothing.
- **Every word is yours.** The word clears, tiles above fall and new letters drop in; the game never spells words by itself.
- **Special tiles** appear where a long word ends: 5 letters leave a ×2 tile, 6 a bomb (it clears the 3×3 around it when used in a word, and bombs set each other off), 7+ a ★ wild that stands for any letter.
- **Combo:** words of 4+ letters in a row build a multiplier (×1.5, ×2, ×2.5, ×3); a 3-letter word resets it.
- **Powerups:** every letter cleared charges the power meter. Each fill earns Shuffle, Line clear, Bomb or Wild, and using one costs no move. Unused ones are worth 1,500 points at the end.
- **Score** = letter values × 100 × length factor (3: ×1, 4: ×2, 5: ×3, 6: ×5, 7: ×8, 8: ×12) × multiplier tiles × combo.
- **Levels** (the main mode): beat a target score for one star, and 1.5× and 2× it for two and three. Levels 1-10 use an easy letter mix (no J, Q, X, Z, K, V), a powerup to start, a faster meter, and a word glows when you're stuck. From level 11 the normal letters come in; after level 20 there are fewer moves. Targets come from `test/calibrate.mjs`, using a bot that plays random common words of 3-5 letters: it three-stars about 9 in 10 tries at level 1 and gets one star about 3 in 4 at level 20.
- **Daily:** the same board for everyone (seeded by the date), 20 words, and a shareable result with one square per word from 🟦 (few points) to 🟥 (many).
- **Feel:** a trail follows your finger and turns green on a real word, points pop up where words clear, sounds climb as you trace, and powerups and stars get their own callouts. Sound can be turned off in settings.

**Readability:** tile letters are set in Atkinson Hyperlegible (designed by the Braille Institute so similar letters stay distinct), vowels get a soft blue tint, and the point numbers are quiet. Settings turn the tint and points off or make the letters bigger.

Progress, the daily streak and the in-progress game are saved in the browser. Saved games are stored as the list of actions and replayed, since the rules are deterministic.

## Build and test

```sh
node apps/letterfall/build.mjs      # dist/index.html (open in any browser) and dist/letterfall.html (artifact body)
node apps/letterfall/test/sim.mjs         # rule checks + 1,000 bot games with balance stats
node apps/letterfall/test/calibrate.mjs   # score spread and star rates per level
```

## Layout

```
src/engine.js        the rules (no DOM): board, word solver, tracing, specials, scoring, levels, seeded randomness
src/letterfall.html  the page: board, tracing input (drag, tap, keyboard), animation, results, sharing
src/words.txt        24k words of 3-8 letters; * marks common words, which hints prefer
test/sim.mjs         rule checks (paths, specials, replay) and balance stats from casual and greedy bots
test/calibrate.mjs   score spread and star rates per level
```

## Tuning (from `test/sim.mjs`)

A typical board has well over 100 traceable words, and boards with fewer than 12 are reshuffled, so the player is never stuck. A casual bot (common 3-5 letter words) earns about 2 powerups and 3 special tiles per 20-word game; a greedy bot that always finds the longest word scores far more, which is the skill ceiling.

## Word list

`src/words.txt` is SCOWL (size 35, American and common English, 3-8 letters, lowercase only) with offensive words removed; words from SCOWL sizes 10-20 are marked common. SCOWL is copyright Kevin Atkinson and others; its license is in `src/WORDS-LICENSE.txt`.
