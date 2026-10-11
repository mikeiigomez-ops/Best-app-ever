/* Workbench app (Ives): boot sequence, capture flow, front door and forging views. */
(function () {
  "use strict";
  const WB = window.WB;

  const DEFAULT_CAPS = { sample: false, images: false, gmail: "unavailable", drive: "unavailable",
    db: false, user: false, assets: false, room: false, downloads: false };

  let caps = Object.assign({}, DEFAULT_CAPS);
  let capsKnown = false;
  let booted = false;
  let autoFront = false;      // the front door was chosen by boot, not by the user
  const t0 = (window.performance && performance.now) ? performance.now() : 0;

  // WB.app.caps: the last Caps. Readable as a property bag (WB.app.caps.sample) and callable (WB.app.caps()).
  const capsFn = function () { return Object.assign({}, caps); };
  function setCaps(c) {
    caps = Object.assign({}, DEFAULT_CAPS, c || {});
    Object.keys(caps).forEach((k) => { capsFn[k] = caps[k]; });
  }
  setCaps(caps);

  /* ------------------------------------------------------------ helpers */
  const U = () => WB.util;
  const has = (mod, fn) => !!(WB[mod] && typeof WB[mod][fn] === "function");
  function safe(label, fn) {
    try { return fn(); } catch (err) { console.error("[WB.app] " + label + " failed", err); return undefined; }
  }
  function storeMode() {
    return has("store", "mode") ? (safe("store.mode", () => WB.store.mode()) || "local") : "local";
  }
  function count() {
    return has("store", "all") ? ((safe("store.all", () => WB.store.all()) || []).length) : 0;
  }
  function profile() {
    const st = WB.store && WB.store.state;
    return (st && st.bench && st.bench.profile) || null;
  }
  function isFirstRun() {
    if (storeMode() === "demo") return false;
    const p = profile();
    return count() === 0 && !(p && p.firstRunDone);
  }
  const canPhoto = () => !!(caps.sample && caps.images);
  const canMail = () => !!(caps.sample && caps.gmail && caps.gmail !== "unavailable" && caps.gmail !== "denied");
  function homeView() {
    if (isFirstRun() || !WB.router.has("bench")) return "front";
    return "bench";
  }
  function goHome(replace) {
    const name = homeView();
    WB.router.go(name, {}, { replace: !!replace });
  }
  function openDemo() {
    if (!has("store", "enterDemo")) {
      WB.ui.toast("The example bench isn't part of this build.");
      return;
    }
    let r;
    try { r = WB.store.enterDemo(); } catch (err) { console.error(err); WB.ui.toast("The example bench didn't open."); return; }
    const go = () => WB.router.go(WB.router.has("bench") ? "bench" : "front", {});
    if (r && typeof r.then === "function") r.then(go, (err) => { console.error(err); WB.ui.toast("The example bench didn't open."); });
    else go();
  }

  /* ------------------------------------------------------------ error copy */
  const ERR = {
    rate_limited: ["A short pause.", "Claude needs a breather. Try again in a minute."],
    invalid_json: ["No clean reading.", "I couldn't make a clean instrument from that. Try a straighter, closer photo."],
    refused: ["Not this one.", "I can't work with that photo."],
    no_fit: ["Nothing to build here.", "That doesn't look like something I can make an instrument from."],
    timeout: ["That took too long.", "Nothing came back in time. Try again, or a closer photo."],
    not_same_spot: ["A different spot.", "That looks like another place. Take the after photo from where you stood before."],
    unavailable: ["Photos need Claude.", "Reading photos needs Claude. The example bench still works."],
    not_granted: ["Nothing was read.", "Claude wasn't allowed to look. Nothing left this page."],
    tool_error: ["Mail didn't answer.", "Gmail returned an error. Try again in a moment."],
    needs_reauth: ["Mail needs reconnecting.", "Connect Gmail in claude.ai Settings → Connectors."],
    server_not_connected: ["Mail isn't connected.", "Connect Gmail in claude.ai Settings → Connectors."],
    unknown: ["That didn't take.", "Something went wrong while reading. Try again."],
  };
  const FIXED_COPY = { rate_limited: 1, invalid_json: 1, refused: 1, needs_reauth: 1, server_not_connected: 1 };
  function errCopy(err) {
    const code = (err && err.code) || "unknown";
    const row = ERR[code] || ERR.unknown;
    const msg = FIXED_COPY[code] ? row[1] : ((err && typeof err.message === "string" && err.message.trim()) || row[1]);
    return { code, title: row[0], message: msg, why: err && err.why, try: err && err.try };
  }

  /* ------------------------------------------------------------ jobs */
  // One local job at a time: a photo forge/snap or a forge-from-mail.
  let job = null;
  let lastURL = null;

  function newJob(o) {
    if (lastURL && (!o.photoSrc || o.photoSrc !== lastURL)) { try { URL.revokeObjectURL(lastURL); } catch (e) { /* ignore */ } lastURL = null; }
    job = Object.assign({ running: true, cancelled: false, jobId: null, error: null, ctrl: new AbortController(),
      stages: [], startedAt: Date.now() }, o);
    if (job.photoSrc && job.photoSrc.indexOf("blob:") === 0) lastURL = job.photoSrc;
    return job;
  }
  function kindMatch(a, b) {
    return a === b || (a === "photo" && b === "snap") || (a === "snap" && b === "photo");
  }
  function pushStage(list, entry) {
    const last = list[list.length - 1];
    if (last && last.label === entry.label && last.detail === entry.detail) return;
    list.push(entry);
    if (list.length > 24) list.splice(0, list.length - 24);
  }
  function stopJob(j) {
    if (!j || !j.running) return;
    j.cancelled = true;
    j.running = false;
    try { j.ctrl.abort(); } catch (e) { /* ignore */ }
    if (j.jobId && has("forge", "cancel")) safe("forge.cancel", () => WB.forge.cancel(j.jobId));
  }
  const DEFAULT_STAGE = {
    photo: "READING THE PHOTO…", snap: "READING THE NEW PHOTO…", verify: "CHECKING WHAT CHANGED…",
    mail: "OPENING YOUR MAIL…", enrich: "OPENING YOUR MAIL…", plan: "PLANNING…", draft: "WRITING…",
  };
  const STAGE_LABEL = {
    reading: "READING…", measuring: "MEASURING…", hinge: "FINDING THE HINGE…", checking: "CHECKING THE NUMBERS…",
    retrying: "ONE MORE LOOK…", searching: "SEARCHING YOUR MAIL…", "reading-mail": "READING A THREAD…",
    writing: "WRITING…", comparing: "COMPARING BEFORE AND AFTER…",
  };
  const SLOW_LINE = {
    photo: "still reading, receipts with tiny print take longer.",
    snap: "still reading, receipts with tiny print take longer.",
    verify: "still comparing, small changes take a closer look.",
    mail: "still reading, long threads take a while.",
    enrich: "still reading, long threads take a while.",
  };

  async function runPhoto(file, o) {
    if (!has("forge", "fromPhoto")) { WB.ui.toast("Reading photos isn't part of this build."); return; }
    if (job && job.running) stopJob(job);
    const kind = o.intent === "snap" ? "snap" : "photo";
    let src = null;
    try { src = URL.createObjectURL(file); } catch (e) { src = null; }
    const j = newJob({ kind, file, intent: o.intent, instrumentId: o.instrumentId || null, photoSrc: src, local: true });
    j.retry = () => runPhoto(file, o);
    const onForging = WB.router.current().name === "forging";
    WB.router.go("forging", { jobId: null, kind, photoSrc: src }, { replace: onForging });
    let res;
    try {
      res = await WB.forge.fromPhoto(file, { intent: o.intent === "snap" ? "snap" : "new", instrumentId: o.instrumentId || undefined, signal: j.ctrl.signal });
    } catch (err) {
      if (job !== j || j.cancelled || (err && err.code === "cancelled")) { j.running = false; return; }
      j.running = false;
      j.error = errCopy(err);
      forgingView.showError(j);
      return;
    }
    if (job !== j || j.cancelled) return;
    j.running = false;
    if (!res || !res.id) { j.error = errCopy({ code: "unknown" }); forgingView.showError(j); return; }
    markFirstRunDone();
    const title = instTitle(res.id);
    if (WB.router.current().name === "forging") {
      WB.router.go("instrument", { id: res.id, develop: true }, { replace: true });
      if (res.snapped && o.intent !== "snap") WB.ui.toast("This landed on " + (title || "an instrument you already have") + ", as a new reading.");
    } else {
      WB.ui.toast((title || "Your instrument") + " is ready.", { action: { label: "Open", onTap: () => WB.router.go("instrument", { id: res.id, develop: true }) } });
    }
  }

  async function runMail() {
    if (!has("forge", "fromMail")) { WB.ui.toast("Forging from mail isn't part of this build."); return; }
    if (!caps.sample) { needsClaude("mail"); return; }
    if (job && job.running) stopJob(job);
    const j = newJob({ kind: "mail", photoSrc: null, local: true });
    j.retry = () => runMail();
    const onForging = WB.router.current().name === "forging";
    WB.router.go("forging", { jobId: null, kind: "mail", photoSrc: null }, { replace: onForging });
    let res;
    try {
      res = await WB.forge.fromMail({ signal: j.ctrl.signal });
    } catch (err) {
      if (job !== j || j.cancelled || (err && err.code === "cancelled")) { j.running = false; return; }
      j.running = false;
      j.error = errCopy(err);
      forgingView.showError(j);
      return;
    }
    if (job !== j || j.cancelled) return;
    j.running = false;
    const ids = (res && Array.isArray(res.ids)) ? res.ids : [];
    if (ids.length) markFirstRunDone();
    const summary = res && res.summary;
    if (WB.router.current().name === "forging") {
      if (ids.length === 1) WB.router.go("instrument", { id: ids[0], develop: true }, { replace: true });
      else WB.router.go(WB.router.has("bench") ? "bench" : "front", {}, { replace: true });
    }
    WB.ui.toast(summary || (ids.length ? (ids.length + (ids.length === 1 ? " instrument" : " instruments") + " from your mail.") : "Nothing in your mail fit. A photo works better."), { ms: 5200 });
  }

  function instTitle(id) {
    const ins = has("store", "get") ? safe("store.get", () => WB.store.get(id)) : null;
    return ins && ins.title ? String(ins.title) : null;
  }
  function markFirstRunDone() {
    if (storeMode() === "demo") return;
    const p = profile();
    if (p && !p.firstRunDone) {
      p.firstRunDone = true;
      if (has("store", "saveBench")) safe("store.saveBench", () => WB.store.saveBench());
    }
  }

  /* ------------------------------------------------------------ capture */
  function needsClaude(intent) {
    const el = U().el;
    const mailOK = intent !== "snap" && canMail() && !canPhoto();
    const demo = storeMode() === "demo";
    const msg = caps.sample && !caps.images
      ? "Claude can't read images on this page." + (mailOK ? " Your mail can still build instruments." : "")
      : "Open Workbench inside Claude to read your own photos." + (demo ? " Every number on the example bench still moves." : " The example bench still works, and every number moves.");
    const actions = [];
    if (mailOK) actions.push({ label: "Look in my mail", kind: "primary", onTap: (close) => { close(); runMail(); } });
    if (!demo) actions.push({ label: "Open the example bench", kind: mailOK ? "quiet" : "primary", onTap: (close) => { close(); openDemo(); } });
    actions.push({ label: "Close", kind: "quiet", onTap: (close) => close() });
    WB.ui.sheet({ title: "Reading photos needs Claude", body: el("p", { class: "wb-sheet__text", text: msg }), actions });
  }

  function capture(opts) {
    const o = opts || {};
    const intent = o.intent === "snap" ? "snap" : "new";
    const source = o.source || "ask";
    if (source === "mail") return runMail();
    if (!canPhoto()) {
      needsClaude(intent);
      return Promise.resolve();
    }
    const go = (file) => (file ? runPhoto(file, { intent, instrumentId: o.instrumentId, source }) : undefined);
    if (source === "camera" || source === "library") {
      // pickPhoto must run synchronously inside the gesture
      return WB.ui.pickPhoto({ source }).then(go);
    }
    return new Promise((resolve) => {
      const el = U().el;
      let sh = null, picked = false;
      const choice = (iconName, label, sub, fn) => el("li", null,
        el("button", { type: "button", class: "wb-choice", on: { click: fn } },
          el("span", { class: "wb-choice__glyph", html: WB.ui.icon(iconName) }),
          el("span", { class: "wb-choice__text" },
            el("span", { class: "wb-choice__label", text: label }),
            el("span", { class: "wb-choice__sub", text: sub }))));
      const pick = (src) => () => {
        picked = true;
        const p = WB.ui.pickPhoto({ source: src });
        if (sh) sh.close();
        p.then(go).then(resolve, resolve);
      };
      const list = el("ul", { class: "wb-choices" },
        choice("camera", "Take a photo", intent === "snap" ? "The same thing, as it is now." : "Point it at the thing itself.", pick("camera")),
        choice("library", "Choose from photos", "A photo you already took.", pick("library")),
        intent === "new" && canMail()
          ? choice("mail", "Look in my mail", "Receipts, renewals and return windows. Only when you ask.", () => {
            picked = true; if (sh) sh.close(); runMail().then(resolve, resolve);
          })
          : null);
      sh = WB.ui.sheet({
        title: intent === "snap" ? "Photograph it again" : "Show me something",
        body: list,
        actions: [],
        onClose: () => { if (!picked) resolve(); },
      });
    });
  }

  /* ------------------------------------------------------------ front door */
  const DRAW = {
    receipt: '<path d="M16 6h20v38l-2.5-1.8-2.5 1.8-2.5-1.8-2.5 1.8-2.5-1.8-2.5 1.8-2.5-1.8L16 44z"/><path d="M20 12h8M20 17h12M20 21h9M20 25h12"/><path d="M20 30h12" stroke-dasharray="1 2.2"/><path d="M20 35h5M28 35h4" stroke-width="2"/>',
    fridge: '<rect x="7" y="7" width="38" height="38" rx="2"/><path d="M7 27h38" class="wb-hint__shelf"/><path d="M13 27v-8l2-3v-3h2v3l2 3v8"/><path d="M23 27V17l3-3 3 3v10zM23 17h6"/><circle cx="37" cy="23.4" r="3.4"/><path d="M11 34h13c0 4-2.9 6.2-6.5 6.2S11 38 11 34z"/><rect x="29" y="31" width="9" height="10" rx="1.4"/><path d="M29 34h9"/>',
    bill: '<path d="M12 6h19l8 8v32H12z"/><path d="M31 6v8h8"/><path d="M17 13h9M17 17h6"/><path d="M16 36.5h19"/><path d="M18.5 36v-4M22.5 36v-7M26.5 36v-5M30.5 36v-9"/><path d="M24 41.5h10" stroke-width="2"/>',
    desk: '<path d="M4 37h44M9 37v9M43 37v9"/><path d="M11 37h9M15.5 37V23l7-7"/><path d="M20 13.5l6.5 2.5-3.5 4z"/><path d="M30 29h7v8h-7z"/><path d="M37 31h1.6a2 2 0 010 4H37"/><path d="M19 35.6l9.5-1.2M20 33.4l8-1.4"/><path d="M42 37c2.2-3-1.2-5 .8-8"/>',
  };
  const HINTS = [
    { key: "receipt", label: "RECEIPT", lead: "A receipt.", tip: " Flat, in good light, with the total in frame." },
    { key: "fridge", label: "FRIDGE", lead: "Inside your fridge.", tip: " Door open, one full shelf is plenty." },
    { key: "bill", label: "BILL", lead: "A bill.", tip: " The page with the total and the billing days." },
    { key: "desk", label: "CORNER", lead: "The corner that's bugging you.", tip: " Stand where you'd start tidying." },
  ];
  function drawing(key) {
    return '<svg viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + DRAW[key] + "</svg>";
  }

  const frontView = {
    el: null,
    enter(el) {
      this.el = el;
      const u = U();
      el.textContent = "";
      const tip = u.el("p", { class: "wb-front__tip", "aria-live": "polite" }, "Tap a drawing for how to frame it.");
      const hints = u.el("ul", { class: "wb-front__hints", "aria-label": "Things you could photograph" });
      HINTS.forEach((h, i) => {
        const b = u.el("button", { type: "button", class: "wb-hint", "aria-label": h.lead + h.tip, "aria-pressed": "false" },
          u.el("span", { html: drawing(h.key) }),
          u.el("span", { class: "wb-micro" }, u.el("span", { class: "wb-hint__n", text: "0" + (i + 1) + " " }), h.label));
        b.addEventListener("click", () => {
          u.$$(".wb-hint", hints).forEach((n) => { n.classList.remove("is-active"); n.setAttribute("aria-pressed", "false"); });
          b.classList.add("is-active");
          b.setAttribute("aria-pressed", "true");
          tip.textContent = "";
          tip.appendChild(u.el("b", { text: h.lead }));
          tip.appendChild(document.createTextNode(h.tip));
          u.haptic(4);
        });
        hints.appendChild(u.el("li", null, b));
      });
      const acts = u.el("div", { class: "wb-front__acts" + (capsKnown ? "" : " is-pending"), "aria-busy": capsKnown ? "false" : "true" });
      el.appendChild(u.el("div", { class: "wb-front" },
        u.el("header", { class: "wb-front__top" },
          u.el("span", { class: "wb-micro", text: "WORKBENCH · NO. 001" }),
          u.el("span", { class: "wb-micro wb-front__date", text: u.fmtDay(Date.now()).toUpperCase() })),
        u.el("h1", { class: "wb-front__hero" }, "Show me anything you paid for, own, or have to deal with."),
        u.el("p", { class: "wb-front__sub" }, "A receipt. Inside your fridge. A bill. The corner that's bugging you."),
        hints,
        tip,
        u.el("div", { class: "wb-front__spacer" }),
        acts,
        u.el("p", { class: "wb-micro wb-front__foot", text: "YOUR MAIL STAYS CLOSED UNTIL YOU ASK." })));
      this.acts = acts;
      this.renderActs();
    },
    renderActs() {
      const acts = this.acts;
      if (!acts || !acts.isConnected) return;
      const u = U();
      acts.textContent = "";
      if (canPhoto()) {
        acts.appendChild(u.el("button", { type: "button", class: "wb-btn wb-btn--primary wb-btn--block",
          on: { click: () => capture({ intent: "new", source: "camera" }) } },
          u.el("span", { class: "wb-btn__dot", "aria-hidden": "true" }), u.el("span", { class: "wb-btn__label", text: "Take a photo" })));
        acts.appendChild(u.el("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block",
          on: { click: () => capture({ intent: "new", source: "library" }) } },
          u.el("span", { class: "wb-btn__label", text: "Choose from photos" })));
        acts.appendChild(u.el("button", { type: "button", class: "wb-link", text: "See one I made earlier", on: { click: openDemo } }));
      } else {
        acts.appendChild(u.el("p", { class: "wb-front__note", text: "Reading photos needs Claude. Here's a bench built from four example photos. Every number still moves." }));
        acts.appendChild(u.el("button", { type: "button", class: "wb-btn wb-btn--primary wb-btn--block", on: { click: openDemo } },
          u.el("span", { class: "wb-btn__dot", "aria-hidden": "true" }), u.el("span", { class: "wb-btn__label", text: "Open the example bench" })));
        if (canMail()) {
          acts.appendChild(u.el("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block", on: { click: () => runMail() } },
            u.el("span", { class: "wb-btn__label", text: "Build one from my mail" })));
        }
      }
      if (capsKnown) {
        acts.classList.remove("is-pending");
        acts.classList.add("is-ready");
        acts.setAttribute("aria-busy", "false");
      }
    },
    leave() { this.acts = null; },
  };

  /* ------------------------------------------------------------ forging */
  const forgingView = {
    el: null, refs: null, clock: 0, slow: 0, view: null,
    enter(el, params) {
      const p = params || {};
      const mine = job && (job.running || job.error) ? job : null;
      if (!p.kind && !p.jobId && !mine) {
        // a stale forging URL: nothing is being read
        setTimeout(() => goHome(true), 0);
        return;
      }
      const external = !mine || (!!p.jobId && p.jobId !== mine.jobId) || (!!p.kind && !kindMatch(p.kind, mine.kind));
      this.view = {
        kind: p.kind || (mine && mine.kind) || "photo",
        jobId: p.jobId || (mine && !external ? mine.jobId : null),
        photoSrc: p.photoSrc != null ? p.photoSrc : (mine && !external ? mine.photoSrc : null),
        job: external ? null : mine,
        stages: external ? [] : (mine ? mine.stages : []),
        startedAt: (!external && mine) ? mine.startedAt : Date.now(),
        error: null,
      };
      this.el = el;
      this.render();
      if (this.view.job && this.view.job.error) this.showError(this.view.job);
    },
    leave() {
      clearInterval(this.clock); clearTimeout(this.slow);
      const v = this.view;
      if (v && v.job && v.job.running) stopJob(v.job);   // leaving the forge stops the read
      if (v && v.job && !v.job.running) v.job.error = null;
      this.view = null; this.refs = null;
    },
    render() {
      const u = U(), v = this.view, el = this.el;
      el.textContent = "";
      const kindLabel = { photo: "FORGING", snap: "NEW READING", verify: "CHECKING", mail: "FORGING FROM MAIL", enrich: "READING MAIL", plan: "PLANNING", draft: "WRITING" }[v.kind] || "FORGING";
      const clock = u.el("span", { class: "wb-micro wb-forge__clock", "aria-hidden": "true", text: "0:00" });
      let figure;
      if (v.photoSrc) {
        const img = u.el("img", { class: "wb-forge__img", alt: v.kind === "verify" ? "Your after photo" : "Your photo, being read", src: v.photoSrc, decoding: "async" });
        figure = u.el("figure", { class: "wb-forge__mat" },
          u.el("div", { class: "wb-forge__frame" }, img, u.el("span", { class: "wb-forge__scan", "aria-hidden": "true" })),
          ["tl", "tr", "bl", "br"].map((c) => u.el("span", { class: "wb-forge__tick wb-forge__tick--" + c, "aria-hidden": "true" })));
      } else {
        figure = u.el("figure", { class: "wb-forge__mat" },
          u.el("div", { class: "wb-forge__plate", "aria-hidden": "true" },
            u.el("span", { class: "wb-forge__plate-line wb-forge__plate-empty", text: v.kind === "mail" || v.kind === "enrich" ? "category:purchases" : "—" })),
          u.el("span", { class: "wb-forge__scan", "aria-hidden": "true" }),
          ["tl", "tr", "bl", "br"].map((c) => u.el("span", { class: "wb-forge__tick wb-forge__tick--" + c, "aria-hidden": "true" })));
      }
      const ticker = u.el("ol", { class: "wb-forge__ticker", "aria-live": "polite", "aria-label": "Progress" });
      const slow = u.el("p", { class: "wb-forge__slow", hidden: true, text: SLOW_LINE[v.kind] || "still working, this one takes a little longer." });
      const err = u.el("div", { class: "wb-forge__err", hidden: true, role: "alert" });
      const stop = u.el("button", { type: "button", class: "wb-btn wb-btn--quiet wb-forge__stop", text: "Stop", on: { click: () => this.stop() } });
      const acts = u.el("div", { class: "wb-forge__acts" }, stop);
      el.appendChild(u.el("div", { class: "wb-forge", "aria-busy": "true" },
        u.el("header", { class: "wb-forge__top" }, u.el("span", { class: "wb-micro", text: kindLabel }), clock),
        figure, ticker, slow, err, u.el("div", { class: "wb-forge__spacer" }), acts));
      this.refs = { root: el.firstChild, clock, figure, ticker, slow, err, acts, stop };
      this.renderTicker();
      clearInterval(this.clock); clearTimeout(this.slow);
      const tickClock = () => {
        if (!this.refs) return;
        const s = Math.max(0, Math.floor((Date.now() - v.startedAt) / 1000));
        this.refs.clock.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      };
      tickClock();
      this.clock = setInterval(tickClock, 1000);
      const remaining = Math.max(0, 12000 - (Date.now() - v.startedAt));
      this.slow = setTimeout(() => { if (this.refs && !this.view.error) this.refs.slow.hidden = false; }, remaining);
    },
    renderTicker() {
      if (!this.refs) return;
      const u = U(), v = this.view;
      const list = v.stages.length ? v.stages : [{ stage: "start", label: DEFAULT_STAGE[v.kind] || "READING…", detail: null }];
      const shown = list.slice(-4);
      const ol = this.refs.ticker;
      ol.textContent = "";
      shown.forEach((s, i) => {
        const current = i === shown.length - 1 && !v.error;
        const li = u.el("li", { class: "wb-forge__stage" + (current ? " is-current" : "") },
          u.el("span", { text: s.label }), current ? u.el("span", { class: "wb-forge__caret", "aria-hidden": "true" }) : null);
        ol.appendChild(li);
        if (s.detail && current) ol.appendChild(u.el("li", { class: "wb-forge__detail", text: "“" + s.detail + "”" }));
      });
      // letterpress plate: the search terms tick past
      const plate = this.refs.figure.querySelector(".wb-forge__plate");
      if (plate) {
        const queries = v.stages.filter((s) => s.detail).map((s) => s.detail).slice(-6);
        if (queries.length) {
          plate.textContent = "";
          queries.forEach((q) => plate.appendChild(u.el("span", { class: "wb-forge__plate-line", text: q })));
        }
      }
    },
    matches(p) {
      const v = this.view;
      if (!v) return false;
      if (v.jobId) return p.jobId === v.jobId;
      return kindMatch(p.kind, v.kind);
    },
    showError(j) {
      const v = this.view;
      if (!v || !this.refs || (v.job && v.job !== j && j.local)) return;
      const e = j.error || errCopy({ code: "unknown" });
      v.error = e;
      const u = U(), r = this.refs;
      clearTimeout(this.slow);
      r.slow.hidden = true;
      r.root.setAttribute("aria-busy", "false");
      r.figure.classList.add("is-error");
      this.renderTicker();
      r.err.hidden = false;
      r.err.textContent = "";
      r.err.appendChild(u.el("h2", { class: "wb-forge__err-title", text: e.title }));
      r.err.appendChild(u.el("p", { class: "wb-forge__err-msg", text: e.code === "no_fit" && e.why ? String(e.why) : e.message }));
      if (e.try) {
        r.err.appendChild(u.el("p", { class: "wb-forge__err-try" }, u.el("b", { text: "Try: " }), String(e.try)));
      }
      clearInterval(this.clock);
      r.acts.textContent = "";
      const btn = (label, kind, fn) => u.el("button", { type: "button", class: "wb-btn wb-btn--" + kind + " wb-btn--block", text: label, on: { click: fn } });
      const local = !!(v.job && v.job === j && j.local);
      const isPhoto = local && (j.kind === "photo" || j.kind === "snap");
      const intent = j.kind === "snap" ? "snap" : "new";
      if (e.code === "unavailable" || e.code === "not_granted") {
        if (storeMode() !== "demo") r.acts.appendChild(btn("Open the example bench", "primary", openDemo));
        r.acts.appendChild(btn("Back", "quiet", () => this.exit()));
      } else if (local) {
        if (e.code !== "no_fit" && e.code !== "refused" && typeof j.retry === "function") {
          r.acts.appendChild(btn("Try again", "primary", () => j.retry()));
        } else if (isPhoto) {
          r.acts.appendChild(btn("Take another photo", "primary", () => {
            WB.ui.pickPhoto({ source: "camera" }).then((f) => f && runPhoto(f, { intent, instrumentId: j.instrumentId }));
          }));
        }
        if (isPhoto) {
          r.acts.appendChild(btn("Choose another photo", "quiet", () => {
            WB.ui.pickPhoto({ source: "library" }).then((f) => f && runPhoto(f, { intent, instrumentId: j.instrumentId }));
          }));
        }
        r.acts.appendChild(btn("Back", "quiet", () => this.exit()));
      } else {
        r.acts.appendChild(btn("Back", "quiet", () => this.exit()));
      }
      const first = r.acts.querySelector("button");
      if (first) { try { first.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
    },
    stop() {
      const v = this.view;
      if (v && v.job) stopJob(v.job);
      else if (v && v.jobId && has("forge", "cancel")) safe("forge.cancel", () => WB.forge.cancel(v.jobId));
      this.exit();
    },
    exit() {
      if (job && !job.running) job.error = null;
      WB.router.back();
    },
  };

  /* ------------------------------------------------------------ bus wiring */
  function wire() {
    const bus = WB.bus;
    bus.on("caps:changed", (p) => {
      if (!p || !p.caps) return;
      setCaps(p.caps);
      capsKnown = true;
      if (WB.router.current().name === "front") frontView.renderActs();
    });
    bus.on("forge:start", (p) => {
      if (job && job.running && !job.jobId && kindMatch(p.kind, job.kind)) {
        job.jobId = p.jobId;
        if (forgingView.view && forgingView.view.job === job) forgingView.view.jobId = p.jobId;
        return;
      }
      const v = forgingView.view;
      if (v && !v.job && !v.jobId && p.kind === v.kind) v.jobId = p.jobId;
    });
    bus.on("forge:progress", (p) => {
      const entry = { stage: p.stage, label: String(p.label || STAGE_LABEL[p.stage] || "WORKING\u2026").toUpperCase(), detail: p.detail ? String(p.detail) : null };
      const mine = !!(job && job.running && (job.jobId ? job.jobId === p.jobId : kindMatch(p.kind, job.kind)));
      if (mine) { if (!job.jobId) job.jobId = p.jobId; pushStage(job.stages, entry); }
      const v = forgingView.view;
      if (!v) return;
      if (v.job) { if (mine && v.job === job) forgingView.renderTicker(); return; }
      if (forgingView.matches(p)) {
        if (!v.jobId) v.jobId = p.jobId;
        pushStage(v.stages, entry);
        forgingView.renderTicker();
      }
    });
    bus.on("forge:error", (p) => {
      const v = forgingView.view;
      if (!v || v.job) return;              // local jobs report through their promise
      if (!forgingView.matches(p) || (p.code === "cancelled")) return;
      forgingView.showError({ error: errCopy(p), local: false });
    });
    bus.on("forge:done", (p) => {
      if (p && p.isNew && p.instrumentId) markFirstRunDone();
      const v = forgingView.view;
      if (v && !v.job && forgingView.matches(p) && forgingView.refs) forgingView.refs.figure.classList.add("is-done");
    });
    bus.on("store:loaded", (p) => {
      if (!p || p.mode !== "cloud") return;
      const cur = WB.router.current().name;
      if (cur === "front" && autoFront && count() > 0 && WB.router.has("bench")) {
        autoFront = false;
        WB.router.go("bench", {}, { replace: true });
      }
      const prefs = U().uiPrefs();
      const pr = profile();
      if (!prefs.theme && pr && (pr.theme === "light" || pr.theme === "dark")) applyTheme(pr.theme);
    });
    bus.on("view:enter", (p) => { if (p.view !== "front") autoFront = false; });
  }

  function applyTheme(t) {
    const root = document.documentElement;
    if (t === "light" || t === "dark") root.dataset.theme = t; else delete root.dataset.theme;
  }

  /* ------------------------------------------------------------ boot */
  function restorable(r) {
    if (!r || !WB.router.has(r.name)) return false;
    if (r.name === "bench") return !isFirstRun() || storeMode() === "demo";
    if (r.name === "front") return true;
    if (r.name === "instrument" || r.name === "mission") {
      return !!(r.params.id && has("store", "get") && safe("store.get", () => WB.store.get(r.params.id)));
    }
    return false;  // forging, end, mirror need live context
  }

  function hideBoot() {
    const b = document.getElementById("wb-boot");
    if (!b) return;
    const elapsed = ((window.performance && performance.now) ? performance.now() : 0) - t0;
    const wait = U().reducedMotion() ? 0 : Math.max(0, 280 - elapsed);
    setTimeout(() => {
      b.classList.add("is-gone");
      setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, U().reducedMotion() ? 0 : 240);
    }, wait);
  }

  function boot() {
    if (booted) return;
    booted = true;
    const prefs = U().uiPrefs();
    applyTheme(prefs.theme);

    WB.router.register("front", { enter: (el, p) => frontView.enter(el, p), leave: (el) => frontView.leave(el) });
    WB.router.register("forging", { enter: (el, p) => forgingView.enter(el, p), leave: (el) => forgingView.leave(el) });
    wire();

    // store first: localStorage is read synchronously and store:loaded {mode:'local'} fires
    let loaded = false;
    const offLoaded = WB.bus.on("store:loaded", () => { loaded = true; });
    if (WB.store && typeof WB.store.init === "function") safe("store.init", () => WB.store.init());
    if (!loaded && has("store", "load")) {
      safe("store.load", () => {
        const r = WB.store.load();
        if (r && typeof r.catch === "function") r.catch((err) => console.error("[WB.app] store.load", err));
      });
    }
    offLoaded();
    ["instrument", "actions", "mission", "bench"].forEach((m) => {
      if (WB[m] && typeof WB[m].init === "function") safe(m + ".init", () => WB[m].init());
    });

    const pr = profile();
    if (!prefs.theme && pr && (pr.theme === "light" || pr.theme === "dark")) applyTheme(pr.theme);

    const firstRun = isFirstRun();
    const r = WB.router.parse();
    if (r && restorable(r)) WB.router.go(r.name, r.params, { replace: true, boot: true });
    else {
      const name = homeView();
      autoFront = name === "front";
      WB.router.go(name, {}, { replace: true, boot: true });
    }
    hideBoot();

    // capabilities light up later; never block the first paint on them
    const ready = (c) => {
      if (c) setCaps(c);
      capsKnown = true;
      if (WB.router.current().name === "front") frontView.renderActs();
      if (WB.room && typeof WB.room.init === "function") safe("room.init", () => WB.room.init());
      WB.bus.emit("app:ready", { caps: capsFn(), mode: storeMode(), firstRun });
    };
    if (has("ai", "caps")) {
      let done = false;
      const finish = (c) => { if (done) return; done = true; ready(c); };
      setTimeout(() => finish(null), 10000);
      Promise.resolve().then(() => WB.ai.caps()).then(finish, (err) => { console.error("[WB.app] caps", err); finish(null); });
    } else setTimeout(() => ready(null), 0);
  }

  WB.app = { boot, capture, caps: capsFn, fromMail: runMail, openDemo };
})();
