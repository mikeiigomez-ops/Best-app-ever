// Letterfall engine: pure game rules, no DOM. Runs in the page and in node (test/sim.mjs).
//
// The board is SIZE x SIZE letter tiles. A move swaps two neighbours; it only counts if it spells
// a word (3-6 letters, read left-to-right or top-to-bottom). Words clear, tiles above fall, new
// letters drop in, and any word the fall spells clears too (a chain). A 5-letter word leaves a x2
// tile behind and a 6-letter word a x3; every multiplier inside a word multiplies its score.
// An across word and a down word that share a letter are a crossing: both score double, and the
// power meter gets a boost.
//
// Every letter cleared by a word charges the power meter. A full meter earns
// a powerup: shuffle, line clear, bomb (3x3) or wild (a tile that stands for any letter).
// Powerups cost no move; any left when the moves run out are cashed in for points.
//
// Everything random comes from seeded streams, so the same seed and the same actions always give
// the same game: that is what makes the daily board fair to compare.
var Letterfall = (function () {
  var SIZE = 6;
  var MOVES = 20;
  var MIN = 3, MAX = 6;
  var WILD = "?";
  var POWER_AT = 30;        // letters cleared per powerup
  var CASH_IN = 150;        // points per unused powerup at the end
  var CROSS_CHARGE = 15;    // a crossing fills half the meter
  var POWERS = ["shuffle", "line", "bomb", "wild"];
  var POWER_WEIGHTS = { shuffle: 2, line: 3, bomb: 2.5, wild: 2.5 };

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
  var LEN_FACTOR = { 3: 1, 4: 2, 5: 3, 6: 5 };

  var dict = null;
  function setWords(text) {
    dict = new Set(text.split(/\s+/).filter(Boolean));
  }
  function isWord(w) { return dict.has(w); }

  // The real word a run of letters spells, with wilds filled in, or null. Two wilds at most.
  function matchWord(w) {
    var at = w.indexOf(WILD);
    if (at < 0) return dict.has(w) ? w : null;
    if (w.indexOf(WILD, at + 1) >= 0 && w.split(WILD).length > 3) return null;
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
    if (share < 0.33) return weighted(rng, VOWEL_LIST, WEIGHTS);
    var ch = weighted(rng, LETTERS, WEIGHTS);
    if (share > 0.48 && VOWELS.indexOf(ch) >= 0) ch = weighted(rng, LETTERS, WEIGHTS);
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
          var hit = ok && matchWord(w);
          if (hit) {
            for (var k2 = s; k2 < s + len; k2++) used[k2] = true;
            found.push({ word: hit, cells: cells.slice(s, s + len), across: l % 2 === 0 });
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
          if (ok && matchWord(w)) return true;
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
  function inside(c) { return c && c[0] >= 0 && c[1] >= 0 && c[0] < SIZE && c[1] < SIZE; }

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

  function gravity(g) {
    for (var col = 0; col < SIZE; col++) {
      var stack = [];
      for (var row = SIZE - 1; row >= 0; row--) if (g[row][col]) stack.push(g[row][col]);
      for (var row2 = SIZE - 1, si = 0; row2 >= 0; row2--, si++) g[row2][col] = stack[si] || null;
    }
  }

  // A fresh board with no words on it and at least one move to make.
  function newBoard(rng) {
    var g;
    for (var attempt = 0; attempt < 50; attempt++) {
      g = [];
      for (var r = 0; r < SIZE; r++) g.push(new Array(SIZE).fill(null));
      for (var r2 = 0; r2 < SIZE; r2++) for (var c2 = 0; c2 < SIZE; c2++) {
        g[r2][c2] = tile(drawLetter(g, rng));
        for (var k = 0; k < 30 && makesWordAt(g, r2, c2); k++) g[r2][c2].ch = drawLetter(g, rng);
      }
      if (findWords(g).length === 0 && validMoves(g).length >= 3) return g;
    }
    return g;
  }

  // Shuffle tiles in place (multipliers and wilds travel with their tiles) until the board is
  // quiet and playable again.
  function shuffle(g, rng) {
    var tiles = [];
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) tiles.push(g[r][c]);
    for (var attempt = 0; attempt < 200; attempt++) {
      for (var i = tiles.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = tiles[i]; tiles[i] = tiles[j]; tiles[j] = t;
      }
      for (var n = 0; n < tiles.length; n++) g[Math.floor(n / SIZE)][n % SIZE] = tiles[n];
      if (findWords(g).length === 0 && validMoves(g).length > 0) return;
    }
    // Hopeless letters: deal a new board (multipliers are lost; this almost never happens).
    var fresh = newBoard(rng);
    for (var r3 = 0; r3 < SIZE; r3++) for (var c3 = 0; c3 < SIZE; c3++) g[r3][c3] = fresh[r3][c3];
  }

  // Board as plain data, for drawing a step of a move.
  function snapshot(g) {
    return g.map(function (row) { return row.map(function (t) { return { id: t.id, ch: t.ch, mult: t.mult }; }); });
  }

  function key(c) { return c[0] + "," + c[1]; }

  // Cells a line clear or a bomb hits.
  function blastCells(kind, cell, dir) {
    var cells = [];
    if (kind === "line") return dir === "col" ? lineCells("col", cell[1]) : lineCells("row", cell[0]);
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      var c = [cell[0] + dr, cell[1] + dc];
      if (inside(c)) cells.push(c);
    }
    return cells;
  }

  // One game. Actions return {steps, shuffled, earned, cashIn} for the page to animate; each step
  // is {words, blast, cleared, made, layout}.
  function Game(seed, opts) {
    opts = opts || {};
    this.seed = seed;
    this.rng = makeRng(seed);
    this.prng = makeRng(seed + "#power");
    this.board = newBoard(this.rng);
    this.movesLeft = opts.moves || MOVES;
    this.score = 0;
    this.power = 0;
    this.inv = { shuffle: 0, line: 0, bomb: 0, wild: 0 };
    this.cashIn = 0;
    this.log = []; // per move: {words, chain, points, best, bestPoints, special, cross}
    this.rerolls = opts.rerolls == null ? REFILL_REROLLS : opts.rerolls;
  }

  Game.prototype.over = function () { return this.movesLeft <= 0; };
  Game.prototype.powerCount = function () {
    var n = 0;
    for (var k in this.inv) n += this.inv[k];
    return n;
  };

  Game.prototype._earn = function (why, earned) {
    var kind = weighted(this.prng, POWERS, POWER_WEIGHTS);
    this.inv[kind]++;
    earned.push({ kind: kind, why: why });
  };

  // Clear words until the board is quiet. `first` is an optional blast that goes before the
  // words; `focus` is where the player acted (a multiplier made there stays there).
  Game.prototype._resolve = function (focus, first) {
    var g = this.board, steps = [], chain = 0, all = [], made = false, cross = false, earned = [];
    if (first) {
      var bc = [], pts = 0;
      for (var b = 0; b < first.cells.length; b++) {
        var c0 = first.cells[b], t0 = g[c0[0]][c0[1]];
        pts += VALUES[t0.ch] * 10 * t0.mult;
        bc.push({ cell: c0, id: t0.id });
        g[c0[0]][c0[1]] = null;
      }
      this.score += pts;
      gravity(g);
      var d0 = refill(g, this.rng, this.rerolls);
      steps.push({ words: [], blast: { kind: first.kind, cells: first.cells, points: pts }, cleared: bc, made: [], dropped: d0, layout: snapshot(g) });
    }
    for (;;) {
      var words = findWords(g);
      if (!words.length) break;
      chain++;
      // Crossings: an across word and a down word sharing a tile.
      for (var x = 0; x < words.length; x++) for (var y = x + 1; y < words.length; y++) {
        if (words[x].across === words[y].across) continue;
        var set = {};
        words[x].cells.forEach(function (c) { set[key(c)] = 1; });
        if (words[y].cells.some(function (c) { return set[key(c)]; })) { words[x].cross = words[y].cross = true; }
      }
      var clear = {}, specials = [], scored = [], stepCross = false;
      for (var i = 0; i < words.length; i++) {
        var w = words[i], base = 0, mult = 1;
        for (var q0 = 0; q0 < w.cells.length; q0++) {
          var tt = g[w.cells[q0][0]][w.cells[q0][1]];
          base += VALUES[tt.ch];
          mult *= tt.mult;
        }
        var points = base * 10 * LEN_FACTOR[w.word.length] * chain * mult * (w.cross ? 2 : 1);
        this.score += points;
        if (w.cross) stepCross = true;
        var rec = { word: w.word, cells: w.cells, points: points, mult: mult, chain: chain, cross: !!w.cross };
        scored.push(rec); all.push(rec);
        for (var k = 0; k < w.cells.length; k++) clear[key(w.cells[k])] = w.cells[k];
        if (w.word.length >= 5) {
          // The multiplier stays where the player acted if that is in the word, else mid-word.
          var at = w.cells[Math.floor(w.cells.length / 2)];
          for (var f = 0; f < focus.length; f++) {
            for (var q = 0; q < w.cells.length; q++) {
              if (w.cells[q][0] === focus[f][0] && w.cells[q][1] === focus[f][1]) at = focus[f];
            }
          }
          specials.push({ at: at, mult: w.word.length >= 6 ? 3 : 2 });
        }
      }
      if (stepCross) { cross = true; this.power += CROSS_CHARGE; }
      var madeCells = [];
      for (var sp = 0; sp < specials.length; sp++) {
        var sk = key(specials[sp].at);
        if (!clear[sk]) continue; // two multipliers on one tile: first wins
        delete clear[sk];
        var t = g[specials[sp].at[0]][specials[sp].at[1]];
        t.mult = Math.max(t.mult, specials[sp].mult);
        if (t.ch === WILD) t.ch = weighted(this.rng, VOWEL_LIST, WEIGHTS); // a kept wild settles as a vowel
        madeCells.push({ cell: specials[sp].at, id: t.id, mult: t.mult });
        made = true;
      }
      var cleared = [];
      for (var ck in clear) {
        var cc = clear[ck];
        cleared.push({ cell: cc, id: g[cc[0]][cc[1]].id });
        g[cc[0]][cc[1]] = null;
      }
      this.power += cleared.length;
      while (this.power >= POWER_AT) { this.power -= POWER_AT; this._earn("meter", earned); }
      gravity(g);
      // Long chains are fun up to a point; after a few links the drop stops spelling words.
      var dropped = refill(g, this.rng, chain >= 6 ? 40 : this.rerolls);
      steps.push({ words: scored, cleared: cleared, made: madeCells, dropped: dropped, layout: snapshot(g) });
      focus = [];
    }
    return { steps: steps, words: all, chain: chain, made: made, cross: cross, earned: earned };
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
    } else if (validMoves(this.board).length === 0) {
      shuffle(this.board, this.rng);
      res.shuffled = true;
    }
    return res;
  };

  Game.prototype.tryMove = function (a, b) {
    if (this.over() || !inside(a) || !inside(b) || !adjacent(a, b)) return null;
    var g = this.board;
    swap(g, a, b);
    if (!makesWordAt(g, a[0], a[1]) && !makesWordAt(g, b[0], b[1])) {
      swap(g, a, b);
      return null;
    }
    this.movesLeft--;
    var res = this._resolve([a, b]);
    var best = res.words.reduce(function (m, w) { return !m || w.points > m.points ? w : m; }, null);
    this.log.push({
      words: res.words.length, chain: res.chain,
      points: res.words.reduce(function (s, w) { return s + w.points; }, 0),
      best: best && best.word, bestPoints: best ? best.points : 0, special: res.made, cross: res.cross
    });
    return this._finish(res);
  };

  // Use a powerup. Costs no move. opts: {cell: [r,c], dir: "row"|"col"} as the powerup needs.
  Game.prototype.usePower = function (kind, opts) {
    opts = opts || {};
    if (this.over() || !this.inv[kind]) return null;
    var g = this.board, res;
    if (kind === "shuffle") {
      shuffle(g, this.rng);
      res = { steps: [{ words: [], shuffle: true, cleared: [], made: [], layout: snapshot(g) }], words: [], chain: 0, earned: [] };
    } else {
      if (!inside(opts.cell)) return null;
      if (kind === "wild") {
        var t = g[opts.cell[0]][opts.cell[1]];
        if (t.ch === WILD) return null;
        t.ch = WILD;
        res = this._resolve([opts.cell]);
        res.steps.unshift({ words: [], wild: opts.cell, cleared: [], made: [], layout: null });
      } else if (kind === "line" || kind === "bomb") {
        res = this._resolve([], { kind: kind, cells: blastCells(kind, opts.cell, opts.dir) });
      } else return null;
    }
    this.inv[kind]--;
    var best = res.words.reduce(function (m, w) { return !m || w.points > m.points ? w : m; }, null);
    if (best) this.log.push({ power: kind, words: res.words.length, chain: res.chain, points: 0, best: best.word, bestPoints: best.points });
    return this._finish(res);
  };

  // Replay one saved action: [a, b] for a swap, {p, cell, dir} for a powerup.
  Game.prototype.apply = function (act) {
    if (Array.isArray(act)) return this.tryMove(act[0], act[1]);
    return this.usePower(act.p, act);
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

  Game.prototype.moveLog = function () {
    return this.log.filter(function (m) { return !m.power; });
  };

  return {
    SIZE: SIZE, MOVES: MOVES, VALUES: VALUES, LEN_FACTOR: LEN_FACTOR, WILD: WILD,
    POWER_AT: POWER_AT, CASH_IN: CASH_IN, CROSS_CHARGE: CROSS_CHARGE, POWERS: POWERS,
    setWords: setWords, isWord: isWord, matchWord: matchWord, makeRng: makeRng, Game: Game,
    findWords: findWords, validMoves: validMoves, snapshot: snapshot, blastCells: blastCells
  };
})();
if (typeof module !== "undefined") module.exports = Letterfall;
