/* Workbench actions (Raskin): the commit sheet, intentions, and the one prepared real act.
   A hold on a lever (instrument:commit) pins an intention and opens exactly one prepared act:
   a calendar check-in (.ics), a Gmail draft (never sent), a mission, or a Drive file.
   Registers functions only; all DOM work happens inside init()/commit()/openCommit(). */
(function () {
  "use strict";
  const WB = window.WB;

  /* ------------------------------------------------------------ small helpers */
  const has = (mod, fn) => !!(WB[mod] && typeof WB[mod][fn] === "function");
  const isNum = (n) => typeof n === "number" && isFinite(n);
  const U = () => WB.util;
  const M = () => WB.molds;
  function safe(label, fn, fallback) {
    try { return fn(); } catch (err) { console.error("[WB.actions] " + label, err); return fallback; }
  }
  function nowMs() { return has("util", "now") ? WB.util.now() : Date.now(); }
  function uid(prefix) {
    if (has("util", "uid")) return WB.util.uid(prefix);
    return prefix + "_" + Math.random().toString(36).slice(2, 10);
  }
  function fmtDay(ms) {
    if (has("util", "fmtDay")) return WB.util.fmtDay(ms);
    return new Date(ms).toDateString().slice(0, 10);
  }
  function fmt(value, format, inst) {
    if (has("molds", "format")) return safe("format", () => M().format(value, format, inst), String(value));
    return String(Math.round(value * 100) / 100);
  }
  function getInst(id) { return has("store", "get") ? safe("store.get", () => WB.store.get(id), null) : null; }
  function moldDef(inst) { return inst && has("molds", "get") ? safe("molds.get", () => M().get(inst.mold), null) : null; }
  function compute(inst, over) {
    if (!inst || !has("molds", "compute")) return null;
    return safe("molds.compute", () => M().compute(inst, over || undefined), null);
  }
  function primaryFormat(inst) {
    const d = moldDef(inst);
    return (d && d.outputs && d.outputs[d.primary] && d.outputs[d.primary].format) || "num";
  }

  let lastCaps = null;
  function caps() {
    const c = WB.app && WB.app.caps;
    const v = typeof c === "function" ? safe("app.caps", () => c(), null) : c;
    return Object.assign({ sample: false, gmail: "unavailable", drive: "unavailable", downloads: false }, lastCaps || {}, v || {});
  }
  const usable = (state) => state === "granted" || state === "prompt";

  function emailsOf(inst) {
    const out = [];
    [inst && inst.contact && inst.contact.to, inst && inst.act && inst.act.to].forEach((e) => {
      if (typeof e !== "string") return;
      e.split(/[\s,;]+/).forEach((x) => { if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && out.indexOf(x) < 0) out.push(x); });
    });
    return out;
  }
  function slug(s) {
    return String(s || "instrument").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "instrument";
  }

  /* ------------------------------------------------------------ ICS (pure) */
  function utf8len(ch) {
    const c = ch.codePointAt(0);
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  function icsText(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  function icsFold(line) {
    const parts = [];
    let cur = "", bytes = 0;
    for (const ch of line) {
      const b = utf8len(ch);
      const limit = parts.length ? 74 : 75;   // continuation lines start with one space
      if (bytes + b > limit) { parts.push(cur); cur = ""; bytes = 0; }
      cur += ch; bytes += b;
    }
    parts.push(cur);
    return parts.join("\r\n ");
  }
  const pad = (n) => String(n).padStart(2, "0");
  function icsLocal(ms) {
    const d = new Date(ms);
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(d.getHours()) + pad(d.getMinutes()) + "00";
  }
  function icsUTC(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  /* buildICS({uid, title, description, start:ms, minutes, rrule?, stamp?}) -> RFC 5545 text (CRLF, folded).
     Times are floating local times so the reminder lands at 9:00 wherever the phone is. */
  function buildICS(o) {
    const start = isNum(o.start) ? o.start : Date.now();
    const minutes = Math.max(5, Math.round(o.minutes || 15));
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Workbench//Check-in//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + icsText(o.uid || ("wb-" + start)) + "@workbench",
      "DTSTAMP:" + icsUTC(isNum(o.stamp) ? o.stamp : Date.now()),
      "DTSTART:" + icsLocal(start),
      "DTEND:" + icsLocal(start + minutes * 60000),
      "SUMMARY:" + icsText(o.title || "Workbench check-in"),
    ];
    if (o.description) lines.push("DESCRIPTION:" + icsText(o.description));
    if (o.rrule) lines.push("RRULE:" + String(o.rrule).replace(/[\r\n]/g, ""));
    lines.push("TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsText(o.title || "Workbench check-in"), "TRIGGER:-PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR");
    return lines.map(icsFold).join("\r\n") + "\r\n";
  }
  /* The reminder time: 9:00 local on the check day; if that has passed, the next half hour from now. */
  function reminderStart(checkAt, now) {
    const t = isNum(now) ? now : Date.now();
    const d = new Date(isNum(checkAt) ? checkAt : t);
    d.setHours(9, 0, 0, 0);
    let s = d.getTime();
    if (s <= t) { const n = new Date(t + 30 * 60000); n.setMinutes(n.getMinutes() < 30 ? 30 : 60, 0, 0); s = n.getTime(); }
    return s;
  }

  /* ------------------------------------------------------------ copy */
  const NEXT_PHOTO = {
    leak: "Photograph your next receipt and it lands here.",
    spoil: "Photograph the shelf again and it lands here.",
    perUse: "Photograph the next statement or tag and it lands here.",
    dial: "Photograph your next bill and it lands here.",
    countdown: "Once it's done, photograph the slip and it lands here.",
    reset: "Photograph the corner after and it lands here.",
  };
  function num(v) { return fmt(v, "num"); }
  function plural(n, one, many) { return Math.abs(n - 1) < 1e-9 ? one : many; }

  /* commitTitle(inst, varId, value): the sheet title, e.g. "1 a week, from 3." */
  function commitTitle(inst, varId, value) {
    if (!inst || !inst.vars) return "Committed.";
    const v = inst.vars;
    const w = inst.words || {};
    const c = compute(inst, { [varId]: value });
    const out = (c && c.outputs) || {};
    switch (inst.mold) {
      case "leak": {
        const per = w.period === "month" ? "month" : "week";
        return num(value) + " a " + per + (v.rate && isNum(v.rate.value) ? ", from " + num(v.rate.value) : "") + ".";
      }
      case "perUse":
        return num(value) + plural(value, " use", " uses") + " a month" + (v.uses && isNum(v.uses.value) ? ", from " + num(v.uses.value) : "") + ".";
      case "spoil": {
        const n = Math.round(value);
        if (n <= 0) return "Cook nothing tonight.";
        return "Cook " + n + " tonight" + (isNum(out.saved) && out.saved > 0 ? ", keep " + fmt(out.saved, "usd", inst) : "") + ".";
      }
      case "dial": {
        const n = Math.round(value);
        const unit = w.stepUnit ? String(w.stepUnit) : plural(Math.abs(n), "step", "steps");
        return (n > 0 ? "" : n < 0 ? "−" : "") + Math.abs(n) + " " + unit + ".";
      }
      case "countdown":
        return "Act " + fmt(value, "days", inst) + " early" + (isNum(out.actBy) ? ", by " + fmt(out.actBy, "day", inst) : "") + ".";
      case "reset": {
        const n = Math.round(value);
        return n + plural(n, " move", " moves") + (isNum(out.minutesNeeded) ? ", about " + fmt(out.minutesNeeded, "min", inst) : "") + ".";
      }
      default: {
        const vv = v[varId];
        return (vv ? vv.label + ": " : "") + fmt(value, vv ? vv.format : "num", inst) + ".";
      }
    }
  }
  function commitLine(inst, intention) {
    const day = fmtDay(intention.checkAt);
    if (inst.mold === "countdown") return "I'll remind you on " + day + ". " + NEXT_PHOTO.countdown;
    return "I'll check with you on " + day + ". " + (NEXT_PHOTO[inst.mold] || "Photograph it again and it lands here.");
  }

  /* ------------------------------------------------------------ intention */
  function makeIntention(inst, varId, value, payload) {
    const t = nowMs();
    let it = null;
    if (has("molds", "intentionFor")) it = safe("molds.intentionFor", () => M().intentionFor(inst, varId, value, t), null);
    if (!it) {
      const d = moldDef(inst);
      const base = compute(inst);
      const tgt = compute(inst, { [varId]: value });
      const checkAt = has("molds", "checkAtFor") ? safe("checkAtFor", () => M().checkAtFor(inst, t, value), null)
        : t + (((d && d.checkDays) || 7) * 86400000);
      it = { varId, value, baseline: base ? base.primary : 0, target: tgt ? (isNum(tgt.outcome) ? tgt.outcome : tgt.primary) : 0,
        outputId: (d && d.primary) || "", committedAt: t, checkAt: isNum(checkAt) ? checkAt : t + 7 * 86400000, status: "open", actionId: null };
    }
    if (payload && isNum(payload.baseline)) it.baseline = payload.baseline;
    if (!isNum(it.baseline)) it.baseline = 0;
    if (!isNum(it.target)) it.target = it.baseline;
    it.status = "open";
    it.actionId = null;
    return it;
  }

  /* ------------------------------------------------------------ act choice */
  const ACT_LABEL = {
    ics: "A check-in on my calendar",
    draft: "A Gmail draft",
    mission: "A short mission",
    drive: "A plan in Google Drive",
  };
  /* actOptions(inst): the acts that make sense for this instrument right now, most fitting first. */
  function actOptions(inst) {
    const d = moldDef(inst);
    const acts = (d && Array.isArray(d.acts) && d.acts.length) ? d.acts : ["ics"];
    const c = caps();
    const out = [];
    acts.forEach((a) => {
      if (a === "draft") { if (emailsOf(inst).length) out.push("draft"); }
      else if ((a === "mission" || a === "ics") && out.indexOf(a) < 0) out.push(a);
    });
    if (out.indexOf("ics") < 0) out.push("ics");
    if (!inst.demo && usable(c.drive)) out.push("drive");
    return out;
  }
  /* chooseAct(inst): exactly one prepared act. Claude's suggestion wins when it is allowed. */
  function chooseAct(inst) {
    const opts = actOptions(inst);
    const hint = inst && inst.act && inst.act.type;
    if (hint && opts.indexOf(hint) >= 0) return hint;
    if (opts.indexOf("draft") >= 0) return "draft";
    if (opts.indexOf("mission") >= 0 && (inst.mold === "spoil" || inst.mold === "reset")) return "mission";
    return opts[0];
  }
  function purposesFor(inst, intention) {
    const tgt = intention ? intention.value : null;
    const k = ((inst.kind || "") + " " + (inst.title || "")).toLowerCase();
    if (inst.mold === "leak") return tgt === 0 ? ["cancel", "pause", "ask"] : ["pause", "cancel", "ask"];
    if (inst.mold === "perUse") return tgt === 0 ? ["cancel", "ask", "pause"] : ["ask", "pause", "cancel"];
    if (inst.mold === "countdown") return /return|refund|exchange/.test(k) ? ["return", "ask"] : ["renew", "ask", "cancel"];
    return ["ask"];
  }
  const PURPOSE_LABEL = { cancel: "Cancel", pause: "Pause", return: "Return", ask: "Ask", renew: "Before it renews" };
  const PURPOSE_CARD = {
    cancel: "Draft a cancellation to ", pause: "Draft a pause request to ", return: "Draft a return request to ",
    ask: "Draft a question to ", renew: "Draft a renewal question to ",
  };

  /* ------------------------------------------------------------ error copy */
  function errText(err, server) {
    const code = (err && err.code) || "unknown";
    const svc = server || "Gmail";
    switch (code) {
      case "not_granted": return svc + " stayed closed. Nothing was saved.";
      case "needs_reauth": case "server_not_connected": case "unavailable":
        return "Connect " + svc + " in claude.ai Settings → Connectors.";
      case "tool_error": return svc + " returned an error. Nothing was saved. Hold again to retry.";
      case "rate_limited": return "Claude needs a breather. Try again in a minute.";
      case "timeout": return "That took too long. Nothing was saved.";
      case "refused": return "I can't write that one.";
      case "invalid_json": return "I couldn't write that cleanly. Try again.";
      case "cancelled": return "";
      default: return (err && typeof err.message === "string" && err.message) || "That didn't take. Try again.";
    }
  }

  /* ------------------------------------------------------------ store helpers */
  function recordAction(id, type, status, payload, result) {
    const action = { id: uid("act"), type, status, at: nowMs(), payload: payload || {}, result: result || null };
    let saved = action;
    if (has("store", "addAction")) {
      const r = safe("store.addAction", () => WB.store.addAction(id, action), null);
      if (r && typeof r === "object" && !(typeof r.then === "function") && r.id) saved = r;
    }
    if (has("store", "update")) {
      safe("store.update", () => WB.store.update(id, (inst) => {
        if (inst.intention) inst.intention.actionId = saved.id;
        if (!has("store", "addAction")) { inst.actions = (inst.actions || []).concat([saved]).slice(-20); }
      }, "action"));
    }
    return saved;
  }
  /* markAction(id, actionId, patch): flip a prepared act to done/declined later (missions). */
  function markAction(id, actionId, patch) {
    if (!actionId || !has("store", "update")) return null;
    let out = null;
    safe("store.update", () => WB.store.update(id, (inst) => {
      const a = (inst.actions || []).find((x) => x && x.id === actionId);
      if (a) { Object.assign(a, patch || {}); out = Object.assign({}, a); }
    }, "action"));
    return out;
  }

  /* ------------------------------------------------------------ done announcement */
  // action:done routes to the end view the first time (Zhuo); afterwards we say what happened.
  function announce(id, action, toastText) {
    WB.bus.emit("action:done", { id, action });
    const cur = WB.router && WB.router.current ? WB.router.current().name : null;
    if (cur !== "end" && toastText && has("ui", "toast")) WB.ui.toast(toastText);
  }

  /* ------------------------------------------------------------ the commit sheet */
  let openSheet = null;

  function el() { return WB.util.el.apply(null, arguments); }
  function iconSpan(name, cls) {
    const s = el("span", { class: cls || "act-card__glyph", "aria-hidden": "true" });
    if (has("ui", "icon")) s.innerHTML = WB.ui.icon(name);   // trusted, app-authored SVG
    return s;
  }
  function holdButton(label, onDone, disposers) {
    const btn = el("button", { type: "button", class: "wb-btn wb-btn--primary wb-btn--block wb-btn--hold act-do" },
      el("span", { class: "wb-btn__dot", "aria-hidden": "true" }),
      el("span", { class: "wb-btn__label", text: label }),
      el("span", { class: "wb-btn__hold", "aria-hidden": "true", text: "HOLD" }));
    btn.setAttribute("aria-description", "Press and hold to confirm");
    if (has("ui", "hold")) disposers.push(WB.ui.hold(btn, { ms: 700, onDone }));
    else btn.addEventListener("click", onDone);
    return btn;
  }
  function tapButton(label, onTap, kind) {
    return el("button", { type: "button", class: "wb-btn wb-btn--" + (kind || "primary") + " wb-btn--block act-do", on: { click: onTap } },
      kind === "quiet" ? null : el("span", { class: "wb-btn__dot", "aria-hidden": "true" }),
      el("span", { class: "wb-btn__label", text: label }));
  }

  /* openCommit(id, {act}) -> {el, close} | null : the commit sheet for an instrument's current intention. */
  function openCommit(id, opts) {
    if (!has("ui", "sheet") || !has("util", "el")) return null;
    const o = opts || {};
    const inst = getInst(id);
    if (!inst || !inst.intention) {
      if (has("ui", "toast")) WB.ui.toast("Hold a glowing number to commit first.");
      return null;
    }
    if (openSheet) { try { openSheet.close(); } catch (e) { /* gone */ } openSheet = null; }
    const intention = inst.intention;
    const options = actOptions(inst);
    let act = o.act && options.indexOf(o.act) >= 0 ? o.act : chooseAct(inst);

    const st = { pending: null, closed: false, ctrl: null, writing: false, disposers: [] };
    const pf = primaryFormat(inst);
    const d = moldDef(inst);
    const outLabel = d && d.outputs && d.outputs[d.primary] ? d.outputs[d.primary].label : "";

    // a deadline is not a "from → to" number: say how much room is left and when you act
    const cd = inst.mold === "countdown" ? compute(inst, { [intention.varId]: intention.value }) : null;
    const stake = cd && cd.outputs
      ? el("p", { class: "act-stake" },
          el("span", { class: "act-stake__from wb-mono", text: fmt(cd.outputs.daysLeft, "days", inst) + " left" }),
          el("span", { class: "act-stake__arrow", "aria-hidden": "true", text: "→" }),
          el("span", { class: "wb-sr", text: ", " }),
          el("span", { class: "act-stake__to wb-mono", text: "act by " + fmt(cd.outputs.actBy, "day", inst) }),
          el("span", { class: "act-stake__label wb-micro", text: fmt(intention.value, "days", inst).toUpperCase() + " OF ROOM" }))
      : el("p", { class: "act-stake" },
          el("span", { class: "act-stake__from wb-mono", text: fmt(intention.baseline, pf, inst) }),
          el("span", { class: "act-stake__arrow", "aria-hidden": "true", text: "→" }),
          el("span", { class: "wb-sr", text: " to " }),
          el("span", { class: "act-stake__to wb-mono", text: fmt(intention.target, pf, inst) }),
          outLabel ? el("span", { class: "act-stake__label wb-micro", text: outLabel }) : null);
    const prev = o.prev && isNum(o.prev.value) && o.prev.committedAt !== intention.committedAt ? o.prev : null;
    const line = el("p", { class: "act-line", text: commitLine(inst, intention) +
      (prev ? " This replaces your promise of " + commitTitle(inst, prev.varId, prev.value).replace(/[.,].*$/, "").replace(/^Cook /, "cooking ").replace(/^[A-Z]/, (c) => c.toLowerCase()) + "." : "") });
    const cardSlot = el("div", { class: "act-slot" });
    const switchRow = el("div", { class: "act-switch" });
    const foot = el("div", { class: "act-foot" });
    const remember = el("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block act-remember", text: "Just remember it",
      on: { click: () => doRemember() } });
    foot.appendChild(remember);
    const body = el("div", { class: "act-sheet" }, stake, line, cardSlot, switchRow, foot);

    function disposeHolds() { st.disposers.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* gone */ } }); }
    function finish(type, payload, result, toastText, closeNow) {
      const action = recordAction(id, type, "done", payload, result);
      st.pending = { action, toastText };
      if (closeNow) sheet.close();
      return action;
    }
    function doRemember() {
      if (st.writing) return;
      finish("remember", { varId: intention.varId, value: intention.value }, null, "Pinned. I'll ask on " + fmtDay(intention.checkAt) + ".", true);
    }

    function renderSwitch() {
      switchRow.textContent = "";
      const others = options.filter((x) => x !== act);
      if (!others.length || st.done) return;
      switchRow.appendChild(el("span", { class: "wb-micro act-switch__lead", text: "Or instead" }));
      others.forEach((x) => switchRow.appendChild(el("button", { type: "button", class: "act-switch__btn", text: ACT_LABEL[x] || x,
        on: { click: () => { if (st.writing) return; act = x; renderCard(); } } })));
    }

    function renderCard() {
      disposeHolds();
      if (st.ctrl) { try { st.ctrl.abort(); } catch (e) { /* ignore */ } st.ctrl = null; }
      cardSlot.textContent = "";
      const card = act === "draft" ? draftCard() : act === "mission" ? missionCard() : act === "drive" ? driveCard() : icsCard();
      cardSlot.appendChild(card);
      renderSwitch();
    }

    /* ---- .ics */
    function icsCard() {
      const start = reminderStart(intention.checkAt, nowMs());
      const recurring = inst.mold === "perUse";
      const status = el("p", { class: "act-status", role: "status" });
      const btn = tapButton("Add the check-in", () => run(), "primary");
      const card = el("section", { class: "act-card", "aria-label": "Calendar check-in" },
        el("div", { class: "act-card__head" }, iconSpan("calendar"),
          el("div", { class: "act-card__text" },
            el("h3", { class: "act-card__title", text: inst.mold === "countdown" ? "Add an act-by reminder to my calendar" : "Add a check-in to my calendar" }),
            el("p", { class: "act-card__meta wb-micro", text: fmtDay(start).toUpperCase() + " · " + timeLabel(start) + (recurring ? " · EVERY 2 WEEKS" : "") + " · .ICS FILE" }))),
        status, btn);
      let busy = false;
      async function run() {
        if (busy) return;
        busy = true; btn.disabled = true; status.textContent = "SAVING THE FILE…";
        const text = icsFor(inst, intention, start);
        const filename = "workbench-" + slug(inst.title) + (inst.mold === "countdown" ? "-act-by" : "-check-in") + ".ics";
        let r = "declined";
        try { r = has("ai", "download") ? await WB.ai.download(filename, text, "text/calendar") : (blobDownload(filename, text) ? "fallback" : "declined"); }
        catch (e) { r = blobDownload(filename, text) ? "fallback" : "declined"; }
        busy = false; btn.disabled = false;
        if (st.closed) return;
        if (r === "declined") { status.textContent = "Not saved. Tap again when you want it."; return; }
        finish("ics", { filename, start, recurring }, { saved: r }, "Check-in saved for " + fmtDay(start) + ". Open the file to add it.", true);
      }
      return card;
    }

    /* ---- mission */
    function missionCard() {
      const minutes = guessMinutes(inst);
      const status = el("p", { class: "act-status", role: "status" });
      const stop = el("button", { type: "button", class: "act-inline-btn", text: "Stop", hidden: true, on: { click: () => { if (st.ctrl) st.ctrl.abort(); } } });
      const btn = tapButton("Start the mission", () => run(), "primary");
      const title = minutes ? "Start a " + minutes + "-minute mission" : "Start a short mission";
      const sub = inst.mold === "spoil" ? "PINNED ON THIS SHELF · COOK TONIGHT" : inst.mold === "reset" ? "PINNED ON THIS PHOTO · AFTER PHOTO CHECKS IT" : "A FEW PHYSICAL STEPS · AFTER PHOTO CHECKS IT";
      const card = el("section", { class: "act-card", "aria-label": "Mission" },
        el("div", { class: "act-card__head" }, iconSpan("clock"),
          el("div", { class: "act-card__text" },
            el("h3", { class: "act-card__title", text: title }),
            el("p", { class: "act-card__meta wb-micro", text: sub }))),
        el("div", { class: "act-status-row" }, status, stop), btn);
      let busy = false;
      async function run() {
        if (busy) return;
        busy = true; btn.disabled = true; st.writing = true;
        status.textContent = "PLANNING THE MISSION…"; stop.hidden = false;
        const ctrl = new AbortController(); st.ctrl = ctrl;
        let mission = null, err = null;
        try {
          mission = WB.mission && typeof WB.mission.plan === "function" ? await WB.mission.plan(id, { signal: ctrl.signal }) : null;
        } catch (e) { err = e; }
        busy = false; st.writing = false; stop.hidden = true; btn.disabled = false; st.ctrl = null;
        if (st.closed) return;
        if (!mission) {
          status.textContent = err && err.code === "cancelled" ? "" : errText(err || { code: "unknown", message: "I couldn't plan that one. Try again." }, "Claude");
          return;
        }
        const action = recordAction(id, "mission", "prepared", { missionId: mission.id, title: mission.title, minutes: mission.minutes }, null);
        if (WB.mission && typeof WB.mission.linkAction === "function") WB.mission.linkAction(id, mission.id, action.id);
        st.undoable = false;
        sheet.close();
        if (WB.router) WB.router.go("mission", { id });
      }
      return card;
    }

    /* ---- Gmail draft */
    function draftCard() {
      const c = caps();
      const live = !inst.demo && usable(c.gmail);
      const purposes = purposesFor(inst, intention);
      let purpose = purposes[0];
      const who = (inst.words && inst.words.subject) || inst.title || "them";
      const titleEl = el("h3", { class: "act-card__title" });
      const setTitle = () => { titleEl.textContent = (PURPOSE_CARD[purpose] || "Draft a note to ") + who; };
      setTitle();
      const fid = uid("act-f");
      const chips = el("div", { class: "act-purpose", role: "radiogroup", "aria-label": "What the email asks for" });
      const toIn = el("input", { id: fid + "-to", class: "act-field__input wb-mono", type: "email", multiple: true, autocomplete: "off", spellcheck: "false", placeholder: "name@example.com" });
      const subjIn = el("input", { id: fid + "-s", class: "act-field__input", type: "text", autocomplete: "off" });
      const bodyIn = el("textarea", { id: fid + "-b", class: "act-field__area", rows: "7" });
      const fields = el("div", { class: "act-fields" },
        el("div", { class: "act-field" }, el("label", { class: "wb-micro act-field__label", for: toIn.id, text: "To" }), toIn),
        el("div", { class: "act-field" }, el("label", { class: "wb-micro act-field__label", for: subjIn.id, text: "Subject" }), subjIn),
        el("div", { class: "act-field" }, el("label", { class: "wb-micro act-field__label", for: bodyIn.id, text: "Message" }), bodyIn));
      const note = el("p", { class: "act-note wb-micro", text: live ? "SAVED AS A DRAFT IN GMAIL. NOTHING IS SENT." :
        inst.demo ? "EXAMPLE BENCH: NOTHING GOES TO GMAIL. COPY IT IF IT'S USEFUL." : "GMAIL ISN'T CONNECTED. COPY IT, OR CONNECT GMAIL IN CLAUDE.AI SETTINGS → CONNECTORS." });
      const status = el("p", { class: "act-status", role: "status" });
      const stop = el("button", { type: "button", class: "act-inline-btn", text: "Stop", hidden: true, on: { click: () => { if (st.ctrl) st.ctrl.abort(); } } });
      const actRow = el("div", { class: "act-card__do" });
      const card = el("section", { class: "act-card act-card--draft", "aria-label": "Email draft" },
        el("div", { class: "act-card__head" }, iconSpan("mail"), el("div", { class: "act-card__text" }, titleEl)),
        purposes.length > 1 ? chips : null, fields, note, el("div", { class: "act-status-row" }, status, stop), actRow);
      let replyTo = null;
      let busy = false;

      function renderChips() {
        chips.textContent = "";
        purposes.forEach((p) => chips.appendChild(el("button", { type: "button", role: "radio", class: "act-purpose__chip" + (p === purpose ? " is-active" : ""),
          "aria-checked": p === purpose ? "true" : "false", text: PURPOSE_LABEL[p] || p,
          on: { click: () => { if (busy || p === purpose) return; purpose = p; setTitle(); renderChips(); write(); } } })));
      }
      function setBusy(on, label) {
        busy = on; st.writing = on;
        [toIn, subjIn, bodyIn].forEach((x) => { x.disabled = on; });
        card.classList.toggle("is-busy", on);
        status.textContent = label || "";
        actRow.querySelectorAll("button").forEach((b) => { b.disabled = on; });
      }
      function values() {
        const to = toIn.value.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /@/.test(s));
        return { to, subject: subjIn.value.trim(), body: bodyIn.value.replace(/\s+$/, "") };
      }
      async function write() {
        if (st.ctrl) { try { st.ctrl.abort(); } catch (e) { /* ignore */ } }
        const ctrl = new AbortController(); st.ctrl = ctrl;
        setBusy(true, "WRITING THE DRAFT…"); stop.hidden = false;
        let d = null, err = null;
        try {
          if (has("forge", "writeDraft")) d = await WB.forge.writeDraft(id, { purpose, signal: ctrl.signal });
        } catch (e) { err = e; }
        if (st.closed) return;
        if (st.ctrl && st.ctrl !== ctrl) return;          // a newer write replaced this one
        st.ctrl = null;
        stop.hidden = true;
        if (ctrl.signal.aborted) { setBusy(false, ""); if (!bodyIn.value) fallbackDraft(); return; }
        if (!d) {
          setBusy(false, err && err.code !== "cancelled" ? errText(err, "Claude") : "");
          if (!bodyIn.value) fallbackDraft();
          return;
        }
        toIn.value = (Array.isArray(d.to) && d.to.length ? d.to : emailsOf(inst)).join(", ");
        subjIn.value = String(d.subject || "");
        bodyIn.value = String(d.body || "");
        replyTo = d.replyToMessageId || null;
        setBusy(false, "");
      }
      function fallbackDraft() {
        toIn.value = emailsOf(inst).join(", ");
        subjIn.value = (PURPOSE_LABEL[purpose] || "Question") + ": " + who;
        bodyIn.value = "Hi,\n\n\n\nThanks,\n[Name]";
      }
      async function save() {
        if (busy) return;
        const v = values();
        if (!v.body.trim()) { status.textContent = "Write a line first."; bodyIn.focus(); return; }
        setBusy(true, "SAVING TO GMAIL DRAFTS…");
        let r = null, err = null;
        try { r = await WB.ai.gmail.draft({ to: v.to, subject: v.subject, body: v.body, replyToMessageId: replyTo || undefined }); }
        catch (e) { err = e; }
        const payload = { purpose, to: v.to, subject: v.subject, body: v.body };
        if (r) {
          const action = recordAction(id, "draft", "done", payload, { id: r.id || null, threadId: r.threadId || null, viewUrl: r.viewUrl || null });
          if (st.closed) { announce(id, action, "Draft saved in Gmail. Nothing was sent."); return; }
          st.pending = { action, toastText: "Draft saved in Gmail. Nothing was sent." };
          st.done = true;
          showDone(card, "Saved in your Gmail drafts.", "Nothing was sent. Read it once more, then send it from Gmail when you're ready.",
            r.viewUrl ? { href: r.viewUrl, label: "Open in Gmail" } : null);
          renderSwitch();
          return;
        }
        if (st.closed) return;
        setBusy(false, errText(err, "Gmail"));   // never retried automatically
      }
      async function copy() {
        const v = values();
        const text = (v.to.length ? "To: " + v.to.join(", ") + "\n" : "") + (v.subject ? "Subject: " + v.subject + "\n\n" : "") + v.body;
        const ok = await copyText(text, bodyIn);
        if (!ok) { status.textContent = "Select the message and copy it by hand."; return; }
        finish("draft", { purpose, to: v.to, subject: v.subject, body: v.body, copied: true }, { copied: true }, "Copied. Nothing was sent.", true);
      }
      actRow.appendChild(live ? holdButton("Save the draft", save, st.disposers) : tapButton("Copy the draft", copy, "primary"));
      renderChips();
      // writing a draft is a user-chosen act: it starts once the sheet is open (a tap/hold opened it)
      setTimeout(() => { if (!st.closed && act === "draft") write(); }, 0);
      return card;
    }

    /* ---- Google Drive */
    function driveCard() {
      const status = el("p", { class: "act-status", role: "status" });
      const actRow = el("div", { class: "act-card__do" });
      const fileTitle = "Workbench — " + (inst.title || "plan") + " — " + fmtDay(nowMs());
      const card = el("section", { class: "act-card", "aria-label": "Google Drive file" },
        el("div", { class: "act-card__head" }, iconSpan("drive"),
          el("div", { class: "act-card__text" },
            el("h3", { class: "act-card__title", text: "Save this plan to Google Drive" }),
            el("p", { class: "act-card__meta wb-micro", text: "A SHORT TEXT FILE · ONLY IN YOUR DRIVE" }))),
        el("pre", { class: "act-preview wb-mono", text: planText(inst, intention) }), status, actRow);
      let busy = false;
      async function save() {
        if (busy) return;
        busy = true; status.textContent = "SAVING TO DRIVE…";
        let r = null, err = null;
        try { r = await WB.ai.drive.create({ title: fileTitle, text: planText(inst, intention) }); } catch (e) { err = e; }
        busy = false;
        if (r) {
          const url = pickUrl(r);
          const action = recordAction(id, "drive", "done", { title: fileTitle }, { id: r.id || r.fileId || null, url });
          if (st.closed) { announce(id, action, "Saved to Google Drive."); return; }
          st.pending = { action, toastText: "Saved to Google Drive." };
          st.done = true;
          showDone(card, "Saved to Google Drive.", fileTitle, url ? { href: url, label: "Open in Drive" } : null);
          renderSwitch();
          return;
        }
        if (!st.closed) status.textContent = errText(err, "Google Drive");
      }
      actRow.appendChild(holdButton("Save to Drive", save, st.disposers));
      return card;
    }

    function showDone(card, title, sub, link) {
      disposeHolds();
      card.textContent = "";
      card.classList.add("is-done");
      card.appendChild(el("div", { class: "act-card__head" }, iconSpan("check", "act-card__glyph act-card__glyph--done"),
        el("div", { class: "act-card__text" }, el("h3", { class: "act-card__title", text: title }), sub ? el("p", { class: "act-card__sub", text: sub }) : null)));
      const row = el("div", { class: "act-card__do" });
      if (link && /^https:\/\//.test(link.href)) {
        row.appendChild(el("a", { class: "wb-btn wb-btn--quiet wb-btn--block", href: link.href, target: "_blank", rel: "noopener noreferrer", text: link.label }));
      }
      row.appendChild(tapButton("Done", () => sheet.close(), "primary"));
      card.appendChild(row);
      remember.hidden = true;
      const first = row.querySelector("a, button");
      if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }

    const sheet = WB.ui.sheet({
      title: commitTitle(inst, intention.varId, intention.value),
      body,
      actions: [],
      onClose: () => {
        st.closed = true;
        disposeHolds();
        if (st.ctrl) { try { st.ctrl.abort(); } catch (e) { /* ignore */ } st.ctrl = null; }
        if (openSheet === sheet) openSheet = null;
        const p = st.pending;
        st.pending = null;
        if (p) { announce(id, p.action, p.toastText); return; }
        // closed without choosing an act: the promise is pinned, and it can be taken back in one tap
        if (st.undoable !== false && has("ui", "toast")) {
          WB.ui.toast("Pinned. I'll ask on " + fmtDay(intention.checkAt) + ".", { ms: 6000, action: { label: "Undo", onTap: () => undoCommit(id, intention, o.prev || null) } });
        }
      },
    });
    openSheet = sheet;
    if (sheet && sheet.el) sheet.el.classList.add("act-sheet-panel");
    renderCard();
    return sheet;
  }

  /* undoCommit: put back what was there before the hold (the earlier promise, or none) */
  function undoCommit(id, intention, prev) {
    const cur = getInst(id);
    if (!cur || !cur.intention || cur.intention.committedAt !== intention.committedAt) return;
    if (has("store", "setIntention")) safe("store.setIntention", () => WB.store.setIntention(id, prev && isNum(prev.value) ? prev : null));
    if (has("store", "forgetCommit")) safe("store.forgetCommit", () => WB.store.forgetCommit(id, intention.committedAt, prev));
    if (has("ui", "toast")) WB.ui.toast(prev ? "Back to your earlier promise." : "Undone. Nothing is pinned.");
  }

  /* ------------------------------------------------------------ act content */
  function timeLabel(ms) {
    const d = new Date(ms);
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + pad(m) + " " + ap;
  }
  function icsFor(inst, intention, start) {
    const title = (inst.mold === "countdown" ? "Act on: " : "Check: ") + (inst.title || "Workbench");
    const desc = commitTitle(inst, intention.varId, intention.value) + " " + (NEXT_PHOTO[inst.mold] || "") +
      " Open Workbench and photograph it; it lands on the same instrument.";
    return buildICS({ uid: "wb-" + inst.id + "-" + intention.committedAt, title, description: desc, start,
      minutes: 15, rrule: inst.mold === "perUse" ? "FREQ=WEEKLY;INTERVAL=2;COUNT=6" : null, stamp: nowMs() });
  }
  function planText(inst, intention) {
    const pf = primaryFormat(inst);
    const lines = [
      "Workbench — " + (inst.title || "instrument"),
      "",
      "Promise: " + commitTitle(inst, intention.varId, intention.value),
      "From " + fmt(intention.baseline, pf, inst) + " to " + fmt(intention.target, pf, inst) + ".",
      "Check on: " + fmtDay(intention.checkAt),
      "",
      NEXT_PHOTO[inst.mold] || "",
    ];
    return lines.join("\n").trim() + "\n";
  }
  function pickUrl(r) {
    const u = r && (r.webViewLink || r.url || r.viewUrl || r.alternateLink || (r.file && (r.file.webViewLink || r.file.url)));
    return typeof u === "string" && /^https:\/\//.test(u) ? u : null;
  }
  function guessMinutes(inst) {
    if (inst.mold === "reset") {
      const c = compute(inst);
      const m = c && c.outputs && c.outputs.minutesNeeded;
      if (isNum(m) && m > 0) return Math.round(m);
    }
    if (inst.mold === "dial") return 7;
    return 0;
  }
  function blobDownload(filename, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.rel = "noopener"; a.style.display = "none";
      document.body.appendChild(a); a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) { /* gone */ } }, 4000);
      return true;
    } catch (e) { return false; }
  }
  async function copyText(text, fallbackEl) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand && document.execCommand("copy");
      ta.remove();
      if (ok) return true;
    } catch (e) { /* fall through */ }
    if (fallbackEl) { try { fallbackEl.focus(); fallbackEl.select(); } catch (e) { /* ignore */ } }
    return false;
  }

  /* ------------------------------------------------------------ commit */
  /* commit({id, varId, value, primary, baseline}) : pins the intention, emits intention:created, opens the sheet. */
  function commit(p) {
    if (!p || !p.id || !p.varId || !isNum(p.value)) return null;
    const inst = getInst(p.id);
    if (!inst) return null;
    // the committed lever value is the instrument's value from now on (normally already set on drag end)
    const v = inst.vars && inst.vars[p.varId];
    if (v && v.value !== p.value && has("store", "update")) {
      safe("store.update", () => WB.store.update(p.id, (i) => { if (i.vars && i.vars[p.varId]) i.vars[p.varId].value = p.value; }, "intention"));
    }
    const prevIntention = inst.intention ? JSON.parse(JSON.stringify(inst.intention)) : null;
    const intention = makeIntention(getInst(p.id) || inst, p.varId, p.value, p);
    let ok = false;
    if (has("store", "setIntention")) ok = safe("store.setIntention", () => { WB.store.setIntention(p.id, intention); return true; }, false);
    if (!ok && has("store", "update")) ok = safe("store.update", () => { WB.store.update(p.id, (i) => { i.intention = intention; }, "intention"); return true; }, false);
    if (!ok) { if (has("ui", "toast")) WB.ui.toast("That didn't pin. Try the hold again."); return null; }
    WB.bus.emit("intention:created", { id: p.id, intention });
    return openCommit(p.id, { prev: prevIntention });
  }

  let inited = false;
  function init() {
    if (inited || !WB.bus) return;
    inited = true;
    WB.bus.on("instrument:commit", (p) => { commit(p); });
    WB.bus.on("caps:changed", (p) => { if (p && p.caps) lastCaps = p.caps; });
    WB.bus.on("app:ready", (p) => { if (p && p.caps) lastCaps = p.caps; });
  }

  WB.actions = {
    init, commit, openCommit, chooseAct, actOptions, commitTitle, buildICS, reminderStart, markAction, errText,
    _test: { icsFold, icsText, makeIntention, purposesFor },
  };
})();
