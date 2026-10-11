/* ---- Workbench molds (Lu) ----
   Six hand-designed instrument molds. Claude only fills typed variables; every formula lives here.
   Pure and synchronous: no DOM, no network, no storage. compute() is cheap enough to run per pointermove. */
(function () {
  "use strict";
  const WB = window.WB;

  const DAY = 86400000;
  const ORIGINS = ["seen", "inferred", "assumed", "set", "lever"];
  const SYSTEMS = ["Food", "Money", "Energy", "Things", "Space", "Health"];
  const FORMATS = ["usd", "num", "int", "days", "pct", "day", "min", "times"];
  const EPS = 1e-9;

  /* ---------------- small pure helpers ---------------- */
  const util = () => (WB && WB.util) || {};
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  function toNum(v, d) {
    if (isNum(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
      if (Number.isFinite(n)) return n;
    }
    return d;
  }
  function roundTo(v, step) {
    if (!step) return v;
    const r = Math.round(v / step) * step;
    return Math.round(r * 1e6) / 1e6;
  }
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * p;
  }
  function str(v, max, d) {
    if (typeof v !== "string") return d === undefined ? null : d;
    const s = v.replace(/\s+/g, " ").trim();
    if (!s) return d === undefined ? null : d;
    return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
  }
  /* Claude-provided words are made inert at build time: no markup characters survive. */
  function cleanWord(v, max, d) {
    const s = str(v, max, d);
    if (s == null) return s;
    return s.replace(/[<>]/g, "").replace(/&/g, "and").replace(/"/g, "”").replace(/'/g, "’").replace(/`/g, "’");
  }
  function cleanNote(v, max) {
    const s = cleanWord(v, max, null);
    return s == null ? null : s.replace(/!+/g, ".").replace(/\.{2,}$/, ".");
  }
  function escapeHTML(s) {
    const u = util();
    if (typeof u.escapeHTML === "function") return u.escapeHTML(String(s));
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function rid(prefix, n) {
    let s = "";
    try {
      const a = new Uint32Array(2);
      (window.crypto || globalThis.crypto).getRandomValues(a);
      s = a[0].toString(36) + a[1].toString(36);
    } catch (e) { s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
    s = (s + "00000000").replace(/[^a-z0-9]/g, "");
    return prefix + s.slice(0, n || 8);
  }
  function now() { const u = util(); return typeof u.now === "function" ? u.now() : Date.now(); }
  function dayNum(ms) {
    const u = util();
    if (typeof u.dayNum === "function") return u.dayNum(ms);
    const d = new Date(ms);
    return Math.floor((ms - d.getTimezoneOffset() * 60000) / DAY);
  }
  function fromDayNum(n) {
    const u = util();
    if (typeof u.fromDayNum === "function") return u.fromDayNum(n);
    const d = new Date(n * DAY);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12).getTime();
  }
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDayMs(ms) { const d = new Date(ms); return WD[d.getDay()] + " " + d.getDate() + " " + MO[d.getMonth()]; }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  const MINUS = "−";

  /* ---------------- format ---------------- */
  function format(value, fmt, inst, opts) {
    if (!isNum(value)) return "—";
    const neg = value < 0;
    const a = Math.abs(value);
    const sign = neg ? MINUS : "";
    switch (fmt) {
      case "usd": {
        const cur = (inst && inst.words && inst.words.currency) || "$";
        let body;
        if (a < 100 && !(opts && opts.whole) && Math.abs(a - Math.round(a)) > 0.004) body = a.toFixed(2);
        else body = group(Math.round(a));
        if (body === "0" || body === "0.00") return cur + "0";
        return sign + cur + body;
      }
      case "int": return sign + group(Math.round(a));
      case "num": {
        const r = Math.round(a * 10) / 10;
        return (r === 0 ? "" : sign) + (Number.isInteger(r) ? group(r) : r.toFixed(1));
      }
      case "times": {
        const r = Math.round(a * 10) / 10;
        return sign + (Number.isInteger(r) ? r : r.toFixed(1)) + "×";
      }
      case "days": {
        const r = Math.round(a);
        return (r === 0 ? "" : sign) + r + (r === 1 ? " day" : " days");
      }
      case "min": {
        // steps are kept to the half minute; show the half rather than rounding it away
        const r = Math.max(0, Math.round(value * 2) / 2);
        const whole = Math.floor(r);
        return (r === whole ? String(whole) : (whole ? whole : "") + "½") + " min";
      }
      case "pct": return sign + Math.round(a) + "%";
      case "day": return fmtDayMs(fromDayNum(Math.round(value)));
      default: return sign + (Math.round(a * 100) / 100);
    }
  }

  /* ---------------- mold definitions ----------------
     vars: {kind, label, unit, format, min, max, step, default, range?(value, ctx)->[min,max], required?}
     ctx = {vals, words, items, steps, today} */
  const word = (inst, k, d) => (inst && inst.words && inst.words[k]) || d;

  const MOLDS = {
    leak: {
      id: "leak", name: "Recurring cost", system: "Money", chart: "costOverTime",
      primary: "yearly", outcome: "yearlyAtTarget", better: "lower", decisive: ["rate"],
      template: "{w.subject}, {price} × {rate} a {w.period} is {yearly} a year. At {target} a {w.period} you’d keep {kept}.",
      acts: ["ics", "draft"], checkDays: 7, needsItems: false, needsSteps: false,
      words: { subject: "This", period: "week" },
      vars: {
        price: { kind: "fact", label: "each time", unit: "$", format: "usd", min: 0, max: 200, step: 0.5, default: 12, required: true,
          range: (v) => [0, niceCeil(Math.max(20, v * 3))], stepFor: (v) => (v < 20 ? 0.25 : v < 100 ? 0.5 : v < 500 ? 5 : 10) },
        rate: { kind: "fact", label: "times a {period}", unit: "per {period}", format: "num", min: 0, max: 14, step: 1, default: 2,
          range: (v, c) => [0, Math.max(c.words.period === "month" ? 12 : 7, Math.ceil(v * 2))] },
        target: { kind: "lever", label: "times a {period}, your call", unit: "per {period}", format: "num", min: 0, max: 14, step: 1, default: 1,
          range: (v, c) => [0, Math.max(c.words.period === "month" ? 12 : 7, Math.ceil(toNum(c.vals.rate, 2) * 2))],
          // the lever never travels past "as it is": more orders than now is not a plan
          bound: (vals) => (isNum(vals.rate) ? { max: vals.rate } : null) },
      },
      outputs: {
        yearly: { label: "a year", format: "usd" },
        yearlyAtTarget: { label: "a year at your number", format: "usd" },
        kept: { label: "kept a year", format: "usd" },
      },
      calc(v, inst) {
        const ppy = word(inst, "period", "week") === "month" ? 12 : 52;
        const yearly = v.price * v.rate * ppy;
        const yearlyAtTarget = v.price * v.target * ppy;
        return { yearly, yearlyAtTarget, kept: yearly - yearlyAtTarget, _ppy: ppy };
      },
      formula(id, v, o, inst) {
        const f = (x, k) => format(x, k, inst);
        const ppy = o._ppy;
        if (id === "yearly") return f(v.price, "usd") + " × " + f(v.rate, "num") + " × " + ppy;
        if (id === "yearlyAtTarget") return f(v.price, "usd") + " × " + f(v.target, "num") + " × " + ppy;
        if (id === "kept") return f(o.yearly, "usd") + " " + MINUS + " " + f(o.yearlyAtTarget, "usd");
        return "";
      },
      series(v, o, inst) {
        const cum = (yr) => Array.from({ length: 12 }, (_, i) => Math.round((yr / 12) * (i + 1) * 100) / 100);
        return { type: "costOverTime", unit: (inst.words && inst.words.currency) || "$", months: 12,
          lines: [{ id: "now", label: "as it is", values: cum(o.yearly) }, { id: "target", label: "your number", values: cum(o.yearlyAtTarget) }] };
      },
      promptGuide:
        'leak (Recurring cost) — takeout/delivery/coffee receipt, ride receipt, subscription email, supplier reorder. vars: price (fact, money per occurrence, e.g. the TOTAL line), rate (fact, occurrences per period; usually inferred from loyalty lines, order numbers, or assumed), target (lever, occurrences per period the user might choose; start lower than rate). words: subject (who/what, e.g. "Golden Wok"), period ("week" or "month").',
    },

    spoil: {
      id: "spoil", name: "Decay clock", system: "Food", chart: "timeline",
      primary: "lost", outcome: "lost", better: "lower", asIs: { cookN: 0 },
      template: "{atRisk} of food turns in the next {horizon}. Cook {cookN} tonight and you keep {saved}.",
      acts: ["mission"], checkDays: 4, needsItems: true, needsSteps: false,
      words: { subject: "the fridge" },
      vars: {
        horizon: { kind: "fact", label: "days until you next shop or cook big", unit: "days", format: "days", min: 0, max: 14, step: 1, default: 3 },
        cookN: { kind: "lever", label: "things you cook tonight", unit: "items", format: "int", min: 0, max: 12, step: 1, default: 2,
          range: (v, c) => [0, Math.max(1, (c.items || []).length)],
          // only what is actually at risk can be cooked down: no dead travel on the lever
          bound: (vals, inst) => ({ max: riskyItems(inst, vals.horizon).length }) },
      },
      outputs: {
        lost: { label: "lost", format: "usd" },
        atRisk: { label: "at risk", format: "usd" },
        saved: { label: "kept", format: "usd" },
      },
      calc(v, inst) {
        const risky = riskyItems(inst, v.horizon);
        const n = clamp(Math.round(v.cookN), 0, risky.length);
        const atRisk = risky.reduce((s, it) => s + toNum(it.value, 0), 0);
        const savedItems = risky.slice(0, n);
        const saved = savedItems.reduce((s, it) => s + toNum(it.value, 0), 0);
        return { lost: atRisk - saved, atRisk, saved, _risk: risky.map((i) => i.id), _saved: savedItems.map((i) => i.id) };
      },
      formula(id, v, o, inst) {
        const f = (x) => format(x, "usd", inst);
        const items = inst.items || [];
        const names = (ids) => ids.map((i) => { const it = items.find((x) => x.id === i); return it ? f(it.value) : ""; }).filter(Boolean);
        if (id === "atRisk") { const n = names(o._risk); return n.length ? n.join(" + ") : "nothing inside " + format(v.horizon, "days"); }
        if (id === "saved") { const n = names(o._saved); return n.length ? n.join(" + ") : "nothing cooked"; }
        if (id === "lost") return f(o.atRisk) + " " + MINUS + " " + f(o.saved);
        return "";
      },
      series(v, o, inst) {
        const items = inst.items || [];
        const maxDay = items.reduce((m, it) => Math.max(m, toNum(it.days, 0)), 0);
        const span = Math.max(7, Math.ceil(Math.max(maxDay, v.horizon)) + 1);
        const marks = [{ id: "today", label: "Today", day: 0, value: null, state: "today" }];
        for (const it of items) {
          let state = "safe";
          if (it.cooked || o._saved.indexOf(it.id) >= 0) state = "saved";
          else if (o._risk.indexOf(it.id) >= 0) state = "risk";
          marks.push({ id: it.id, label: it.name, day: toNum(it.days, 0), value: toNum(it.value, 0), state });
        }
        return { type: "timeline", unit: "days", span, marks, cursor: { varId: "horizon", day: v.horizon, map: "direct" } };
      },
      promptGuide:
        'spoil (Decay clock) — inside a fridge, a pantry shelf, a fruit bowl, shop perishables. vars: horizon (fact, days until the user next shops or cooks; usually "assumed" with value 3), cookN (lever, how many at-risk items to cook tonight; start at 2). items (REQUIRED, 3-12): each visible food with name (short, lowercase, e.g. "baby spinach"), value (its price in money, inferred from typical prices if not printed), days (whole days until it turns, judged from how it looks or dates printed), origin, pin [x,y] at the item. words: subject (e.g. "the fridge").',
    },

    perUse: {
      id: "perUse", name: "Cost per use", system: "Things", chart: "gauge",
      primary: "cpu", outcome: "cpuAtTarget", better: "lower", decisive: ["uses"],
      template: "{cost} for {w.subject} at {uses} uses a month is {cpu} a use. At {target} it’s {cpuAtTarget}.",
      acts: ["ics", "draft"], checkDays: 14, needsItems: false, needsSteps: false,
      words: { subject: "this", basis: "once" },
      vars: {
        cost: { kind: "fact", label: "what it costs", unit: "$", format: "usd", min: 0, max: 500, step: 1, default: 50, required: true,
          range: (v) => [0, niceCeil(Math.max(20, v * 3))], stepFor: (v) => (v < 50 ? 0.5 : v < 500 ? 1 : 10) },
        uses: { kind: "fact", label: "uses a month", unit: "per month", format: "num", min: 1, max: 30, step: 1, default: 4 },
        months: { kind: "fact", label: "months you keep it", unit: "months", format: "num", min: 1, max: 60, step: 1, default: 12 },
        target: { kind: "lever", label: "uses a month, your call", unit: "per month", format: "num", min: 1, max: 30, step: 1, default: 8,
          bound: (vals) => (isNum(vals.uses) ? { min: vals.uses } : null) },
        alt: { kind: "fact", label: "the alternative, per use", unit: "$", format: "usd", min: 0, max: 100, step: 0.5, default: null, optional: true,
          range: (v) => [0, niceCeil(Math.max(10, v * 3))] },
      },
      outputs: {
        cpu: { label: "a use", format: "usd" },
        cpuAtTarget: { label: "a use at your number", format: "usd" },
      },
      calc(v, inst) {
        const div = word(inst, "basis", "once") === "month" ? 1 : Math.max(1, v.months);
        const cpu = v.cost / (Math.max(v.uses, 0.25) * div);
        const cpuAtTarget = v.cost / (Math.max(v.target, 0.25) * div);
        return { cpu, cpuAtTarget, _div: div };
      },
      formula(id, v, o, inst) {
        const f = (x, k) => format(x, k, inst);
        const tail = o._div === 1 ? "" : " × " + f(v.months, "num") + " months";
        if (id === "cpu") return f(v.cost, "usd") + " ÷ (" + f(v.uses, "num") + " uses" + tail + ")";
        if (id === "cpuAtTarget") return f(v.cost, "usd") + " ÷ (" + f(v.target, "num") + " uses" + tail + ")";
        return "";
      },
      series(v, o, inst, stored) {
        const usesMin = Math.max(0.25, toNum(inst.vars && inst.vars.uses && inst.vars.uses.min, 1));
        const worst = stored.cost / (usesMin * o._div);
        const alt = isNum(v.alt) ? v.alt : null;
        const max = niceCeil(Math.max(worst, alt ? alt * 2 : 0, o.cpu * 1.1, 1));
        return { type: "gauge", unit: (inst.words && inst.words.currency) || "$", value: o.cpu, min: 0, max, threshold: alt, label: "a use" };
      },
      promptGuide:
        'perUse (Cost per use) — a gym tag or membership email, a jacket/gadget price tag, a closet shelf. vars: cost (fact, money: the price, or the monthly fee when basis is "month"), uses (fact, uses per month; usually assumed), months (fact, months owned or expected; ignored when basis is "month"), target (lever, uses per month the user could aim for), alt (optional fact, the price per use of the alternative, e.g. a day pass; omit if unknown). words: subject (e.g. "the gym"), basis ("month" for memberships/subscriptions, "once" for one-off purchases).',
    },

    dial: {
      id: "dial", name: "Bill dial", system: "Energy", chart: "stackedBar",
      primary: "annual", outcome: "annualAtDial", better: "lower", decisive: ["amount"],
      // the seen bill total sits in the sentence, so the bracket on the photo has a hairline to land on
      template: "Your {amount} bill runs {annual} a year. {steps} {w.stepUnit} and it’s {annualAtDial}, {saved} back.",
      confFacts: ["amount", "days", "fixed", "pctPerStep"],
      acts: ["ics", "mission"], checkDays: 30, needsItems: false, needsSteps: false,
      words: { stepUnit: "steps" },
      vars: {
        amount: { kind: "fact", label: "bill total", unit: "$", format: "usd", min: 0, max: 1000, step: 1, default: 100, required: true,
          range: (v) => [0, niceCeil(Math.max(50, v * 3))] },
        days: { kind: "fact", label: "billing days", unit: "days", format: "days", min: 7, max: 95, step: 1, default: 30 },
        fixed: { kind: "fact", label: "fixed charges", unit: "$", format: "usd", min: 0, max: 1000, step: 1, default: 0,
          range: (v, c) => [0, Math.max(1, Math.ceil(toNum(c.vals.amount, 100)))] },
        pctPerStep: { kind: "fact", label: "usage change per step", unit: "%", format: "pct", min: 0, max: 15, step: 0.5, default: 3 },
        steps: { kind: "lever", label: "steps on the dial", unit: "steps", format: "int", min: -5, max: 5, step: 1, default: 2,
          bound: (vals) => (isNum(vals.pctPerStep) && vals.pctPerStep > 0 ? { min: 0 } : null) },
      },
      outputs: {
        annual: { label: "a year", format: "usd" },
        annualAtDial: { label: "a year, dialled", format: "usd" },
        saved: { label: "back a year", format: "usd" },
      },
      calc(v) {
        const days = Math.max(1, v.days);
        const fixed = clamp(v.fixed, 0, Math.max(0, v.amount));
        const usage = Math.max(0, v.amount - fixed);
        const factor = Math.max(0, 1 - (v.steps * v.pctPerStep) / 100);
        const annual = (v.amount / days) * 365;
        const annualAtDial = ((fixed + usage * factor) / days) * 365;
        return { annual, annualAtDial, saved: annual - annualAtDial, _fixedY: (fixed / days) * 365, _usageY: (usage / days) * 365, _factor: factor };
      },
      formula(id, v, o, inst) {
        const f = (x, k) => format(x, k, inst);
        if (id === "annual") return f(v.amount, "usd") + " ÷ " + f(v.days, "num") + " days × 365";
        if (id === "annualAtDial") return "(" + f(v.fixed, "usd") + " + " + f(Math.max(0, v.amount - v.fixed), "usd") + " × " + (Math.round(o._factor * 1000) / 1000) + ") ÷ " + f(v.days, "num") + " × 365";
        if (id === "saved") return f(o.annual, "usd") + " " + MINUS + " " + f(o.annualAtDial, "usd");
        return "";
      },
      series(v, o) {
        const r = (x) => Math.round(x * 100) / 100;
        return { type: "stackedBar", unit: "usd", bars: [
          { id: "now", label: "Now", parts: [{ id: "fixed", label: "Fixed", value: r(o._fixedY) }, { id: "usage", label: "Usage", value: r(o._usageY) }] },
          { id: "dial", label: "Dialled", parts: [{ id: "fixed", label: "Fixed", value: r(o._fixedY) }, { id: "usage", label: "Usage", value: r(o._usageY * o._factor) }] },
        ] };
      },
      promptGuide:
        'dial (Bill dial) — electric, gas, water, phone or shop utility bill. vars: amount (fact, bill total), days (fact, days in the billing period), fixed (fact, fixed/standing/service charges that do not change with usage), pctPerStep (fact, % usage change per step of the dial, usually inferred, e.g. 3 for "per °F" on heating/cooling), steps (lever, integer -5..5, start at 2). words: stepUnit (what one step is, e.g. "°F cooler", "fewer minutes in the shower", "GB less").',
    },

    countdown: {
      id: "countdown", name: "Deadline", system: "Money", chart: "timeline",
      primary: "daysLeft", outcome: "_slack", better: "higher",
      template: "{w.subject}: {stake} is on the line, {daysLeft} left. Act {lead} early: by {actBy}.",
      acts: ["ics", "draft"], checkDays: null, needsItems: false, needsSteps: false,
      words: { subject: "This" },
      vars: {
        deadline: { kind: "fact", label: "the deadline", unit: "day", format: "day", min: 0, max: 0, step: 1, default: null, required: true,
          range: (v, c) => [Math.min(v, c.today) - 30, Math.max(v, c.today) + 730] },
        stake: { kind: "fact", label: "money at stake", unit: "$", format: "usd", min: 0, max: 1000, step: 1, default: 0,
          range: (v) => [0, niceCeil(Math.max(50, v * 3))] },
        lead: { kind: "lever", label: "days early you act", unit: "days", format: "days", min: 0, max: 30, step: 1, default: 3,
          range: (v, c) => [0, clamp(Math.round(toNum(c.vals.deadline, c.today + 14) - c.today), 1, 60)] },
      },
      outputs: {
        daysLeft: { label: "left", format: "days" },
        actBy: { label: "act by", format: "day" },
      },
      calc(v, inst, today) {
        const daysLeft = Math.round(v.deadline - today);
        const actBy = Math.round(v.deadline - v.lead);
        return { daysLeft, actBy, _slack: Math.max(0, Math.min(v.lead, daysLeft)) };
      },
      formula(id, v, o, inst) {
        if (id === "daysLeft") return format(v.deadline, "day") + " " + MINUS + " today";
        if (id === "actBy") return format(v.deadline, "day") + " " + MINUS + " " + format(v.lead, "days");
        return "";
      },
      series(v, o) {
        const dl = o.daysLeft;
        const span = Math.max(7, dl + 1);
        const act = Math.max(0, dl - v.lead);
        return { type: "timeline", unit: "days", span, marks: [
          { id: "today", label: "Today", day: 0, value: null, state: "today" },
          { id: "actBy", label: "Act by", day: act, value: null, state: "actBy" },
          { id: "deadline", label: "Deadline", day: Math.max(0, dl), value: isNum(v.stake) ? v.stake : null, state: "deadline" },
        ], cursor: { varId: "lead", day: act, map: "fromEnd", ref: Math.max(0, dl) } };
      },
      promptGuide:
        'countdown (Deadline) — return slip, warranty card, lease letter, prescription label, parking ticket, invoice due date. vars: deadline (fact; value = whole days from TODAY until the deadline, e.g. 23), stake (fact, money at stake: refund, fine, invoice amount), lead (lever, days before the deadline the user acts; start at 3). words: subject (e.g. "The boots return").',
    },

    reset: {
      id: "reset", name: "Square meter", system: "Space", chart: "gauge",
      primary: "reclaimed", outcome: "_projected", better: "higher",
      template: "{take} moves, about {minutesNeeded}, and this corner is clear.",
      acts: ["mission"], checkDays: 7, needsItems: false, needsSteps: true,
      words: { subject: "this corner" },
      vars: {
        minutes: { kind: "fact", label: "minutes for all of it", unit: "min", format: "min", min: 1, max: 60, step: 1, default: 7 },
        take: { kind: "lever", label: "moves you do now", unit: "moves", format: "int", min: 1, max: 7, step: 1, default: 5,
          range: (v, c) => [1, Math.max(1, (c.steps || []).length)] },
      },
      outputs: {
        reclaimed: { label: "reclaimed", format: "pct" },
        minutesNeeded: { label: "needed", format: "min" },
      },
      calc(v, inst) {
        const steps = (inst.steps || []).slice().sort((a, b) => a.n - b.n);
        const total = steps.reduce((s, x) => s + toNum(x.minutes, 0), 0);
        const take = clamp(Math.round(v.take), 0, steps.length);
        const scale = total > 0 && v.minutes > 0 ? v.minutes / total : 1;
        const minutesNeeded = steps.slice(0, take).reduce((s, x) => s + toNum(x.minutes, 0), 0) * scale;
        const projected = steps.length ? (take / steps.length) * 100 : 0;
        return { reclaimed: verifiedReclaimed(inst), minutesNeeded, _projected: projected, _scale: scale, _take: take };
      },
      formula(id, v, o, inst) {
        if (id === "minutesNeeded") {
          const steps = (inst.steps || []).slice().sort((a, b) => a.n - b.n).slice(0, o._take);
          return steps.length ? steps.map((s) => Math.round(toNum(s.minutes, 0) * o._scale * 10) / 10).join(" + ") + " min" : "0 min";
        }
        if (id === "reclaimed") return o.reclaimed > 0 ? "from your after photo" : "0% until an after photo shows it";
        return "";
      },
      series(v, o) {
        const done = o.reclaimed > 0;
        return { type: "gauge", unit: "%", value: done ? o.reclaimed : o._projected, min: 0, max: 100,
          threshold: done ? o._projected : null, label: done ? "reclaimed" : "if you do these" };
      },
      promptGuide:
        'reset (Square meter) — any physical chaos: a desk, drawer, nightstand, entryway, a dying plant (revive it), a pile to give away (release it). vars: minutes (fact, inferred total minutes, the sum of the steps), take (lever, how many steps to do now; start at all of them). steps (REQUIRED, 3-7): imperative, specific to THIS photo, <= 9 words each, with minutes and a pin [x,y] on the thing it touches. Keep the total near 7 minutes. words: subject (e.g. "the desk corner").',
    },
  };

  function riskyItems(inst, horizon) {
    const h = isNum(horizon) ? horizon : 3;
    return ((inst && inst.items) || []).filter((it) => !it.cooked && toNum(it.days, 99) <= h + EPS)
      .slice().sort((a, b) => (a.days - b.days) || (b.value - a.value));
  }
  function verifiedReclaimed(inst) {
    if (inst.mission && inst.mission.verified && isNum(inst.mission.verified.reclaimed)) return clamp(inst.mission.verified.reclaimed, 0, 100);
    const obs = (inst.observations || []).filter((o) => o.source === "mission" && isNum(o.value));
    return obs.length ? clamp(obs[obs.length - 1].value, 0, 100) : 0;
  }

  /* ---------------- var ranges ---------------- */
  function ctxFor(inst, vals) {
    return { vals: vals || {}, words: Object.assign({}, (MOLDS[inst.mold] || {}).words, inst.words || {}), items: inst.items || [], steps: inst.steps || [], today: dayNum(now()) };
  }
  function rangeFor(mold, id, value, ctx) {
    const d = mold.vars[id];
    let lo = d.min, hi = d.max;
    if (typeof d.range === "function" && isNum(value)) {
      const r = d.range(value, ctx);
      lo = r[0]; hi = r[1];
    }
    if (isNum(value) && d.kind === "fact") { lo = Math.min(lo, value); hi = Math.max(hi, value); }
    const step = typeof d.stepFor === "function" && isNum(value) ? d.stepFor(value) : d.step;
    return { min: lo, max: hi, step };
  }
  /* A lever's honest limits: its own range, narrowed so it can never travel past "as it is" (leak target <= rate,
     perUse target >= uses, dial steps >= 0, spoil cookN <= what is at risk). overrides are live drag values. */
  function applyBound(mold, id, r, vals, inst) {
    const d = mold.vars[id];
    if (!d || d.kind !== "lever" || typeof d.bound !== "function") return r;
    let b = null;
    try { b = d.bound(vals, inst); } catch (e) { b = null; }
    if (!b) return r;
    let lo = r.min, hi = r.max;
    if (isNum(b.max)) hi = Math.min(hi, b.max);
    if (isNum(b.min)) lo = Math.max(lo, b.min);
    if (hi < lo) { if (isNum(b.max) && !isNum(b.min)) lo = hi; else hi = lo; }
    return { min: lo, max: hi, step: r.step };
  }
  function range(inst, varId, overrides) {
    const mold = MOLDS[inst && inst.mold];
    if (!mold || !mold.vars[varId]) return null;
    const v = inst.vars && inst.vars[varId];
    const vals = {};
    for (const k in inst.vars || {}) vals[k] = inst.vars[k] && inst.vars[k].value;
    if (overrides) for (const k in overrides) if (isNum(overrides[k])) vals[k] = overrides[k];
    let r;
    if (v && isNum(v.min) && isNum(v.max) && v.max > v.min) r = { min: v.min, max: v.max, step: v.step || mold.vars[varId].step };
    else r = rangeFor(mold, varId, v ? v.value : mold.vars[varId].default, ctxFor(inst, vals));
    return applyBound(mold, varId, r, vals, inst);
  }

  /* ---------------- compute ---------------- */
  function values(inst, overrides) {
    const mold = MOLDS[inst.mold];
    const v = {};
    for (const id in mold.vars) {
      const d = mold.vars[id];
      let x = overrides && isNum(overrides[id]) ? overrides[id] : inst.vars && inst.vars[id] ? toNum(inst.vars[id].value, null) : null;
      if (!isNum(x)) x = isNum(d.default) ? d.default : null;
      if (!isNum(x) && id === "deadline") x = dayNum(now()) + 14;
      v[id] = x;
    }
    // levers are read inside their honest bounds, so no output ever reads "keep −$6,531"
    for (const id in mold.vars) {
      const d = mold.vars[id];
      if (d.kind !== "lever" || typeof d.bound !== "function" || !isNum(v[id])) continue;
      let b = null;
      try { b = d.bound(v, inst); } catch (e) { b = null; }
      if (!b) continue;
      if (isNum(b.max) && v[id] > b.max) v[id] = b.max;
      if (isNum(b.min) && v[id] < b.min) v[id] = b.min;
    }
    return v;
  }
  function compute(inst, overrides) {
    const mold = inst && MOLDS[inst.mold];
    if (!mold) return { outputs: {}, primary: NaN, series: null, outcome: NaN, values: {} };
    const today = dayNum(now());
    const v = values(inst, overrides);
    const raw = mold.calc(v, inst, today);
    const outputs = {};
    for (const k in mold.outputs) outputs[k] = raw[k];
    const stored = overrides ? values(inst, null) : v;
    let series = null;
    try { series = mold.series(v, raw, inst, stored); } catch (e) { series = null; }
    return { outputs, primary: raw[mold.primary], outcome: raw[mold.outcome], series, values: v, _raw: raw };
  }
  function formula(inst, outId, overrides) {
    const mold = inst && MOLDS[inst.mold];
    if (!mold || !mold.outputs[outId]) return "";
    const v = values(inst, overrides);
    const raw = mold.calc(v, inst, dayNum(now()));
    try { return mold.formula(outId, v, raw, inst) || ""; } catch (e) { return ""; }
  }
  function primaryOf(inst, overrides) {
    const mold = inst && MOLDS[inst.mold];
    if (!mold) return { id: null, value: NaN, formatted: "—", label: "" };
    // the instrument's own number is reality "as it is": a lever choice (cook 3 tonight) is a plan, not a reading
    const c = compute(inst, overrides || mold.asIs || undefined);
    const o = mold.outputs[mold.primary];
    return { id: mold.primary, value: c.primary, formatted: format(c.primary, o.format, inst), label: o.label };
  }
  /* The primary output "as it is": for molds whose primary depends on the lever itself (spoil), the lever
     is set to its do-nothing value, so a commit reads "$12 lost -> $0 lost" instead of "$0 -> $0". */
  function baseline(inst) {
    const mold = inst && MOLDS[inst.mold];
    if (!mold) return NaN;
    return compute(inst, mold.asIs || undefined).primary;
  }
  /* verdict(inst, varId, value, overrides): is committing the lever at value a step the right way?
     'better' | 'same' (no change from as it is) | 'worse' | 'na' (molds with no "as it is": countdown, reset). */
  const COMPARABLE = { leak: 1, perUse: 1, dial: 1, spoil: 1 };
  function verdict(inst, varId, value, overrides) {
    const mold = inst && MOLDS[inst.mold];
    if (!mold || !COMPARABLE[mold.id] || !mold.vars[varId] || mold.vars[varId].kind !== "lever") return "na";
    const ov = Object.assign({}, overrides || {});
    const raw = values(inst, Object.assign({}, ov, { [varId]: value }))[varId];
    if (isNum(raw) && Math.abs(raw - value) > EPS) return "worse";   // past the bound
    const base = compute(inst, Object.assign({}, ov, mold.asIs || {})).primary;
    const out = compute(inst, Object.assign({}, ov, { [varId]: value })).outcome;
    if (!isNum(base) || !isNum(out)) return "na";
    const tol = Math.max(0.005, Math.abs(base) * 1e-6);
    const d = mold.better === "lower" ? base - out : out - base;
    return d > tol ? "better" : d < -tol ? "worse" : "same";
  }
  /* The primary output in the world where the lever choice holds (used for ghost targets). */
  function outcome(inst, overrides) {
    const mold = inst && MOLDS[inst.mold];
    if (!mold) return { id: null, value: NaN, formatted: "—" };
    const c = compute(inst, overrides);
    const fmt = mold.outputs[mold.primary].format;
    return { id: mold.outcome, value: c.outcome, formatted: format(c.outcome, fmt, inst) };
  }

  /* ---------------- sentence ---------------- */
  function templateIds(mold) {
    const ids = [];
    mold.template.replace(/\{([a-zA-Z.]+)\}/g, (m, k) => { if (k.indexOf("w.") !== 0) ids.push(k); return m; });
    return ids;
  }
  function sentence(inst, overrides) {
    const mold = inst && MOLDS[inst.mold];
    if (!mold) return [];
    const words = Object.assign({}, mold.words, inst.words || {});
    const out = [];
    const push = (t) => {
      if (!t) return;
      const last = out[out.length - 1];
      if (last && last.t === "text") last.text += t; else out.push({ t: "text", text: t });
    };
    const re = /\{([a-zA-Z.]+)\}/g;
    let i = 0, m;
    const tpl = mold.template;
    let lastVal = null;
    while ((m = re.exec(tpl))) {
      let lit = tpl.slice(i, m.index);
      if (inst.mold === "reset" && lastVal === 1) lit = lit.replace(/^ moves/, " move");
      push(escapeHTML(lit));
      i = re.lastIndex;
      const key = m[1];
      lastVal = null;
      if (key.indexOf("w.") === 0) {
        const k = key.slice(2);
        let w = words[k] != null ? String(words[k]) : "";
        if (out.length === 0 && w) w = w.charAt(0).toUpperCase() + w.slice(1);
        push(escapeHTML(w));
      } else if (mold.vars[key]) {
        if (!inst.vars || !inst.vars[key]) { push("—"); continue; }
        out.push({ t: "var", id: key });
        lastVal = overrides && isNum(overrides[key]) ? overrides[key] : toNum(inst.vars[key].value, null);
      } else if (mold.outputs[key]) {
        out.push({ t: "out", id: key });
      }
    }
    let rest = tpl.slice(i);
    if (inst.mold === "reset" && lastVal === 1) rest = rest.replace(/^ moves/, " move");
    push(escapeHTML(rest));
    return out;
  }

  /* ---------------- hinge & confidence ---------------- */
  function sentenceFacts(inst) {
    const mold = MOLDS[inst.mold];
    return templateIds(mold).filter((id) => mold.vars[id] && mold.vars[id].kind === "fact" && inst.vars && inst.vars[id]);
  }
  function hinge(inst) {
    const none = { varId: null, impact: 0, isLever: false, note: "" };
    const mold = inst && MOLDS[inst.mold];
    if (!mold) return none;
    const ids = templateIds(mold).filter((id) => mold.vars[id] && inst.vars && inst.vars[id]);
    let best = null;
    for (const id of ids) {
      const d = mold.vars[id];
      const v = inst.vars[id];
      const isLever = d.kind === "lever";
      if (!isLever && v.origin === "seen") continue;
      const r = range(inst, id);
      if (!r) continue;
      const a = compute(inst, { [id]: r.min });
      const b = compute(inst, { [id]: r.max });
      const dp = Math.abs((a.primary || 0) - (b.primary || 0));
      const doo = Math.abs((a.outcome || 0) - (b.outcome || 0));
      const impact = Math.max(isNum(dp) ? dp : 0, isNum(doo) ? doo : 0);
      const tol = Math.max(EPS, Math.abs(impact) * 1e-9);
      if (!best || impact > best.impact + tol || (Math.abs(impact - best.impact) <= tol && isLever && !best.isLever)) {
        best = { varId: id, impact, isLever, origin: v.origin };
      }
    }
    if (!best) return none;
    let note;
    if (best.isLever) note = "This is the one that decides it.";
    else if (best.origin === "set") note = "Everything turns on this one. You set it.";
    else note = "Everything turns on this guess. Set it.";
    return { varId: best.varId, impact: best.impact, isLever: best.isLever, note };
  }
  function confidence(inst) {
    const mold = inst && MOLDS[inst.mold];
    if (!mold) return { measured: 0, total: 0, ratio: 0 };
    let ids = Array.isArray(mold.confFacts) ? mold.confFacts.filter((id) => inst.vars && inst.vars[id]) : sentenceFacts(inst);
    if (!ids.length) ids = Object.keys(mold.vars).filter((id) => mold.vars[id].kind === "fact" && inst.vars && inst.vars[id]);
    const measured = ids.filter((id) => inst.vars[id].origin === "seen" || inst.vars[id].origin === "set").length;
    return { measured, total: ids.length, ratio: ids.length ? measured / ids.length : 0, ids: ids.slice() };
  }

  /* ---------------- ghost ---------------- */
  function checkAtFor(inst, committedAt, value) {
    const mold = MOLDS[inst.mold];
    const t = isNum(committedAt) ? committedAt : now();
    if (mold && mold.id === "countdown") {
      const v = values(inst, isNum(value) ? { lead: value } : null);
      return Math.max(t, fromDayNum(Math.round(v.deadline - v.lead)));
    }
    return t + ((mold && mold.checkDays) || 7) * DAY;
  }
  function intentionFor(inst, varId, value, at) {
    const mold = MOLDS[inst.mold];
    const t = isNum(at) ? at : now();
    const tgt = compute(inst, { [varId]: value });
    return { varId, value, baseline: baseline(inst), target: tgt.outcome, outputId: mold.primary,
      committedAt: t, checkAt: checkAtFor(inst, t, value), status: "open", actionId: null };
  }
  function ghost(inst) {
    const mold = inst && MOLDS[inst.mold];
    const it = inst && inst.intention;
    const points = ((inst && inst.observations) || []).filter((o) => isNum(o.t) && isNum(o.value))
      .map((o) => (o.hollow ? { t: o.t, v: o.value, hollow: true, source: o.source } : { t: o.t, v: o.value, source: o.source })).sort((a, b) => a.t - b.t);
    if (!mold || !it) return { baseline: null, target: null, start: null, end: null, points, status: "none", due: false, progress: null };
    const base0 = isNum(it.baseline) ? it.baseline : baseline(inst);
    let target = isNum(it.value) ? compute(inst, { [it.varId]: it.value }).outcome : NaN;
    if (!isNum(target)) target = isNum(it.target) ? it.target : base0;
    const start = isNum(it.committedAt) ? it.committedAt : now();
    const end = isNum(it.checkAt) ? it.checkAt : checkAtFor(inst, start, it.value);
    const t = now();
    let status = it.status === "held" || it.status === "missed" ? it.status : "open";
    const ms = inst.mission;
    if (ms && ms.verified && (!isNum(ms.startedAt) || ms.startedAt >= start - 60000) && ms.verified.reclaimed > 0) status = "held";
    // a promise resolves only on a decisive reading: a manual check-in, a mission, or a photo/mail reading whose
    // deciding facts were seen or set (a hollow reading built on a guess never scores the promise)
    const after = points.filter((p) => p.t > start && !p.hollow);
    const tol = 0.1 * Math.max(Math.abs(target), Math.abs(target) < EPS ? Math.abs(base0) : 0);
    let progress = null;
    if (after.length) {
      const last = after[after.length - 1].v;
      const span = mold.better === "lower" ? base0 - target : target - base0;
      const got = mold.better === "lower" ? base0 - last : last - base0;
      progress = span > EPS ? clamp(got / span, -1, 1) : null;
      // a manual "how did it go" answers the check-in as soon as it is given
      const manual = after[after.length - 1].source === "manual";
      if (status === "open" && (t >= end || manual)) {
        const ok = mold.better === "lower" ? last <= target + tol : last >= target - tol;
        const closer = !ok && got > Math.max(tol * 0.5, Math.abs(base0) * 0.02);
        status = ok ? "held" : closer ? "closer" : "missed";
      }
    }
    return { baseline: base0, target, start, end, points, status, due: status === "open" && t >= end, progress };
  }

  /* ---------------- validate ---------------- */
  function badBox(b) {
    if (!Array.isArray(b) || b.length !== 4) return "must be [x, y, w, h]";
    if (!b.every((x) => isNum(toNum(x, NaN)))) return "must be four numbers";
    if (b.some((x) => toNum(x, 0) > 1.5 || toNum(x, 0) < -0.1)) return "must be fractions 0..1 of the image, not pixels";
    return null;
  }
  function validate(spec, opts) {
    const errs = [];
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return ["The reply must be one JSON object."];
    if (spec.fit === false) {
      if (typeof spec.why !== "string" || !spec.why.trim()) errs.push('"why" must be a short sentence when "fit" is false.');
      return errs;
    }
    const mold = MOLDS[spec.mold];
    if (!mold) { errs.push('"mold" must be one of: ' + Object.keys(MOLDS).join(", ") + "."); return errs; }
    if (!spec.vars || typeof spec.vars !== "object") { errs.push('"vars" must be an object keyed by variable id.'); return errs; }
    for (const id in mold.vars) {
      const d = mold.vars[id];
      const v = spec.vars[id];
      if (v == null) { if (d.required) errs.push('vars.' + id + " is required for mold " + mold.id + "."); continue; }
      const val = typeof v === "object" ? v.value : v;
      if (!isNum(toNum(val, NaN))) { errs.push("vars." + id + ".value must be a number."); continue; }
      if (d.kind === "fact" && typeof v === "object" && v.origin != null && ["seen", "inferred", "assumed"].indexOf(v.origin) < 0)
        errs.push("vars." + id + '.origin must be "seen", "inferred" or "assumed".');
      if (typeof v === "object" && v.evidence && v.evidence.bbox != null) {
        const b = badBox(v.evidence.bbox);
        if (b) errs.push("vars." + id + ".evidence.bbox " + b + ".");
      }
    }
    if (mold.needsItems) {
      if (!Array.isArray(spec.items) || !spec.items.length) errs.push('"items" must list 3-12 visible foods for mold spoil.');
      else spec.items.forEach((it, i) => {
        if (!it || typeof it.name !== "string") errs.push("items[" + i + "].name must be a string.");
        else if (!isNum(toNum(it.days, NaN))) errs.push("items[" + i + "].days must be a number.");
      });
    }
    if (mold.needsSteps) {
      if (!Array.isArray(spec.steps) || !spec.steps.length) errs.push('"steps" must list 3-7 steps for mold reset.');
      else spec.steps.forEach((s, i) => { if (!s || typeof s.text !== "string" || !s.text.trim()) errs.push("steps[" + i + "].text must be a string."); });
    }
    if (!opts || opts.source !== "mail") {
      for (const k of ["items", "steps"]) {
        (Array.isArray(spec[k]) ? spec[k] : []).forEach((x, i) => {
          if (x && Array.isArray(x.pin) && x.pin.some((p) => toNum(p, 0) > 1.5)) errs.push(k + "[" + i + "].pin must be fractions 0..1, not pixels.");
        });
      }
    }
    return errs;
  }

  /* ---------------- build ---------------- */
  const EMAIL_RE = /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}$/i;
  function email(v) { const s = str(v, 120); return s && EMAIL_RE.test(s) ? s : null; }
  function cleanBox(b) {
    if (badBox(b)) return null;
    let [x, y, w, h] = b.map((n) => toNum(n, 0));
    x = clamp(x, 0, 1); y = clamp(y, 0, 1);
    w = clamp(w, 0, 1 - x); h = clamp(h, 0, 1 - y);
    if (w < 0.004 || h < 0.004) return null;
    return [x, y, w, h].map((n) => Math.round(n * 10000) / 10000);
  }
  function cleanPin(p) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = toNum(p[0], NaN), y = toNum(p[1], NaN);
    if (!isNum(x) || !isNum(y) || x > 1.5 || y > 1.5) return null;
    return [Math.round(clamp(x, 0, 1) * 1000) / 1000, Math.round(clamp(y, 0, 1) * 1000) / 1000];
  }
  function cleanDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; }
  function cleanItems(arr) {
    return (Array.isArray(arr) ? arr : []).filter((it) => it && typeof it.name === "string" && it.name.trim()).slice(0, 12).map((it, i) => ({
      id: "i" + (i + 1),
      name: cleanWord(it.name, 32, "item").toLowerCase(),
      value: Math.max(0, Math.round(toNum(it.value, 0) * 100) / 100),
      days: clamp(Math.round(toNum(it.days, 3) * 2) / 2, 0, 60),
      origin: ["seen", "inferred", "assumed"].indexOf(it.origin) >= 0 ? it.origin : "inferred",
      pin: cleanPin(it.pin),
    }));
  }
  function cleanSteps(arr) {
    return (Array.isArray(arr) ? arr : []).filter((s) => s && typeof s.text === "string" && s.text.trim()).slice(0, 7).map((s, i) => ({
      id: "s" + (i + 1), n: i + 1,
      text: cleanWord(s.text, 72, "Do this step"),
      minutes: clamp(Math.round(toNum(s.minutes, 2) * 2) / 2, 0.5, 30),
      pin: cleanPin(s.pin),
    }));
  }
  function cleanWords(mold, w) {
    w = w && typeof w === "object" ? w : {};
    const out = { currency: cleanWord(w.currency, 3, "$") || "$" };
    const subj = cleanWord(w.subject, 40, null);
    if (subj) out.subject = subj; else if (mold.words.subject) out.subject = mold.words.subject;
    if (mold.id === "leak") out.period = w.period === "month" ? "month" : "week";
    if (mold.id === "perUse") out.basis = w.basis === "month" ? "month" : "once";
    if (mold.id === "dial") out.stepUnit = cleanWord(w.stepUnit, 28, null) || mold.words.stepUnit;
    return out;
  }
  function labelFor(d, words) { return d.label.replace("{period}", words.period || "week"); }

  /* Makes one Evidence entry from a Claude var evidence object. ctx.source 'photo'|'mail'. Returns entry or null. */
  function evidenceFrom(ev, ctx, n) {
    if (!ev || typeof ev !== "object") return null;
    if (ctx.source !== "mail" && ev.bbox != null) {
      const bbox = cleanBox(ev.bbox);
      if (!bbox) return null;
      return { id: "ev" + n, type: "photo", bbox, text: str(ev.text, 80, ""), photoIndex: 0 };
    }
    const threadId = str(ev.threadId, 80);
    if (threadId) {
      const meta = (ctx.threads && ctx.threads[threadId]) || {};
      return { id: "ev" + n, type: "email", threadId, quote: str(ev.quote, 120, ""), date: cleanDate(ev.date) || cleanDate(meta.date) || null,
        subject: str(meta.subject || ev.subject, 120, null), sender: str(meta.sender || ev.sender, 120, null) };
    }
    return null;
  }

  function makeVars(mold, specVars, words, extra, ctx) {
    specVars = specVars || {};
    const today = dayNum(now());
    const raw = {};
    for (const id in mold.vars) {
      const sv = specVars[id];
      raw[id] = sv == null ? null : toNum(typeof sv === "object" ? sv.value : sv, null);
    }
    if (mold.id === "countdown" && isNum(raw.deadline)) raw.deadline = today + Math.round(raw.deadline);
    if (mold.id === "reset" && !isNum(raw.minutes)) raw.minutes = (extra.steps || []).reduce((s, x) => s + x.minutes, 0) || null;
    if (mold.id === "reset" && !isNum(raw.take)) raw.take = (extra.steps || []).length || null;
    const vals = {};
    for (const id in mold.vars) vals[id] = isNum(raw[id]) ? raw[id] : mold.vars[id].default;
    const rctx = { vals, words, items: extra.items || [], steps: extra.steps || [], today };
    const vars = {};
    const evidence = [];
    for (const id in mold.vars) {
      const d = mold.vars[id];
      const sv = specVars[id] && typeof specVars[id] === "object" ? specVars[id] : {};
      let value = vals[id];
      if (!isNum(value)) {
        if (d.optional) continue;
        if (id === "deadline") value = today + 14;
        else continue;
      }
      let origin;
      if (d.kind === "lever") origin = "lever";
      else if (!isNum(raw[id])) origin = "assumed";
      else origin = ["seen", "inferred", "assumed"].indexOf(sv.origin) >= 0 ? sv.origin : "inferred";
      let evidenceId = null;
      let reason = cleanNote(sv.reason, 140);
      if (origin === "seen") {
        const ev = evidenceFrom(sv.evidence, ctx, evidence.length + 1);
        if (ev) { evidence.push(ev); evidenceId = ev.id; }
        else { origin = "inferred"; reason = reason || (ctx.source === "mail" ? "Read from your mail, but not quoted." : "Read from the photo, but not boxed."); }
      }
      if (origin === "assumed" && !reason) reason = "A starting guess. Set it.";
      if (d.kind === "lever") reason = null;
      const r = rangeFor(mold, id, value, rctx);
      value = clamp(value, r.min, r.max);
      if (d.kind === "lever" || d.format === "int" || d.format === "days" || d.format === "day") value = Math.round(value);
      vars[id] = { id, kind: d.kind, label: labelFor(d, words), unit: d.unit.replace("{period}", words.period || "week"), format: d.format,
        value, min: r.min, max: r.max, step: r.step, origin, evidenceId, reason };
    }
    return { vars, evidence };
  }

  function observe(inst, source, note, at) {
    const mold = MOLDS[inst.mold];
    const c = compute(inst);
    const facts = {};
    for (const id in inst.vars) if (mold.vars[id] && mold.vars[id].kind === "fact") facts[id] = inst.vars[id].value;
    const hollow = (mold.decisive || []).some((id) => inst.vars[id] && inst.vars[id].origin !== "seen" && inst.vars[id].origin !== "set");
    const o = { t: isNum(at) ? at : now(), value: c.primary, facts, source: source || "manual", note: note || null };
    if (hollow) o.hollow = true;
    return o;
  }

  function build(spec, photoRef, opts) {
    opts = opts || {};
    const mold = MOLDS[spec && spec.mold];
    if (!mold) throw { code: "invalid_json", message: "Unknown mold." };
    const source = opts.source === "mail" ? "mail" : "photo";
    const t = now();
    const words = cleanWords(mold, spec.words);
    const items = mold.needsItems ? cleanItems(spec.items) : [];
    const steps = mold.needsSteps ? cleanSteps(spec.steps) : [];
    const mv = makeVars(mold, spec.vars, words, { items, steps }, { source, threads: opts.threads });
    const act = spec.act && typeof spec.act === "object" ? spec.act : {};
    const actType = mold.acts.indexOf(act.type) >= 0 ? act.type : mold.acts[0];
    const to = email(act.to);
    const photo = photoRef ? Object.assign({}, photoRef, { role: "hero" }) : null;
    const inst = {
      id: rid("ins_", 8), v: 1, demo: !!opts.demo, mold: mold.id,
      kind: (str(spec.kind, 48, mold.id) || mold.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || mold.id,
      system: SYSTEMS.indexOf(spec.system) >= 0 ? spec.system : mold.system,
      title: cleanWord(spec.title, 28, mold.name) || mold.name,
      createdAt: t, updatedAt: t,
      photo, photos: photo ? [photo] : [],
      words, vars: mv.vars, items, steps, evidence: mv.evidence,
      fieldNote: cleanNote(spec.fieldNote, 180),
      nextPhotos: (Array.isArray(spec.nextPhotos) ? spec.nextPhotos : []).map((s) => cleanWord(s, 90, null)).filter(Boolean).slice(0, 3),
      mailQuery: str(spec.mailQuery, 200, null),
      act: { type: actType, to, why: cleanWord(act.why, 120, null) },
      contact: to ? { to, threadId: null, messageId: null } : null,
      intention: null, observations: [], actions: [], mission: null, enriched: null,
    };
    if (mold.id === "spoil" && inst.vars.cookN) {
      const c = compute(inst)._raw;
      if (!(spec.vars && spec.vars.cookN != null)) inst.vars.cookN.value = Math.min(2, c._risk.length);
    }
    inst.observations.push(observe(inst, source === "mail" ? "email" : "photo", null, t));
    return inst;
  }

  /* New reading of an existing instrument (snap). Returns a new instrument; does not add the observation. */
  function snap(inst, spec, photoRef) {
    const mold = MOLDS[inst.mold];
    const out = clone(inst);
    if (!mold || spec.mold !== inst.mold) return out;
    const words = out.words || cleanWords(mold, {});
    const items = mold.needsItems ? cleanItems(spec.items) : out.items || [];
    const steps = mold.needsSteps ? cleanSteps(spec.steps) : out.steps || [];
    const mv = makeVars(mold, spec.vars, words, { items, steps }, { source: "photo" });
    const keptEvidence = (out.evidence || []).filter((e) => e.type === "email");
    const evidence = keptEvidence.slice();
    let n = evidence.reduce((m, e) => Math.max(m, parseInt(String(e.id).replace(/\D/g, ""), 10) || 0), 0);
    for (const id in mv.vars) {
      const nv = mv.vars[id];
      const ov = out.vars[id];
      if (nv.kind === "lever") { if (!ov) out.vars[id] = nv; continue; }
      const given = spec.vars && spec.vars[id] != null;
      if (ov && (!given || (ov.origin === "set" && nv.origin !== "seen") || (ov.origin === "seen" && nv.origin !== "seen" && ov.evidenceId && keptEvidence.some((e) => e.id === ov.evidenceId)))) {
        if (ov.evidenceId && !evidence.some((e) => e.id === ov.evidenceId)) ov.evidenceId = null;
        if (ov.origin === "seen" && !ov.evidenceId) ov.origin = "inferred";
        continue;
      }
      if (nv.evidenceId) {
        const ev = mv.evidence.find((e) => e.id === nv.evidenceId);
        n += 1;
        const copy = Object.assign({}, ev, { id: "ev" + n });
        evidence.push(copy);
        nv.evidenceId = copy.id;
      }
      out.vars[id] = nv;
    }
    out.evidence = evidence;
    if (mold.needsItems && items.length) out.items = items;
    if (mold.needsSteps && steps.length) out.steps = steps;
    if (photoRef) {
      const ref = Object.assign({}, photoRef, { role: "snap" });
      out.photo = ref;
      out.photos = (out.photos || []).concat([ref]).slice(-6);
    }
    const note = cleanNote(spec.fieldNote, 180);
    if (note) out.fieldNote = note;
    if (Array.isArray(spec.nextPhotos) && spec.nextPhotos.length) out.nextPhotos = spec.nextPhotos.map((s) => cleanWord(s, 90, null)).filter(Boolean).slice(0, 3);
    if (!out.mailQuery && spec.mailQuery) out.mailQuery = str(spec.mailQuery, 200, null);
    const vals = {};
    for (const id in out.vars) vals[id] = out.vars[id].value;
    const rctx = ctxFor(out, vals);
    for (const id in out.vars) {
      const lv = out.vars[id];
      if (lv.kind !== "lever" || !mold.vars[id]) continue;
      const r = rangeFor(mold, id, lv.value, rctx);
      lv.min = r.min; lv.max = r.max;
      lv.value = clamp(lv.value, r.min, r.max);
    }
    out.updatedAt = now();
    return out;
  }

  /* Enrichment patch from mail. Only facts change, and only to "seen" with email evidence. */
  function applyPatch(inst, patch, opts) {
    const mold = MOLDS[inst && inst.mold];
    const out = clone(inst);
    if (!mold || !patch || typeof patch !== "object") return out;
    opts = opts || {};
    out.evidence = out.evidence || [];
    let n = out.evidence.reduce((m, e) => Math.max(m, parseInt(String(e.id).replace(/\D/g, ""), 10) || 0), 0);
    const pv = patch.vars && typeof patch.vars === "object" ? patch.vars : {};
    for (const id in pv) {
      const d = mold.vars[id];
      if (!d || d.kind !== "fact") continue;
      const p = pv[id];
      let value = toNum(p && typeof p === "object" ? p.value : p, NaN);
      if (!isNum(value)) continue;
      if (id === "deadline" && p && p.daysFromToday) value = dayNum(now()) + Math.round(value);
      n += 1;
      const ev = evidenceFrom(Object.assign({}, p && p.evidence), { source: "mail", threads: opts.threads }, n);
      if (!ev) { n -= 1; continue; }
      out.evidence.push(ev);
      const prev = out.vars[id] || { id, kind: "fact", label: labelFor(d, out.words || {}), unit: d.unit.replace("{period}", (out.words && out.words.period) || "week"), format: d.format, step: d.step };
      if (d.format === "int" || d.format === "days" || d.format === "day") value = Math.round(value);
      prev.value = value;
      prev.min = isNum(prev.min) ? Math.min(prev.min, value) : Math.min(d.min, value);
      prev.max = isNum(prev.max) ? Math.max(prev.max, value) : Math.max(d.max, value);
      prev.origin = "seen";
      prev.evidenceId = ev.id;
      prev.reason = null;
      out.vars[id] = prev;
    }
    if (mold.needsItems && Array.isArray(patch.items) && patch.items.length) {
      const items = cleanItems(patch.items);
      if (items.length) out.items = items.map((it) => { const old = (inst.items || []).find((o) => o.name === it.name); return old && old.pin ? Object.assign(it, { pin: old.pin }) : it; });
    }
    const obs = (out.observations || []).slice();
    for (const h of Array.isArray(patch.history) ? patch.history : []) {
      const date = cleanDate(h && h.date);
      if (!date || !h.facts || typeof h.facts !== "object") continue;
      const over = {};
      for (const k in h.facts) if (mold.vars[k] && mold.vars[k].kind === "fact" && isNum(toNum(h.facts[k], NaN))) over[k] = toNum(h.facts[k], NaN);
      if (!Object.keys(over).length) continue;
      const t = Date.parse(date + "T12:00:00");
      if (!isNum(t) || t > now() + DAY) continue;
      const c = compute(out, over);
      if (obs.some((o) => o.source === "email" && Math.abs(o.t - t) < DAY / 2)) continue;
      obs.push({ t, value: c.primary, facts: over, source: "email", note: null });
    }
    obs.sort((a, b) => a.t - b.t);
    out.observations = obs.slice(-60);
    const ct = patch.contact && typeof patch.contact === "object" ? patch.contact : null;
    if (ct) {
      const prev = out.contact || { to: null, threadId: null, messageId: null };
      out.contact = { to: email(ct.to) || prev.to, threadId: str(ct.threadId, 80, null) || prev.threadId, messageId: str(ct.messageId, 120, null) || prev.messageId };
    }
    const summary = cleanNote(patch.summary, 200);
    out.enriched = { at: now(), summary };
    out.updatedAt = now();
    return out;
  }

  /* ---------------- registry ---------------- */
  function publicDef(m) {
    const vars = {};
    for (const id in m.vars) {
      const d = m.vars[id];
      vars[id] = { kind: d.kind, label: d.label, unit: d.unit, format: d.format, min: d.min, max: d.max, step: d.step, default: d.default };
    }
    const outputs = {};
    for (const id in m.outputs) outputs[id] = { label: m.outputs[id].label, format: m.outputs[id].format };
    return { id: m.id, name: m.name, system: m.system, chart: m.chart, vars, outputs, primary: m.primary, better: m.better, template: m.template,
      acts: m.acts.slice(), checkDays: m.checkDays, needsItems: m.needsItems, needsSteps: m.needsSteps, promptGuide: m.promptGuide };
  }
  const DEFS = {};
  for (const id in MOLDS) DEFS[id] = publicDef(MOLDS[id]);

  WB.molds = {
    list: () => Object.keys(DEFS).map((k) => DEFS[k]),
    get: (id) => DEFS[id] || null,
    compute, hinge, confidence, ghost, sentence, format, primaryOf, validate, build, applyPatch,
    /* extras beyond the contract (safe to ignore) */
    outcome, baseline, formula, range, snap, observe, intentionFor, checkAtFor, verdict, riskyItems: (inst, h) => riskyItems(inst, h),
    ids: () => Object.keys(DEFS),
    SYSTEMS: SYSTEMS.slice(), FORMATS: FORMATS.slice(), ORIGINS: ORIGINS.slice(),
  };
})();
