// OpenBot Armor configuration page.
//
// The page is sandboxed: no fetch, no filesystem, no window storage. It reads
// and writes only this plugin's options through magpie.options.get/set. File
// import uses a native <input type="file"> and File.text()/FileReader.
;(function () {
  var t = window.t || function (s) { return s; };
  var RATE_MS = 1100;
  // Magpie caps a page's options POST at 64KB for the WHOLE body
  // (http.MaxBytesReader in pluginpage.go). The inline armor text must leave
  // room for every other option, so cap it well below.
  var MAX_TEXT = 40 * 1024;
  var DEFAULTS = {
    enabled: false,
    mode: "enforce",
    gatewayTimeoutMs: 3000,
    armor_source: "bundled",
    armor_file: "",
    armor_text: "",
    injectArmor: true,
    stripPersonaSections: true,
    stripTaskBullets: true,
    stripEnglishAntiJobs: true,
    stripEnglishSections: true,
    targetAllOpenCode: false,
    allowedOrigins: ["local", "magpie-key", "unknown"],
    agents: [],
    models: [],
    profileNames: [],
  };
  var MODES = ["off", "observe", "enforce"];
  var SOURCES = ["bundled", "compact", "file", "inline"];
  var MODE_OPTIONS = [
    ["off", "off — leave requests alone"],
    ["observe", "observe — compute changes, do not send them"],
    ["enforce", "enforce — rewrite matching requests"],
  ];
  var SOURCE_OPTIONS = [
    ["bundled", "bundled — full armor.md shipped with this plugin"],
    ["compact", "compact — shorter armor.compact.md (fewer tokens)"],
    ["file", "file — read a local .md/.txt on every request"],
    ["inline", "inline — text stored in this page's options"],
  ];

  // One row per option in package.json. The page cannot import lib/options.mjs,
  // so descriptions live here; test/package-parity enforces DEFAULTS parity.
  var FIELD_HELP = [
    { key: "enabled", type: "boolean", desc: "Master switch. Off leaves every request untouched." },
    { key: "mode", type: "string", desc: "off / observe / enforce: leave requests alone / compute changes only / rewrite." },
    { key: "gatewayTimeoutMs", type: "number", desc: "Gateway hook timeout in milliseconds (100–10000)." },
    { key: "armor_source", type: "string", desc: "Armor source: bundled / compact / file / inline." },
    { key: "armor_file", type: "string", desc: "Local path used by the file source; relative paths resolve against the request cwd." },
    { key: "armor_text", type: "string", desc: "Inline armor text used by the inline source; importing a file writes here." },
    { key: "injectArmor", type: "boolean", desc: "Inject the protocol into the system prompt; off leaves only anti-job stripping." },
    { key: "stripPersonaSections", type: "boolean", desc: "Best-effort: strip known Chinese headings such as 【不做什么】; unknown formats are still overridden by the system protocol." },
    { key: "stripTaskBullets", type: "boolean", desc: "Strip task-scope bullets such as 不接 XX / 不付款." },
    { key: "stripEnglishAntiJobs", type: "boolean", desc: "Strip English task prohibitions such as Do not share." },
    { key: "stripEnglishSections", type: "boolean", desc: "Best-effort: strip known English headings such as Anti-jobs / Boundaries; unknown formats are still overridden by the system protocol." },
    { key: "targetAllOpenCode", type: "boolean", desc: "Fallback: also handle every OpenCode request when the OpenBot marker is missing." },
    { key: "allowedOrigins", type: "string[]", desc: "Allowed Magpie origins; local / magpie-key / unknown by default." },
    { key: "agents", type: "string[]", desc: "Only these Magpie agents; empty means all." },
    { key: "models", type: "string[]", desc: "Only these model prefixes; empty means all." },
    { key: "profileNames", type: "string[]", desc: "Only these OpenBot bot names; empty means all." },
  ];

  var base = {};
  var draft = null;
  var sending = false;
  var dirty = false;
  var failed = "";
  var lastAt = Date.now() - RATE_MS;
  var paintedLang = "";

  function $(id) { return document.getElementById(id); }

  function bool(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }

  function list(value) {
    if (Array.isArray(value)) {
      return value.filter(function (s) { return typeof s === "string"; })
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
    }
    return String(value || "")
      .split(/[,，\n]/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function integer(value, fallback) {
    var n = Number(value);
    return Number.isInteger(n) && n >= 100 && n <= 10000 ? n : fallback;
  }

  // Magpie's 64KB limit is on UTF-8 bytes, not JavaScript UTF-16 length.
  function utf8Bytes(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(text)).length;
    return unescape(encodeURIComponent(String(text))).length;
  }

  function normalize(o) {
    var input = o && typeof o === "object" ? o : {};
    var out = Object.assign({}, DEFAULTS, input);
    out.enabled = bool(out.enabled, DEFAULTS.enabled);
    out.mode = MODES.indexOf(out.mode) >= 0 ? out.mode : DEFAULTS.mode;
    out.armor_source = SOURCES.indexOf(input.armor_source) >= 0
      ? input.armor_source
      : SOURCES.indexOf(input.armorSource) >= 0
        ? input.armorSource
        : DEFAULTS.armor_source;
    out.armor_file = typeof input.armor_file === "string"
      ? input.armor_file
      : typeof input.armorFile === "string"
        ? input.armorFile
        : DEFAULTS.armor_file;
    out.armor_text = typeof input.armor_text === "string"
      ? input.armor_text
      : typeof input.armorText === "string"
        ? input.armorText
        : DEFAULTS.armor_text;
    out.injectArmor = bool(out.injectArmor, DEFAULTS.injectArmor);
    out.stripPersonaSections = bool(out.stripPersonaSections, DEFAULTS.stripPersonaSections);
    out.stripTaskBullets = bool(out.stripTaskBullets, DEFAULTS.stripTaskBullets);
    out.stripEnglishAntiJobs = bool(out.stripEnglishAntiJobs, DEFAULTS.stripEnglishAntiJobs);
    out.stripEnglishSections = bool(out.stripEnglishSections, DEFAULTS.stripEnglishSections);
    out.targetAllOpenCode = bool(out.targetAllOpenCode, DEFAULTS.targetAllOpenCode);
    out.allowedOrigins = list(out.allowedOrigins);
    if (!out.allowedOrigins.length) out.allowedOrigins = DEFAULTS.allowedOrigins.slice();
    out.agents = list(out.agents);
    out.models = list(out.models);
    out.profileNames = list(out.profileNames);
    out.gatewayTimeoutMs = integer(out.gatewayTimeoutMs, DEFAULTS.gatewayTimeoutMs);
    return out;
  }

  function parseArmor(raw) {
    var text = String(raw || "").replace(/^\uFEFF/, "");
    var fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
    if (fm) text = text.slice(fm[0].length);
    return text.trim();
  }

  function readSelectedFile(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  function setInput(id, value) {
    var el = $(id);
    if (!el) return;
    if (document.activeElement !== el && el.value !== value) el.value = value;
  }

  function flash(text) {
    var el = $("msg");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 4000);
  }

  function showQuickResult(titleKey, stepKeys) {
    var box = $("quick-result");
    if (!box) return;
    $("quick-result-title").textContent = t(titleKey);
    var list = $("quick-result-steps");
    list.textContent = "";
    for (var i = 0; i < stepKeys.length; i++) {
      var li = document.createElement("li");
      li.textContent = t(stepKeys[i]);
      list.appendChild(li);
    }
    box.hidden = false;
  }

  function hideQuickResult() {
    var box = $("quick-result");
    if (box) box.hidden = true;
  }

  function fillOptions(id, entries) {
    var sel = $(id);
    var current = sel.value;
    sel.textContent = "";
    for (var i = 0; i < entries.length; i++) {
      var option = document.createElement("option");
      option.value = entries[i][0];
      option.textContent = t(entries[i][1]);
      sel.appendChild(option);
    }
    sel.value = current;
  }

  function modeNote(mode) {
    if (mode === "off") return t("off: no request is read or rewritten.");
    if (mode === "observe") return t("observe: computes changes but does not send them.");
    return t("enforce: rewrites matching OpenBot requests.");
  }

  function sourceNote(source) {
    if (source === "file") {
      var fileNote = t("The file is re-read on every request; edits apply at once.");
      if (!draft.armor_file) fileNote += " " + t("No file path set; the armor will not be injected, but anti-job stripping still runs.");
      return fileNote;
    }
    if (source === "inline") {
      var inlineNote = t("Saving options restarts Magpie's plugin host; the next request uses them.");
      if (!draft.armor_text.trim()) inlineNote += " " + t("Inline text is empty; the armor will not be injected, but anti-job stripping still runs.");
      return inlineNote;
    }
    if (source === "compact") {
      return t("The compact armor is shorter (fewer tokens per request) and covers the same rules in brief.");
    }
    return t("The full armor.md ships with the plugin and is not editable here.");
  }

  function sourceLabel(source) {
    for (var i = 0; i < SOURCE_OPTIONS.length; i++) {
      if (SOURCE_OPTIONS[i][0] === source) return t(SOURCE_OPTIONS[i][1]);
    }
    return source;
  }

  function setSourceVisibility(source) {
    var fileFields = $("file-source-fields");
    var inlineFields = $("inline-source-fields");
    if (fileFields) fileFields.hidden = source !== "file";
    if (inlineFields) inlineFields.hidden = source !== "inline";
    var preview = $("preview");
    if (preview) preview.hidden = source !== "inline";
  }
  function armorSummary() {
    var parts = [t("Source") + ": " + sourceLabel(draft.armor_source)];
    if (draft.armor_source === "inline") {
      parts.push(draft.armor_text.length + " " + t("chars"));
    } else if (draft.armor_source === "file") {
      parts.push(draft.armor_file || t("No file path set; the armor will not be injected, but anti-job stripping still runs."));
    }
    if (draft.armor_source === "bundled" || draft.armor_source === "compact") return "";
    return parts.join(" · ");
  }

  function defaultText(key) {
    var value = DEFAULTS[key];
    if (Array.isArray(value)) return value.length ? value.join(", ") : "[]";
    if (value === "") return '""';
    return String(value);
  }

  function renderFieldHelp() {
    var body = $("field-help-body");
    if (!body) return;
    body.textContent = "";
    for (var i = 0; i < FIELD_HELP.length; i++) {
      var row = document.createElement("tr");
      var name = document.createElement("td");
      name.setAttribute("data-label", t("Field"));
      var code = document.createElement("code");
      code.textContent = FIELD_HELP[i].key;
      name.appendChild(code);
      var type = document.createElement("td");
      type.setAttribute("data-label", t("Type"));
      type.textContent = FIELD_HELP[i].type;
      var def = document.createElement("td");
      def.setAttribute("data-label", t("Default"));
      def.textContent = defaultText(FIELD_HELP[i].key);
      var desc = document.createElement("td");
      desc.setAttribute("data-label", t("Description"));
      desc.textContent = t(FIELD_HELP[i].desc);
      row.appendChild(name);
      row.appendChild(type);
      row.appendChild(def);
      row.appendChild(desc);
      body.appendChild(row);
    }
  }

  function configJson() {
    var publicDraft = {};
    for (var key in draft) {
      if (Object.prototype.hasOwnProperty.call(draft, key) && key !== "status") publicDraft[key] = draft[key];
    }
    return JSON.stringify(publicDraft, null, 2);
  }

  var BOOLEAN_KEYS = [
    "enabled", "injectArmor", "stripPersonaSections", "stripTaskBullets",
    "stripEnglishAntiJobs", "stripEnglishSections", "targetAllOpenCode",
  ];
  var ARRAY_KEYS = ["allowedOrigins", "agents", "models", "profileNames"];

  function validateConfigJson(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return t("JSON must be an object.");
    }
    var allowed = Object.keys(DEFAULTS);
    for (var key in parsed) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key) || key === "status") continue;
      if (allowed.indexOf(key) < 0) return t("Unknown field") + ": " + key;
    }
    for (var i = 0; i < BOOLEAN_KEYS.length; i++) {
      var booleanKey = BOOLEAN_KEYS[i];
      if (booleanKey in parsed && typeof parsed[booleanKey] !== "boolean") {
        return t("Field type error") + ": " + booleanKey + " (boolean)";
      }
    }
    for (var a = 0; a < ARRAY_KEYS.length; a++) {
      var arrayKey = ARRAY_KEYS[a];
      if (!(arrayKey in parsed)) continue;
      if (!Array.isArray(parsed[arrayKey]) || parsed[arrayKey].some(function (v) { return typeof v !== "string"; })) {
        return t("Field type error") + ": " + arrayKey + " (string[])";
      }
    }
    if ("mode" in parsed && MODES.indexOf(parsed.mode) < 0) {
      return t("Invalid mode") + ": " + parsed.mode;
    }
    if ("armor_source" in parsed && SOURCES.indexOf(parsed.armor_source) < 0) {
      return t("Invalid armor source") + ": " + parsed.armor_source;
    }
    if ("gatewayTimeoutMs" in parsed &&
        (typeof parsed.gatewayTimeoutMs !== "number" ||
         !Number.isInteger(parsed.gatewayTimeoutMs) ||
         parsed.gatewayTimeoutMs < 100 ||
         parsed.gatewayTimeoutMs > 10000)) {
      return t("Field type error") + ": gatewayTimeoutMs (100–10000)";
    }
    for (var s = 0; s < ["armor_file", "armor_text"].length; s++) {
      var stringKey = ["armor_file", "armor_text"][s];
      if (stringKey in parsed && typeof parsed[stringKey] !== "string") {
        return t("Field type error") + ": " + stringKey + " (string)";
      }
    }
    return "";
  }

  function openJsonEditor() {
    $("json-editor").value = configJson();
    $("json-editor-wrap").hidden = false;
    $("json-editor").focus();
  }

  function closeJsonEditor() {
    $("json-editor-wrap").hidden = true;
  }

  function paint() {
    if (!draft) return;
    document.title = t("OpenBot Armor");
    $("title").textContent = t("OpenBot Armor");
    $("lead").textContent = t("Runtime gateway hook for OpenBot requests through Magpie.");

    var currentLang = window.__I18N__ ? window.__I18N__.lang : "en";
    var langChanged = currentLang !== paintedLang;
    $("quick-title").textContent = t("Quick start");
    if (langChanged || !$("quick-steps").children.length) {
      $("quick-steps").textContent = "";
      var steps = [
        t("Turn the switch on (or use the recommended button below)."),
        t("Keep mode = enforce; keep the source you chose; save."),
        t("Chat once with an OpenBot bot and ask whether the global execution protocol is loaded. It should answer yes."),
      ];
      for (var s = 0; s < steps.length; s++) {
        var li = document.createElement("li");
        li.textContent = steps[s];
        $("quick-steps").appendChild(li);
      }
    }
    $("quick-enable").textContent = t("Enable with recommended settings");
    $("quick-disable").textContent = t("Turn everything off");
    $("quick-note").textContent = t("You can switch to observe first: it shows what would change without touching requests.");

    $("switch").textContent = draft.enabled ? t("Turn off") : t("Turn on");
    $("switch").setAttribute("aria-pressed", draft.enabled ? "true" : "false");
    $("state").textContent = draft.enabled ? t("Enabled") : t("Disabled");
    $("dirty").textContent = t("Unsaved");
    $("dirty").hidden = !dirty;

    $("mode-label").textContent = t("Mode");
    if (langChanged || !$("mode").children.length) fillOptions("mode", MODE_OPTIONS);
    $("mode").value = draft.mode;
    $("mode-note").textContent = modeNote(draft.mode);

    $("source-title").textContent = t("Armor source");
    $("source-label").textContent = t("Source");
    if (langChanged || !$("source").children.length) fillOptions("source", SOURCE_OPTIONS);
    $("source").value = draft.armor_source;
    $("source-note").textContent = sourceNote(draft.armor_source);
    setSourceVisibility(draft.armor_source);
    $("file-label").textContent = t("File path");
    setInput("armor-file", draft.armor_file);
    $("use-file").textContent = t("Use this file");
    $("use-bundled").textContent = t("Use bundled");
    $("inline-label").textContent = t("Inline armor text");
    setInput("armor-text", draft.armor_text);
    var armorInput = $("armor-text");
    if (document.activeElement !== armorInput && !armorInput.placeholder) {
      armorInput.placeholder = t("Paste your protocol text here, or import a file below.");
    }
    $("import-file").textContent = t("Import file into inline text…");
    $("clear-text").textContent = t("Clear inline text");
    $("use-inline").textContent = t("Use inline text");
    var summary = armorSummary();
    $("armor-summary").textContent = summary;
    $("armor-summary").hidden = !summary;

    $("preview-label").textContent = t("Preview");
    var preview = "";
    if (draft.armor_source === "bundled") {
      preview = t("The full armor.md ships with the plugin and is not editable here.");
    } else if (draft.armor_source === "compact") {
      preview = t("The compact armor is shorter (fewer tokens per request) and covers the same rules in brief.");
    } else if (draft.armor_source === "file") {
      preview = t("Preview reads the file at request time; it is not shown here.");
    } else if (!draft.armor_text.trim()) {
      preview = t("No inline text.");
    } else {
      preview = draft.armor_text.length > 4000
        ? draft.armor_text.slice(0, 4000) + "\n\n… " + (draft.armor_text.length - 4000) + " " + t("more")
        : draft.armor_text;
    }
    $("armor-preview").textContent = preview;

    $("advanced-title").textContent = t("Advanced");
    $("inject-label").textContent = t("Inject armor into system prompt");
    $("strip-sections-label").textContent = t("Strip Chinese anti-job sections");
    $("strip-bullets-label").textContent = t("Strip task-scope bullets");
    $("strip-english-label").textContent = t("Strip English task prohibitions");
    $("strip-english-sections-label").textContent = t("Strip English anti-job sections");
    $("target-label").textContent = t("Fallback: all OpenCode requests when OpenBot marker is missing");
    var checks = document.querySelectorAll("[data-key]");
    for (var i = 0; i < checks.length; i++) {
      var key = checks[i].getAttribute("data-key");
      checks[i].checked = !!draft[key];
    }
    $("profiles-label").textContent = t("Only these OpenBot bots (comma-separated, empty = all)");
    setInput("profileNames", draft.profileNames.join(", "));
    $("origins-label").textContent = t("Allowed origins (comma-separated)");
    $("origins-note").textContent = t("Origins hint: local, magpie-key and unknown are allowed by default; gateway-key and remote are skipped.");
    setInput("origins", draft.allowedOrigins.join(", "));
    $("agents-label").textContent = t("Only these Magpie agents (comma-separated, empty = all)");
    setInput("agents", draft.agents.join(", "));
    $("models-label").textContent = t("Only these model prefixes (comma-separated, empty = all)");
    setInput("models", draft.models.join(", "));
    $("timeout-label").textContent = t("Gateway hook timeout (ms)");
    setInput("timeout", String(draft.gatewayTimeoutMs));

    $("config-title").textContent = t("Config JSON (copy for backup)");
    $("copy-config").textContent = t("Copy JSON");
    $("edit-config").textContent = t("Edit JSON");
    $("copy-note").textContent = t("Read-only backup. Use Edit JSON or the form above to change options.");
    $("json-editor-note").textContent = t("Paste config JSON here. This is the same magpie.options shown under Magpie → Plugins → Options; this page is the normal editor, that one is the fallback. Unknown fields and wrong types are rejected.");
    $("apply-json").textContent = t("Apply JSON");
    $("cancel-json").textContent = t("Cancel");
    $("field-help-title").textContent = t("Field help");
    $("field-col").textContent = t("Field");
    $("type-col").textContent = t("Type");
    $("default-col").textContent = t("Default");
    $("desc-col").textContent = t("Description");
    if (langChanged || !$("field-help-body").children.length) renderFieldHelp();
    $("config-json").value = configJson();

    $("save").textContent = sending ? t("Saving…") : t("Save");
    $("save").disabled = sending || !dirty;
    $("reset").textContent = t("Restore defaults");
    $("reset").disabled = sending;
    $("quick-enable").disabled = sending;
    $("quick-disable").disabled = sending;
    $("apply-json").disabled = sending;

    var statusText;
    if (failed) statusText = failed;
    else if (sending) statusText = t("Saving…");
    else if (dirty) statusText = t("Unsaved changes — click Save.");
    else statusText = t("Saved. Next request uses these options.") + " " +
      t("Saving options restarts Magpie's plugin host; the next request uses them.");
    $("status").textContent = statusText;
    paintedLang = currentLang;
  }

  function mark(patch, saveNow) {
    hideQuickResult();
    draft = Object.assign({}, draft, patch);
    dirty = true;
    failed = "";
    paint();
    if (saveNow) void flush();
  }

  async function flush() {
    if (sending) return;
    sending = true;
    paint();
    try {
      while (dirty) {
        var wait = Math.max(0, RATE_MS - (Date.now() - lastAt));
        if (wait) await new Promise(function (resolve) { setTimeout(resolve, wait); });
        lastAt = Date.now();
        if (utf8Bytes(draft.armor_text) > MAX_TEXT) {
          failed = t("Inline armor text is too large") + ": " + utf8Bytes(draft.armor_text) + " > " + MAX_TEXT;
          break;
        }
        // Capture the exact draft this save sends. If the user edits while
        // the POST is in flight, keep dirty set so the newer draft is saved
        // in the next loop instead of being silently lost.
        var sentDraft = draft;
        var body = Object.assign({}, base, sentDraft);
        delete body.status; // legacy status field from earlier versions
        try {
          var saved = await magpie.options.set(body);
          base = saved && typeof saved === "object" ? Object.assign({}, body, saved) : body;
          dirty = draft !== sentDraft;
          failed = "";
        } catch (e) {
          failed = t("Save failed") + ": " + (e && e.message ? e.message : String(e));
          break;
        }
      }
    } finally {
      sending = false;
      paint();
    }
  }

  function bind() {
    $("switch").onclick = function () { mark({ enabled: !draft.enabled }, true); };
    $("mode").onchange = function () { mark({ mode: $("mode").value }, true); };
    $("source").onchange = function () { mark({ armor_source: $("source").value }, true); };
    $("armor-file").oninput = function () { mark({ armor_file: $("armor-file").value }, false); };
    $("use-file").onclick = function () {
      mark({ armor_source: "file", armor_file: $("armor-file").value.trim() }, true);
    };
    $("use-bundled").onclick = function () { mark({ armor_source: "bundled" }, true); };
    $("armor-text").oninput = function () { mark({ armor_text: $("armor-text").value }, false); };
    $("clear-text").onclick = function () { mark({ armor_text: "" }, false); };
    $("use-inline").onclick = function () { mark({ armor_source: "inline" }, true); };

    $("quick-enable").onclick = async function () {
      mark({
        enabled: true,
        mode: "enforce",
        injectArmor: true,
        stripPersonaSections: true,
        stripTaskBullets: true,
        stripEnglishAntiJobs: true,
        stripEnglishSections: true,
        targetAllOpenCode: true,
      }, false);
      await flush();
      if (!failed && !dirty) {
        showQuickResult("Enabled and saved. Next:", [
          "Go to OpenBot and chat once with any bot.",
          "Ask: “全局执行协议是否已加载？” It should answer yes.",
          "If it does not, check that the plugin is on and the armor source is not empty.",
        ]);
      } else if (failed) {
        flash(failed);
      }
    };
    $("quick-disable").onclick = function () {
      mark({ enabled: false }, true);
      flash(t("Turned off. Requests go through untouched."));
    };

    $("edit-config").onclick = function () { openJsonEditor(); };
    $("cancel-json").onclick = function () { closeJsonEditor(); };
    $("apply-json").onclick = async function () {
      var text = $("json-editor").value.trim();
      if (!text) { flash(t("JSON is empty.")); return; }
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        flash(t("Invalid JSON") + ": " + t("Check the syntax."));
        return;
      }
      var error = validateConfigJson(parsed);
      if (error) { flash(error); return; }
      // Merge into the current draft: a partial JSON edit must not silently
      // reset unrelated settings back to defaults.
      hideQuickResult();
      draft = normalize(Object.assign({}, draft, parsed));
      dirty = true;
      failed = "";
      paint();
      await flush();
      if (failed) {
        flash(failed);
        return;
      }
      closeJsonEditor();
      if (!dirty) flash(t("JSON applied and saved."));
    };

    $("copy-config").onclick = function () {
      var text = $("config-json").value;
      var done = function () { flash(t("Copied to clipboard.")); };
      var fallback = function () {
        var box = $("config-json");
        box.focus();
        box.select();
        try {
          if (document.execCommand && document.execCommand("copy")) done();
          else flash(t("Copy failed; select the text and copy it."));
        } catch (e) {
          flash(t("Copy failed; select the text and copy it."));
        }
      };
      var clipboard = null;
      try {
        clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
      } catch (e) {
        clipboard = null;
      }
      if (clipboard && clipboard.writeText) {
        try {
          var writing = clipboard.writeText(text);
          if (writing && typeof writing.then === "function") writing.then(done, fallback);
          else done();
        } catch (e) {
          fallback();
        }
      } else {
        fallback();
      }
    };

    $("import-file").onclick = function () {
      $("file-input").value = "";
      $("file-input").click();
    };
    $("file-input").onchange = async function () {
      var f = this.files && this.files[0];
      if (!f) return;
      try {
        var raw = await readSelectedFile(f);
        if (typeof raw !== "string") throw new Error("not text");
        var text = parseArmor(raw);
        if (!text) {
          flash(t("Could not read that file."));
          return;
        }
        if (utf8Bytes(text) > MAX_TEXT) {
          flash(t("File too large") + ": " + utf8Bytes(text) + " > " + MAX_TEXT);
          return;
        }
        mark({ armor_text: text, armor_source: "inline" }, false);
        flash(t("Imported") + ": " + f.name + " · " + t("Click Save to apply."));
      } catch (e) {
        flash(t("Could not read that file."));
      }
    };

    var checks = document.querySelectorAll("[data-key]");
    for (var i = 0; i < checks.length; i++) {
      checks[i].onchange = function () {
        var patch = {};
        patch[this.getAttribute("data-key")] = this.checked;
        mark(patch, true);
      };
    }

    $("profileNames").oninput = function () { mark({ profileNames: list($("profileNames").value) }, false); };
    $("origins").oninput = function () { mark({ allowedOrigins: list($("origins").value) }, false); };
    $("agents").oninput = function () { mark({ agents: list($("agents").value) }, false); };
    $("models").oninput = function () { mark({ models: list($("models").value) }, false); };
    $("timeout").onchange = function () {
      mark({ gatewayTimeoutMs: integer($("timeout").value, DEFAULTS.gatewayTimeoutMs) }, true);
    };
    $("save").onclick = function () { void flush(); };
    $("reset").onclick = function () {
      hideQuickResult();
      closeJsonEditor();
      draft = normalize(DEFAULTS);
      dirty = true;
      failed = "";
      flash(t("Defaults restored; saving…"));
      paint();
      void flush();
    };
  }

  (async function init() {
    try {
      await magpie.ready;
      if (window.__I18N__) {
        window.__I18N__.setLang((magpie.theme && magpie.theme.lang) || "en");
      }
      if (typeof magpie.onTheme === "function") {
        magpie.onTheme(function (theme) {
          if (window.__I18N__) window.__I18N__.setLang((theme && theme.lang) || "en");
          paint();
        });
      }
      try {
        base = (await magpie.options.get()) || {};
      } catch (e) {
        failed = t("Save failed") + ": " + (e && e.message ? e.message : String(e));
      }
      draft = normalize(base);
      dirty = false;
      paint();
      bind();
    } catch (e) {
      $("status").textContent = t("Save failed") + ": " + (e && e.message ? e.message : String(e));
    }
  })();
})();
