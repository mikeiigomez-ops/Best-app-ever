// Letterfall engine: pure game rules, no DOM. Runs in the page and in node (test/*.mjs).
//
// The board is SIZE x SIZE letter tiles. A move traces a word through neighbouring tiles (diagonals
// count, no tile twice), 3 to 8 letters. The word clears, the tiles above fall, and new letters drop
// in. The game never spells words by itself: every word is one the player found.
//
// Long words leave a special tile where they ended: 5 letters a x2 tile, 6 a bomb (when used in a
// word it clears the 3x3 around it, and bombs set each other off), 7+ a wild that stands for any
// letter. Words of 4+ letters in a row build a combo multiplier (up to x3); a 3-letter word resets it.
//
// Every letter cleared charges the power meter; a full meter earns a powerup (shuffle, line clear,
// bomb, wild). Powerups cost no move; any left when the moves run out are cashed in for points.
//
// Everything random comes from seeded streams, so the same seed and the same actions always give
// the same game: that is what makes the daily board fair to compare.
var Letterfall = (function () {
  var SIZE = 6;
  var MOVES = 20;
  var MIN = 3, MAX = 8;
  var WILD = "?";
  var POWER_AT = 30;        // letters cleared per powerup
  var UNIT = 100;           // points per letter value
  var CASH_IN = 1500;       // points per unused powerup at the end
  var MIN_WORDS = 12;       // a board with fewer findable words than this is reshuffled
  var POWERS = ["shuffle", "line", "bomb", "wild"];
  var POWER_WEIGHTS = { shuffle: 1.5, line: 3, bomb: 3, wild: 2.5 };

  // Scrabble-like bag, with the hard letters made rarer.
  var WEIGHTS = {
    e: 12, a: 9, i: 8, o: 8, n: 6, r: 6, t: 6, l: 4, s: 5, u: 4, d: 4, g: 3, b: 2, c: 2.5, m: 2.5,
    p: 2.5, f: 2, h: 2.5, v: 1.2, w: 1.6, y: 2, k: 1, j: 0.3, x: 0.3, q: 0.15, z: 0.3
  };
  var VALUES = {
    a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3, n: 1, o: 1, p: 3,
    q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10, "?": 0
  };
  var VOWELS = "aeiou";
  var ALPHABET = "abcdefghijklmnopqrstuvwxyz";
  var LEN_FACTOR = { 3: 1, 4: 2, 5: 3, 6: 5, 7: 8, 8: 12 };

  // The word list: one word per entry, "*" marks a common word (hints prefer those).
  var dict = null, common = null, prefixes = null;
  function setWords(text) {
    dict = new Set(); common = new Set(); prefixes = new Set();
    text.split(/\s+/).forEach(function (w) {
      if (!w) return;
      if (w[0] === "*") { w = w.slice(1); common.add(w); }
      dict.add(w);
      for (var i = 1; i <= w.length; i++) prefixes.add(w.slice(0, i));
    });
  }
  function isWord(w) { return dict.has(w); }

  // The real word a run of letters spells, with wilds filled in, or null. Two wilds at most.
  function matchWord(w) {
    var at = w.indexOf(WILD);
    if (at < 0) return dict.has(w) ? w : null;
    if (w.split(WILD).length > 3) return null;
    for (var i = 0; i < 26; i++) {
      var hit = matchWord(w.slice(0, at) + ALPHABET[i] + w.slice(at + 1));
      if (hit) return hit;
    }
    return null;
  }

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

  function weighted(rng, keys, weights) {
    var total = 0, i;
    for (i = 0; i < keys.length; i++) total += weights[keys[i]];
    var r = rng() * total;
    for (i = 0; i < keys.length; i++) {
      r -= weights[keys[i]];
      if (r < 0) return keys[i];
    }
    return keys[keys.length - 1];
  }

  var LETTERS = Object.keys(WEIGHTS);
  var VOWEL_LIST = VOWELS.split("");
  var NORMAL_BAG = { letters: LETTERS, weights: WEIGHTS, minVowels: 0.33, maxVowels: 0.48 };
  // Easy letters: the ones most short words are made of, and a few more vowels.
  var EASY_WEIGHTS = { e: 13, a: 11, i: 7, o: 9, u: 3, n: 6, r: 6, t: 7, l: 5, s: 7, d: 4, g: 2, b: 2, c: 2.5, m: 3, p: 3, h: 3, w: 1.5, y: 1.5, f: 1 };
  var EASY_BAG = { letters: Object.keys(EASY_WEIGHTS), weights: EASY_WEIGHTS, minVowels: 0.38, maxVowels: 0.5 };

  function vowelShare(g) {
    var v = 0, n = 0;
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
      if (g[r][c]) { n++; if (VOWELS.indexOf(g[r][c].ch) >= 0) v++; }
    }
    return n ? v / n : 0.4;
  }

  // Keep the vowel share in the bag's range so there is always something to spell.
  function drawLetter(g, rng, bag) {
    var share = vowelShare(g);
    if (share < bag.minVowels) return weighted(rng, VOWEL_LIST, bag.weights);
    var ch = weighted(rng, bag.letters, bag.weights);
    if (share > bag.maxVowels && VOWELS.indexOf(ch) >= 0) ch = weighted(rng, bag.letters, bag.weights);
    return ch;
  }

  var nextId = 1;
  function tile(ch) { return { id: nextId++, ch: ch, mult: 1, bomb: false }; }

  function inside(c) { return Array.isArray(c) && c[0] >= 0 && c[1] >= 0 && c[0] < SIZE && c[1] < SIZE; }
  function touching(a, b) { return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1; }
  function key(c) { return c[0] + "," + c[1]; }

  // Every word that can be traced on the board, each with one path. Used for hints and to make
  // sure a board is never stuck.
  function solve(g) {
    var list = [], found = {}, seen = {}, path = [];
    function dfs(r, c, prefix, wilds) {
      var t = g[r][c], chars = t.ch;
      if (t.ch === WILD) {
        if (wilds >= 2) return; // matchWord allows two wilds per word
        chars = ALPHABET; wilds++;
      }
      seen[r * SIZE + c] = true;
      path.push([r, c]);
      for (var i = 0; i < chars.length; i++) {
        var w = prefix + chars[i];
        if (!prefixes.has(w)) continue;
        if (w.length >= MIN && dict.has(w) && !found[w]) {
          found[w] = true;
          list.push({ word: w, path: path.slice(), common: common.has(w) });
        }
        if (w.length >= MAX) continue;
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          var nr = r + dr, nc = c + dc;
          if ((dr || dc) && nr >= 0 && nc >= 0 && nr < SIZE && nc < SIZE && !seen[nr * SIZE + nc]) dfs(nr, nc, w, wilds);
        }
      }
      path.pop();
      seen[r * SIZE + c] = false;
    }
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) dfs(r, c, "", 0);
    return list;
  }

  function refill(g, rng, bag) {
    var dropped = [];
    for (var c = 0; c < SIZE; c++) for (var r = 0; r < SIZE; r++) {
      if (!g[r][c]) { g[r][c] = tile(drawLetter(g, rng, bag)); dropped.push([r, c]); }
    }
    return dropped;
  }

  function gravity(g) {
    for (var col = 0; col < SIZE; col++) {
      var stack = [];
      for (var row = SIZE - 1; row >= 0; row--) if (g[row][col]) stack.push(g[row][col]);
      for (var row2 = SIZE - 1, si = 0; row2 >= 0; row2--, si++) g[row2][col] = stack[si] || null;
    }
  }

  // A fresh board with plenty to find.
  function newBoard(rng, bag) {
    var g;
    for (var attempt = 0; attempt < 30; attempt++) {
      g = [];
      for (var r = 0; r < SIZE; r++) g.push(new Array(SIZE).fill(null));
      refill(g, rng, bag);
      if (solve(g).length >= MIN_WORDS * 2) return g;
    }
    return g;
  }

  // Shuffle tiles in place (specials travel with their tiles) until there is plenty to find.
  function shuffle(g, rng, bag) {
    var tiles = [];
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) tiles.push(g[r][c]);
    for (var attempt = 0; attempt < 40; attempt++) {
      for (var i = tiles.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = tiles[i]; tiles[i] = tiles[j]; tiles[j] = t;
      }
      for (var n = 0; n < tiles.length; n++) g[Math.floor(n / SIZE)][n % SIZE] = tiles[n];
      if (solve(g).length >= MIN_WORDS) return;
    }
    // Hopeless letters: deal a new board (specials are lost; this almost never happens).
    var fresh = newBoard(rng, bag);
    for (var r3 = 0; r3 < SIZE; r3++) for (var c3 = 0; c3 < SIZE; c3++) g[r3][c3] = fresh[r3][c3];
  }

  // Board as plain data, for drawing.
  function snapshot(g) {
    return g.map(function (row) { return row.map(function (t) { return { id: t.id, ch: t.ch, mult: t.mult, bomb: t.bomb }; }); });
  }

  // Cells a line clear or a bomb hits.
  function blastCells(kind, cell, dir) {
    var cells = [];
    if (kind === "line") {
      for (var k = 0; k < SIZE; k++) cells.push(dir === "col" ? [k, cell[1]] : [cell[0], k]);
      return cells;
    }
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      var c = [cell[0] + dr, cell[1] + dc];
      if (inside(c)) cells.push(c);
    }
    return cells;
  }

  // Is this a path a finger could trace? Neighbouring cells, no cell twice.
  function validPath(path) {
    if (!Array.isArray(path) || path.length < MIN || path.length > MAX) return false;
    var seen = {};
    for (var i = 0; i < path.length; i++) {
      if (!inside(path[i]) || seen[key(path[i])]) return false;
      if (i && !touching(path[i - 1], path[i])) return false;
      seen[key(path[i])] = true;
    }
    return true;
  }

  function comboFor(streak) { return Math.min(3, 1 + 0.5 * Math.max(0, streak - 1)); }

  // One game. Actions return {steps, earned, cashIn, shuffled} for the page to animate; a step is
  // {words, blast, cleared, made, layout}.
  function Game(seed, opts) {
    opts = opts || {};
    this.seed = seed;
    this.rng = makeRng(seed);
    this.prng = makeRng(seed + "#power");
    this.bag = opts.easy ? EASY_BAG : NORMAL_BAG;
    this.board = newBoard(this.rng, this.bag);
    this.movesLeft = opts.moves || MOVES;
    this.score = 0;
    this.power = 0;
    this.powerAt = opts.powerAt || POWER_AT;
    this.inv = { shuffle: 0, line: 0, bomb: 0, wild: 0 };
    for (var ik in opts.inv || {}) this.inv[ik] = opts.inv[ik];
    this.streak = 0;
    this.cashIn = 0;
    this.powerPoints = 0;
    this.log = []; // per action: {words, points, best, bestPoints, special, combo, power?}
  }

  Game.prototype.over = function () { return this.movesLeft <= 0; };
  Game.prototype.powerCount = function () {
    var n = 0;
    for (var k in this.inv) n += this.inv[k];
    return n;
  };
  // The multiplier the next 4+ letter word would get.
  Game.prototype.nextCombo = function () { return comboFor(this.streak + 1); };

  // The word a path spells right now (wilds filled in), or null.
  Game.prototype.wordAt = function (path) {
    if (!validPath(path)) return null;
    var g = this.board;
    return matchWord(path.map(function (c) { return g[c[0]][c[1]].ch; }).join(""));
  };

  Game.prototype._charge = function (n, earned) {
    this.power += n;
    while (this.power >= this.powerAt) {
      this.power -= this.powerAt;
      var kind = weighted(this.prng, POWERS, POWER_WEIGHTS);
      this.inv[kind]++;
      earned.push({ kind: kind });
    }
  };

  // Clear cells (plus any bombs they set off), let tiles fall, refill. `keep` is a cell that stays
  // (if it is a bomb, it still goes off).
  Game.prototype._clear = function (cells, keep, earned) {
    var g = this.board, clear = {}, queue = cells.slice(), blast = [], pts = 0;
    var keepKey = keep ? key(keep) : null;
    for (var i = 0; i < cells.length; i++) clear[key(cells[i])] = true;
    // Bombs among the cleared tiles go off, and can set off other bombs.
    while (queue.length) {
      var c = queue.shift(), t = g[c[0]][c[1]];
      if (!t.bomb) continue;
      blastCells("bomb", c).forEach(function (b) {
        var k = key(b);
        if (clear[k] || k === keepKey) return;
        clear[k] = true; blast.push(b); queue.push(b);
      });
    }
    for (var b = 0; b < blast.length; b++) {
      var bt = g[blast[b][0]][blast[b][1]];
      pts += VALUES[bt.ch] * UNIT * bt.mult;
    }
    var cleared = [];
    for (var ck in clear) {
      if (ck === keepKey) continue;
      var p = ck.split(",").map(Number);
      cleared.push({ cell: p, id: g[p[0]][p[1]].id });
      g[p[0]][p[1]] = null;
    }
    this._charge(cleared.length, earned);
    gravity(g);
    var dropped = refill(g, this.rng, this.bag);
    return { cleared: cleared, blast: blast.length ? { kind: "bomb", cells: blast, points: pts } : null, dropped: dropped, points: pts };
  };

  // After any action: never leave the player stuck, and cash in powerups when the game ends.
  Game.prototype._finish = function (res) {
    res.shuffled = false;
    res.cashIn = 0;
    if (this.over()) {
      res.cashIn = this.powerCount() * CASH_IN;
      this.cashIn += res.cashIn;
      this.score += res.cashIn;
      for (var k in this.inv) this.inv[k] = 0;
    } else if (solve(this.board).length < MIN_WORDS) {
      shuffle(this.board, this.rng, this.bag);
      res.shuffled = true;
    }
    return res;
  };

  // Trace a word. Returns null (and changes nothing) if the path isn't a word.
  Game.prototype.trace = function (path) {
    if (this.over()) return null;
    var word = this.wordAt(path);
    if (!word) return null;
    var g = this.board, earned = [];
    this.movesLeft--;
    this.streak = word.length >= 4 ? this.streak + 1 : 0;
    var combo = word.length >= 4 ? comboFor(this.streak) : 1;
    var base = 0, mult = 1;
    path.forEach(function (c) { var t = g[c[0]][c[1]]; base += VALUES[t.ch]; mult *= t.mult; });
    var points = Math.round(base * UNIT * LEN_FACTOR[word.length] * mult * combo);
    // A long word leaves a special tile where it ended: that tile stays and changes.
    var keep = word.length >= 5 ? path[path.length - 1] : null;
    var kt = keep ? g[keep[0]][keep[1]] : null;
    var cl = this._clear(path, keep, earned);
    var made = [];
    if (kt) {
      var last = word[word.length - 1];
      if (word.length >= 7) { kt.ch = WILD; kt.mult = 1; kt.bomb = false; }
      else if (word.length === 6) { kt.bomb = true; kt.mult = 1; if (kt.ch === WILD) kt.ch = last; }
      else { kt.mult = 2; kt.bomb = false; if (kt.ch === WILD) kt.ch = last; }
      made.push({ id: kt.id, kind: word.length >= 7 ? "wild" : word.length === 6 ? "bomb" : "x2" });
    }
    var total = points + cl.points;
    this.score += total;
    var rec = { word: word, cells: path, points: points, mult: mult, combo: combo };
    this.log.push({ words: 1, points: total, best: word, bestPoints: points, special: made.length > 0, combo: combo });
    return this._finish({
      steps: [{ words: [rec], blast: cl.blast, cleared: cl.cleared, made: made, dropped: cl.dropped, layout: snapshot(g) }],
      words: [rec], earned: earned
    });
  };

  // Use a powerup. Costs no move. opts: {cell: [r,c], dir: "row"|"col"} as the powerup needs.
  Game.prototype.usePower = function (kind, opts) {
    opts = opts || {};
    if (this.over() || !this.inv[kind]) return null;
    var g = this.board, res, earned = [], pts = 0;
    if (kind === "shuffle") {
      shuffle(g, this.rng, this.bag);
      res = { steps: [{ words: [], shuffle: true, cleared: [], made: [], layout: snapshot(g) }] };
    } else {
      if (!inside(opts.cell)) return null;
      if (kind === "wild") {
        var t = g[opts.cell[0]][opts.cell[1]];
        if (t.ch === WILD) return null;
        t.ch = WILD; t.bomb = false;
        res = { steps: [{ words: [], wild: opts.cell, cleared: [], made: [], layout: snapshot(g) }] };
      } else if (kind === "line" || kind === "bomb") {
        var cells = blastCells(kind, opts.cell, opts.dir);
        cells.forEach(function (c) { var bt = g[c[0]][c[1]]; pts += VALUES[bt.ch] * UNIT * bt.mult; });
        var cl = this._clear(cells, null, earned);
        pts += cl.points;
        var shown = cl.blast ? cells.concat(cl.blast.cells) : cells;
        res = { steps: [{ words: [], blast: { kind: kind, cells: shown, points: pts }, cleared: cl.cleared, made: [], dropped: cl.dropped, layout: snapshot(g) }] };
      } else return null;
    }
    this.inv[kind]--;
    this.score += pts;
    this.powerPoints += pts;
    res.words = [];
    res.earned = earned;
    this.log.push({ power: kind, words: 0, points: pts });
    return this._finish(res);
  };

  // Replay one saved action: an array of cells for a word, {p, cell, dir} for a powerup.
  Game.prototype.apply = function (act) {
    if (Array.isArray(act)) return this.trace(act);
    return this.usePower(act.p, act);
  };

  // A word to suggest: common, 4-5 letters if possible. Doesn't touch the rng.
  Game.prototype.hint = function () {
    var all = solve(this.board);
    if (!all.length) return null;
    function rank(w) { return (w.common ? 0 : 10) + Math.abs(w.word.length - 4.5); }
    all.sort(function (a, b) { return rank(a) - rank(b) || (a.word < b.word ? -1 : 1); });
    return all[0];
  };

  // Highest-scoring word of the game so far.
  Game.prototype.bestWord = function () {
    var best = null;
    for (var i = 0; i < this.log.length; i++) {
      if (this.log[i].best && (!best || this.log[i].bestPoints > best.points)) best = { word: this.log[i].best, points: this.log[i].bestPoints };
    }
    return best;
  };

  Game.prototype.moveLog = function () {
    return this.log.filter(function (m) { return !m.power; });
  };

  // Levels: generous at first (easy letters, a powerup to start, a faster meter, low targets), then
  // a slow climb. Targets are set from test/calibrate.mjs; `assist` makes a word glow when the
  // player is stuck.
  function level(n) {
    n = Math.max(1, Math.floor(n));
    var cfg = { n: n, moves: 15, easy: false, powerAt: POWER_AT, inv: {}, assist: 0 };
    if (n <= 5) { cfg.moves = 12; cfg.easy = true; cfg.powerAt = 20; cfg.inv = { bomb: 1 }; cfg.assist = 6; }
    else if (n <= 10) { cfg.easy = true; cfg.powerAt = 25; cfg.inv = { wild: 1 }; cfg.assist = 10; }
    else if (n > 20) cfg.moves = Math.max(12, 15 - Math.floor((n - 20) / 10));
    var base = n <= TARGETS.length ? TARGETS[n - 1] : LATE_TARGET;
    cfg.targets = [base, Math.round(base * 1.5 / 500) * 500, base * 2];
    return cfg;
  }
  // Early targets sit low on purpose (most players three-star levels 1-5); levels 11+ use the
  // normal letters, so their targets jump and then climb slowly.
  var TARGETS = [7000, 7500, 8000, 8500, 9000, 11500, 12000, 12000, 12500, 13000,
    17000, 17000, 17500, 17500, 18000, 18500, 19000, 19000, 19500, 20000,
    20500, 21000, 21000, 21500, 22000, 22500, 23000, 23000, 23500, 22000];
  var LATE_TARGET = 20000; // fewer moves keep later levels getting harder

  return {
    SIZE: SIZE, MOVES: MOVES, MIN: MIN, MAX: MAX, VALUES: VALUES, LEN_FACTOR: LEN_FACTOR, WILD: WILD,
    POWER_AT: POWER_AT, UNIT: UNIT, CASH_IN: CASH_IN, POWERS: POWERS,
    setWords: setWords, isWord: isWord, matchWord: matchWord, makeRng: makeRng, Game: Game,
    solve: solve, snapshot: snapshot, blastCells: blastCells, validPath: validPath, level: level
  };
})();
if (typeof module !== "undefined") module.exports = Letterfall;
