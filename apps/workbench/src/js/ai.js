/* ---- Workbench AI & platform wrapper (Lu) ----
   The ONLY code allowed to reference window.claude. Every capability degrades to null / a coded rejection,
   never to a thrown error at load. sample is only ever called from forge.js flows started by a user gesture. */
(function () {
  "use strict";
  const WB = window.WB;

  const CAP_TIMEOUT = 10000;
  const memo = {};
  let lastCaps = null;
  let capsInflight = null;

  const emit = (name, payload) => { try { WB.bus && WB.bus.emit(name, payload); } catch (e) { /* bus missing */ } };
  const isObj = (o) => o && typeof o === "object";

  /* ---------------- error normalization ---------------- */
  const COPY = {
    unavailable: "Claude isn’t available here. The example bench still works.",
    not_granted: "Claude access is off for this page.",
    rate_limited: "Claude needs a breather. Try again in a minute.",
    invalid_json: "I couldn’t make a clean instrument from that. Try a straighter, closer photo.",
    cancelled: "",
    refused: "I can’t work with that photo.",
    timeout: "That took too long. Try again.",
    tool_error: "That service had a problem with the request.",
    needs_reauth: "Connect Gmail in claude.ai Settings → Connectors.",
    server_not_connected: "Connect Gmail in claude.ai Settings → Connectors.",
    no_fit: "That one doesn’t make an instrument yet.",
    not_same_spot: "That doesn’t look like the same spot. Stand where you took the first one and try again.",
    unknown: "Something went wrong. Try again.",
  };
  const CODE_MAP = {
    sampling_disabled: "unavailable", capability_disabled: "unavailable", capability_removed: "unavailable", not_declared: "unavailable",
    unavailable: "unavailable", server_unavailable: "unavailable", not_available: "unavailable",
    not_granted: "not_granted", denied: "not_granted", permission_denied: "not_granted",
    rate_limited: "rate_limited", invalid_json: "invalid_json", refused: "refused", timeout: "timeout",
    cancelled: "cancelled", canceled: "cancelled", aborted: "cancelled", AbortError: "cancelled",
    tool_error: "tool_error", needs_reauth: "needs_reauth", session_expired: "needs_reauth",
    server_not_connected: "server_not_connected", no_fit: "no_fit", not_same_spot: "not_same_spot",
  };
  function norm(e, ctx) {
    if (isObj(e) && e.__wb) return e;
    let raw = isObj(e) ? (e.code || (e.name === "AbortError" ? "AbortError" : null)) : typeof e === "string" ? e : null;
    let code = CODE_MAP[raw] || "unknown";
    if (code === "unknown" && isObj(e) && /abort/i.test(String(e.message || ""))) code = "cancelled";
    let message = COPY[code];
    if (ctx && ctx.server && (code === "needs_reauth" || code === "server_not_connected"))
      message = "Connect " + (ctx.server === "Google Drive" ? "Google Drive" : "Gmail") + " in claude.ai Settings → Connectors.";
    if (ctx && ctx.server && code === "not_granted") message = ctx.server === "Gmail" ? "Mail stays closed." : "Drive stays closed.";
    if (ctx && ctx.server && code === "tool_error") message = (ctx.server === "Google Drive" ? "Drive" : "Gmail") + " had a problem with that request.";
    const out = { __wb: true, code, message };
    if (isObj(e) && typeof e.message === "string" && e.message && code === "unknown") out.detail = e.message.slice(0, 200);
    if (isObj(e) && typeof e.text === "string") out.text = e.text;
    if (isObj(e) && Array.isArray(e.errors)) out.errors = e.errors;
    return out;
  }
  function fail(code, message, extra) { return Object.assign({ __wb: true, code, message: message != null ? message : COPY[code] || COPY.unknown }, extra || {}); }

  /* ---------------- capability access ---------------- */
  function cap(name) {
    if (memo[name]) return memo[name];
    const c = typeof window !== "undefined" ? window.claude : undefined;
    if (!c || typeof c.use !== "function") return (memo[name] = Promise.resolve(null));
    memo[name] = new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, CAP_TIMEOUT);
      let p;
      try { p = Promise.resolve(c.use(name)); } catch (e) { p = Promise.resolve(null); }
      p.then((ns) => { if (!done) { done = true; clearTimeout(t); resolve(ns || null); } },
        () => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
    });
    return memo[name];
  }

  async function permState(perm, key, fallback) {
    if (!perm || typeof perm.state !== "function") return fallback;
    try {
      const s = await perm.state(key);
      return ["granted", "prompt", "denied", "unavailable"].indexOf(s) >= 0 ? s : fallback;
    } catch (e) { return fallback; }
  }
  async function imagesOk(sample) {
    if (!sample) return false;
    if (typeof sample.limits !== "function") return true;
    try {
      const l = await sample.limits();
      if (!isObj(l)) return true;
      if (!("images" in l)) return false;
      return !!l.images;
    } catch (e) { return true; }
  }
  function setCaps(next) {
    const changed = JSON.stringify(next) !== JSON.stringify(lastCaps);
    lastCaps = next;
    if (changed) emit("caps:changed", { caps: Object.assign({}, next) });
    return next;
  }
  function caps() {
    if (capsInflight) return capsInflight;
    capsInflight = (async () => {
      const [sample, mcp, perm, db, user, assets, room, downloads] = await Promise.all(
        ["sample", "mcp", "permissions", "db", "user", "assets", "room", "downloads"].map(cap));
      const base = mcp ? "prompt" : "unavailable";
      const keep = (k, v) => (learned[k] && v !== "unavailable" ? learned[k] : v);
      const next = {
        sample: !!sample,
        images: await imagesOk(sample),
        gmail: mcp ? keep("gmail", await permState(perm, "mcp:Gmail", base)) : "unavailable",
        drive: mcp ? keep("drive", await permState(perm, "mcp:Google Drive", base)) : "unavailable",
        db: !!db, user: !!user, assets: !!assets, room: !!room, downloads: !!downloads,
      };
      return setCaps(next);
    })().finally(() => { capsInflight = null; });
    return capsInflight;
  }
  /* What a real call taught us this load (declined, or not connected) outranks the permission probe. */
  const learned = {};
  function noteServer(server, state) {
    const k = server === "Gmail" ? "gmail" : server === "Google Drive" ? "drive" : null;
    if (!k) return;
    if (state === "granted") delete learned[k]; else learned[k] = state;
    if (!lastCaps || lastCaps[k] === state) return;
    setCaps(Object.assign({}, lastCaps, { [k]: state }));
  }
  function noteSample(code) {
    if (!lastCaps || !lastCaps.sample) return;
    if (code === "unavailable" || code === "not_granted") setCaps(Object.assign({}, lastCaps, { sample: false, images: false }));
  }

  /* ---------------- abort plumbing ---------------- */
  function linked(signal, timeoutMs) {
    const ctl = new AbortController();
    let why = null;
    const onAbort = () => { if (!why) why = "cancelled"; ctl.abort(); };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true }); }
    let t = null;
    if (timeoutMs > 0) t = setTimeout(() => { why = "timeout"; ctl.abort(); }, timeoutMs);
    return {
      signal: ctl.signal,
      why: () => why,
      dispose() { if (t) clearTimeout(t); if (signal) signal.removeEventListener("abort", onAbort); },
    };
  }
  function abortable(promise, link) {
    if (!link) return promise;
    return new Promise((resolve, reject) => {
      if (link.signal.aborted) return reject(fail(link.why() || "cancelled"));
      const onAbort = () => reject(fail(link.why() || "cancelled"));
      link.signal.addEventListener("abort", onAbort, { once: true });
      promise.then((v) => { link.signal.removeEventListener("abort", onAbort); resolve(v); },
        (e) => { link.signal.removeEventListener("abort", onAbort); reject(link.signal.aborted ? fail(link.why() || "cancelled") : e); });
    });
  }

  function toBlobs(images) {
    if (!images) return undefined;
    if (typeof FileList !== "undefined" && images instanceof FileList) return images;
    const arr = Array.isArray(images) ? images : [images];
    const out = arr.filter(Boolean);
    return out.length ? out : undefined;
  }

  /* Page tools: a hard cap on rounds, and execute() never throws into the model loop. */
  function wrapTools(tools, maxCalls) {
    if (!Array.isArray(tools) || !tools.length) return undefined;
    let calls = 0;
    return tools.map((t) => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
      async execute(input) {
        calls += 1;
        if (calls > maxCalls) return { error: "Tool budget used up. Answer now with what you already have." };
        try { return await t.execute(input || {}); }
        catch (e) {
          const n = norm(e);
          if (typeof t.onFatal === "function" && t.onFatal(n)) return { error: "Stopped." };
          return { error: n.message || "That call failed." };
        }
      },
    }));
  }

  function sampleOpts(o, link) {
    const opts = { modelTier: o.tier || "quick", cache: false };
    if (link) opts.signal = link.signal;
    if (typeof o.onText === "function") opts.onText = o.onText;
    const imgs = toBlobs(o.images);
    if (imgs) opts.images = imgs;
    const tools = wrapTools(o.tools, o.maxToolCalls || 12);
    if (tools) opts.tools = tools;
    return opts;
  }

  async function getSample() {
    const s = await cap("sample");
    if (!s) throw fail("unavailable");
    return s;
  }

  async function ask(input, o) {
    o = o || {};
    const sample = await getSample();
    const link = linked(o.signal, o.timeoutMs);
    try {
      if (link.signal.aborted) throw fail(link.why() || "cancelled");
      const r = await abortable(Promise.resolve().then(() => sample(input, sampleOpts(o, link))), link);
      return typeof r === "string" ? r : r && typeof r.text === "string" ? r.text : "";
    } catch (e) {
      const n = norm(e);
      noteSample(n.code);
      throw n;
    } finally { link.dispose(); }
  }

  function extractJSON(text) {
    if (typeof text !== "string") return undefined;
    const t = text.replace(/```(?:json)?/gi, "").trim();
    try { return JSON.parse(t); } catch (e) { /* fall through */ }
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* fall through */ } }
    const c = t.indexOf("["), d = t.lastIndexOf("]");
    if (c >= 0 && d > c) { try { return JSON.parse(t.slice(c, d + 1)); } catch (e) { /* fall through */ } }
    return undefined;
  }

  async function jsonOnce(sample, input, o, link) {
    const opts = sampleOpts(o, link);
    if (typeof sample.json === "function") return abortable(Promise.resolve().then(() => sample.json(input, opts)), link);
    const r = await abortable(Promise.resolve().then(() => sample(input, opts)), link);
    const v = extractJSON(typeof r === "string" ? r : r && r.text);
    if (v === undefined) throw fail("invalid_json");
    return v;
  }
  function withFeedback(input, prev, problems) {
    const note = "Your previous JSON had these problems:\n- " + problems.join("\n- ") +
      "\nFix them and return ONLY the corrected JSON, in the same shape.";
    if (Array.isArray(input)) {
      const msgs = input.slice();
      if (prev !== undefined) msgs.push({ role: "assistant", content: JSON.stringify(prev).slice(0, 12000) });
      msgs.push({ role: "user", content: note });
      return msgs;
    }
    return String(input) + "\n\n" + (prev !== undefined ? "Your previous reply was:\n" + JSON.stringify(prev).slice(0, 8000) + "\n\n" : "") + note;
  }

  async function json(input, o) {
    o = o || {};
    const sample = await getSample();
    const link = linked(o.signal, o.timeoutMs);
    let retries = o.retries == null ? 1 : o.retries;
    let tier = o.tier || "quick";
    let current = input;
    try {
      for (;;) {
        let value, problems = null, raw;
        try {
          value = await jsonOnce(sample, current, Object.assign({}, o, { tier }), link);
        } catch (e) {
          const n = norm(e);
          if (n.code !== "invalid_json" || retries <= 0 || link.signal.aborted) throw n;
          problems = ["It was not valid JSON. Reply with one JSON value and nothing else."];
        }
        if (!problems) {
          if (typeof o.onChecking === "function") { try { o.onChecking(); } catch (e) { /* ui */ } }
          raw = value;
          if (typeof o.validate === "function") {
            let errs;
            try { errs = o.validate(value) || []; } catch (e) { errs = ["The JSON could not be checked: " + String((e && e.message) || e)]; }
            if (errs.length) problems = errs.slice(0, 12);
          }
          if (!problems) return value;
          if (retries <= 0) throw fail("invalid_json", null, { errors: problems });
        }
        retries -= 1;
        tier = "default";
        if (typeof o.onRetry === "function") { try { o.onRetry(problems); } catch (e) { /* ui */ } }
        current = withFeedback(input, raw, problems);
      }
    } catch (e) {
      const n = link.signal.aborted ? fail(link.why() || "cancelled") : norm(e);
      noteSample(n.code);
      throw n;
    } finally { link.dispose(); }
  }

  /* ---------------- MCP ---------------- */
  async function mcp(server, tool, input) {
    const ns = await cap("mcp");
    if (!ns || typeof ns.callTool !== "function") throw fail("unavailable", "Connect " + server + " in claude.ai Settings → Connectors.");
    let res;
    try {
      res = await ns.callTool(server, tool, input || {});
    } catch (e) {
      const n = norm(e, { server });
      if (n.code === "not_granted") noteServer(server, "denied");
      else if (n.code === "needs_reauth" || n.code === "server_not_connected" || n.code === "unavailable") noteServer(server, "unavailable");
      if (n.code === "unknown") { n.code = "tool_error"; n.message = norm({ code: "tool_error" }, { server }).message; }
      throw n;
    }
    noteServer(server, "granted");
    if (isObj(res) && res.isError) throw fail("tool_error", norm({ code: "tool_error" }, { server }).message);
    let payload = isObj(res) && "payload" in res ? res.payload : res;
    if (typeof payload === "string") { const p = extractJSON(payload); if (p !== undefined) payload = p; }
    return payload;
  }

  const clip = (s, n) => { s = s == null ? "" : String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  function who(x) {
    if (!x) return "";
    if (typeof x === "string") return x;
    if (isObj(x)) return x.name && x.email ? x.name + " <" + x.email + ">" : x.email || x.name || "";
    return String(x);
  }
  function listOf(payload, keys) {
    if (Array.isArray(payload)) return payload;
    if (!isObj(payload)) return [];
    for (const k of keys) if (Array.isArray(payload[k])) return payload[k];
    return [];
  }

  const gmail = {
    async search(query, pageSize) {
      const payload = await mcp("Gmail", "search_threads", { query: String(query || "").slice(0, 300), pageSize: Math.min(50, pageSize || 15) });
      return listOf(payload, ["threads", "results", "items"]).slice(0, pageSize || 15).map((t) => {
        const msgs = listOf(t, ["messages"]);
        const first = msgs[0] || t;
        const last = msgs[msgs.length - 1] || t;
        return {
          threadId: String(t.id || t.threadId || first.threadId || ""),
          subject: clip(first.subject || t.subject || "", 200),
          sender: clip(who(last.sender || first.sender || t.sender || last.from || first.from), 160),
          date: String(last.date || first.date || t.date || ""),
          snippet: clip(last.snippet || first.snippet || t.snippet || "", 200),
        };
      }).filter((x) => x.threadId);
    },
    async thread(threadId) {
      const payload = await mcp("Gmail", "get_thread", { threadId: String(threadId), messageFormat: "PLAIN_TEXT" });
      const msgs = listOf(payload, ["messages"]);
      const first = msgs[0] || payload || {};
      const last = msgs[msgs.length - 1] || first;
      const body = (m) => String((m && (m.plaintext_body || m.plaintextBody || m.body || m.text || m.snippet)) || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n");
      let text = body(first);
      if (msgs.length > 1) {
        const half = 1450;
        text = clip(text, half) + "\n\n---\n\n" + clip(body(last), half);
      }
      return {
        subject: clip(first.subject || "", 200),
        sender: clip(who(first.sender || first.from), 160),
        date: String(last.date || first.date || ""),
        text: clip(text, 3000),
        messageIds: msgs.map((m) => m && m.id).filter(Boolean).map(String),
      };
    },
    async draft(d) {
      d = d || {};
      const input = { to: (Array.isArray(d.to) ? d.to : d.to ? [d.to] : []).map(String), subject: String(d.subject || ""), body: String(d.body || "") };
      if (d.replyToMessageId) input.replyToMessageId = String(d.replyToMessageId);
      const p = await mcp("Gmail", "create_draft", input);
      const o = isObj(p) ? (isObj(p.draft) ? Object.assign({}, p, p.draft) : p) : {};
      const id = o.id || o.draftId || null;
      const threadId = o.threadId || (isObj(o.message) && o.message.threadId) || null;
      const viewUrl = o.viewUrl || o.url || o.webUrl || "https://mail.google.com/mail/u/0/#drafts";
      return { id: id && String(id), threadId: threadId && String(threadId), viewUrl: String(viewUrl) };
    },
  };

  const drive = {
    async create(o) {
      o = o || {};
      const p = await mcp("Google Drive", "create_file", { title: String(o.title || "Workbench"), textContent: String(o.text || ""), contentMimeType: "text/plain" });
      return isObj(p) ? p : { result: p };
    },
  };

  /* ---------------- downloads, assets, accounts ---------------- */
  function anchorDownload(filename, blob) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.rel = "noopener"; a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) { /* gone */ } }, 4000);
      return true;
    } catch (e) { return false; }
  }
  async function download(filename, data, mime) {
    const type = mime || (data && data.type) || "text/plain";
    const blob = typeof Blob !== "undefined" && data instanceof Blob ? data : new Blob([data == null ? "" : String(data)], { type: type + (/^text\//.test(type) && !/charset/.test(type) ? ";charset=utf-8" : "") });
    const ns = await cap("downloads");
    if (ns && typeof ns.save === "function") {
      try {
        const r = await ns.save({ filename, data: typeof data === "string" && !mime ? data : blob });
        if (r === false || (isObj(r) && (r.saved === false || r.status === "declined"))) return "declined";
        return "saved";
      } catch (e) {
        const n = norm(e);
        if (n.code === "cancelled" || n.code === "not_granted") return "declined";
      }
    }
    return anchorDownload(filename, blob) ? "fallback" : "declined";
  }

  async function upload(blob) {
    try {
      const ns = await cap("assets");
      if (!ns || !blob) return null;
      const fn = typeof ns === "function" ? ns : ns.upload || ns.put || ns.create || ns.save;
      if (typeof fn !== "function") return null;
      const r = await fn.call(ns, blob);
      const id = isObj(r) ? r.id || r.assetId || r.key : typeof r === "string" ? r : null;
      if (!id) return null;
      const url = (isObj(r) && (r.url || r.src)) || "/_blob/" + encodeURIComponent(id);
      return { id: String(id), url: String(url) };
    } catch (e) { return null; }
  }

  let uidP = null;
  function userId() {
    if (uidP) return uidP;
    uidP = (async () => {
      const u = await cap("user");
      if (!u) return null;
      try {
        if (typeof u.id === "function") { const id = await u.id(); return id ? String(id) : null; }
        if (typeof u.me === "function") { const me = await u.me(); return me && me.id ? String(me.id) : null; }
      } catch (e) { /* signed out */ }
      return null;
    })();
    uidP.then((v) => { if (v == null) uidP = null; });
    return uidP;
  }
  const db = () => cap("db");
  const room = () => cap("room");

  /* ---------------- images ---------------- */
  async function decode(file) {
    if (typeof createImageBitmap === "function") {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
      catch (e) { try { return await createImageBitmap(file); } catch (e2) { /* fall back to <img> */ } }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 0); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(fail("unknown", "That photo didn’t open. Try a JPEG or a screenshot.")); };
      img.src = url;
    });
  }
  function draw(src, max) {
    const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    const k = Math.min(1, max / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, w, h);
    return c;
  }
  const toBlob = (c, q) => new Promise((resolve, reject) => {
    try { c.toBlob((b) => (b ? resolve(b) : reject(fail("unknown", "That photo didn’t open."))), "image/jpeg", q); }
    catch (e) { reject(fail("unknown", "That photo didn’t open.")); }
  });
  function dataURL(src, max, q, budget) {
    let c = draw(src, max);
    let url = c.toDataURL("image/jpeg", q);
    let quality = q;
    while (budget && url.length > budget * 1.37 && quality > 0.35) { quality -= 0.12; url = c.toDataURL("image/jpeg", quality); }
    let m = max;
    while (budget && url.length > budget * 1.37 && m > 160) { m = Math.round(m * 0.75); c = draw(src, m); url = c.toDataURL("image/jpeg", quality); }
    return url;
  }
  async function prepImage(file) {
    if (!file) throw fail("unknown", "No photo.");
    const img = await decode(file);
    try {
      const big = draw(img, 1600);
      const blob = await toBlob(big, 0.82);
      const thumb = dataURL(img, 480, 0.7, 40 * 1024);
      return { blob, thumb, w: big.width, h: big.height };
    } finally { try { img.close && img.close(); } catch (e) { /* not a bitmap */ } }
  }
  /* Extra: a data URL for local photo storage when assets are unavailable (store may use it). */
  async function shrink(file, max, q) {
    const img = await decode(file);
    try { return dataURL(img, max || 900, q || 0.65, 180 * 1024); }
    finally { try { img.close && img.close(); } catch (e) { /* not a bitmap */ } }
  }
  async function blobFromSrc(src) {
    if (!src || typeof src !== "string") throw fail("unknown", "No photo.");
    if (src.indexOf("data:") === 0) {
      const comma = src.indexOf(",");
      const meta = src.slice(5, comma);
      const isB64 = /;base64/i.test(meta);
      const mime = meta.split(";")[0] || "application/octet-stream";
      const body = src.slice(comma + 1);
      if (!isB64) return new Blob([decodeURIComponent(body)], { type: mime });
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    const r = await fetch(src);
    if (!r.ok) throw fail("unknown", "Couldn’t load the earlier photo.");
    return r.blob();
  }
  /* SVG (demo photos) cannot go to Claude as-is; rasterize anything that is not jpeg/png/webp/gif. */
  async function rasterBlob(src, max) {
    const b = await blobFromSrc(src);
    if (/^image\/(jpeg|png|webp|gif)$/.test(b.type)) return b;
    const img = await decode(b);
    return toBlob(draw(img, max || 1200), 0.82);
  }

  WB.ai = {
    cap, caps, ask, json, mcp, gmail, drive, download, upload, userId, db, room, prepImage, blobFromSrc,
    /* extras beyond the contract */
    shrink, rasterBlob, extractJSON,
    lastCaps: () => (lastCaps ? Object.assign({}, lastCaps) : null),
    message: (code, server) => norm({ code }, server ? { server } : null).message,
    error: (e, server) => { const n = norm(e, server ? { server } : null); return { code: n.code, message: n.message }; },
  };
})();
