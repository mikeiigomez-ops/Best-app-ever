# Letterfall

A daily word puzzle that plays like a match-3 game.

- **Swap** two neighbouring letters to spell a word of 3 to 6 letters, reading left to right or top to bottom. A swap that spells nothing bounces back and costs no move.
- **Cascades:** spelled words clear, the letters above fall, and new letters drop in. Any word the fall spells scores again with a chain bonus (×2, ×3, …).
- **Multipliers:** a 5-letter word leaves a ×2 tile behind and a 6-letter word a ×3. A word that uses them is multiplied, and two together multiply each other.
- **Crossings:** when an across word and a down word share a letter, both score double and the power meter gets 15 extra charge.
- **Powerups:** every letter cleared by a word charges the power meter (30 to fill). Each fill earns a powerup, and using one costs no move:
  - **Shuffle** mixes up the board.
  - **Line clear** wipes out a row or column you pick.
  - **Bomb** clears a 3×3 square.
  - **Wild** turns a tile into a ★ that stands for any letter.
  Any left when the moves run out are worth 150 points each.
- **Score** = letter values (as in classic word games) × 10 × length factor (3: ×1, 4: ×2, 5: ×3, 6: ×5) × chain × multipliers.
- **20 moves.** The Daily board is the same for everyone (seeded by the date), and the result is a shareable emoji grid. Practice boards are endless.

**Readability:** tile letters are set in Atkinson Hyperlegible (designed by the Braille Institute so similar letters stay distinct), vowels get a soft blue tint, and the point numbers are quiet. Settings turn the tint and points off or make the letters bigger.

Progress, the daily streak and the in-progress game are saved in the browser. Saved games are stored as the list of moves and replayed, since the rules are deterministic.

## Build and test

```sh
node apps/letterfall/build.mjs      # dist/index.html (open in any browser) and dist/letterfall.html (artifact body)
node apps/letterfall/test/sim.mjs   # rule checks + 1,000 bot games with balance stats
```

## Layout

```
src/engine.js        the rules (no DOM): board, words, cascades, scoring, seeded randomness
src/letterfall.html  the page: board, input (drag, tap-tap, keyboard), animation, results, sharing
src/words.txt        11k words of 3-6 letters
test/sim.mjs         determinism and rule checks, plus balance stats from random and greedy bots
```

## Tuning (from `test/sim.mjs`)

With one reroll for new letters that would land in a word, a quarter to a third of moves set off a chain. With powerups in play, bots earn about 5 to 6 per game and a typical game scores around 5,000 to 6,000. No dead boards came up in 1,000 games; if one does, the letters are shuffled.

## Word list

`src/words.txt` is SCOWL (size 35, American and common English, 3-6 letters, lowercase only) with offensive words removed. SCOWL is copyright Kevin Atkinson and others; its license is in `src/WORDS-LICENSE.txt`.
