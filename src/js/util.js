/* Upscroll — shared helpers. Classic scripts share the window.UP namespace. */
(function () {
  const UP = (window.UP = window.UP || {});

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "html") el.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "style" && typeof v === "object") {
          for (const [sk, sv] of Object.entries(v)) {
            if (sv == null) continue;
            if (sk.startsWith("--")) el.style.setProperty(sk, String(sv));
            else el.style[sk] = sv;
          }
        }
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const now = () => Date.now();
  const DAY = 86400000;
  const MIN = 60000;

  function dayKey(ts = now()) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function daysBetween(a, b) {
    const pa = new Date(a + "T12:00:00"), pb = new Date(b + "T12:00:00");
    return Math.round((pb - pa) / DAY);
  }

  function hash(str) {
    let x = 2166136261;
    for (let i = 0; i < str.length; i++) {
      x ^= str.charCodeAt(i);
      x = Math.imul(x, 16777619);
    }
    return x >>> 0;
  }
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = Math.random;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function weighted(entries) {
    // entries: [[value, weight], ...]
    let total = 0;
    for (const [, w] of entries) total += Math.max(0, w);
    if (total <= 0) return null;
    let r = rand() * total;
    for (const [v, w] of entries) {
      r -= Math.max(0, w);
      if (r <= 0) return v;
    }
    return entries[entries.length - 1][0];
  }

  function fmtNum(n, unit) {
    const abs = Math.abs(n);
    let s;
    if (abs >= 1e15) {
      const exp = Math.floor(Math.log10(abs));
      const sup = String(exp).split("").map((c) => "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079"[+c]).join("");
      s = trim(n / Math.pow(10, exp)) + " \u00d7 10" + sup;
    }
    else if (abs >= 1e12) s = trim(n / 1e12) + " trillion";
    else if (abs >= 1e9) s = trim(n / 1e9) + " billion";
    else if (abs >= 1e6) s = trim(n / 1e6) + " million";
    else if (abs >= 10000) s = Math.round(n).toLocaleString("en-US");
    else if (abs >= 100) s = Math.round(n).toLocaleString("en-US");
    else if (abs >= 10) s = (Math.round(n * 10) / 10).toString();
    else if (abs >= 1) s = (Math.round(n * 100) / 100).toString();
    else if (abs === 0) s = "0";
    else s = Number(n.toPrecision(2)).toString();
    if (!unit) return s;
    if (unit === "%" || unit === "°") return s + unit;
    return s + "\u00a0" + unit;
  }
  function trim(x) {
    return (Math.round(x * 10) / 10).toString();
  }

  // "dentist tomorrow", "zoo slip by thursday", "call mom tonight" -> end of that day
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  function parseDue(text) {
    const t = " " + String(text).toLowerCase() + " ";
    const end = (d) => { d.setHours(23, 59, 0, 0); return d.getTime(); };
    const base = new Date();
    if (/\b(today|tonight|this evening)\b/.test(t)) return end(base);
    if (/\btomorrow\b/.test(t)) { base.setDate(base.getDate() + 1); return end(base); }
    if (/\b(this )?weekend\b/.test(t)) { base.setDate(base.getDate() + ((6 - base.getDay() + 7) % 7)); return end(base); }
    if (/\bnext week\b/.test(t)) { base.setDate(base.getDate() + ((8 - base.getDay()) % 7 || 7)); return end(base); }
    for (let i = 0; i < 7; i++) {
      const name = WEEKDAYS[i];
      const re = new RegExp("\\b(by |on |this |next )?(" + name + "|" + name.slice(0, 3) + ")\\b");
      const m = t.match(re);
      if (m) {
        let add = (i - base.getDay() + 7) % 7;
        if (m[1] === "next " && add < 7) add += add === 0 ? 7 : 0;
        base.setDate(base.getDate() + add);
        return end(base);
      }
    }
    return null;
  }
  function dueLabel(ts) {
    if (!ts) return "";
    const days = Math.round((new Date(ts).setHours(12) - new Date().setHours(12)) / DAY);
    if (days < 0) return "Overdue";
    if (days === 0) return "Due today";
    if (days === 1) return "Due tomorrow";
    if (days < 7) return "Due " + new Date(ts).toLocaleDateString(undefined, { weekday: "long" });
    return "Due " + new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function timeAgo(ts) {
    const d = now() - ts;
    if (d < 2 * MIN) return "just now";
    if (d < 60 * MIN) return Math.round(d / MIN) + " min ago";
    if (d < DAY) return Math.round(d / 3600000) + " h ago";
    const days = Math.max(1, daysBetween(dayKey(ts), dayKey()));
    if (days === 1) return "yesterday";
    if (days < 30) return days + " days ago";
    const m = Math.round(days / 30);
    return m === 1 ? "a month ago" : m + " months ago";
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "topic";
  }

  function uid(prefix = "x") {
    return prefix + "-" + now().toString(36) + "-" + Math.floor(rand() * 1e6).toString(36);
  }

  /* ---------- Sound: tiny WebAudio synth, starts only after a gesture ---------- */
  let ctx = null;
  function audio() {
    if (!UP.state || !UP.state.settings.sound) return null;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch (e) {
      return null;
    }
  }
  function tone(freq, t0, dur, type = "sine", vol = 0.06) {
    const a = audio();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime + t0);
    g.gain.setValueAtTime(0.0001, a.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(vol, a.currentTime + t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + t0);
    o.stop(a.currentTime + t0 + dur + 0.05);
  }
  const sfx = {
    good(combo = 1) {
      const base = 520 * Math.pow(1.06, Math.min(combo, 12));
      tone(base, 0, 0.16, "triangle");
      tone(base * 1.5, 0.07, 0.22, "triangle");
    },
    bad() {
      tone(180, 0, 0.22, "sine", 0.07);
      tone(140, 0.08, 0.25, "sine", 0.05);
    },
    tick() { tone(1200, 0, 0.04, "square", 0.015); },
    done() { [523, 659, 784].forEach((f, i) => tone(f, i * 0.06, 0.25, "triangle", 0.05)); },
    level() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.08, 0.35, "triangle", 0.05)); },
    chest() { [880, 1108, 1318, 1760, 2217].forEach((f, i) => tone(f, i * 0.05, 0.3, "sine", 0.04)); },
    breath(up) { tone(up ? 330 : 247, 0, 1.2, "sine", 0.025); },
  };
  function buzz(pattern) {
    try {
      if (UP.state && UP.state.settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) { /* not allowed here */ }
  }

  function safeStorage() {
    try {
      const k = "__up_probe";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  Object.assign(UP, {
    $, $$, h, clamp, now, DAY, MIN, dayKey, daysBetween, hash, mulberry, pick, shuffle, weighted,
    fmtNum, timeAgo, parseDue, dueLabel, debounce, reducedMotion, slug, uid, sfx, buzz, safeStorage, copyText,
  });
})();
