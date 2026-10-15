// Letterfall engine: pure game rules, no DOM. Runs in the page and in node (test/sim.mjs).
//
// The board is SIZE x SIZE letter tiles. A move swaps two neighbours; it only counts if it spells
// a word (3-6 letters, read left-to-right or top-to-bottom). Words clear, tiles above fall, new
// letters drop in, and any word the fall spells clears too (a chain). A 5-letter word leaves a x2
// tile behind and a 6-letter word a x3; every multiplier inside a word multiplies its score.
// Everything random comes from one seeded stream, so the same seed and the same moves always give
// the same game: that is what makes the daily board fair to compare.
var Letterfall = (function () {
  var SIZE = 6;
  var MOVES = 20;
  var MIN = 3, MAX = 6;

  // Scrabble-like bag, with the hard letters made rarer.
  var WEIGHTS = {
    e: 12, a: 9, i: 8, o: 8, n: 6, r: 6, t: 6, l: 4, s: 5, u: 4, d: 4, g: 3, b: 2, c: 2.5, m: 2.5,
    p: 2.5, f: 2, h: 2.5, v: 1.2, w: 1.6, y: 2, k: 1, j: 0.3, x: 0.3, q: 0.15, z: 0.3
  };
  var VALUES = {
    a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3, n: 1, o: 1, p: 3,
    q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10
  };
  var VOWELS = "aeiou";
  var LEN_FACTOR = { 3: 1, 4: 2, 5: 3, 6: 5 };

  var dict = null;
  function setWords(text) {
    dict = new Set(text.split(/\s+/).filter(Boolean));
  }
  function isWord(w) { return dict.has(w); }

  // mulberry32 seeded from a string hash.
  function makeRng(seed) {
    var h = 1779033703 ^ seed.length;
    for (var i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    var a = h >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var LETTERS = Object.keys(WEIGHTS);
  var TOTAL = LETTERS.reduce(function (s, k) { return s + WEIGHTS[k]; }, 0);
  var VOWEL_TOTAL = VOWELS.split("").reduce(function (s, k) { return s + WEIGHTS[k]; }, 0);

  function drawFrom(rng, onlyVowels) {
    var pool = onlyVowels ? VOWELS.split("") : LETTERS;
    var r = rng() * (onlyVowels ? VOWEL_TOTAL : TOTAL);
    for (var i = 0; i < pool.length; i++) {
      r -= WEIGHTS[pool[i]];
      if (r < 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function vowelShare(g) {
    var v = 0, n = 0;
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
      if (g[r][c]) { n++; if (VOWELS.indexOf(g[r][c].ch) >= 0) v++; }
    }
    return n ? v / n : 0.4;
  }

  // Keep roughly 35-45% vowels on the board so there is always something to spell.
  function drawLetter(g, rng) {
    var share = vowelShare(g);
    if (share < 0.33) return drawFrom(rng, true);
    var ch = drawFrom(rng, false);
    if (share > 0.48 && VOWELS.indexOf(ch) >= 0) ch = drawFrom(rng, false);
    return ch;
  }

  var nextId = 1;
  function tile(ch) { return { id: nextId++, ch: ch, mult: 1 }; }

  function lineCells(kind, i) {
    var cells = [];
    for (var k = 0; k < SIZE; k++) cells.push(kind === "row" ? [i, k] : [k, i]);
    return cells;
  }
  var LINES = [];
  for (var li = 0; li < SIZE; li++) { LINES.push(lineCells("row", li)); LINES.push(lineCells("col", li)); }

  // All words on the board. Within a line the longest words win and words don't overlap;
  // a row word and a column word may share a tile.
  function findWords(g) {
    var found = [];
    for (var l = 0; l < LINES.length; l++) {
      var cells = LINES[l];
      var used = new Array(SIZE).fill(false);
      for (var len = MAX; len >= MIN; len--) {
        for (var s = 0; s + len <= SIZE; s++) {
          var w = "", ok = true;
          for (var k = s; k < s + len; k++) {
            var t = g[cells[k][0]][cells[k][1]];
            if (!t || used[k]) { ok = false; break; }
            w += t.ch;
          }
          if (ok && isWord(w)) {
            for (var k2 = s; k2 < s + len; k2++) used[k2] = true;
            found.push({ word: w, cells: cells.slice(s, s + len) });
          }
        }
      }
    }
    return found;
  }

  // Does the tile at (r,c) sit inside a word along its row or column? Empty cells break words.
  function makesWordAt(g, r, c) {
    var lines = [lineCells("row", r), lineCells("col", c)];
    var pos = [c, r];
    for (var l = 0; l < 2; l++) {
      var cells = lines[l];
      for (var len = MIN; len <= MAX; len++) {
        for (var s = Math.max(0, pos[l] - len + 1); s <= pos[l] && s + len <= SIZE; s++) {
          var w = "", ok = true;
          for (var k = s; k < s + len; k++) {
            var t = g[cells[k][0]][cells[k][1]];
            if (!t) { ok = false; break; }
            w += t.ch;
          }
          if (ok && isWord(w)) return true;
        }
      }
    }
    return false;
  }

  function swap(g, a, b) {
    var t = g[a[0]][a[1]];
    g[a[0]][a[1]] = g[b[0]][b[1]];
    g[b[0]][b[1]] = t;
  }

  function adjacent(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
  }

  // Every swap that would spell a word.
  function validMoves(g) {
    var moves = [];
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
      var nb = [[r, c + 1], [r + 1, c]];
      for (var i = 0; i < 2; i++) {
        var b = nb[i];
        if (b[0] >= SIZE || b[1] >= SIZE) continue;
        if (g[r][c].ch === g[b[0]][b[1]].ch) continue;
        swap(g, [r, c], b);
        var hit = makesWordAt(g, r, c) || makesWordAt(g, b[0], b[1]);
        swap(g, [r, c], b);
        if (hit) moves.push([[r, c], b]);
      }
    }
    return moves;
  }

  // Fill empty cells top-down. A new letter that would spell a word on landing is rerolled
  // REFILL_REROLLS times; what survives becomes a free chain. Tuned with test/sim.mjs.
  var REFILL_REROLLS = 1;
  function refill(g, rng, rerolls) {
    var dropped = [];
    for (var c = 0; c < SIZE; c++) {
      for (var r = 0; r < SIZE; r++) {
        if (g[r][c]) continue;
        g[r][c] = tile(drawLetter(g, rng));
        for (var k = 0; k < rerolls && makesWordAt(g, r, c); k++) g[r][c].ch = drawLetter(g, rng);
        dropped.push([r, c]);
      }
    }
    return dropped;
  }

  // A fresh board with no words on it and at least one move to make.
  function newBoard(rng) {
    for (var attempt = 0; attempt < 50; attempt++) {
      var g = [];
      for (var r = 0; r < SIZE; r++) g.push(new Array(SIZE).fill(null));
      for (var r2 = 0; r2 < SIZE; r2++) for (var c2 = 0; c2 < SIZE; c2++) {
        g[r2][c2] = tile(drawLetter(g, rng));
        for (var k = 0; k < 30 && makesWordAt(g, r2, c2); k++) g[r2][c2].ch = drawLetter(g, rng);
      }
      if (findWords(g).length === 0 && validMoves(g).length >= 3) return g;
    }
    return g;
  }

  // Shuffle letters in place (keeping multipliers with their tiles) until the board is quiet
  // and playable again. Used when no move is left.
  function shuffle(g, rng) {
    var tiles = [];
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) tiles.push(g[r][c]);
    for (var attempt = 0; attempt < 200; attempt++) {
      for (var i = tiles.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = tiles[i]; tiles[i] = tiles[j]; tiles[j] = t;
      }
      for (var n = 0; n < tiles.length; n++) g[Math.floor(n / SIZE)][n % SIZE] = tiles[n];
      if (findWords(g).length === 0 && validMoves(g).length > 0) return true;
    }
    // Hopeless letters: deal a new board (multipliers are lost; this almost never happens).
    var fresh = newBoard(rng);
    for (var r3 = 0; r3 < SIZE; r3++) for (var c3 = 0; c3 < SIZE; c3++) g[r3][c3] = fresh[r3][c3];
    return true;
  }

  // Board as plain data, for drawing a step of a move.
  function snapshot(g) {
    return g.map(function (row) { return row.map(function (t) { return { id: t.id, ch: t.ch, mult: t.mult }; }); });
  }

  function wordScore(word, cells, g, chain) {
    var base = 0, mult = 1;
    for (var i = 0; i < word.length; i++) base += VALUES[word[i]];
    for (var k = 0; k < cells.length; k++) mult *= g[cells[k][0]][cells[k][1]].mult;
    return { points: base * 10 * LEN_FACTOR[word.length] * chain * mult, mult: mult };
  }

  // One game. Each play() returns the steps to animate: [{words, cleared, made, fallen, dropped}, ...].
  function Game(seed, opts) {
    opts = opts || {};
    this.seed = seed;
    this.rng = makeRng(seed);
    this.board = newBoard(this.rng);
    this.movesLeft = opts.moves || MOVES;
    this.score = 0;
    this.log = []; // per move: {words: [..], chain, best, special}
    this.rerolls = opts.rerolls == null ? REFILL_REROLLS : opts.rerolls;
  }

  Game.prototype.over = function () { return this.movesLeft <= 0; };

  Game.prototype.tryMove = function (a, b) {
    if (this.over() || !adjacent(a, b)) return null;
    var g = this.board;
    swap(g, a, b);
    if (!makesWordAt(g, a[0], a[1]) && !makesWordAt(g, b[0], b[1])) {
      swap(g, a, b);
      return null;
    }
    this.movesLeft--;
    var steps = [], chain = 0, moveWords = [], made = false;
    var focus = [a, b];
    for (;;) {
      var words = findWords(g);
      if (!words.length) break;
      chain++;
      var clear = {}, specials = [], scored = [];
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var s = wordScore(w.word, w.cells, g, chain);
        this.score += s.points;
        scored.push({ word: w.word, cells: w.cells, points: s.points, mult: s.mult, chain: chain });
        moveWords.push(scored[scored.length - 1]);
        for (var k = 0; k < w.cells.length; k++) clear[w.cells[k][0] + "," + w.cells[k][1]] = w.cells[k];
        if (w.word.length >= 5) {
          // The special stays where the player swapped if it is in the word, else mid-word.
          var at = w.cells[Math.floor(w.cells.length / 2)];
          for (var f = 0; f < focus.length; f++) {
            for (var q = 0; q < w.cells.length; q++) {
              if (w.cells[q][0] === focus[f][0] && w.cells[q][1] === focus[f][1]) at = focus[f];
            }
          }
          specials.push({ at: at, mult: w.word.length >= 6 ? 3 : 2 });
        }
      }
      var madeCells = [];
      for (var sp = 0; sp < specials.length; sp++) {
        var key = specials[sp].at[0] + "," + specials[sp].at[1];
        if (!clear[key]) continue; // two specials on one tile: first wins
        delete clear[key];
        var t = g[specials[sp].at[0]][specials[sp].at[1]];
        t.mult = Math.max(t.mult, specials[sp].mult);
        madeCells.push({ cell: specials[sp].at, id: t.id, mult: t.mult });
        made = true;
      }
      var cleared = [];
      for (var ck in clear) {
        var cc = clear[ck];
        cleared.push({ cell: cc, id: g[cc[0]][cc[1]].id });
        g[cc[0]][cc[1]] = null;
      }
      // Gravity.
      for (var col = 0; col < SIZE; col++) {
        var stack = [];
        for (var row = SIZE - 1; row >= 0; row--) if (g[row][col]) stack.push(g[row][col]);
        for (var row2 = SIZE - 1, si = 0; row2 >= 0; row2--, si++) g[row2][col] = stack[si] || null;
      }
      // Long chains are fun up to a point; after a few links the drop stops spelling words.
      var dropped = refill(g, this.rng, chain >= 6 ? 40 : this.rerolls);
      steps.push({ words: scored, cleared: cleared, made: madeCells, dropped: dropped, layout: snapshot(g) });
      focus = [];
    }
    var shuffled = false;
    if (!this.over() && validMoves(g).length === 0) { shuffle(g, this.rng); shuffled = true; }
    var best = moveWords.reduce(function (m, w) { return !m || w.points > m.points ? w : m; }, null);
    this.log.push({ words: moveWords.length, chain: chain, points: moveWords.reduce(function (s, w) { return s + w.points; }, 0), best: best && best.word, bestPoints: best ? best.points : 0, special: made });
    return { steps: steps, shuffled: shuffled };
  };

  // A move to suggest. Doesn't touch the rng, so asking for hints never changes the game.
  Game.prototype.hint = function () {
    var m = validMoves(this.board);
    return m.length ? m[(this.log.length * 7) % m.length] : null;
  };

  // Highest-scoring word of the game so far.
  Game.prototype.bestWord = function () {
    var best = null;
    for (var i = 0; i < this.log.length; i++) {
      if (this.log[i].best && (!best || this.log[i].bestPoints > best.points)) best = { word: this.log[i].best, points: this.log[i].bestPoints };
    }
    return best;
  };

  return {
    SIZE: SIZE, MOVES: MOVES, VALUES: VALUES, LEN_FACTOR: LEN_FACTOR,
    setWords: setWords, isWord: isWord, makeRng: makeRng, Game: Game,
    findWords: findWords, validMoves: validMoves, snapshot: snapshot
  };
})();
if (typeof module !== "undefined") module.exports = Letterfall;
