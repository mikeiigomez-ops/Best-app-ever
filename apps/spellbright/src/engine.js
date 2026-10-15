// Spellbright engine: pure game rules, no DOM. Runs in the page and in node (test/*.mjs).
//
// The board is SIZE x SIZE letter tiles. A move traces a word through neighbouring tiles (diagonals
// count, no tile twice), 3 to 8 letters. The word clears, the tiles above fall, and new letters drop
// in. The game never spells words by itself: every word is one the player found.
//
// Long words leave a special tile where they ended: 5 letters a x2 tile, 6 a bomb (when used in a
// word it clears the 3x3 around it, and bombs set each other off), 7+ a wild that stands for any
// letter. Words of 4+ letters in a row build a combo multiplier (up to x3); a 3-letter word resets it.
//
// Story levels can also have a goal: fill letter orders, light every dim bulb (cells that light up
// when a word or blast passes over them), or bring loaves down to the bottom row (loaves are not
// letters; they fall when the tiles under them clear, and a word touching one nudges it down a
// row). Finishing the goal ends the level; each move
// left over is worth an encore bonus, and stars depend on how many moves were left. Theme words
// (from a per-chapter list) score double the first time.
//
// Every letter cleared charges the power meter; a full meter earns a powerup (shuffle, line clear,
// bomb, wild). Powerups cost no move; any left when the moves run out are cashed in for points.
//
// Everything random comes from seeded streams, so the same seed and the same actions always give
// the same game: that is what makes the daily board fair to compare.
var Spellbright = (function () {
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
  function tile(ch) { return { id: nextId++, ch: ch, mult: 1, bomb: false, bread: false }; }
  var ENCORE = 1000; // points per move left when a goal is finished early

  function inside(c) { return Array.isArray(c) && c[0] >= 0 && c[1] >= 0 && c[0] < SIZE && c[1] < SIZE; }
  function touching(a, b) { return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1; }
  function key(c) { return c[0] + "," + c[1]; }

  // Every word that can be traced on the board, each with one path. Used for hints and to make
  // sure a board is never stuck.
  function solve(g) {
    var list = [], found = {}, seen = {}, path = [];
    function dfs(r, c, prefix, wilds) {
      var t = g[r][c], chars = t.ch;
      if (t.bread) return; // loaves aren't letters
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
  // Loaves stay where they are.
  function shuffle(g, rng, bag) {
    var tiles = [], cells = [];
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (!g[r][c].bread) { tiles.push(g[r][c]); cells.push([r, c]); }
    for (var attempt = 0; attempt < 40; attempt++) {
      for (var i = tiles.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = tiles[i]; tiles[i] = tiles[j]; tiles[j] = t;
      }
      for (var n = 0; n < tiles.length; n++) g[cells[n][0]][cells[n][1]] = tiles[n];
      if (solve(g).length >= MIN_WORDS) return;
    }
    // Hopeless letters: new letters on every non-loaf tile (specials are lost; this almost never happens).
    var fresh = newBoard(rng, bag);
    for (var k = 0; k < cells.length; k++) g[cells[k][0]][cells[k][1]] = fresh[cells[k][0]][cells[k][1]];
  }

  // Board as plain data, for drawing.
  function snapshot(g) {
    return g.map(function (row) { return row.map(function (t) { return { id: t.id, ch: t.ch, mult: t.mult, bomb: t.bomb, bread: t.bread }; }); });
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
    this.targets = opts.targets || null;
    // Goals.
    var goal = opts.goal || null;
    this.goal = goal;
    this.starMoves = opts.starMoves || [3, 6];
    this.goalDone = false;
    this.finishLeft = 0;
    this.encore = 0;
    var grng = makeRng(seed + "#goal");
    if (goal && goal.orders) {
      this.need = {}; this.got = {};
      for (var ok in goal.orders) { this.need[ok] = goal.orders[ok]; this.got[ok] = 0; }
    }
    // Dim bulbs: cells (not tiles) that light up when cleared. Spread over the board.
    this.dark = null;
    if (goal && goal.bulbs) {
      this.dark = [];
      for (var dr = 0; dr < SIZE; dr++) this.dark.push(new Array(SIZE).fill(false));
      var spots = [];
      for (var sr = 0; sr < SIZE; sr++) for (var sc = 0; sc < SIZE; sc++) spots.push([sr, sc]);
      for (var si = spots.length - 1; si > 0; si--) { var sj = Math.floor(grng() * (si + 1)); var tmp = spots[si]; spots[si] = spots[sj]; spots[sj] = tmp; }
      for (var bi = 0; bi < Math.min(goal.bulbs, spots.length); bi++) this.dark[spots[bi][0]][spots[bi][1]] = true;
    }
    // Loaves start in one row (goal.row, default the second), in different columns.
    this.baked = 0;
    if (goal && goal.bread) {
      var cols = [0, 1, 2, 3, 4, 5];
      for (var ci = cols.length - 1; ci > 0; ci--) { var cj = Math.floor(grng() * (ci + 1)); var ct = cols[ci]; cols[ci] = cols[cj]; cols[cj] = ct; }
      for (var li = 0; li < Math.min(goal.bread, SIZE); li++) {
        var loaf = tile(""); loaf.bread = true;
        this.board[goal.row == null ? 1 : goal.row][cols[li]] = loaf;
      }
    }
    // Theme words score double the first time.
    this.theme = new Set((opts.theme || []).filter(function (w) { return dict.has(w); }));
    this.themeFound = {};
  }

  // Goal progress, for drawing: {orders: [{ch, got, need}], bulbs: {lit, total}, bread: {baked, total}}.
  Game.prototype.goalState = function () {
    if (!this.goal) return null;
    var out = {};
    if (this.need) out.orders = Object.keys(this.need).map(function (k) { return { ch: k, got: this.got[k], need: this.need[k] }; }, this);
    if (this.dark) {
      var left = 0;
      this.dark.forEach(function (row) { row.forEach(function (d) { if (d) left++; }); });
      out.bulbs = { lit: this.goal.bulbs - left, total: this.goal.bulbs };
    }
    if (this.goal.bread) out.bread = { baked: this.baked, total: this.goal.bread };
    return out;
  };
  Game.prototype._goalMet = function () {
    if (!this.goal) return false;
    for (var k in this.need || {}) if (this.got[k] < this.need[k]) return false;
    if (this.dark) for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (this.dark[r][c]) return false;
    if (this.goal.bread && this.baked < this.goal.bread) return false;
    return true;
  };
  // Stars: goal levels by moves left at the finish, score levels by score.
  Game.prototype.stars = function () {
    if (this.goal) {
      if (!this.goalDone) return 0;
      return 1 + (this.finishLeft >= this.starMoves[0] ? 1 : 0) + (this.finishLeft >= this.starMoves[1] ? 1 : 0);
    }
    var sc = this.score;
    return this.targets ? this.targets.filter(function (t) { return sc >= t; }).length : 0;
  };
  // Letters still wanted by an order.
  Game.prototype.wanted = function () {
    var w = {};
    for (var k in this.need || {}) if (this.got[k] < this.need[k]) w[k] = true;
    return w;
  };

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
    if (path.some(function (c) { return g[c[0]][c[1]].bread; })) return null;
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
    for (var i = 0; i < cells.length; i++) if (!g[cells[i][0]][cells[i][1]].bread) clear[key(cells[i])] = true;
    // Bombs among the cleared tiles go off, and can set off other bombs.
    while (queue.length) {
      var c = queue.shift(), t = g[c[0]][c[1]];
      if (!t.bomb) continue;
      blastCells("bomb", c).forEach(function (b) {
        var k = key(b);
        if (clear[k] || k === keepKey || g[b[0]][b[1]].bread) return;
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
    // Every cell a word or blast touched lights up, the kept tile's too.
    var lit = [];
    if (this.dark) {
      for (var lk in clear) {
        var lp = lk.split(",").map(Number);
        if (this.dark[lp[0]][lp[1]]) { this.dark[lp[0]][lp[1]] = false; lit.push(lp); }
      }
    }
    // Loaves touching anything cleared get nudged down a row after the fall.
    var nudge = {};
    for (var nk in clear) {
      var np = nk.split(",").map(Number);
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
        var nr = np[0] + dr, nc = np[1] + dc;
        if (nr >= 0 && nc >= 0 && nr < SIZE && nc < SIZE && g[nr][nc] && g[nr][nc].bread) nudge[g[nr][nc].id] = true;
      }
    }
    this._charge(cleared.length, earned);
    gravity(g);
    for (var ur = SIZE - 2; ur >= 0; ur--) for (var uc = 0; uc < SIZE; uc++) {
      var ut = g[ur][uc];
      if (ut && ut.bread && nudge[ut.id] && g[ur + 1][uc] && !g[ur + 1][uc].bread) {
        g[ur][uc] = g[ur + 1][uc]; g[ur + 1][uc] = ut; delete nudge[ut.id];
      }
    }
    // Loaves that reach the bottom row are baked: they leave, and the column falls again.
    var baked = [];
    for (;;) {
      var hit = false;
      for (var bc = 0; bc < SIZE; bc++) {
        var bt2 = g[SIZE - 1][bc];
        if (bt2 && bt2.bread) { baked.push({ id: bt2.id, col: bc }); g[SIZE - 1][bc] = null; this.baked++; hit = true; }
      }
      if (!hit) break;
      gravity(g);
    }
    var dropped = refill(g, this.rng, this.bag);
    return { cleared: cleared, blast: blast.length ? { kind: "bomb", cells: blast, points: pts } : null, dropped: dropped, points: pts, lit: lit, baked: baked };
  };

  // After any action: never leave the player stuck, and cash in powerups when the game ends.
  Game.prototype._finish = function (res) {
    res.shuffled = false;
    res.cashIn = 0;
    res.encore = 0;
    if (!this.goalDone && this._goalMet()) {
      // Goal finished: moves left over become an encore bonus, and the level ends.
      this.goalDone = true;
      res.goalDone = true;
      this.finishLeft = this.movesLeft;
      this.encore = res.encore = this.movesLeft * ENCORE;
      this.score += this.encore;
      this.movesLeft = 0;
    }
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
    var theme = this.theme.has(word) && !this.themeFound[word];
    if (theme) this.themeFound[word] = true;
    var points = Math.round(base * UNIT * LEN_FACTOR[word.length] * mult * combo * (theme ? 2 : 1));
    // Orders take the word's letters (a wild counts as the letter it stood for).
    var filled = {};
    if (this.need) {
      for (var wi = 0; wi < word.length; wi++) {
        var wc = word[wi];
        if (this.need[wc] && this.got[wc] < this.need[wc]) { this.got[wc]++; filled[wc] = (filled[wc] || 0) + 1; }
      }
    }
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
    var rec = { word: word, cells: path, points: points, mult: mult, combo: combo, theme: theme, filled: filled };
    this.log.push({ words: 1, points: total, best: word, bestPoints: points, special: made.length > 0, combo: combo });
    return this._finish({
      steps: [{ words: [rec], blast: cl.blast, cleared: cl.cleared, made: made, dropped: cl.dropped, lit: cl.lit, baked: cl.baked, layout: snapshot(g) }],
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
        if (t.ch === WILD || t.bread) return null;
        t.ch = WILD; t.bomb = false;
        res = { steps: [{ words: [], wild: opts.cell, cleared: [], made: [], layout: snapshot(g) }] };
      } else if (kind === "line" || kind === "bomb") {
        var cells = blastCells(kind, opts.cell, opts.dir).filter(function (c) { return !g[c[0]][c[1]].bread; });
        cells.forEach(function (c) { var bt = g[c[0]][c[1]]; pts += VALUES[bt.ch] * UNIT * bt.mult; });
        var cl = this._clear(cells, null, earned);
        pts += cl.points;
        var shown = cl.blast ? cells.concat(cl.blast.cells) : cells;
        res = { steps: [{ words: [], blast: { kind: kind, cells: shown, points: pts }, cleared: cl.cleared, made: [], dropped: cl.dropped, lit: cl.lit, baked: cl.baked, layout: snapshot(g) }] };
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
    var self = this;
    function rank(w) { return (w.common ? 0 : 10) + Math.abs(w.word.length - 4.5) - 3 * self.goalValue(w); }
    all.sort(function (a, b) { return rank(a) - rank(b) || (a.word < b.word ? -1 : 1); });
    return all[0];
  };

  // How much a word (from solve) would help the goal: letters it fills, bulbs it lights, cells it
  // clears under a loaf. Used for hints and by the test bots.
  Game.prototype.goalValue = function (w) {
    if (!this.goal) return 0;
    var g = this.board, v = 0, got = {}, self = this;
    if (this.need) for (var i = 0; i < w.word.length; i++) {
      var ch = w.word[i];
      if (this.need[ch] && this.got[ch] + (got[ch] || 0) < this.need[ch]) { got[ch] = (got[ch] || 0) + 1; v++; }
    }
    if (this.dark) w.path.forEach(function (c) { if (self.dark[c[0]][c[1]]) v++; });
    if (this.goal.bread) {
      // Cells cleared under a loaf drop it; touching a loaf nudges it.
      var touched = {};
      w.path.forEach(function (c) {
        for (var r = 0; r < c[0]; r++) if (g[r][c[1]].bread) { v += 1; break; }
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          var nr = c[0] + dr, nc = c[1] + dc;
          if (nr >= 0 && nc >= 0 && nr < SIZE && nc < SIZE && g[nr][nc].bread) touched[nr * SIZE + nc] = true;
        }
      });
      v += Object.keys(touched).length;
    }
    return v;
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

  // Levels. Episode 1 gives each chapter its own goal: orders at Mo's Diner (2-3), dim bulbs at the
  // Bijou (4-6), loaves at Rosa's Bakery (7-10), and each chapter's last level mixes in the one
  // before. After level 10 the goals take turns and grow. Levels 1-10 use easy letters, a powerup to
  // start and a faster meter; a word glows when the player is stuck (`assist`, in seconds). Moves,
  // targets and star thresholds come from test/calibrate.mjs.
  var THEMES = {
    diner: "pie egg eggs toast tea jam ham bacon coffee menu order diner fries soup stew bun buns plate table cook grill sauce shake pancake waffle syrup milk cream sugar salt fork knife cup mug lunch dinner steak burger tip booth",
    cinema: "film films movie movies show star stars seat seats ticket reel scene actor actors cast plot popcorn screen drama light lights camera act role stage hero script sequel usher snack comedy horror credits film",
    bakery: "bread loaf loaves bun buns roll rolls cake cakes pie pies tart dough flour bake baker baked oven crust sweet sugar honey icing cream scone bagel toast rye yeast knead crumb butter cookie muffin pastry"
  };
  var EPISODE = [
    null,
    { theme: "diner", moves: 12, targets: [7000, 10500, 14000] },
    { theme: "diner", moves: 12, goal: { orders: { e: 5, a: 3 } }, starMoves: [3, 6] },
    { theme: "diner", moves: 13, goal: { orders: { s: 3, t: 3, o: 3 } }, starMoves: [3, 6] },
    { theme: "cinema", moves: 16, goal: { bulbs: 8 }, starMoves: [5, 8] },
    { theme: "cinema", moves: 16, goal: { bulbs: 12 }, starMoves: [3, 6] },
    { theme: "cinema", moves: 17, goal: { bulbs: 10, orders: { e: 4, n: 2 } }, starMoves: [3, 6] },
    { theme: "bakery", moves: 12, goal: { bread: 2, row: 0 }, starMoves: [3, 6] },
    { theme: "bakery", moves: 12, goal: { bread: 3, row: 0 }, starMoves: [3, 6] },
    { theme: "bakery", moves: 16, goal: { bread: 2, row: 0, bulbs: 8 }, starMoves: [3, 6] },
    { theme: "bakery", moves: 14, goal: { bread: 3, row: 0, orders: { r: 3, e: 5 } }, starMoves: [3, 6] }
  ];
  var ORDER_SETS = [{ e: 6, s: 4, t: 3 }, { a: 5, r: 4, n: 3 }, { o: 5, l: 4, d: 2 }, { i: 5, t: 4, g: 2 }, { e: 7, d: 3, c: 2 }];
  function level(n) {
    n = Math.max(1, Math.floor(n));
    var cfg = { n: n, moves: 15, easy: false, powerAt: POWER_AT, inv: {}, assist: 0, goal: null, theme: [] };
    if (n <= 5) { cfg.easy = true; cfg.powerAt = 20; cfg.inv = { bomb: 1 }; cfg.assist = 6; }
    else if (n <= 10) { cfg.easy = true; cfg.powerAt = 25; cfg.inv = { wild: 1 }; cfg.assist = 10; }
    var e = EPISODE[n];
    if (e) {
      cfg.moves = e.moves;
      cfg.goal = e.goal || null;
      cfg.starMoves = e.starMoves;
      cfg.theme = THEMES[e.theme].split(" ");
      cfg.chapterTheme = e.theme;
      if (e.targets) cfg.targets = e.targets;
    } else {
      // After the episode: goals take turns and slowly grow; every fourth level is a score level.
      var k = n - 11, step = Math.floor(k / 4), kind = k % 4;
      cfg.moves = Math.max(13, 16 - Math.floor(k / 12));
      cfg.theme = THEMES[["diner", "cinema", "bakery"][k % 3]].split(" ");
      if (kind === 0) { var base = Math.min(30000, 18000 + step * 1000); cfg.targets = [base, Math.round(base * 1.5 / 500) * 500, base * 2]; }
      else if (kind === 1) {
        var o = ORDER_SETS[step % ORDER_SETS.length], grown = {};
        for (var ok in o) grown[ok] = Math.max(2, o[ok] - 1) + Math.floor(step / ORDER_SETS.length);
        cfg.goal = { orders: grown }; cfg.starMoves = [2, 4];
      }
      else if (kind === 2) { cfg.goal = { bulbs: Math.min(22, 10 + step) }; cfg.starMoves = [2, 4]; }
      else { cfg.goal = { bread: Math.min(5, 3 + Math.floor(step / 3)), row: 0 }; cfg.moves -= 4; cfg.starMoves = [3, 5]; }
    }
    return cfg;
  }

  return {
    SIZE: SIZE, MOVES: MOVES, MIN: MIN, MAX: MAX, VALUES: VALUES, LEN_FACTOR: LEN_FACTOR, WILD: WILD,
    POWER_AT: POWER_AT, UNIT: UNIT, CASH_IN: CASH_IN, POWERS: POWERS,
    setWords: setWords, isWord: isWord, matchWord: matchWord, makeRng: makeRng, Game: Game,
    solve: solve, snapshot: snapshot, blastCells: blastCells, validPath: validPath, level: level
  };
})();
if (typeof module !== "undefined") module.exports = Spellbright;
