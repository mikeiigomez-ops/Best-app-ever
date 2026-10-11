# Platform reference for app builders (Claude artifact runtime, contract 0.2.75)

The app is a page published as a Claude artifact. The host wraps it in a document skeleton, so the published
file has no <!doctype>/<html>/<head>/<body>: it starts with <title>, <style>, markup, <script>.
CSP: external scripts only from cdnjs.cloudflare.com / cdn.jsdelivr.net/npm / unpkg.com (exact pinned versions);
stylesheets only from fonts.googleapis.com. No fetch to other hosts. No alert/confirm/prompt (they no-op).
No service workers. localStorage works but can throw: wrap in try/catch. Links to https:// open in a new tab.

## Getting capabilities
    const ns = await window.claude?.use?.("sample")   // null => unavailable: hide/degrade, never crash
`window.claude` may be absent entirely (opened outside Claude). Never read window.claude.db etc. directly.
`use()` resolves later (never in the first synchronous run); render the page first, light features up after.

## sample (call Claude)  — declared as capabilities: {sample: {images: true}}
    const sample = await claude.use("sample")
    const {text} = await sample(input, {onText({text}){...}, signal, modelTier: "quick"|"default"|"complex", cache: false|{gcTime}})
    const value  = await sample.json(input, opts)   // reply parsed as JSON; say the exact JSON shape in the prompt
    input = "prompt string" | [{role:"user"|"assistant", content}]  (must start and end with a user turn)
    opts.images = Blob | Blob[] | FileList   (photos from <input type=file accept="image/*" capture="environment">)
    opts.tools = [{name, description, inputSchema:{type:"object",properties,required}, execute(input){ return plainData }}]
       -> Claude can call page functions in an agentic loop (each round ~1-10s on default tier). No cache with tools.
- Memoryless: every call must include instructions + data + output format.
- Errors reject {code, message, text?}: not_granted / sampling_disabled / capability_disabled => hide feature for this view;
  rate_limited => tell user, let them retry; invalid_json => offer "try again"; cancelled => silent; refused => change wording.
- Call only from a user gesture or once at load with a stable prompt. Never from timers/loops. First call shows a consent dialog.
- "quick" tier answers in ~1-2s with no thinking; "default" thinks first (5-60s). Show "Thinking..." + a Stop button.

## mcp (the viewer's own connectors) — declared as
    capabilities: {mcp: {servers: [{server: "Gmail", tools: ["search_threads","get_thread","create_draft","label_thread","unlabel_thread","list_labels"]},
                                   {server: "Google Drive", tools: ["search_files","read_file_content","create_file"]}]}}
    const mcp = await claude.use("mcp")           // null => unavailable
    const res = await mcp.callTool("Gmail", "search_threads", {query: "in:inbox newer_than:7d", pageSize: 20})
    res.payload  // parsed JSON result
- Gmail search_threads {query (Gmail syntax), pageSize<=50, pageToken, view:"THREAD_VIEW_MINIMAL"}
     -> threads with id, messages[{id, subject, snippet, sender, date, label_ids}] (previews only: ~5 oldest messages)
- Gmail get_thread {threadId, messageFormat:"PLAIN_TEXT"} -> messages[{id, subject, sender, to_recipients, date, plaintext_body}]
- Gmail create_draft {to:[...], subject, body (plain text), replyToMessageId?} -> {id, threadId, viewUrl}   (drafts only; never send)
- Gmail label_thread {threadId, labelIds:["STARRED"|"IMPORTANT"|userLabelId]} ; unlabel_thread {threadId, labelIds:["INBOX"]} = archive
- Drive search_files {query: "fullText contains 'tax' and modifiedTime > '2025-01-01T00:00:00Z'", pageSize, excludeContentSnippets}
- Drive read_file_content {fileId} -> text representation
- Drive create_file — creates a file (check its result shape at runtime; treat as best-effort)
- Errors reject {code}: needs_reauth / server_not_connected => show "connect Gmail in claude.ai Settings > Connectors";
  not_granted => the viewer declined; tool_error => show message in that section; server_unavailable => retry once on user gesture.
  Never collapse every code into one generic banner. Writes (drafts, labels) only from a deliberate user tap; never retry writes automatically.
- NEVER embed the user's real data in the page source. Fetch at view time only.

## db (private cloud state)  — capabilities: {db: {}, user: {}}
    const db = await claude.use("db"); const user = await claude.use("user"); const id = await user.id()
    const ref = db.collection("data/users/" + id).doc("main")   // even number of segments = document
    await ref.set(obj) ; (await ref.get()).exists / .data() ; ref.update(partial) ; ref.onSnapshot(cb)
- Each document <= 256 KiB. data/users/<id>/ is private to that user. Signed-out/outside => null: fall back to localStorage.

## room (live presence between everyone who has the page open right now) — capabilities: {room: {}}
    const room = await claude.use("room"); room.emit(topic, data); room.on(topic, fn); room.presence({...}); room.onPeers(fn)
- Nothing persists; messages can drop. Single-viewer experience must be complete without it.

## downloads — capabilities: {downloads: true}
    const dl = await claude.use("downloads"); await dl.save({filename, data /* string|Blob */})  // user confirms

## permissions (built in, never declared)
    const p = await claude.use("permissions"); await p.state("mcp:Gmail") // "granted"|"prompt"|"denied"|"unavailable"

## Design basics expected on the page
- Works at 360-430px phone width first; no horizontal scroll; 16px gutters; safe-area insets for fixed bars.
- body sets an explicit background; all colors as CSS custom properties on :root.
- Respect prefers-reduced-motion. Visible focus states. Buttons are <button>. Inputs have labels/ids.
- Fonts: Google Fonts link with fallbacks.
