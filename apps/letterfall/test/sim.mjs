// Plays many games with simple bots to check the rules hold up and to tune the numbers.
// Run: node apps/letterfall/test/sim.mjs [games] [rerolls]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const L = createRequire(import.meta.url)(join(here, "../src/engine.js"));
L.setWords(readFileSync(join(here, "../src/words.txt"), "utf8"));

const games = +(process.argv[2] || 500);
const rerolls = process.argv[3] == null ? undefined : +process.argv[3];

function key(g) { return g.board.map((r) => r.map((t) => t.ch + t.mult).join("")).join("/"); }

// Same seed + same moves => same game.
{
  const a = new L.Game("2026-10-15"), b = new L.Game("2026-10-15");
  assert.equal(key(a), key(b));
  for (let i = 0; i < L.MOVES; i++) { const m = a.hint(); a.tryMove(...m); b.tryMove(...m); }
  assert.equal(key(a), key(b));
  assert.equal(a.score, b.score);
  assert.notEqual(key(new L.Game("2026-10-16")), key(new L.Game("2026-10-15")));
}

// Wilds stand for any letter; the reported word is the real one.
{
  assert.equal(L.matchWord("st?r"), "star");
  assert.ok(L.matchWord("?ox"), "two wilds can match");
  assert.equal(L.matchWord("???"), null, "three wilds never match");
  assert.equal(L.matchWord("qqq"), null);
}

// Powerups: replaying the same actions (swaps and powerups) gives the same game.
{
  const a = new L.Game("powers"), acts = [];
  for (const k of L.POWERS) a.inv[k] = 2;
  const plan = [{ p: "line", cell: [2, 3], dir: "col" }, null, { p: "bomb", cell: [0, 0] }, { p: "wild", cell: [3, 3] }, null, { p: "shuffle" }, { p: "line", cell: [5, 1], dir: "row" }, null];
  for (const step of plan) {
    const act = step || a.hint();
    const res = a.apply(act);
    assert.ok(res, "action must be accepted: " + JSON.stringify(act));
    assert.equal(L.findWords(a.board).length, 0);
    acts.push(act);
  }
  const b = new L.Game("powers");
  for (const k of L.POWERS) b.inv[k] = 2;
  for (const act of acts) b.apply(act);
  assert.equal(key(a), key(b));
  assert.equal(a.score, b.score);
  assert.equal(a.usePower("bomb", { cell: [9, 9] }), null, "bad target is refused");
  const none = new L.Game("x");
  assert.equal(none.usePower("bomb", { cell: [1, 1] }), null, "no powerup, no use");
}

// Invalid moves change nothing and cost no move.
{
  const g = new L.Game("x");
  const before = key(g);
  assert.equal(g.tryMove([0, 0], [2, 2]), null);
  const moves = L.validMoves(g.board);
  const set = new Set(moves.map((m) => m.flat().join()));
  outer: for (let r = 0; r < L.SIZE; r++) for (let c = 0; c + 1 < L.SIZE; c++) {
    if (!set.has([r, c, r, c + 1].join())) { assert.equal(g.tryMove([r, c], [r, c + 1]), null); break outer; }
  }
  assert.equal(key(g), before);
  assert.equal(g.movesLeft, L.MOVES);
}

let pstats;
let stats = { moves: 0, chains: 0, words: 0, specials: 0, shuffles: 0, score: [], options: 0, longest: 0, wordsSeen: {} };
for (const bot of ["random", "greedy"]) {
  stats = { moves: 0, chains: 0, words: 0, specials: 0, shuffles: 0, score: [], options: 0, longest: 0, wordsSeen: {} };
  pstats = { earned: 0, cross: 0, used: 0, cash: 0 };
  for (let n = 0; n < games; n++) {
    const g = new L.Game("sim" + n, { rerolls });
    assert.equal(L.findWords(g.board).length, 0, "fresh board must be quiet");
    while (!g.over()) {
      const moves = L.validMoves(g.board);
      assert.ok(moves.length > 0, "board must always have a move");
      stats.options += moves.length;
      let pick = moves[Math.floor(Math.random() * moves.length)];
      if (bot === "greedy") {
        // Prefer the swap that spells the longest word.
        let bestLen = 0;
        for (const m of moves) {
          const t = structuredClone(g.board);
          const tmp = t[m[0][0]][m[0][1]]; t[m[0][0]][m[0][1]] = t[m[1][0]][m[1][1]]; t[m[1][0]][m[1][1]] = tmp;
          const len = Math.max(0, ...L.findWords(t).map((w) => w.word.length));
          if (len > bestLen) { bestLen = len; pick = m; }
        }
      }
      // Spend a powerup now and then, like a player would.
      const have = L.POWERS.filter((k) => g.inv[k]);
      if (have.length && Math.random() < 0.5) {
        const kind = have[Math.floor(Math.random() * have.length)];
        const cell = [Math.floor(Math.random() * 6), Math.floor(Math.random() * 6)];
        const pr = g.usePower(kind, { cell, dir: Math.random() < 0.5 ? "row" : "col" });
        if (pr) {
          pstats.used++;
          pstats.earned += pr.earned.length;
          assert.equal(L.findWords(g.board).length, 0, "board must settle after a powerup");
          assert.ok(L.validMoves(g.board).length > 0, "board must stay playable after a powerup");
          continue;
        }
      }
      const res = g.tryMove(...pick);
      pstats.earned += res.earned.length;
      if (res.steps.some((s) => s.words.some((w) => w.cross))) pstats.cross++;
      pstats.cash += res.cashIn;
      assert.ok(res, "a valid move must be accepted");
      assert.equal(L.findWords(g.board).length, 0, "board must settle with no words left");
      for (const row of g.board) for (const t of row) assert.ok(t && /^[a-z?]$/.test(t.ch));
      stats.moves++;
      if (res.steps.length > 1) stats.chains++;
      if (res.shuffled) stats.shuffles++;
      for (const s of res.steps) {
        stats.words += s.words.length; stats.specials += s.made.length;
        for (const w of s.words) stats.wordsSeen[w.word] = (stats.wordsSeen[w.word] || 0) + 1;
      }
      stats.longest = Math.max(stats.longest, res.steps.length);
    }
    stats.score.push(g.score);
  }
  stats.score.sort((a, b) => a - b);
  const q = (p) => stats.score[Math.floor(p * (stats.score.length - 1))];
  const top = Object.entries(stats.wordsSeen).sort((a, b) => b[1] - a[1]).slice(0, 25).map((e) => e[0]).join(" ");
  console.log(`${bot}: ${games} games  moves-available/turn ${(stats.options / stats.moves).toFixed(1)}  ` +
    `chain-moves ${(100 * stats.chains / stats.moves).toFixed(0)}%  words/move ${(stats.words / stats.moves).toFixed(2)}  ` +
    `specials/game ${(stats.specials / games).toFixed(1)}  shuffles/game ${(stats.shuffles / games).toFixed(2)}  longest chain ${stats.longest}\n` +
    `  powerups earned/game ${(pstats.earned / games).toFixed(1)} (moves with a crossing ${(pstats.cross / games).toFixed(1)})  used/game ${(pstats.used / games).toFixed(1)}  cash-in/game ${(pstats.cash / games).toFixed(0)}\n` +
    `  score p10 ${q(0.1)}  median ${q(0.5)}  p90 ${q(0.9)}  max ${q(1)}\n  most common words: ${top}`);
}
console.log("all checks passed");
