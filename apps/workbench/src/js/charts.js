/* ---- Workbench charts (Victor) ----
   Four hand-drawn chart types (costOverTime, timeline with a draggable cursor, stackedBar, gauge),
   the ghost "promise" band (dashed intention line + solid observation dots + the gap), and the 60x18 spark.
   Pure SVG strings rebuilt per frame: cheap enough to run on every pointermove during a scrub.
   Pointer handling lives on the persistent container, so rebuilding the SVG never drops a drag.
   Registers functions only: no DOM work and no calls into other modules at load. */
(function () {
  "use strict";
  const WB = window.WB;

  const DAY = 86400000;
  const states = new WeakMap();

  /* ---------------------------------------------------------------- helpers */
  const U = () => (WB && WB.util) || {};
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = (n) => Math.round(n * 10) / 10;
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    const u = U();
    if (typeof u.escapeHTML === "function") return u.escapeHTML(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
  }
  function reduced() {
    const u = U();
    if (typeof u.reducedMotion === "function") return u.reducedMotion();
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }
  function molds() { return (WB && WB.molds) || null; }
  function fmt(v, format, inst, o) {
    const m = molds();
    if (m && typeof m.format === "function") {
      try { return m.format(v, format, inst, o); } catch (e) { /* fall through */ }
    }
    if (!isNum(v)) return "—";
    if (format === "usd") {
      const u = U();
      return typeof u.fmtUSD === "function" ? u.fmtUSD(v) : "$" + Math.round(v).toLocaleString("en-US");
    }
    if (format === "pct") return Math.round(v) + "%";
    if (format === "days") return Math.round(v) + (Math.round(v) === 1 ? " day" : " days");
    return String(r1(v));
  }
  function fmtDayOffset(day) {
    const ms = Date.now() + Math.round(day) * DAY;
    const u = U();
    if (typeof u.fmtDay === "function") return u.fmtDay(ms);
    const d = new Date(ms);
    return d.toDateString().slice(0, 10);
  }
  function fmtDayMs(ms) {
    const u = U();
    if (typeof u.fmtDay === "function") return u.fmtDay(ms);
    return new Date(ms).toDateString().slice(0, 10);
  }
  const upper = (s) => String(s == null ? "" : s).toUpperCase();
  // approximate text width for IBM Plex Mono (0.6em advance)
  const monoW = (s, size) => String(s).length * size * 0.6;

  function primaryFormat(inst) {
    const m = molds();
    const def = inst && m && typeof m.get === "function" ? m.get(inst.mold) : null;
    if (def && def.outputs && def.outputs[def.primary]) return def.outputs[def.primary].format;
    return "num";
  }
  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const m = raw / p;
    const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * p;
  }
  function ptsPath(pts) {
    return pts.map((p, i) => (i ? "L" : "M") + r1(p[0]) + " " + r1(p[1])).join("");
  }

  /* ---------------------------------------------------------------- costOverTime */
  function drawCost(st, W, H, P) {
    const s = st.series, o = st.opts, inst = o.inst;
    const lines = Array.isArray(s.lines) ? s.lines : [];
    const now = lines.find((l) => l.id === "now") || lines[0];
    const tgt = lines.find((l) => l.id === "target") || lines[1];
    const months = s.months || 12;
    const x0 = 10, x1 = W - 84, y0 = 16, y1 = H - 22;
    let need = 1;
    lines.forEach((l) => (l.values || []).forEach((v) => { if (isNum(v)) need = Math.max(need, v); }));
    const max = scaleMax(st, need * 1.06);
    const x = (i) => x0 + (i / months) * (x1 - x0);
    const y = (v) => y1 - (clamp(v, 0, max) / max) * (y1 - y0);
    const pts = (l) => [[x(0), y(0)]].concat((l.values || []).map((v, i) => [x(i + 1), y(isNum(v) ? v : 0)]));

    // month ticks + axis
    for (let i = 0; i <= months; i++) {
      const tx = r1(x(i));
      P.push('<line class="ch-tick" x1="' + tx + '" x2="' + tx + '" y1="' + y1 + '" y2="' + (y1 + (i % 6 === 0 ? 5 : 3)) + '"/>');
    }
    P.push('<line class="ch-axis" x1="' + x0 + '" x2="' + x1 + '" y1="' + y1 + '" y2="' + y1 + '"/>');
    P.push('<text class="ch-lbl" x="' + x0 + '" y="' + (H - 4) + '">NOW</text>');
    P.push('<text class="ch-lbl" x="' + r1(x(months / 2)) + '" y="' + (H - 4) + '" text-anchor="middle">6 MO</text>');
    P.push('<text class="ch-lbl" x="' + r1(x1) + '" y="' + (H - 4) + '" text-anchor="end">1 YR</text>');

    if (now && tgt) {
      const a = pts(now), b = pts(tgt);
      const lastNow = (now.values || [])[months - 1] || 0, lastT = (tgt.values || [])[months - 1] || 0;
      const area = ptsPath(a) + b.slice().reverse().map((p) => "L" + r1(p[0]) + " " + r1(p[1])).join("") + "Z";
      P.push('<path class="' + (lastT <= lastNow ? "ch-kept" : "ch-extra") + '" d="' + area + '"/>');
      P.push('<path class="ch-line ch-line--now" d="' + ptsPath(a) + '"/>');
      P.push('<path class="ch-line ch-line--target" d="' + ptsPath(b) + '"/>');
      // end labels, kept apart vertically
      let ya = y(lastNow), yb = y(lastT);
      if (Math.abs(ya - yb) < 24) {
        const mid = (ya + yb) / 2;
        if (lastNow >= lastT) { ya = mid - 12; yb = mid + 12; } else { ya = mid + 12; yb = mid - 12; }
      }
      ya = clamp(ya, y0 + 2, y1 - 2); yb = clamp(yb, y0 + 2, y1 + 6);
      endLabel(P, x1 + 8, ya, fmt(lastNow, "usd", inst), upper(now.label || "as it is"), "now");
      endLabel(P, x1 + 8, yb, fmt(lastT, "usd", inst), upper(tgt.label || "your number"), "target");
      st.summary = "Cost over a year: " + fmt(lastNow, "usd", inst) + " as it is, " + fmt(lastT, "usd", inst) + " at your number.";
    } else if (now) {
      P.push('<path class="ch-line ch-line--now" d="' + ptsPath(pts(now)) + '"/>');
      st.summary = "Cost over a year.";
    }
  }
  function endLabel(P, x, y, value, label, kind) {
    P.push('<text class="ch-end ch-end--' + kind + '" x="' + r1(x) + '" y="' + r1(y + 1) + '">' + esc(value) + "</text>");
    P.push('<text class="ch-lbl ch-lbl--' + kind + '" x="' + r1(x) + '" y="' + r1(y + 11) + '">' + esc(label.length > 13 ? label.slice(0, 12) + "…" : label) + "</text>");
  }
  function scaleMax(st, need) {
    // during a live drag the scale only grows, so the curve visibly bends instead of the axis rescaling under it
    if (st.opts.live && st.sticky && isNum(st.sticky.max)) {
      st.sticky.max = Math.max(st.sticky.max, need);
      return st.sticky.max;
    }
    if (st.opts.live) st.sticky = { max: need };
    return need;
  }

  /* ---------------------------------------------------------------- timeline */
  function drawTimeline(st, W, H, P) {
    const s = st.series, o = st.opts, inst = o.inst;
    const span = Math.max(1, s.span || 7);
    const marks = Array.isArray(s.marks) ? s.marks : [];
    const x0 = 14, x1 = W - 14, yTop = 30, yBase = H - 30;
    const x = (d) => x0 + (clamp(d, 0, span) / span) * (x1 - x0);
    const isCountdown = marks.some((m) => m.state === "deadline" || m.state === "actBy");
    const cur = s.cursor || null;

    // day ticks
    const every = span <= 14 ? 1 : span <= 60 ? 7 : span <= 180 ? 14 : 30;
    for (let d = 0; d <= span + 1e-9; d += every) {
      const tx = r1(x(d));
      P.push('<line class="ch-tick" x1="' + tx + '" x2="' + tx + '" y1="' + yBase + '" y2="' + (yBase + 4) + '"/>');
    }
    P.push('<line class="ch-axis" x1="' + x0 + '" x2="' + x1 + '" y1="' + yBase + '" y2="' + yBase + '"/>');

    let curDay = null;
    if (cur && isNum(cur.day)) curDay = clamp(cur.day, 0, span);

    if (!isCountdown) {
      // decay clock: the zone inside the horizon, items as numbered dots
      if (curDay != null) P.push('<rect class="ch-zone" x="' + x0 + '" y="' + yTop + '" width="' + r1(Math.max(0, x(curDay) - x0)) + '" height="' + (yBase - yTop) + '"/>');
      P.push('<text class="ch-lbl" x="' + x0 + '" y="' + (H - 12) + '">TODAY</text>');
      P.push('<text class="ch-lbl" x="' + x1 + '" y="' + (H - 12) + '" text-anchor="end">' + esc(span + " DAYS") + "</text>");
      const items = marks.filter((m) => m.state !== "today");
      const stacks = {};
      let risk = 0, kept = 0;
      items.forEach((m, i) => {
        const key = Math.round(clamp(m.day, 0, span) * 2) / 2;
        const k = stacks[key] = (stacks[key] || 0) + 1;
        const col = Math.floor((k - 1) / 4), row = (k - 1) % 4;
        const cx = clamp(x(m.day) + col * 13, x0 + 9, x1 - 9);
        const cy = yBase - 12 - row * 21;
        const cls = m.state === "risk" ? "risk" : m.state === "saved" ? "saved" : "safe";
        if (cls === "risk") risk += isNum(m.value) ? m.value : 0;
        if (cls === "saved") kept += isNum(m.value) ? m.value : 0;
        P.push('<g class="ch-dot ch-dot--' + cls + '" data-id="' + esc(m.id) + '"><circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="9"/>' +
          '<text x="' + r1(cx) + '" y="' + r1(cy + 3.5) + '" text-anchor="middle">' + (i + 1) + "</text></g>");
      });
      st.summary = items.length + " items over " + span + " days; " + fmt(risk, "usd", inst) + " at risk, " + fmt(kept, "usd", inst) + " cooked tonight.";
    } else {
      // deadline: today, act-by (the lever), deadline (the fact)
      const today = marks.find((m) => m.state === "today");
      const act = marks.find((m) => m.state === "actBy");
      const dl = marks.find((m) => m.state === "deadline");
      const yMid = yBase;
      if (act && dl) {
        P.push('<rect class="ch-slack" x="' + r1(x(act.day)) + '" y="' + (yMid - 10) + '" width="' + r1(Math.max(0, x(dl.day) - x(act.day))) + '" height="10"/>');
      }
      if (today) {
        P.push('<line class="ch-mark ch-mark--today" x1="' + x0 + '" x2="' + x0 + '" y1="' + (yMid - 16) + '" y2="' + (yMid + 4) + '"/>');
        P.push('<text class="ch-lbl" x="' + x0 + '" y="' + (H - 12) + '">TODAY</text>');
      }
      const anchorAt = (px, w) => (px > W - w / 2 - 4 ? "end" : px < w / 2 + 4 ? "start" : "middle");
      if (dl) {
        const dx = x(dl.day);
        P.push('<line class="ch-mark ch-mark--deadline" x1="' + r1(dx) + '" x2="' + r1(dx) + '" y1="' + (yTop + 4) + '" y2="' + (yMid + 4) + '"/>');
        const lbl = "DEADLINE " + upper(fmtDayOffset(dl.day));
        P.push('<text class="ch-lbl ch-lbl--ink" x="' + r1(dx) + '" y="' + (H - 12) + '" text-anchor="' + anchorAt(dx, monoW(lbl, 9.5)) + '">' + esc(lbl) + "</text>");
        if (isNum(dl.value) && dl.value > 0) {
          const sv = fmt(dl.value, "usd", inst);
          const right = dx > W - 60;
          P.push('<text class="ch-end" x="' + r1(right ? dx - 6 : dx + 6) + '" y="' + (yTop + 16) + '" text-anchor="' + (right ? "end" : "start") + '">' + esc(sv) + "</text>");
        }
      }
      if (act) {
        const ax = x(act.day);
        const lbl = "ACT BY " + upper(fmtDayOffset(act.day));
        const w = monoW(lbl, 9.5);
        // sits just left of the cursor line, above the rule; flips right when there is no room
        const left = ax - 6 - w >= x0;
        P.push('<text class="ch-lbl ch-lbl--act" x="' + r1(left ? ax - 6 : ax + 6) + '" y="' + (yMid - 16) + '" text-anchor="' + (left ? "end" : "start") + '">' + esc(lbl) + "</text>");
      }
      const dlDays = dl ? Math.round(dl.day) : 0;
      st.summary = "Deadline in " + dlDays + (dlDays === 1 ? " day" : " days") + (act ? "; act by " + fmtDayOffset(act.day) + "." : ".");
    }

    // the cursor: a draggable vertical line bound to a var
    if (cur && curDay != null) {
      const cx = x(curDay);
      const label = cursorLabel(st, cur, curDay);
      const lw = monoW(label, 11) + 14;
      const lx = clamp(cx - lw / 2, 2, W - lw - 2);
      const drag = st.drag && st.drag.active ? " is-dragging" : "";
      const ro = o.readOnly || typeof o.onCursor !== "function" ? " is-static" : "";
      P.push('<g class="ch-cursor' + drag + ro + '">' +
        '<line class="ch-cursor__line" x1="' + r1(cx) + '" x2="' + r1(cx) + '" y1="' + (yTop - 4) + '" y2="' + (yBase + 2) + '"/>' +
        '<rect class="ch-cursor__pill" x="' + r1(lx) + '" y="2" width="' + r1(lw) + '" height="18" rx="9"/>' +
        '<text class="ch-cursor__text" x="' + r1(lx + lw / 2) + '" y="15" text-anchor="middle">' + esc(label) + "</text>" +
        '<line class="ch-cursor__stem" x1="' + r1(cx) + '" x2="' + r1(cx) + '" y1="20" y2="' + (yTop - 4) + '"/>' +
        '<circle class="ch-cursor__knob" cx="' + r1(cx) + '" cy="' + (yBase + 2) + '" r="5"/></g>');
    }
    st.geo = { x0, x1, span, cursor: cur, curDay };
  }
  function cursorLabel(st, cur, curDay) {
    const inst = st.opts.inst;
    const v = cursorValueFromDay(st, cur, curDay);
    const meta = inst && inst.vars && inst.vars[cur.varId];
    const f = (meta && meta.format) || "days";
    const txt = fmt(v, f, inst);
    if (cur.varId === "lead" || cur.map === "fromEnd") return upper(txt) + " EARLY";
    return upper(txt);
  }
  function cursorMap(st, cur) {
    if (cur.map) return cur.map;
    return cur.varId === "lead" ? "fromEnd" : "direct";
  }
  function cursorRef(st, cur) {
    if (isNum(cur.ref)) return cur.ref;
    const dl = (st.series.marks || []).find((m) => m.state === "deadline");
    return dl ? dl.day : st.series.span || 0;
  }
  function cursorValueFromDay(st, cur, day) {
    return cursorMap(st, cur) === "fromEnd" ? cursorRef(st, cur) - day : day;
  }

  /* ---------------------------------------------------------------- stackedBar */
  function drawBars(st, W, H, P) {
    const s = st.series, inst = st.opts.inst;
    const bars = Array.isArray(s.bars) ? s.bars.slice(0, 3) : [];
    const lx = 10, bx0 = 76, bx1 = W - 82;
    const total = (b) => (b.parts || []).reduce((a, p) => a + (isNum(p.value) ? Math.max(0, p.value) : 0), 0);
    const max = scaleMax(st, Math.max(1, ...bars.map(total)) * 1.02);
    const xw = (v) => (Math.max(0, v) / max) * (bx1 - bx0);
    const rowH = 24, gap = 24, top = 18;
    const totals = bars.map(total);
    bars.forEach((b, i) => {
      const y = top + i * (rowH + gap);
      P.push('<text class="ch-lbl ch-lbl--ink" x="' + lx + '" y="' + r1(y + rowH / 2 + 4) + '">' + esc(upper(b.label || b.id)) + "</text>");
      let cx = bx0;
      (b.parts || []).forEach((p) => {
        const w = xw(p.value);
        if (w <= 0) return;
        P.push('<rect class="ch-bar ch-bar--' + esc(p.id) + '" x="' + r1(cx) + '" y="' + y + '" width="' + r1(w) + '" height="' + rowH + '"/>');
        cx += w;
      });
      P.push('<text class="ch-end" x="' + r1(cx + 8) + '" y="' + r1(y + rowH / 2 + 4) + '">' + esc(fmt(totals[i], "usd", inst)) + "</text>");
      if (i === 1 && bars[0]) {
        const diff = totals[0] - totals[1];
        const xa = bx0 + xw(totals[1]), xb = bx0 + xw(totals[0]);
        if (Math.abs(xb - xa) >= 1) {
          const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
          P.push('<rect class="ch-bar ' + (diff >= 0 ? "ch-bar--saved" : "ch-bar--over") + '" x="' + r1(lo) + '" y="' + (y + 0.5) + '" width="' + r1(hi - lo) + '" height="' + (rowH - 1) + '"/>');
        }
        const lbl = (diff >= 0 ? "−" : "+") + fmt(Math.abs(diff), "usd", inst, { whole: true }) + " A YEAR";
        P.push('<text class="ch-lbl ' + (diff >= 0 ? "ch-lbl--good" : "ch-lbl--warn") + '" x="' + bx0 + '" y="' + (y + rowH + 14) + '">' + esc(lbl) + "</text>");
      }
    });
    // legend
    const ly = H - 8;
    P.push('<rect class="ch-bar ch-bar--fixed" x="' + bx0 + '" y="' + (ly - 8) + '" width="9" height="9"/>');
    P.push('<text class="ch-lbl" x="' + (bx0 + 14) + '" y="' + ly + '">FIXED</text>');
    P.push('<rect class="ch-bar ch-bar--usage" x="' + (bx0 + 64) + '" y="' + (ly - 8) + '" width="9" height="9"/>');
    P.push('<text class="ch-lbl" x="' + (bx0 + 78) + '" y="' + ly + '">USAGE</text>');
    st.summary = bars.map((b, i) => (b.label || b.id) + " " + fmt(totals[i], "usd", inst) + " a year").join(", ") + ".";
  }

  /* ---------------------------------------------------------------- gauge */
  function drawGauge(st, W, H, P) {
    const s = st.series, o = st.opts, inst = o.inst;
    const isPct = s.unit === "%";
    const f = (v) => (isPct ? fmt(v, "pct", inst) : fmt(v, "usd", inst));
    const min = isNum(s.min) ? s.min : 0;
    let max = isNum(s.max) && s.max > min ? s.max : min + 1;
    const x0 = 14, x1 = W - 14, ty = 82;
    const x = (v) => x0 + ((clamp(v, min, max) - min) / (max - min)) * (x1 - x0);
    // ticks
    const step = niceStep(max - min, W < 340 ? 4 : 5);
    for (let v = min; v <= max + step * 1e-6; v += step) {
      const tx = r1(x(v));
      P.push('<line class="ch-tick" x1="' + tx + '" x2="' + tx + '" y1="' + (ty + 4) + '" y2="' + (ty + 9) + '"/>');
      const anchor = tx < x0 + 18 ? "start" : tx > x1 - 18 ? "end" : "middle";
      P.push('<text class="ch-lbl" x="' + tx + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + esc(f(v)) + "</text>");
    }
    P.push('<line class="ch-axis" x1="' + x0 + '" x2="' + x1 + '" y1="' + (ty + 4) + '" y2="' + (ty + 4) + '"/>');
    const th = isNum(s.threshold) ? s.threshold : null;
    const better = (molds() && inst && molds().get && molds().get(inst.mold) && molds().get(inst.mold).better) || "lower";
    if (th != null && th > min && th < max * 1.5) {
      const thx = x(th);
      if (better === "lower") P.push('<rect class="ch-over" x="' + r1(thx) + '" y="' + (ty - 4) + '" width="' + r1(Math.max(0, x1 - thx)) + '" height="8"/>');
      // keep the dashed marker out of the needle's reading: split it where the reading text sits
      const rv = isNum(s.value) ? s.value : min, rRead = f(rv), rLbl = s.label ? " " + s.label : "";
      const rtw = monoW(rRead, 16) + monoW(rLbl, 11), rrx = clamp(x(rv) - rtw / 2, 2, W - rtw - 2);
      if (thx > rrx - 4 && thx < rrx + rtw + 4) {
        P.push('<line class="ch-threshold" x1="' + r1(thx) + '" x2="' + r1(thx) + '" y1="' + (ty - 44) + '" y2="' + (ty - 40) + '"/>');
        P.push('<line class="ch-threshold" x1="' + r1(thx) + '" x2="' + r1(thx) + '" y1="' + (ty - 16) + '" y2="' + (ty + 9) + '"/>');
      } else P.push('<line class="ch-threshold" x1="' + r1(thx) + '" x2="' + r1(thx) + '" y1="' + (ty - 44) + '" y2="' + (ty + 9) + '"/>');
      const tl = (isPct ? "PLANNED " : "THE ALTERNATIVE ") + f(th);
      const anchor = thx > W - 90 ? "end" : thx < 90 ? "start" : "middle";
      P.push('<text class="ch-lbl ch-lbl--ink" x="' + r1(thx) + '" y="' + (ty - 48) + '" text-anchor="' + anchor + '">' + esc(tl) + "</text>");
    }
    const v = isNum(s.value) ? s.value : min;
    const vx = x(v);
    P.push('<rect class="ch-gauge__track" x="' + x0 + '" y="' + (ty - 3) + '" width="' + (x1 - x0) + '" height="6"/>');
    P.push('<rect class="ch-gauge__fill" x="' + x0 + '" y="' + (ty - 3) + '" width="' + r1(Math.max(0, vx - x0)) + '" height="6"/>');
    // secondary marker: the value at your lever setting
    const sec = o.secondary && isNum(o.secondary.value) ? o.secondary : null;
    if (sec) {
      const sx = x(sec.value);
      P.push('<circle class="ch-gauge__sec" cx="' + r1(sx) + '" cy="' + ty + '" r="5"/>');
      const sl = upper(sec.label || "at your number") + " " + f(sec.value);
      const anchor = sx > W - 100 ? "end" : sx < 100 ? "start" : "middle";
      P.push('<text class="ch-lbl ch-lbl--target" x="' + r1(sx) + '" y="' + (ty + 24) + '" text-anchor="' + anchor + '">' + esc(sl) + "</text>");
    }
    // the needle and its reading
    P.push('<path class="ch-needle" d="M' + r1(vx - 6) + " " + (ty - 14) + "L" + r1(vx + 6) + " " + (ty - 14) + "L" + r1(vx) + " " + (ty - 4) + 'Z"/>');
    const read = f(v);
    const lbl = s.label ? " " + s.label : "";
    const tw = monoW(read, 16) + monoW(lbl, 11);
    const rx = clamp(vx - tw / 2, 2, W - tw - 2);
    P.push('<text class="ch-read" x="' + r1(rx) + '" y="' + (ty - 22) + '">' + esc(read) + '<tspan class="ch-read__unit">' + esc(lbl) + "</tspan></text>");
    st.summary = "Reading " + read + lbl + (th != null ? "; the alternative is " + f(th) : "") + ".";
  }

  /* ---------------------------------------------------------------- ghost band */
  function ghostOf(st) {
    const o = st.opts;
    if (o.ghost === false) return null;
    let g = o.ghost && typeof o.ghost === "object" ? o.ghost : null;
    if (!g && o.inst && molds() && typeof molds().ghost === "function") {
      try { g = molds().ghost(o.inst); } catch (e) { g = null; }
    }
    if (!g) return null;
    const pts = Array.isArray(g.points) ? g.points.filter((p) => isNum(p.t) && isNum(p.v)) : [];
    if (g.status === "none" && pts.length < 2) return null;
    return Object.assign({}, g, { points: pts });
  }

  function drawGhost(st, g, W, top, bandH, P) {
    const inst = st.opts.inst;
    const pf = primaryFormat(inst);
    const f = (v) => fmt(v, pf, inst);
    const now = Date.now();
    const has = g.status && g.status !== "none" && isNum(g.baseline);
    let pts = g.points;
    const x0 = 12, x1 = W - 76, y0 = top + 30, y1 = top + bandH - 22;
    let t0 = Infinity, t1 = -Infinity;
    if (has && isNum(g.start) && isNum(g.end)) {
      // the promise owns the axis: a little before the commit, through the check day (and today, if later)
      const span = Math.max(DAY, g.end - g.start);
      t0 = g.start - span * 0.35;
      t1 = Math.max(g.end, now, pts.length ? pts[pts.length - 1].t : 0);
      // readings from long before the promise are folded onto the left edge as one "before" point
      const early = pts.filter((p) => p.t < t0);
      const lastEarly = early.length ? Object.assign({}, early[early.length - 1], { t: t0, folded: true }) : null;
      pts = (lastEarly ? [lastEarly] : []).concat(pts.filter((p) => p.t >= t0));
    } else {
      const ts = pts.map((p) => p.t).concat([now]);
      ts.forEach((t) => { t0 = Math.min(t0, t); t1 = Math.max(t1, t); });
    }
    if (!(t1 > t0)) { t0 -= DAY; t1 += DAY; }
    const pad = (t1 - t0) * 0.03; t0 -= pad; t1 += pad;
    const vs = pts.map((p) => p.v);
    if (has) { vs.push(g.baseline); if (isNum(g.target)) vs.push(g.target); }
    let v0 = Math.min(...vs), v1 = Math.max(...vs);
    if (!(v1 > v0)) { const d = Math.abs(v1) * 0.1 || 1; v0 -= d; v1 += d; }
    const vp = (v1 - v0) * 0.12; v0 -= vp; v1 += vp;
    const x = (t) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
    const y = (v) => y1 - ((v - v0) / (v1 - v0)) * (y1 - y0);

    P.push('<line class="ch-rule" x1="0" x2="' + W + '" y1="' + (top + 0.5) + '" y2="' + (top + 0.5) + '"/>');
    P.push('<text class="ch-lbl ch-lbl--ink" x="' + x0 + '" y="' + (top + 15) + '">' + (has ? "THE PROMISE" : "READINGS") + "</text>");
    if (has) {
      let st8 = "CHECK " + upper(fmtDayMs(g.end));
      let cls = "";
      if (g.due) { st8 = "CHECK-IN DUE"; cls = " ch-lbl--signal"; }
      else if (g.status === "held") { st8 = "HELD"; cls = " ch-lbl--good"; }
      else if (g.status === "missed") { st8 = "MISSED"; cls = " ch-lbl--warn"; }
      else if (g.status === "closer") { st8 = "CLOSER"; cls = " ch-lbl--good"; }
      P.push('<text class="ch-lbl' + cls + '" x="' + (W - 12) + '" y="' + (top + 15) + '" text-anchor="end">' + esc(st8) + "</text>");
    }
    // today
    const nx = r1(x(now));
    P.push('<line class="ch-today" x1="' + nx + '" x2="' + nx + '" y1="' + (y0 - 4) + '" y2="' + y1 + '"/>');

    let ghostAt = null;
    if (has && isNum(g.target) && isNum(g.start) && isNum(g.end)) {
      const ink = st.opts.ink && !reduced() ? " ch-ghost--ink" : "";
      P.push('<path class="ch-ghost' + ink + '" d="M' + r1(x(g.start)) + " " + r1(y(g.baseline)) + "L" + r1(x(g.end)) + " " + r1(y(g.target)) + '"/>');
      P.push('<circle class="ch-ghost__end' + ink + '" cx="' + r1(x(g.end)) + '" cy="' + r1(y(g.target)) + '" r="2.5"/>');
      P.push('<text class="ch-end ch-end--ghost' + ink + '" x="' + r1(x(g.end) + 8) + '" y="' + r1(clamp(y(g.target) + 4, y0 + 4, y1 + 4)) + '">' + esc(f(g.target)) + "</text>");
      ghostAt = (t) => {
        const k = clamp((t - g.start) / Math.max(1, g.end - g.start), 0, 1);
        return g.baseline + (g.target - g.baseline) * k;
      };
    }
    // time axis: the commit and the check day, so same-week readings spread out instead of stacking on the baseline
    if (has && isNum(g.start) && isNum(g.end)) {
      const ya = y1 + 14;
      P.push('<line class="ch-rule" x1="' + r1(x(g.start)) + '" x2="' + r1(x(g.start)) + '" y1="' + (y1 + 2) + '" y2="' + (y1 + 5) + '"/>');
      P.push('<line class="ch-rule" x1="' + r1(x(g.end)) + '" x2="' + r1(x(g.end)) + '" y1="' + (y1 + 2) + '" y2="' + (y1 + 5) + '"/>');
      P.push('<text class="ch-lbl" x="' + r1(Math.max(x0, x(g.start) - 4)) + '" y="' + ya + '">' + esc(upper(fmtDayMs(g.start))) + "</text>");
      P.push('<text class="ch-lbl" x="' + r1(Math.min(W - 12, x(g.end) + 4)) + '" y="' + ya + '" text-anchor="end">' + esc(upper(fmtDayMs(g.end))) + "</text>");
    }
    // a hollow reading (built on a guess) is drawn open and never scores the promise
    const solid = pts.filter((p) => !p.hollow);
    if (solid.length > 1) P.push('<path class="ch-obs-line" d="' + ptsPath(solid.map((p) => [x(p.t), y(p.v)])) + '"/>');
    pts.forEach((p) => { P.push('<circle class="ch-obs' + (p.hollow ? " ch-obs--hollow" : "") + '" cx="' + r1(x(p.t)) + '" cy="' + r1(y(p.v)) + '" r="3"/>'); });
    const last = solid[solid.length - 1] || (has ? null : pts[pts.length - 1]);
    if (last) {
      const lx = x(last.t), ly = y(last.v);
      if (ghostAt && last.t > g.start) {
        const gv = ghostAt(last.t);
        const diff = last.v - gv;
        const better = (molds() && molds().get && molds().get(inst.mold) && molds().get(inst.mold).better) || "lower";
        const ahead = better === "lower" ? diff <= 0 : diff >= 0;
        P.push('<line class="ch-gap ' + (ahead ? "ch-gap--good" : "ch-gap--warn") + '" x1="' + r1(lx) + '" x2="' + r1(lx) + '" y1="' + r1(ly) + '" y2="' + r1(y(gv)) + '"/>');
        const gl = (Math.abs(diff) < 1e-6 ? "ON THE LINE" : "GAP " + f(Math.abs(diff)));
        // the label sits in clear space above both the reading and the line, never on the dashes
        const gw = monoW(gl, 9);
        const gx = lx + 6 + gw <= x1 ? lx + 6 : Math.max(x0, lx - 6 - gw);
        const gy = Math.max(top + 26, Math.min(ly, y(gv)) - 8);
        P.push('<text class="ch-lbl ch-lbl--gap ' + (ahead ? "ch-lbl--good" : "ch-lbl--warn") + '" x="' + r1(gx) + '" y="' + r1(gy) + '">' + esc(gl) + "</text>");
      } else if (!has) {
        P.push('<text class="ch-end" x="' + r1(Math.min(lx + 8, W - 12 - monoW(f(last.v), 12))) + '" y="' + r1(clamp(ly + 4, y0 + 4, y1)) + '">' + esc(f(last.v)) + "</text>");
      }
    }
    st.summary = (st.summary || "") + (has ? " Promise: " + f(g.baseline) + " to " + f(g.target) + ", status " + (g.due ? "due" : g.status) + "." : " " + pts.length + " readings.");
  }

  /* ---------------------------------------------------------------- draw */
  function width(st) {
    const w = st.el.clientWidth || (st.el.getBoundingClientRect ? st.el.getBoundingClientRect().width : 0) || 340;
    return Math.max(240, Math.round(w));
  }
  function draw(st) {
    const o = st.opts, s = st.series;
    const W = width(st);
    const mainH = o.height || 140;
    const g = o.compact ? null : ghostOf(st);
    // the ghost line is the one score in the app: it gets real room once there is a promise
    const bandH = g ? (g.status && g.status !== "none" ? 124 : 84) : 0;
    const H = mainH + bandH;
    const P = [];
    st.summary = "";
    st.geo = null;
    if (!s || !s.type) {
      P.push('<text class="ch-lbl" x="' + W / 2 + '" y="' + mainH / 2 + '" text-anchor="middle">NO CHART FOR THIS ONE</text>');
    } else if (s.type === "costOverTime") drawCost(st, W, mainH, P);
    else if (s.type === "timeline") drawTimeline(st, W, mainH, P);
    else if (s.type === "stackedBar") drawBars(st, W, mainH, P);
    else if (s.type === "gauge") drawGauge(st, W, mainH, P);
    if (g) drawGhost(st, g, W, mainH + 4, bandH - 4, P);
    const svg = st.svg;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.innerHTML = P.join("");
    svg.setAttribute("aria-label", st.summary || "Chart");
    st.el.classList.toggle("ch--cursor", !!(st.geo && st.geo.cursor && !o.readOnly && typeof o.onCursor === "function"));
    st.el.dataset.type = (s && s.type) || "none";
  }

  /* ---------------------------------------------------------------- cursor dragging */
  function cursorValueAt(st, clientX) {
    const geo = st.geo;
    if (!geo || !geo.cursor) return null;
    const rect = st.svg.getBoundingClientRect();
    const sx = rect.width ? (parseFloat(st.svg.getAttribute("width")) || rect.width) / rect.width : 1;
    const px = (clientX - rect.left) * sx;
    const day = clamp(((px - geo.x0) / (geo.x1 - geo.x0)) * geo.span, 0, geo.span);
    let v = cursorValueFromDay(st, geo.cursor, day);
    const rg = st.opts.cursorRange;
    const step = rg && rg.step > 0 ? rg.step : 1;
    v = Math.round(v / step) * step;
    if (rg) v = clamp(v, isNum(rg.min) ? rg.min : -Infinity, isNum(rg.max) ? rg.max : Infinity);
    return Math.round(v * 1e6) / 1e6;
  }
  function bindPointer(st) {
    const el = st.el;
    const active = () => st.geo && st.geo.cursor && !st.opts.readOnly && typeof st.opts.onCursor === "function";
    const send = (v, phase) => { try { st.opts.onCursor(st.geo.cursor.varId, v, phase); } catch (err) { console.error("[WB.charts] onCursor", err); } };
    const onDown = (e) => {
      if (!active() || (e.button != null && e.button !== 0)) return;
      st.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, active: false, last: null };
    };
    const onMove = (e) => {
      const d = st.drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.active) {
        const dx = Math.abs(e.clientX - d.sx), dy = Math.abs(e.clientY - d.sy);
        if (dy > 8 && dy > dx) { st.drag = null; return; }
        if (dx < 6) return;
        d.active = true;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        el.classList.add("is-dragging");
        send(cursorValueAt(st, d.sx), "start");
      }
      e.preventDefault();
      const v = cursorValueAt(st, e.clientX);
      if (v != null && v !== d.last) { d.last = v; send(v, "move"); }
    };
    const onUp = (e) => {
      const d = st.drag;
      if (!d || e.pointerId !== d.id) return;
      st.drag = null;
      el.classList.remove("is-dragging");
      if (e.type === "pointercancel") { if (d.active) send(d.last, "end"); return; }
      if (d.active) { send(d.last != null ? d.last : cursorValueAt(st, e.clientX), "end"); return; }
      // a tap on the timeline sets the cursor there
      if (Math.abs(e.clientX - d.sx) < 6 && Math.abs(e.clientY - d.sy) < 6) {
        const v = cursorValueAt(st, e.clientX);
        if (v != null) { send(v, "start"); send(v, "end"); }
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }

  function create(el) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ch-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("focusable", "false");
    el.classList.add("ch");
    el.appendChild(svg);
    const st = { el, svg, opts: {}, series: null, sticky: null, drag: null, geo: null, summary: "" };
    const unbind = bindPointer(st);
    st.handle = {
      el,
      update(input, opts) { return render(el, input, opts); },
      redraw() { if (st.series || st.opts) draw(st); },
      summary() { return st.summary; },
      destroy() {
        unbind();
        if (svg.parentNode) svg.parentNode.removeChild(svg);
        el.classList.remove("ch", "ch--cursor", "is-dragging");
        states.delete(el);
      },
    };
    return st;
  }

  /* render(el, series | instrument, opts) -> handle
     opts: {inst, overrides, ghost (object | false), live, ink, onCursor(varId, value, phase), cursorRange {min,max,step},
            secondary {value,label}, readOnly, height, compact} */
  function render(el, input, opts) {
    if (!el || typeof document === "undefined") return null;
    let o = Object.assign({}, opts || {});
    let series = input;
    if (input && typeof input === "object" && input.mold && !input.type) {
      o.inst = o.inst || input;
      const m = molds();
      let c = null;
      try { c = m && typeof m.compute === "function" ? m.compute(input, o.overrides) : null; } catch (e) { c = null; }
      series = c ? c.series : null;
    }
    let st = states.get(el);
    if (!st) { st = create(el); states.set(el, st); }
    if (!o.live) st.sticky = null;
    st.opts = o;
    st.series = series || null;
    try { draw(st); } catch (err) { console.error("[WB.charts] render", err); }
    return st.handle;
  }

  /* renderSpark(instrument | ghost, {w, h}) -> SVGElement (stringifies to its markup) */
  function renderSpark(input, opts) {
    const o = opts || {};
    const W = o.w || 60, H = o.h || 18;
    let g = null;
    if (input && input.mold) {
      try { g = molds() && typeof molds().ghost === "function" ? molds().ghost(input) : null; } catch (e) { g = null; }
      if (!g) g = { status: "none", points: (input.observations || []).map((x) => ({ t: x.t, v: x.value })) };
    } else g = input || { status: "none", points: [] };
    const pts = (g.points || []).filter((p) => isNum(p.t) && isNum(p.v)).slice(-12);
    const has = g.status && g.status !== "none" && isNum(g.baseline) && isNum(g.target) && isNum(g.start) && isNum(g.end);
    const now = Date.now();
    const ts = pts.map((p) => p.t);
    const vs = pts.map((p) => p.v);
    if (has) { ts.push(g.start, g.end); vs.push(g.baseline, g.target); }
    ts.push(now);
    let t0 = Math.min(...ts), t1 = Math.max(...ts);
    if (!(t1 > t0)) { t0 -= DAY; t1 += DAY; }
    let v0 = vs.length ? Math.min(...vs) : 0, v1 = vs.length ? Math.max(...vs) : 1;
    if (!(v1 > v0)) { const d = Math.abs(v1) * 0.2 || 1; v0 -= d; v1 += d; }
    const pad = 3;
    const x = (t) => pad + ((t - t0) / (t1 - t0)) * (W - pad * 2);
    const y = (v) => H - pad - ((v - v0) / (v1 - v0)) * (H - pad * 2);
    const P = [];
    P.push('<line class="ch-spark__base" x1="0" x2="' + W + '" y1="' + (H - 0.5) + '" y2="' + (H - 0.5) + '"/>');
    if (has) P.push('<path class="ch-spark__ghost" d="M' + r1(x(g.start)) + " " + r1(y(g.baseline)) + "L" + r1(x(g.end)) + " " + r1(y(g.target)) + '"/>');
    if (pts.length > 1) P.push('<path class="ch-spark__line" d="' + ptsPath(pts.map((p) => [x(p.t), y(p.v)])) + '"/>');
    pts.forEach((p, i) => {
      const lastOne = i === pts.length - 1;
      P.push('<circle class="ch-spark__dot' + (lastOne ? " is-last" : "") + '" cx="' + r1(x(p.t)) + '" cy="' + r1(y(p.v)) + '" r="' + (lastOne ? 2 : 1.25) + '"/>');
    });
    if (!pts.length && !has) P.push('<line class="ch-spark__ghost" x1="2" x2="' + (W - 2) + '" y1="' + H / 2 + '" y2="' + H / 2 + '"/>');
    const cls = "ch-spark" + (g.due ? " is-due" : "") + (g.status === "held" ? " is-held" : g.status === "missed" ? " is-missed" : "");
    if (typeof document === "undefined") {
      return '<svg class="' + cls + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true">' + P.join("") + "</svg>";
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", cls);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML = P.join("");
    // hedge for callers that interpolate the result into a template string
    svg.toString = function () { return this.outerHTML; };
    return svg;
  }

  WB.charts = { render, renderSpark };
})();
