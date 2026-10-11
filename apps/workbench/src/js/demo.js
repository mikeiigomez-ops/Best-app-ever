/* ---- Workbench demo (Zhuo) ----
   The example bench: four instruments built on hand-drawn ink "photos", each stamped EXAMPLE,
   so it is honest that none of it is real. Also the canned answers demo instruments use instead of Claude
   (enrichPatch, verifyFallback, draftFallback). Registers functions only; nothing runs at load. */
(function () {
  "use strict";
  const WB = window.WB;

  const DAY = 86400000;
  const HOUR = 3600000;
  /* Ink-on-vellum colours for the drawings. These are pictures (img src), not page styling,
     so they carry the palette's light values literally. */
  const PAPER = "#F3EFE6", PAPER2 = "#EAE4D7", PAPER3 = "#DDD5C4", INK = "#1A1916", INK2 = "#4A463E", INK3 = "#8A8476", SIGNAL = "#FF4D1A";
  const MONO = "'IBM Plex Mono', Menlo, Consolas, monospace";
  const SERIF = "'Instrument Serif', Georgia, serif";

  const now = () => (WB.util && typeof WB.util.now === "function" ? WB.util.now() : Date.now());
  function isoDay(ms) {
    const d = new Date(ms);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ------------------------------------------------------------ drawings */
  function stamp(x, y, rot) {
    return '<g transform="translate(' + x + " " + y + ") rotate(" + rot + ')" opacity=".86">' +
      '<rect x="-92" y="-26" width="184" height="52" rx="5" fill="none" stroke="' + SIGNAL + '" stroke-width="4"/>' +
      '<rect x="-84" y="-18" width="168" height="36" rx="3" fill="none" stroke="' + SIGNAL + '" stroke-width="1.5"/>' +
      '<text x="0" y="10" text-anchor="middle" font-family="' + MONO + '" font-size="27" font-weight="700" letter-spacing="5" fill="' + SIGNAL + '">EXAMPLE</text></g>';
  }
  function grain(id) {
    return '<filter id="' + id + '"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .1  0 0 0 0 .09  0 0 0 0 .07  0 0 0 .07 0"/></filter>';
  }
  function svg(w, h, body) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '">' +
      "<defs>" + grain("g") + "</defs>" +
      '<rect width="' + w + '" height="' + h + '" fill="' + PAPER + '"/>' + body +
      '<rect width="' + w + '" height="' + h + '" filter="url(#g)" opacity=".9"/></svg>';
  }
  const T = (x, y, s, txt, o) => '<text x="' + x + '" y="' + y + '" font-family="' + ((o && o.f) || MONO) + '" font-size="' + s + '"' +
    (o && o.a ? ' text-anchor="' + o.a + '"' : "") + (o && o.w ? ' font-weight="' + o.w + '"' : "") + (o && o.ls ? ' letter-spacing="' + o.ls + '"' : "") +
    ' fill="' + ((o && o.c) || INK) + '">' + txt + "</text>";
  const L = (d, o) => '<path d="' + d + '" fill="' + ((o && o.fill) || "none") + '" stroke="' + ((o && o.c) || INK) + '" stroke-width="' + ((o && o.w) || 2.2) +
    '" stroke-linecap="round" stroke-linejoin="round"' + (o && o.dash ? ' stroke-dasharray="' + o.dash + '"' : "") + "/>";

  // 1. Golden Wok receipt, 600×800. TOTAL line boxed at [0.2917, 0.48, 0.4167, 0.045].
  function receiptSVG() {
    let zig = "M150 40H450V742";
    for (let x = 450, up = true; x > 150; x -= 15, up = !up) zig += "L" + (x - 15) + " " + (up ? 758 : 742);
    zig += "Z";
    let bars = "";
    const bw = [3, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 3, 1, 2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1];
    let bx = 214;
    bw.forEach((w, i) => { if (i % 2 === 0) bars += '<rect x="' + bx + '" y="600" width="' + w * 2 + '" height="54" fill="' + INK + '"/>'; bx += w * 2 + 2; });
    const row = (y, l, r, o) => T(180, y, (o && o.s) || 17, l, o) + T(420, y, (o && o.s) || 17, r, Object.assign({ a: "end" }, o || {}));
    return svg(600, 800,
      '<path d="' + zig + '" transform="translate(9 10)" fill="' + PAPER3 + '"/>' +
      '<path d="' + zig + '" fill="#FBF8F1" stroke="' + INK3 + '" stroke-width="1.5"/>' +
      L("M300 66c-14 0-22 8-22 17h44c0-9-8-17-22-17zM270 83h60M292 66v-6M308 66v-6", { w: 2 }) +
      T(300, 122, 31, "GOLDEN WOK", { a: "middle", w: 700, ls: 3 }) +
      T(300, 148, 14, "142 MILL ST · TAKEOUT", { a: "middle", c: INK2, ls: 1 }) +
      T(300, 170, 13, "ORDER 0318 · 19:42", { a: "middle", c: INK2 }) +
      L("M172 188H428", { w: 1.6, dash: "5 6", c: INK2 }) +
      row(220, "1 KUNG PAO CHICKEN", "14.50") +
      row(248, "1 VEG FRIED RICE", "8.90") +
      row(276, "1 DUMPLINGS (6)", "6.50") +
      row(304, "  CHOPSTICKS ×2", "0.00", { c: INK2 }) +
      L("M172 324H428", { w: 1.6, dash: "5 6", c: INK2 }) +
      row(352, "SUBTOTAL", "29.90") +
      row(378, "TAX", "1.50") +
      row(412, "TOTAL", "$31.40", { s: 26, w: 700 }) +
      L("M172 438H428", { w: 1.6, dash: "5 6", c: INK2 }) +
      T(300, 474, 16, "WOK CLUB  ● ● ● ○ ○", { a: "middle", ls: 1 }) +
      T(300, 500, 13, "3RD ORDER THIS WEEK · 2 MORE = FREE ROLLS", { a: "middle", c: INK2 }) +
      T(300, 556, 22, "thank you", { a: "middle", f: SERIF, c: INK2 }) +
      bars +
      T(300, 680, 12, "0318 2210 4471 0026", { a: "middle", c: INK2, ls: 2 }) +
      stamp(452, 560, -14));
  }

  // 2. Fridge shelf, 800×600. Item pins match the drawing.
  function fridgeSVG() {
    return svg(800, 600,
      '<rect x="40" y="30" width="720" height="540" rx="14" fill="' + PAPER2 + '" stroke="' + INK + '" stroke-width="3"/>' +
      '<rect x="62" y="52" width="676" height="496" rx="6" fill="#F8F5EE" stroke="' + INK3 + '" stroke-width="1.5"/>' +
      L("M62 334H738", { w: 3 }) + L("M62 342H738", { w: 1, c: INK3 }) +
      L("M62 522H738", { w: 3 }) + L("M90 535H710", { w: 1, c: INK3, dash: "3 7" }) +
      L("M700 70v40M716 70v40", { w: 1.2, c: INK3 }) +
      // half roast chicken on a plate
      '<ellipse cx="170" cy="318" rx="98" ry="15" fill="#FBF8F1" stroke="' + INK + '" stroke-width="2.2"/>' +
      L("M92 312c-4-34 18-64 54-74 30-8 62 2 84 22 12 11 18 30 14 52", { fill: PAPER3 }) +
      L("M118 300c10-24 34-40 62-40M150 312c4-18 18-30 36-34M210 270c10 6 16 16 18 28", { w: 1.5, c: INK2 }) +
      L("M232 262c14-8 30-6 38 4", { w: 2 }) + L("M266 262c6-2 10 2 9 7", { w: 2 }) +
      // baby spinach bag
      L("M286 178h92l-6 142h-80z", { fill: "#FBF8F1" }) + L("M286 178l4-14h84l4 14", { w: 2 }) +
      L("M298 194h68", { w: 1.2, c: INK2, dash: "2 4" }) +
      T(332, 226, 13, "BABY", { a: "middle", w: 600 }) + T(332, 242, 13, "SPINACH", { a: "middle", w: 600 }) +
      L("M300 290c8-14 20-18 30-10 8-12 22-12 30 2M306 304c10-6 18-4 24 2 8-8 18-8 26 0", { w: 1.5, c: INK2 }) +
      // berries punnet
      L("M410 270h104l-8 50h-88z", { fill: "#FBF8F1" }) + L("M418 284h90M420 300h86", { w: 1, c: INK3 }) +
      [[428, 262], [446, 256], [464, 262], [482, 255], [500, 262], [437, 246], [456, 244], [474, 246], [492, 246]]
        .map((p) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="9" fill="' + PAPER3 + '" stroke="' + INK + '" stroke-width="1.8"/>').join("") +
      // milk carton
      L("M584 320V150l22-34h52l22 34v170z", { fill: "#FBF8F1" }) + L("M584 150h96M606 116l10 34M658 116l-10 34", { w: 1.6 }) +
      L("M616 100h32v16h-32z", { fill: PAPER3, w: 1.8 }) +
      T(632, 196, 22, "MILK", { a: "middle", w: 700, ls: 2 }) +
      T(632, 222, 11, "2% · 1 L", { a: "middle", c: INK2 }) +
      '<rect x="596" y="270" width="72" height="30" fill="none" stroke="' + INK + '" stroke-width="1.4"/>' +
      T(632, 283, 9, "USE BY", { a: "middle", c: INK2 }) + T(632, 296, 11, "18 OCT", { a: "middle", w: 600 }) +
      // feta block
      L("M108 516v-44l14-16h104l6 16v44z", { fill: "#FBF8F1" }) + L("M108 472h124M226 456v16", { w: 1.6 }) +
      T(170, 500, 17, "FETA", { a: "middle", w: 700, ls: 3 }) +
      // yogurt cup
      L("M290 430h82l-10 86h-62z", { fill: "#FBF8F1" }) + L("M286 422h90v8h-90z", { fill: PAPER3, w: 1.8 }) +
      T(331, 478, 13, "GREEK", { a: "middle", w: 600 }) + T(331, 494, 10, "YOGURT", { a: "middle", c: INK2 }) +
      // two peppers
      L("M440 470c-6-32 18-50 42-44 22 6 30 30 22 56-8 26-34 36-50 28-10-6-12-22-14-40z", { fill: PAPER3 }) +
      L("M474 428c0-10 4-16 12-18", { w: 2 }) +
      L("M510 478c-2-30 22-44 44-36 20 8 24 32 14 54-10 22-34 28-48 18-8-6-10-20-10-36z", { fill: "#FBF8F1" }) +
      L("M544 444c2-10 8-14 16-14", { w: 2 }) +
      L("M454 470c2 14 6 24 12 30M524 474c2 12 6 20 12 26", { w: 1.2, c: INK2 }) +
      stamp(664, 452, -10));
  }

  // 3. Gym membership tag, 800×600. "$49/MO" boxed at [0.5975, 0.57, 0.2075, 0.0867].
  function gymSVG() {
    let bars = "";
    for (let i = 0, x = 172; i < 34; i++) { const w = (i * 7) % 3 + 1; if (i % 2 === 0) bars += '<rect x="' + x + '" y="408" width="' + w * 2 + '" height="30" fill="' + INK + '"/>'; x += w * 2 + 2; }
    return svg(800, 600,
      L("M60 90c40-40 110-40 140 0 26 34 14 84-24 98", { w: 4, c: INK2 }) +
      L("M62 96c-20 40 6 92 52 98", { w: 4, c: INK2 }) +
      '<rect x="128" y="146" width="560" height="320" rx="26" transform="translate(8 9)" fill="' + PAPER3 + '"/>' +
      '<rect x="128" y="146" width="560" height="320" rx="26" fill="#FBF8F1" stroke="' + INK + '" stroke-width="3"/>' +
      '<circle cx="172" cy="190" r="16" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="2.4"/>' +
      L("M128 236H688", { w: 1.2, c: INK3 }) +
      T(214, 206, 40, "IRONWORKS", { w: 700, ls: 4 }) +
      T(660, 204, 13, "GYM · MEMBER", { a: "end", c: INK2, ls: 2 }) +
      L("M214 286h22v-14h10v34h-10v-14M246 280h40M286 272h10v34h-10v-14h22", { w: 3 }) +
      T(172, 300, 15, "PLAN", { c: INK2, ls: 2 }) + T(172, 324, 20, "MONTHLY · ALL CLUBS", { w: 600 }) +
      T(172, 362, 13, "MEMBER SINCE 03/26 · NO. 20417", { c: INK2 }) +
      T(640, 384, 44, "$49/MO", { a: "end", w: 700 }) +
      bars +
      T(660, 438, 11, "SCAN AT THE DESK", { a: "end", c: INK2, ls: 2 }) +
      stamp(560, 112, 8));
  }

  // 4. Desk corner, 800×600. Step pins match the drawing.
  function deskSVG() {
    return svg(800, 600,
      L("M560 30V318", { w: 1.5, c: INK3 }) +
      '<rect x="586" y="70" width="150" height="110" fill="#FBF8F1" stroke="' + INK3 + '" stroke-width="1.5"/>' +
      L("M600 156l34-40 26 26 20-18 40 32", { w: 1.5, c: INK3 }) +
      L("M40 318H760L790 448H10z", { fill: PAPER2, w: 2.6 }) +
      L("M10 448H790V474H10z", { fill: PAPER3, w: 2.6 }) +
      L("M40 474V590M760 474V590M70 474V590M730 474V590", { w: 2.6 }) +
      // three mugs (step 1)
      L("M92 412v-56h44v56c0 6-6 10-22 10s-22-4-22-10z", { fill: "#FBF8F1" }) + L("M136 370c14 0 16 22 0 24", { w: 2.2 }) +
      L("M150 420v-62h46v62c0 6-6 9-23 9s-23-3-23-9z", { fill: PAPER3 }) + L("M196 372c15 0 17 24 0 26", { w: 2.2 }) +
      L("M188 340v-44h40v44c0 5-5 8-20 8s-20-3-20-8z", { fill: "#FBF8F1" }) + L("M228 306c12 0 14 18 0 20", { w: 2 }) +
      '<ellipse cx="114" cy="357" rx="22" ry="4" fill="' + INK2 + '" opacity=".5"/>' +
      // loose papers (step 2)
      L("M282 418l20-52 128 14-14 46z", { fill: "#FBF8F1", w: 1.8 }) +
      L("M300 424l38-54 120 34-30 40z", { fill: "#FBF8F1", w: 1.8 }) +
      L("M330 410l12-38 112 6-8 40z", { fill: "#FBF8F1", w: 1.8 }) +
      L("M350 386h78M348 396h70M346 406h82", { w: 1, c: INK3 }) +
      // charger cables (step 3)
      L("M500 420c10-30 40-28 44-8s-26 22-30 4 22-30 46-20 20 26 2 30-16-16 4-22 34 0 36 18", { w: 2 }) +
      L("M584 422c10 0 18 4 24 12", { w: 2 }) + '<rect x="600" y="430" width="20" height="12" rx="2" fill="' + INK + '"/>' +
      // two books (step 4)
      L("M622 424l10-92 30 3-10 92z", { fill: PAPER3, w: 2 }) + L("M652 427l18-88 30 6-18 88z", { fill: "#FBF8F1", w: 2 }) +
      L("M630 352l28 3M662 360l28 6", { w: 1.2, c: INK2 }) +
      // lamp
      L("M712 424h48M736 424V300l-24-48M712 252l-34 18 18 30 34-20z", { w: 2.2 }) +
      // coffee ring + crumbs (step 5)
      '<ellipse cx="410" cy="436" rx="24" ry="7" fill="none" stroke="' + INK2 + '" stroke-width="2.2" stroke-dasharray="14 4 22 5"/>' +
      [[372, 440], [380, 434], [448, 438], [456, 432], [440, 444], [366, 434]].map((p) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2" fill="' + INK2 + '"/>').join("") +
      stamp(170, 120, -9));
  }

  const DRAWINGS = { receipt: [receiptSVG, 600, 800], fridge: [fridgeSVG, 800, 600], gym: [gymSVG, 800, 600], desk: [deskSVG, 800, 600] };
  const photoCache = {};
  function photo(key, at) {
    const d = DRAWINGS[key];
    if (!d) return null;
    if (!photoCache[key]) photoCache[key] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(d[0]());
    const src = photoCache[key];
    return { src, assetId: null, thumb: src, w: d[1], h: d[2], at: at || now(), role: "hero" };
  }

  /* ------------------------------------------------------------ instruments */
  const IDS = { takeout: "ins_dtakeout", fridge: "ins_dfridge1", gym: "ins_dgympass", desk: "ins_ddeskcnr" };

  function specs() {
    return {
      takeout: {
        fit: true, mold: "leak", kind: "takeout-golden-wok", system: "Money", title: "Takeout",
        words: { subject: "Golden Wok", period: "week", currency: "$" },
        vars: {
          price: { value: 31.4, origin: "seen", evidence: { bbox: [0.2917, 0.48, 0.4167, 0.045], text: "TOTAL $31.40" } },
          rate: { value: 3, origin: "inferred", reason: "The loyalty line says this is the third order this week." },
          target: { value: 1 },
        },
        fieldNote: "Three orders in one week, and the loyalty card is two stamps from free spring rolls. That is how it gets you.",
        nextPhotos: ["Your next Golden Wok receipt"],
        mailQuery: "from:(golden wok) newer_than:3m",
        act: { type: "ics", to: null, why: "A check-in a week from now." },
      },
      fridge: {
        fit: true, mold: "spoil", kind: "home-fridge", system: "Food", title: "Fridge",
        words: { subject: "the fridge", currency: "$" },
        vars: {
          horizon: { value: 3, origin: "assumed", reason: "A guess: most people shop about twice a week. Set it." },
          cookN: { value: 2 },
        },
        items: [
          { name: "half roast chicken", value: 9, days: 1, origin: "inferred", pin: [0.2125, 0.45] },
          { name: "baby spinach", value: 4, days: 2, origin: "inferred", pin: [0.4125, 0.4167] },
          { name: "berries", value: 5, days: 2, origin: "inferred", pin: [0.575, 0.43] },
          { name: "feta", value: 6, days: 4, origin: "inferred", pin: [0.2125, 0.8033] },
          { name: "greek yogurt", value: 3, days: 6, origin: "inferred", pin: [0.4125, 0.78] },
          { name: "peppers", value: 4, days: 5, origin: "inferred", pin: [0.63125, 0.78] },
          { name: "milk", value: 3, days: 7, origin: "seen", pin: [0.79, 0.3667] },
        ],
        fieldNote: "The chicken is the clock here. The spinach bag already has condensation inside.",
        nextPhotos: ["The same shelf after dinner"],
        mailQuery: null,
        act: { type: "mission", to: null, why: "Cook the at-risk things tonight." },
      },
      gym: {
        fit: true, mold: "perUse", kind: "gym-ironworks", system: "Health", title: "Gym",
        words: { subject: "Ironworks", basis: "month", currency: "$" },
        vars: {
          cost: { value: 49, origin: "seen", evidence: { bbox: [0.5975, 0.57, 0.2075, 0.0867], text: "$49/MO" } },
          uses: { value: 2, origin: "assumed", reason: "A starting guess. Check-in emails would prove it." },
          target: { value: 6 },
          alt: { value: 15, origin: "inferred", reason: "Day passes at gyms like this run about $15." },
        },
        fieldNote: "A monthly plan on a key tag that still looks new.",
        nextPhotos: ["The check-in screen after your next visit"],
        mailQuery: "from:(ironworks) subject:(visit OR check-in) newer_than:3m",
        act: { type: "ics", to: null, why: "A check-in in two weeks." },
      },
      desk: {
        fit: true, mold: "reset", kind: "desk-corner", system: "Space", title: "Desk corner",
        words: { subject: "the desk corner", currency: "$" },
        vars: { minutes: { value: 7, origin: "inferred", reason: "The sum of the five moves below." }, take: { value: 5 } },
        steps: [
          { text: "Carry the three mugs to the sink", minutes: 1.5, pin: [0.2, 0.6333] },
          { text: "Square the loose papers into one stack", minutes: 1.5, pin: [0.47, 0.665] },
          { text: "Coil the charger cable and tie it", minutes: 1, pin: [0.6875, 0.69] },
          { text: "Stand the two books by the lamp", minutes: 1, pin: [0.835, 0.63] },
          { text: "Wipe the coffee ring and crumbs", minutes: 2, pin: [0.5125, 0.727] },
        ],
        fieldNote: "Three mugs means three separate afternoons. The cable is doing most of the visual noise.",
        nextPhotos: ["The same corner from where you stood"],
        mailQuery: null,
        act: { type: "mission", to: null, why: "Seven minutes, then an after photo." },
      },
    };
  }

  /* build(): Instrument[] for the example bench. Fresh objects every call; never persisted. */
  function build() {
    const M = WB.molds;
    if (!M || typeof M.build !== "function") return [];
    const t = now();
    const s = specs();
    const ages = { takeout: 7 * DAY + 2 * HOUR, fridge: 3 * HOUR, gym: 5 * DAY, desk: 26 * HOUR };
    const photos = { takeout: "receipt", fridge: "fridge", gym: "gym", desk: "desk" };
    const out = [];
    Object.keys(s).forEach((key, i) => {
      let inst;
      const at = t - ages[key];
      try { inst = M.build(s[key], photo(photos[key], at), { demo: true, source: "photo" }); }
      catch (e) { console.error("[WB.demo] build " + key, e); return; }
      inst.id = IDS[key];
      inst.demo = true;
      inst.createdAt = at;
      inst.updatedAt = at + i;
      (inst.observations || []).forEach((o) => { o.t = at; });
      out.push(inst);
    });
    const takeout = out.find((x) => x.id === IDS.takeout);
    if (takeout) {
      // an earlier receipt, and the promise made a week ago: 1 a week, check due today
      const prev = M.observe ? M.observe(takeout, "photo", "An earlier receipt", takeout.createdAt - 14 * DAY) : null;
      if (prev) takeout.observations.unshift(prev);
      const committedAt = takeout.createdAt + 10 * 60000;
      let it = null;
      if (typeof M.intentionFor === "function") it = M.intentionFor(takeout, "target", 1, committedAt);
      if (it) {
        it.checkAt = Math.min(it.checkAt, t - HOUR);
        it.actionId = "act_dremembr";
        takeout.intention = it;
        takeout.actions = [{ id: "act_dremembr", type: "remember", status: "done", at: committedAt, payload: { varId: "target", value: 1 }, result: null }];
      }
      takeout.updatedAt = committedAt;
    }
    return out;
  }

  /* ------------------------------------------------------------ canned answers */
  const GYM_THREAD = "example-thread-gym-1";
  function enrichPatch(inst) {
    if (!inst || !inst.demo) return null;
    if (inst.mold !== "perUse") return null;
    const t = now();
    return {
      vars: {
        uses: { value: 3, origin: "seen", evidence: { threadId: GYM_THREAD, quote: "EXAMPLE · You checked in 3 times in September. See you soon.", date: isoDay(t - 11 * DAY),
          subject: "EXAMPLE · Your September at Ironworks", sender: "Ironworks (example) <hello@ironworks.example>" } },
      },
      history: [
        { date: isoDay(t - 41 * DAY), facts: { uses: 2 } },
        { date: isoDay(t - 11 * DAY), facts: { uses: 3 } },
      ],
      contact: { to: "hello@ironworks.example", threadId: GYM_THREAD, messageId: null },
      summary: "EXAMPLE mail: 3 check-ins in September, not 2.",
      queries: ["from:(ironworks) newer_than:3m", "subject:(visit OR check-in) ironworks", "\"checked in\" ironworks"],
    };
  }

  function verifyFallback(mission) {
    const steps = (mission && mission.steps) || [];
    const done = steps.filter((x) => x.done).map((x) => x.id);
    const notDone = steps.filter((x) => !x.done).map((x) => x.id);
    return { done, notDone, reclaimed: steps.length ? Math.round((done.length / steps.length) * 100) : 0, by: "self", fieldNote: "Checked by you." };
  }

  /* the example draft always says what the chosen purpose asks for */
  function draftFallback(inst, opts) {
    const purpose = (opts && opts.purpose) || "ask";
    if (!inst) return null;
    const it = inst.intention;
    if (inst.mold === "leak") {
      const n = it && typeof it.value === "number" ? it.value : 1;
      const T = {
        cancel: ["Please stop my Wok Club emails", "Hi,\n\nCould you take me off the Wok Club list and stop the promotional emails and texts? Thanks for the dumplings.\n\n[Name]"],
        pause: ["Pausing Wok Club for a while", "Hi,\n\nI'm cutting back to " + (n === 0 ? "no orders" : n + (n === 1 ? " order" : " orders")) + " a week for now. Could you pause the Wok Club promotions until I sign up again?\n\nThanks,\n[Name]"],
        ask: ["A question about Wok Club", "Hi,\n\nIs there a cheaper way to order from you a few times a month, like a pickup discount or a set menu for two? I'd like to keep ordering, just less often.\n\nThanks,\n[Name]"],
      };
      const t = T[purpose] || T.ask;
      return { to: [], subject: t[0], body: t[1], replyToMessageId: null };
    }
    if (inst.mold === "perUse") {
      const T = {
        pause: ["Pausing my membership (no. 20417)", "Hi,\n\nCould you pause my monthly membership, no. 20417, from the next billing date? I'm only getting in a couple of times a month. Please confirm by email.\n\nThanks,\n[Name]"],
        cancel: ["Cancel my membership (no. 20417)", "Hi,\n\nPlease cancel my monthly membership, no. 20417, at the end of this billing period, and confirm the date of the last charge by email.\n\nThanks,\n[Name]"],
        ask: ["A question about my membership (no. 20417)", "Hi,\n\nI get in a few times a month. Is there an off-peak plan or a class pack that would cost less than $49 a month for that? Membership no. 20417.\n\nThanks,\n[Name]"],
      };
      const t = T[purpose] || T.ask;
      return { to: ["hello@ironworks.example"], subject: t[0], body: t[1], replyToMessageId: null };
    }
    return null;
  }

  WB.demo = {
    build, enrichPatch, verifyFallback, draftFallback,
    /* extras beyond the contract */
    photo, ids: () => Object.assign({}, IDS),
  };
})();
