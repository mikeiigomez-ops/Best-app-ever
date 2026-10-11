/* Workbench mission (Raskin): the pinned 7-minute mission on the user's own photo.
   Brief → Running (a countdown with nothing to scroll) → After photo → Reveal (before/after wipe).
   View: "mission", params {id} (the instrument id; the mission lives on inst.mission).
   Registers functions only; the route is registered in init(). */
(function () {
  "use strict";
  const WB = window.WB;

  const has = (mod, fn) => !!(WB[mod] && typeof WB[mod][fn] === "function");
  const isNum = (n) => typeof n === "number" && isFinite(n);
  function safe(label, fn, fallback) {
    try { return fn(); } catch (err) { console.error("[WB.mission] " + label, err); return fallback; }
  }
  const nowMs = () => (has("util", "now") ? WB.util.now() : Date.now());
  const el = function () { return WB.util.el.apply(null, arguments); };
  const icon = (name) => (has("ui", "icon") ? WB.ui.icon(name) : "");
  const reduced = () => (has("util", "reducedMotion") ? WB.util.reducedMotion() : false);
  const haptic = (ms) => { if (has("util", "haptic")) WB.util.haptic(ms); };
  function getInst(id) { return has("store", "get") ? safe("store.get", () => WB.store.get(id), null) : null; }
  function update(id, fn) {
    if (!has("store", "update")) return null;
    return safe("store.update", () => WB.store.update(id, fn, "mission"), null);
  }
  const uid = (p) => (has("util", "uid") ? WB.util.uid(p) : p + "_" + Math.random().toString(36).slice(2, 10));
  const srcOf = (ref) => (ref && (ref.src || ref.thumb)) || null;

  /* ------------------------------------------------------------ pure time math */
  /* remaining(mission, now) -> ms left (0 when over, null when not started) */
  function remaining(m, t) {
    if (!m || !isNum(m.endsAt) || !isNum(m.startedAt)) return null;
    return Math.max(0, m.endsAt - (isNum(t) ? t : Date.now()));
  }
  function clock(ms) {
    const s = Math.max(0, Math.ceil((ms || 0) / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function progress(m, t) {
    if (!m || !isNum(m.endsAt) || !isNum(m.startedAt) || m.endsAt <= m.startedAt) return 0;
    return Math.min(1, Math.max(0, ((isNum(t) ? t : Date.now()) - m.startedAt) / (m.endsAt - m.startedAt)));
  }
  /* one rounding for minutes everywhere (the instrument rows use the same): halves show as "1½ min" */
  function minText(v) {
    if (WB.molds && typeof WB.molds.format === "function") return WB.molds.format(v, "min");
    return (Math.round(v * 2) / 2) + " min";
  }
  function totalMinutes(m) {
    if (m && isNum(m.minutes) && m.minutes > 0) return m.minutes;
    const s = (m && m.steps || []).reduce((a, x) => a + (isNum(x.minutes) ? x.minutes : 0), 0);
    return Math.max(1, Math.round(s) || 7);
  }
  /* phase(mission, local) -> 'none'|'brief'|'running'|'checking'|'reveal' */
  function phase(m, local) {
    if (!m) return "none";
    if (m.verified) return "reveal";
    if (local && local.checking) return "checking";
    if (!isNum(m.startedAt)) return "brief";
    return "running";
  }
  function selfVerified(m) {
    const steps = (m && m.steps) || [];
    const done = steps.filter((s) => s.done).map((s) => s.id);
    const notDone = steps.filter((s) => !s.done).map((s) => s.id);
    return { done, notDone, reclaimed: steps.length ? Math.round((done.length / steps.length) * 100) : 0, by: "self" };
  }

  /* ------------------------------------------------------------ planning */
  function sortedSteps(inst) { return ((inst && inst.steps) || []).slice().sort((a, b) => (a.n || 0) - (b.n || 0)); }
  function localPlan(inst) {
    const base = { id: uid("msn"), instrumentId: inst.id, title: "", minutes: 0, steps: [], beforePhoto: inst.photo || null,
      startedAt: null, endsAt: null, afterPhoto: null, verified: null, fieldNote: null };
    let steps = [];
    if (inst.mold === "reset" && inst.steps && inst.steps.length) {
      const take = Math.max(1, Math.round((inst.vars && inst.vars.take && inst.vars.take.value) || inst.steps.length));
      steps = sortedSteps(inst).slice(0, take);
      base.title = "Clear " + String((inst.words && inst.words.subject) || "this corner").replace(/^(?!the |this |my )/i, "the ") + ".";
    } else if (inst.mold === "spoil" && inst.items && inst.items.length) {
      const horizon = inst.vars && inst.vars.horizon && isNum(inst.vars.horizon.value) ? inst.vars.horizon.value : 3;
      const fresh = inst.items.filter((i) => !i.cooked).slice().sort((a, b) => a.days - b.days);
      const items = (fresh.filter((i) => i.days <= horizon).length ? fresh.filter((i) => i.days <= horizon) : fresh).slice(0, 3);
      steps = items.map((it) => ({ text: "Cook the " + it.name, minutes: 5, pin: it.pin || null }));
      base.title = "Cook tonight: " + items.map((i) => i.name).join(", ") + ".";
    } else {
      steps = [{ text: (inst.act && inst.act.why) || "Do the one thing this needs", minutes: 5, pin: null }];
      base.title = (inst.title || "One thing") + ".";
    }
    base.steps = steps.slice(0, 7).map((s, i) => ({ id: "m" + (i + 1), n: i + 1, text: String(s.text || "").slice(0, 72),
      minutes: isNum(s.minutes) && s.minutes > 0 ? s.minutes : 1, pin: Array.isArray(s.pin) ? s.pin.slice(0, 2) : null, done: false }));
    base.minutes = Math.max(1, Math.round(base.steps.reduce((a, s) => a + s.minutes, 0)));
    return base;
  }
  function normalize(inst, m) {
    const out = Object.assign({ id: uid("msn"), instrumentId: inst.id, title: inst.title || "Mission", minutes: 0, steps: [], beforePhoto: null,
      startedAt: null, endsAt: null, afterPhoto: null, verified: null, fieldNote: null }, m || {});
    out.instrumentId = inst.id;
    out.steps = (out.steps || []).filter((s) => s && s.text).map((s, i) => Object.assign({}, s, { id: s.id || "m" + (i + 1), n: s.n || i + 1, done: !!s.done }));
    out.minutes = totalMinutes(out);
    // a bill is not the spot: dial missions get a before photo only if the user takes one
    if (inst.mold === "dial" && out.beforePhoto && inst.photo && out.beforePhoto === inst.photo) out.beforePhoto = null;
    else if (inst.mold === "dial" && out.beforePhoto && inst.photo && out.beforePhoto.src === inst.photo.src) out.beforePhoto = null;
    return out;
  }
  /* plan(id, {signal}) -> Promise<Mission> : plans (via WB.forge when present), stores it on the instrument. */
  async function plan(id, opts) {
    const o = opts || {};
    const inst = getInst(id);
    if (!inst) throw { code: "unknown", message: "That instrument isn't on the bench any more." };
    let m = null;
    if (has("forge", "planMission")) {
      try { m = await WB.forge.planMission(id, { signal: o.signal }); }
      catch (e) { if ((e && e.code === "cancelled") || (o.signal && o.signal.aborted)) throw { code: "cancelled", message: "" }; m = null; }
    }
    if (o.signal && o.signal.aborted) throw { code: "cancelled", message: "" };
    const fresh = getInst(id) || inst;
    if (!m || !Array.isArray(m.steps) || !m.steps.length) m = localPlan(fresh);
    m = normalize(fresh, m);
    update(id, (i) => { i.mission = m; });
    return m;
  }
  const links = {};
  function linkAction(id, missionId, actionId) { if (missionId && actionId) links[missionId] = actionId; }
  function missionAction(inst, m) {
    if (!inst || !m) return null;
    const list = inst.actions || [];
    const byLink = links[m.id] && list.find((a) => a && a.id === links[m.id]);
    return byLink || list.slice().reverse().find((a) => a && a.type === "mission" && a.payload && a.payload.missionId === m.id) || null;
  }

  /* ------------------------------------------------------------ verified → instrument */
  function cookIds(inst) {
    const c = has("molds", "compute") ? safe("compute", () => WB.molds.compute(inst), null) : null;
    const raw = c && c._raw;
    if (raw && Array.isArray(raw._saved) && raw._saved.length) return raw._saved.slice();
    const horizon = inst.vars && inst.vars.horizon ? inst.vars.horizon.value : 3;
    const n = Math.round((inst.vars && inst.vars.cookN && inst.vars.cookN.value) || 0);
    return (inst.items || []).filter((i) => !i.cooked && i.days <= horizon).sort((a, b) => a.days - b.days).slice(0, n).map((i) => i.id);
  }
  function applyVerified(id, m) {
    const v = m.verified || selfVerified(m);
    let mold = null;
    update(id, (inst) => {
      mold = inst.mold;
      if (inst.mold === "spoil" && v.done.length) {
        const ids = cookIds(inst);
        (inst.items || []).forEach((it) => { if (ids.indexOf(it.id) >= 0) it.cooked = true; });
      }
      inst.mission = m;
      if (inst.intention && inst.intention.status === "open" && v.reclaimed > 0) inst.intention.status = "held";
      const a = missionAction(inst, m);
      if (a) { a.status = "done"; a.result = Object.assign({}, a.result || {}, { reclaimed: v.reclaimed, by: v.by }); }
    });
    const inst = getInst(id);
    if (inst && (mold === "spoil" || mold === "reset") && has("molds", "compute") && has("store", "addObservation")) {
      const c = safe("compute", () => WB.molds.compute(inst, mold === "spoil" ? { cookN: 0 } : undefined), null);
      if (c && isNum(c.primary)) {
        safe("store.addObservation", () => WB.store.addObservation(id, { t: nowMs(), value: c.primary, facts: {}, source: "mission", note: m.fieldNote || null }));
      }
    }
    return getInst(id);
  }

  /* ------------------------------------------------------------ view state */
  const V = { el: null, id: null, local: {}, timer: 0, wake: null, disposers: [], urls: [], wasOver: false, lastMin: null };

  function cleanup() {
    clearInterval(V.timer); V.timer = 0;
    V.disposers.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* gone */ } });
    releaseWake();
  }
  function revokeUrls() { V.urls.splice(0).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } }); }
  async function requestWake() {
    if (V.wake || !navigator.wakeLock || typeof navigator.wakeLock.request !== "function") return;
    try { V.wake = await navigator.wakeLock.request("screen"); if (V.wake && V.wake.addEventListener) V.wake.addEventListener("release", () => { V.wake = null; }); }
    catch (e) { V.wake = null; }
  }
  function releaseWake() { if (V.wake) { try { V.wake.release(); } catch (e) { /* ignore */ } V.wake = null; } }

  function enter(sectionEl, params) {
    cleanup();
    revokeUrls();
    V.el = sectionEl;
    V.id = params && params.id ? String(params.id) : null;
    V.local = {};
    V.wasOver = false; V.lastMin = null;
    render();
  }
  function leave() {
    if (V.local.checking && V.local.checking.ctrl) { try { V.local.checking.ctrl.abort(); } catch (e) { /* ignore */ } }
    cleanup();
    revokeUrls();
    V.local = {};
    V.el = null;
  }

  function render() {
    if (!V.el || !has("util", "el")) return;
    cleanup();
    const inst = V.id ? getInst(V.id) : null;
    const m = inst ? inst.mission : null;
    const ph = inst ? phase(m, V.local) : "none";
    const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
    V.el.textContent = "";
    let root;
    if (!inst) root = renderMissing();
    else if (ph === "none") root = renderNone(inst);
    else if (ph === "brief") root = renderBrief(inst, m);
    else if (ph === "running") root = renderRunning(inst, m);
    else if (ph === "checking") root = renderChecking(inst, m);
    else root = renderReveal(inst, m);
    root.dataset.phase = ph;
    V.el.appendChild(root);
    if (focusKey) {
      const f = V.el.querySelector('[data-fk="' + focusKey + '"]');
      if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }

  /* ------------------------------------------------------------ shared pieces */
  function topbar(label, right, backLabel) {
    return el("header", { class: "msn-top" },
      el("button", { type: "button", class: "wb-iconbtn msn-top__back", "aria-label": backLabel || "Back", html: icon("back"),
        on: { click: () => WB.router.back() } }),
      el("span", { class: "wb-micro msn-top__label", text: label }),
      right || el("span", { class: "msn-top__sp", "aria-hidden": "true" }));
  }
  function ratioOf(ref) { return ref && isNum(ref.w) && isNum(ref.h) && ref.w > 0 && ref.h > 0 ? ref.w / ref.h : 4 / 3; }
  function photoImg(ref, alt, cls) {
    const img = el("img", { class: cls || "msn-spec__img", alt: alt || "", src: srcOf(ref), decoding: "async", draggable: "false" });
    img.addEventListener("error", () => { if (ref && ref.thumb && img.getAttribute("src") !== ref.thumb) img.src = ref.thumb; }, { once: true });
    return img;
  }
  /* specimen(photo, steps, {tickable, dim, label}) */
  function specimen(photo, steps, o) {
    o = o || {};
    const frame = el("div", { class: "msn-spec__frame", style: { "--ar": String(ratioOf(photo)) } }, photoImg(photo, o.alt || "Your photo of the spot"));
    (steps || []).forEach((s) => {
      if (!Array.isArray(s.pin) || !isNum(Number(s.pin[0])) || !isNum(Number(s.pin[1]))) return;
      const x = Math.min(1, Math.max(0, Number(s.pin[0]))) * 100, y = Math.min(1, Math.max(0, Number(s.pin[1]))) * 100;
      const style = { left: x + "%", top: y + "%" };
      const cls = "msn-pin" + (s.done ? " is-done" : "");
      const pin = o.tickable
        ? el("button", { type: "button", class: cls, style, "aria-pressed": s.done ? "true" : "false", "data-fk": "pin-" + s.id,
            "aria-label": "Step " + s.n + ": " + s.text + (s.done ? ", done" : ""), on: { click: () => toggleStep(s.id) } },
            el("span", { text: String(s.n) }))
        : el("span", { class: cls, style, "aria-hidden": "true" }, el("span", { text: String(s.n) }));
      frame.appendChild(pin);
    });
    // a drawn example plate already carries its own EXAMPLE stamp; only a real photo on the example bench needs one
    if (o.example && !/^data:image\/svg/.test(String(srcOf(photo) || ""))) frame.appendChild(el("span", { class: "msn-stamp wb-micro", text: "EXAMPLE" }));
    return el("figure", { class: "msn-spec" + (o.dim ? " msn-spec--dim" : "") }, frame);
  }
  function stepList(steps, mode) {
    const ol = el("ol", { class: "msn-steps" + (mode ? " msn-steps--" + mode : "") });
    (steps || []).forEach((s) => {
      const verdict = mode === "reveal" ? (s.done ? "is-done" : "is-missed") : s.done ? "is-done" : "";
      ol.appendChild(el("li", { class: "msn-step " + verdict },
        el("span", { class: "msn-step__n wb-mono", "aria-hidden": "true" }, mode === "reveal" && s.done ? el("span", { html: icon("check") }) : String(s.n)),
        el("span", { class: "msn-step__text", text: s.text }),
        mode === "reveal" ? el("span", { class: "wb-sr", text: s.done ? " — done" : " — not done" })
          : el("span", { class: "msn-step__min wb-mono", text: minText(isNum(s.minutes) ? s.minutes : 1) })));
    });
    return ol;
  }
  function errorCopy(e) {
    if (!e) return "";
    if (e.code === "not_same_spot") return "That looks like another place. Take the after photo from where you stood before.";
    if (WB.actions && typeof WB.actions.errText === "function") return WB.actions.errText(e, "Claude");
    return (e && e.message) || "That didn't take. Try again.";
  }

  /* ------------------------------------------------------------ missing / none */
  function renderMissing() {
    return el("div", { class: "msn msn--empty" }, topbar("MISSION"),
      el("div", { class: "msn-empty" },
        el("h1", { class: "msn-title wb-serif", text: "This mission isn't here." }),
        el("p", { class: "msn-empty__sub", text: "The instrument it belonged to is gone, or lives on another device." }),
        el("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block", text: "Back to the bench",
          on: { click: () => WB.router.go(WB.router.has && WB.router.has("bench") ? "bench" : "front", {}, { replace: true }) } })));
  }
  function renderNone(inst) {
    const status = el("p", { class: "msn-status", role: "status" });
    const btn = el("button", { type: "button", class: "wb-btn wb-btn--primary wb-btn--block", "data-fk": "plan" },
      el("span", { class: "wb-btn__dot", "aria-hidden": "true" }), el("span", { class: "wb-btn__label", text: "Plan a short mission" }));
    let ctrl = null;
    btn.addEventListener("click", async () => {
      if (ctrl) { ctrl.abort(); return; }
      ctrl = new AbortController();
      btn.querySelector(".wb-btn__label").textContent = "Stop planning";
      status.textContent = "PLANNING THE MISSION…";
      try { await plan(inst.id, { signal: ctrl.signal }); ctrl = null; render(); }
      catch (e) {
        ctrl = null;
        if (!V.el) return;
        btn.querySelector(".wb-btn__label").textContent = "Plan a short mission";
        status.textContent = e && e.code === "cancelled" ? "" : errorCopy(e);
      }
    });
    return el("div", { class: "msn msn--empty" }, topbar("MISSION"),
      el("div", { class: "msn-empty" },
        el("h1", { class: "msn-title wb-serif", text: "No mission on " + (inst.title || "this one") + " yet." }),
        el("p", { class: "msn-empty__sub", text: "A few minutes, pinned on your own photo. The after photo checks it." }),
        status, btn));
  }

  /* ------------------------------------------------------------ brief */
  function renderBrief(inst, m) {
    const mins = totalMinutes(m);
    const steps = m.steps || [];
    const photo = m.beforePhoto;
    let figure;
    if (photo && srcOf(photo)) figure = specimen(photo, steps, { example: !!inst.demo, alt: "The spot for this mission, with numbered pins" });
    else {
      figure = el("div", { class: "msn-plate" },
        el("p", { class: "msn-plate__text", text: "No photo of the spot yet. Take one first and the after photo has something to compare with." }),
        el("button", { type: "button", class: "wb-btn wb-btn--quiet", "data-fk": "before", text: "Photograph the spot first",
          on: { click: () => takeBefore() } }));
    }
    const start = el("button", { type: "button", class: "wb-btn wb-btn--primary wb-btn--block msn-start", "data-fk": "start",
      on: { click: () => startMission() } },
      el("span", { class: "wb-btn__dot", "aria-hidden": "true" }),
      el("span", { class: "wb-btn__label", text: "Start" }),
      el("span", { class: "msn-start__time wb-mono", text: clock(mins * 60000) }));
    return el("div", { class: "msn msn--brief" },
      topbar("MISSION · " + minText(mins).toUpperCase()),
      el("div", { class: "msn-body" },
        figure,
        el("h1", { class: "msn-title wb-serif", text: m.title || "A short mission." }),
        el("p", { class: "wb-micro msn-meta", text: minText(mins).toUpperCase() + " · " + steps.length + (steps.length === 1 ? " STEP" : " STEPS") + " · AFTER PHOTO CHECKS IT" }),
        stepList(steps, "brief"),
        roomToggle(),
        el("p", { class: "msn-fine", text: "Leaving this screen doesn't stop the clock. Come back any time." })),
      el("div", { class: "msn-bar" }, el("div", { class: "msn-bar__in" }, start)));
  }
  /* nobody in the room sees a mission unless you ask for it here */
  function roomToggle() {
    const R = WB.room;
    if (!R || typeof R.setMissionVisible !== "function" || typeof R.others !== "function" || !R.available()) return null;
    const others = R.others();
    if (!others.length) return null;
    const on = R.missionVisible();
    const names = others.slice(0, 2).map((p) => String(p.name || "someone").split(/\s+/)[0]).join(" and ") + (others.length > 2 ? " and others" : "");
    return el("button", { type: "button", class: "msn-room" + (on ? " is-on" : ""), "aria-pressed": on ? "true" : "false", "data-fk": "room",
      on: { click: () => { R.setMissionVisible(!on); render(); } } },
      el("span", { class: "msn-room__box", "aria-hidden": "true" }, on ? "✓" : ""),
      el("span", { class: "msn-room__text", text: on ? "Visible to " + names + " here" : "Let people here see this mission" }));
  }
  async function takeBefore() {
    if (!has("ui", "pickPhoto")) return;
    const id = V.id;
    const file = await WB.ui.pickPhoto({ source: "camera" });
    if (!file || V.id !== id) return;
    let ref = null;
    if (has("store", "putPhoto")) { try { ref = await WB.store.putPhoto(file, "before"); } catch (e) { ref = null; } }
    if (!ref) { if (has("ui", "toast")) WB.ui.toast("That photo didn't save. The mission works without it."); return; }
    update(id, (i) => { if (i.mission) i.mission.beforePhoto = ref; });
    if (V.id === id) render();
  }
  function startMission() {
    const id = V.id;
    const inst = getInst(id);
    if (!inst || !inst.mission) return;
    const t = nowMs();
    const mins = totalMinutes(inst.mission);
    update(id, (i) => { if (i.mission) { i.mission.startedAt = t; i.mission.endsAt = t + mins * 60000; i.mission.minutes = mins; } });
    const fresh = getInst(id);
    haptic(12);
    if (fresh && fresh.mission) WB.bus.emit("mission:start", { id, mission: fresh.mission });
    render();
  }
  function abandon() {
    if (!has("ui", "sheet")) return;
    WB.ui.sheet({
      title: "Stop this mission?",
      body: el("p", { class: "wb-sheet__text", text: "Your ticks stay. You can start it again from the brief." }),
      actions: [
        { label: "Keep going", kind: "primary", onTap: (close) => close() },
        { label: "Stop the mission", kind: "danger", onTap: (close) => {
          close();
          update(V.id, (i) => { if (i.mission) { i.mission.startedAt = null; i.mission.endsAt = null; } });
          releaseWake();
          render();
        } },
      ],
    });
  }

  /* ------------------------------------------------------------ running */
  function toggleStep(stepId) {
    const id = V.id;
    let nowDone = false;
    update(id, (i) => {
      const s = i.mission && (i.mission.steps || []).find((x) => x.id === stepId);
      if (s) { s.done = !s.done; nowDone = s.done; }
    });
    haptic(nowDone ? 14 : 6);
    render();
  }
  function renderRunning(inst, m) {
    const steps = m.steps || [];
    const left = remaining(m, nowMs());
    const allDone = steps.length > 0 && steps.every((s) => s.done);
    const over = left === 0;
    const finishing = over || allDone || !!V.local.finishing;
    const cur = steps.find((s) => !s.done) || null;
    const curIdx = cur ? steps.indexOf(cur) : -1;

    const fill = el("span", { class: "msn-progress__fill" });
    const bar = el("div", { class: "msn-progress", "aria-hidden": "true" }, fill);
    const clockEl = el("div", { class: "msn-clock wb-mono" + (over ? " is-over" : ""), role: "timer", "aria-label": "Time left" , text: clock(left) });
    const sr = el("p", { class: "wb-sr", "aria-live": "polite" });
    const stopBtn = el("button", { type: "button", class: "msn-top__act", text: "Stop", on: { click: () => abandon() } });

    const photo = m.beforePhoto && srcOf(m.beforePhoto) ? specimen(m.beforePhoto, steps, { tickable: true, dim: true, example: !!inst.demo }) : null;

    let middle;
    if (!finishing && cur) {
      middle = el("div", { class: "msn-now" },
        el("p", { class: "wb-micro msn-now__count", text: "STEP " + (curIdx + 1) + " OF " + steps.length }),
        el("button", { type: "button", class: "msn-now__step wb-serif", "data-fk": "now", "aria-label": cur.text + ". Tap when it's done.",
          on: { click: () => toggleStep(cur.id) } },
          el("span", { text: cur.text }),
          el("span", { class: "msn-now__tick", "aria-hidden": "true", html: icon("check") })));
    } else {
      middle = el("div", { class: "msn-now" },
        el("p", { class: "msn-time wb-serif", text: over ? "Time. Show me the after." : allDone ? "All ticked. Show me the after." : "Done early. Show me the after." }));
    }

    const dots = el("div", { class: "msn-dots", role: "group", "aria-label": "Steps" });
    steps.forEach((s) => dots.appendChild(el("button", { type: "button", class: "msn-dot" + (s.done ? " is-done" : "") + (s === cur && !finishing ? " is-current" : ""),
      "data-fk": "dot-" + s.id, "aria-pressed": s.done ? "true" : "false", "aria-label": "Step " + s.n + ": " + s.text, title: s.text,
      on: { click: () => toggleStep(s.id) } }, el("span", { text: String(s.n) }))));

    const err = el("p", { class: "msn-err", role: "alert", hidden: !V.local.error, text: errorCopy(V.local.error) });
    const acts = el("div", { class: "msn-acts" });
    if (finishing) {
      acts.appendChild(el("button", { type: "button", class: "wb-btn wb-btn--primary wb-btn--block", "data-fk": "after-cam", on: { click: () => takeAfter("camera") } },
        el("span", { class: "wb-btn__dot", "aria-hidden": "true" }), el("span", { class: "wb-btn__label", text: "Take the after photo" })));
      acts.appendChild(el("div", { class: "msn-acts__row" },
        el("button", { type: "button", class: "wb-btn wb-btn--quiet", "data-fk": "after-lib", text: "Choose from photos", on: { click: () => takeAfter("library") } }),
        el("button", { type: "button", class: "wb-btn wb-btn--quiet", "data-fk": "self", text: "Tick it myself", on: { click: () => selfCheckNoPhoto() } })));
    } else {
      acts.appendChild(el("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block", "data-fk": "early", text: "I'm done",
        on: { click: () => { V.local.finishing = true; render(); } } }));
    }

    const root = el("div", { class: "msn msn--run" + (photo ? "" : " msn--nophoto") }, bar,
      topbar("ON A MISSION", stopBtn, "Leave. The clock keeps running."),
      photo, el("div", { class: "msn-run__mid" }, clockEl, middle, dots), sr, err, acts);

    // the clock: computed from endsAt, so leaving and coming back loses nothing
    V.wasOver = over;
    const tick = () => {
      const inst2 = getInst(V.id);
      const m2 = inst2 && inst2.mission;
      if (!m2 || !isNum(m2.endsAt)) return;
      const t = nowMs();
      const l = remaining(m2, t);
      clockEl.textContent = clock(l);
      fill.style.transform = "scaleX(" + progress(m2, t).toFixed(4) + ")";
      const mins = Math.ceil(l / 60000);
      if (mins !== V.lastMin) {
        V.lastMin = mins;
        if (l > 0) sr.textContent = mins + (mins === 1 ? " minute left." : " minutes left.");
      }
      if (l === 0 && !V.wasOver) {
        V.wasOver = true;
        haptic(30);
        render();
      }
    };
    tick();
    V.timer = setInterval(tick, 250);
    requestWake();
    const onVis = () => { if (document.visibilityState === "visible" && V.el && phase((getInst(V.id) || {}).mission, V.local) === "running") requestWake(); };
    document.addEventListener("visibilitychange", onVis);
    V.disposers.push(() => document.removeEventListener("visibilitychange", onVis));
    return root;
  }

  /* ------------------------------------------------------------ after photo / checking */
  async function takeAfter(source) {
    if (!has("ui", "pickPhoto")) return;
    const id = V.id;
    const file = await WB.ui.pickPhoto({ source });
    if (!file || V.id !== id) return;
    const inst = getInst(id);
    if (!inst || !inst.mission) return;
    let src = null;
    try { src = URL.createObjectURL(file); V.urls.push(src); } catch (e) { src = null; }
    const ctrl = new AbortController();
    const job = { src, ctrl, jobId: null, stages: [{ label: "CHECKING WHAT CHANGED…", detail: null }] };
    V.local.error = null;
    V.local.checking = job;
    render();
    let m = null, err = null;
    try {
      if (has("forge", "verifyMission")) {
        m = await WB.forge.verifyMission(inst.mission, file, { signal: ctrl.signal, onStart: (jid) => { job.jobId = jid; } });
      } else {
        let ref = null;
        if (has("store", "putPhoto")) { try { ref = await WB.store.putPhoto(file, "after"); } catch (e) { ref = null; } }
        m = Object.assign({}, inst.mission, { afterPhoto: ref, verified: selfVerified(inst.mission), fieldNote: "Checked by you." });
      }
    } catch (e) { err = e; }
    if (V.id !== id || V.local.checking !== job) return;    // left, or replaced
    V.local.checking = null;
    if (!m) {
      V.local.error = err && err.code === "cancelled" ? null : (err || { code: "unknown" });
      V.local.finishing = true;
      render();
      return;
    }
    if (!m.verified) m = Object.assign({}, m, { verified: selfVerified(m) });
    applyVerified(id, m);
    V.local.sweep = true;
    haptic(14);
    render();
  }
  function selfCheckNoPhoto() {
    const id = V.id;
    const inst = getInst(id);
    if (!inst || !inst.mission) return;
    const m = Object.assign({}, inst.mission, { afterPhoto: null, verified: selfVerified(inst.mission), fieldNote: "Checked by you." });
    applyVerified(id, m);
    V.local.sweep = false;
    render();
  }
  function renderChecking(inst, m) {
    const job = V.local.checking;
    const figure = job.src
      ? el("figure", { class: "msn-spec msn-spec--checking" },
          el("div", { class: "msn-spec__frame msn-spec__frame--free" },
            el("img", { class: "msn-spec__img", src: job.src, alt: "Your after photo, being compared", decoding: "async" }),
            el("span", { class: "msn-scan", "aria-hidden": "true" })))
      : null;
    const ticker = el("ol", { class: "msn-ticker", "aria-live": "polite", "aria-label": "Progress" });
    job.stages.slice(-4).forEach((s, i, arr) => ticker.appendChild(el("li", { class: "msn-ticker__line wb-mono" + (i === arr.length - 1 ? " is-current" : ""), text: s.label })));
    job.tickerEl = ticker;
    const stop = el("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block", "data-fk": "stop", text: "Stop",
      on: { click: () => { try { job.ctrl.abort(); } catch (e) { /* ignore */ } if (job.jobId && has("forge", "cancel")) safe("cancel", () => WB.forge.cancel(job.jobId)); } } });
    return el("div", { class: "msn msn--checking", "aria-busy": "true" }, topbar("CHECKING"),
      el("div", { class: "msn-body" }, figure, ticker,
        el("p", { class: "msn-fine", text: "Comparing it with the before photo. Only what's visible counts." })),
      el("div", { class: "msn-bar" }, el("div", { class: "msn-bar__in" }, stop)));
  }
  function onProgress(p) {
    const job = V.local && V.local.checking;
    if (!job || !p || p.kind !== "verify") return;
    if (job.jobId && p.jobId !== job.jobId) return;
    const label = String(p.label || "CHECKING…").toUpperCase();
    const last = job.stages[job.stages.length - 1];
    if (last && last.label === label) return;
    job.stages.push({ label, detail: p.detail || null });
    if (job.tickerEl && job.tickerEl.isConnected) {
      job.tickerEl.textContent = "";
      job.stages.slice(-4).forEach((s, i, arr) => job.tickerEl.appendChild(el("li", { class: "msn-ticker__line wb-mono" + (i === arr.length - 1 ? " is-current" : ""), text: s.label })));
    }
  }

  /* ------------------------------------------------------------ reveal */
  /* wipe position math: pointer x within the frame → percent 0..100 */
  function wipePct(clientX, left, width) { return width > 0 ? Math.min(100, Math.max(0, ((clientX - left) / width) * 100)) : 50; }
  function wipe(before, after, example) {
    const ratio = ratioOf(before || after);
    const frame = el("div", { class: "msn-wipe", style: { "--ar": String(ratio), "--wipe": "0%" } });
    frame.appendChild(photoImg(before, "Before", "msn-wipe__img"));
    const afterImg = photoImg(after, "After", "msn-wipe__img");
    frame.appendChild(el("div", { class: "msn-wipe__after" }, afterImg));
    frame.appendChild(el("span", { class: "msn-wipe__tag msn-wipe__tag--after wb-micro", "aria-hidden": "true", text: "AFTER" }));
    frame.appendChild(el("span", { class: "msn-wipe__tag msn-wipe__tag--before wb-micro", "aria-hidden": "true", text: "BEFORE" }));
    if (example) frame.appendChild(el("span", { class: "msn-stamp wb-micro", text: "EXAMPLE" }));
    const line = el("span", { class: "msn-wipe__line", "aria-hidden": "true" });
    const handle = el("button", { type: "button", class: "msn-wipe__handle", role: "slider", "aria-label": "Wipe between before and after",
      "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", "aria-valuetext": "Before", "data-fk": "wipe", html: icon("wipe") });
    frame.appendChild(line);
    frame.appendChild(handle);
    let pos = 0, raf = 0, sweeping = false;
    const set = (p) => {
      pos = Math.min(100, Math.max(0, p));
      frame.style.setProperty("--wipe", pos.toFixed(2) + "%");
      handle.setAttribute("aria-valuenow", String(Math.round(pos)));
      handle.setAttribute("aria-valuetext", pos < 5 ? "Before" : pos > 95 ? "After" : Math.round(pos) + "% after");
    };
    const stopSweep = () => { sweeping = false; cancelAnimationFrame(raf); };
    let sx = 0, sy = 0, dragging = false, pid = null, rect = null;
    frame.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      stopSweep();
      sx = e.clientX; sy = e.clientY; pid = e.pointerId; dragging = false; rect = frame.getBoundingClientRect();
      if (e.target === handle) { dragging = true; try { frame.setPointerCapture(pid); } catch (err) { /* ignore */ } }
    });
    frame.addEventListener("pointermove", (e) => {
      if (pid == null || e.pointerId !== pid) return;
      if (!dragging) {
        const dx = Math.abs(e.clientX - sx), dy = Math.abs(e.clientY - sy);
        if (dx > 6 && dx > dy) { dragging = true; try { frame.setPointerCapture(pid); } catch (err) { /* ignore */ } }
        else if (dy > 10) { pid = null; return; }
      }
      if (dragging) { e.preventDefault(); set(wipePct(e.clientX, rect.left, rect.width)); }
    });
    const end = (e) => {
      if (pid == null || (e && e.pointerId !== pid)) return;
      if (!dragging && e && e.type === "pointerup" && rect) set(wipePct(e.clientX, rect.left, rect.width));
      pid = null; dragging = false;
    };
    frame.addEventListener("pointerup", end);
    frame.addEventListener("pointercancel", () => { pid = null; dragging = false; });
    handle.addEventListener("keydown", (e) => {
      const k = e.key;
      let n = null;
      if (k === "ArrowRight" || k === "ArrowUp") n = pos + 5;
      else if (k === "ArrowLeft" || k === "ArrowDown") n = pos - 5;
      else if (k === "Home") n = 0;
      else if (k === "End") n = 100;
      if (n != null) { e.preventDefault(); stopSweep(); set(n); }
    });
    function sweep() {
      if (reduced()) { set(55); return; }
      sweeping = true;
      const t0 = performance.now();
      const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
      const stepFn = (t) => {
        if (!sweeping) return;
        const k = (t - t0) / 1200;
        if (k >= 1) { set(55); sweeping = false; return; }
        set(k < 0.62 ? ease(k / 0.62) * 100 : 100 - ease((k - 0.62) / 0.38) * 45);
        raf = requestAnimationFrame(stepFn);
      };
      raf = requestAnimationFrame(stepFn);
    }
    V.disposers.push(stopSweep);
    return { node: frame, sweep, set };
  }
  function renderReveal(inst, m) {
    const v = m.verified || selfVerified(m);
    const before = m.beforePhoto && srcOf(m.beforePhoto) ? m.beforePhoto : null;
    const after = m.afterPhoto && srcOf(m.afterPhoto) ? m.afterPhoto : null;
    let figure = null, w = null;
    if (before && after) { w = wipe(before, after, !!inst.demo); figure = el("figure", { class: "msn-reveal__fig" }, w.node); }
    else if (after || before) figure = specimen(after || before, after ? [] : m.steps, { example: !!inst.demo, alt: after ? "Your after photo" : "The spot before" });
    const pct = Math.round(isNum(v.reclaimed) ? v.reclaimed : 0);
    const by = v.by === "claude" ? "CHECKED BY CLAUDE, FROM THE TWO PHOTOS" : "CHECKED BY YOU";
    const done = el("button", { type: "button", class: "wb-btn wb-btn--primary wb-btn--block", "data-fk": "done", on: { click: () => finish() } },
      el("span", { class: "wb-btn__dot", "aria-hidden": "true" }), el("span", { class: "wb-btn__label", text: "Done" }));
    const extra = before && after
      ? el("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block", "data-fk": "save", text: "Save the before and after", on: { click: () => saveImage(inst, before, after) } })
      : null;
    const root = el("div", { class: "msn msn--reveal" }, topbar("MISSION · CHECKED"),
      el("div", { class: "msn-body" },
        figure,
        el("div", { class: "msn-reclaimed" },
          el("span", { class: "wb-micro", text: "RECLAIMED" }),
          el("span", { class: "msn-reclaimed__n wb-mono", text: pct + "%" })),
        m.fieldNote && m.fieldNote !== "Checked by you." ? el("p", { class: "msn-note wb-serif", text: m.fieldNote }) : null,
        el("p", { class: "wb-micro msn-by", text: by }),
        stepList(m.steps || [], "reveal")),
      el("div", { class: "msn-bar" }, el("div", { class: "msn-bar__in" }, extra, done)));
    if (w) {
      if (V.local.sweep) { V.local.sweep = false; requestAnimationFrame(() => w.sweep()); }
      else w.set(55);
    }
    return root;
  }
  const closed = new Set();
  function finish() {
    const id = V.id;
    const inst = getInst(id);
    const m = inst && inst.mission;
    if (!m) { WB.router.back(); return; }
    const a = missionAction(inst, m);
    const already = closed.has(m.id) || !!(a && a.result && a.result.closed);
    if (!already) {
      closed.add(m.id);
      if (a) update(id, (i) => { const x = missionAction(i, m); if (x) { x.status = "done"; x.result = Object.assign({}, x.result || {}, { closed: true }); } });
      WB.bus.emit("mission:done", { id, mission: (getInst(id) || inst).mission });
    }
    const cur = WB.router.current().name;
    if (cur === "mission") {
      WB.router.go("instrument", { id }, { replace: true });
      if (already) return;
      const pct = m.verified && isNum(m.verified.reclaimed) ? Math.round(m.verified.reclaimed) : null;
      if (has("ui", "toast")) WB.ui.toast(pct != null ? "Mission closed. " + pct + "% reclaimed." : "Mission closed.");
    }
  }

  /* before/after as one image, for the user to keep (optional) */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (/^https?:/.test(src)) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  async function saveImage(inst, before, after) {
    try {
      const [a, b] = await Promise.all([loadImage(srcOf(before)), loadImage(srcOf(after))]);
      const h = 900;
      const wa = Math.round(h * (a.naturalWidth || a.width) / (a.naturalHeight || a.height)) || h;
      const wb = Math.round(h * (b.naturalWidth || b.width) / (b.naturalHeight || b.height)) || h;
      const gap = 12;
      const cv = document.createElement("canvas");
      cv.width = Math.min(4000, wa + wb + gap); cv.height = h;
      const ctx = cv.getContext("2d");
      const cs = getComputedStyle(document.body);
      ctx.fillStyle = cs.getPropertyValue("--paper").trim() || cs.backgroundColor || "white";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(a, 0, 0, wa, h);
      ctx.drawImage(b, wa + gap, 0, wb, h);
      const blob = await new Promise((res, rej) => { try { cv.toBlob((x) => (x ? res(x) : rej(new Error("toBlob"))), "image/jpeg", 0.86); } catch (e) { rej(e); } });
      const name = "workbench-" + String(inst.title || "mission").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-before-after.jpg";
      let r = "declined";
      if (has("ai", "download")) r = await WB.ai.download(name, blob, "image/jpeg");
      if (has("ui", "toast")) WB.ui.toast(r === "declined" ? "Not saved." : "Saved the before and after.");
    } catch (e) {
      if (has("ui", "toast")) WB.ui.toast("That image can't be saved from here.");
    }
  }

  /* ------------------------------------------------------------ init */
  let inited = false;
  function init() {
    if (inited || !WB.router || !WB.bus) return;
    inited = true;
    WB.router.register("mission", { enter, leave });
    WB.bus.on("forge:progress", onProgress);
    WB.bus.on("instrument:updated", (p) => {
      // another device or module changed this instrument: redraw unless we're mid-check
      if (!V.el || !p || p.id !== V.id || p.source === "mission" || p.source === "scrub") return;
      if (V.local.checking) return;
      render();
    });
  }

  /* open(id): plan if needed, then show the mission view. */
  async function open(id, opts) {
    const inst = getInst(id);
    if (!inst) return null;
    if (!inst.mission || inst.mission.verified) { try { await plan(id, opts); } catch (e) { if (e && e.code === "cancelled") return null; } }
    WB.router.go("mission", { id });
    return (getInst(id) || {}).mission || null;
  }

  WB.mission = {
    init, plan, open, linkAction,
    remaining, clock, progress, phase,
    _test: { selfVerified, localPlan, normalize, wipePct, totalMinutes },
  };
})();
