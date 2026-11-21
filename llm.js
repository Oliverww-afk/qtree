(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const C = root.QTreeCompiler;
  if (!C) throw new Error("QTreeCompiler missing");

  const SETTINGS_KEY = "qtreeModelSettings";

  function endpoint() {
    const config = root.QTREE_CONFIG || {};
    if (config.endpoint) return String(config.endpoint);
    const host = root.location && root.location.hostname;
    if (host === "127.0.0.1" || host === "localhost") return "/api/compile";
    return "";
  }

  function normalizeBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function normalizeSettings(value) {
    const input = value || {};
    return {
      base: normalizeBase(input.base),
      model: String(input.model || "").trim(),
      key: String(input.key || "").trim(),
      mode: input.mode === "proxy" ? "proxy" : "direct"
    };
  }

  function getSettings() {
    try {
      const saved = JSON.parse(root.localStorage.getItem(SETTINGS_KEY) || "{}");
      return normalizeSettings(saved);
    } catch (error) {
      return normalizeSettings({});
    }
  }

  function saveSettings(value) {
    const settings = normalizeSettings(value);
    try {
      root.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) { /* ignore quota */ }
    return settings;
  }

  function clearSettings() {
    try { root.localStorage.removeItem(SETTINGS_KEY); } catch (error) { /* ignore */ }
  }

  function parseJsonContent(content) {
    const text = String(content || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try { return JSON.parse(text); } catch (error) { /* continue */ }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("model_not_json");
  }

  function timeoutError() {
    const error = new Error("timeout");
    error.name = "AbortError";
    return error;
  }

  function reasonOf(error) {
    return error && error.name === "AbortError" ? "timeout" : (error && error.message) || "network_error";
  }

  function buildDirectRequest(text, settings) {
    return {
      model: settings.model,
      stream: false,
      temperature: 0.2,
      messages: [{ role: "user", content: C.buildPrompt(text) }]
    };
  }

  async function compileDirect(text, fallback, settings, opts) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs || 60000) : null;
    try {
      const response = await fetch(`${settings.base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${settings.key}`
        },
        body: JSON.stringify(buildDirectRequest(text, settings)),
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const payload = await response.json();
      const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
      const raw = typeof content === "string" ? parseJsonContent(content) : content;
      if (!raw) throw new Error("missing_session");
      const normalized = C.normalizeModel(raw, text, fallback);
      if (!normalized.ok) {
        return { ok: false, mode: "offline", session: fallback, reason: normalized.reason || "invalid_model_output" };
      }
      return {
        ok: true,
        mode: normalized.session.mode,
        session: normalized.session,
        reason: normalized.session.mode === "offline" ? "model_output_not_specific" : "",
        meta: { mode: "direct", model: settings.model }
      };
    } catch (error) {
      return { ok: false, mode: "offline", session: fallback, reason: `direct_${reasonOf(error)}` };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function compileProxy(text, fallback, settings, opts) {
    const url = endpoint();
    if (!url) return { ok: false, mode: "offline", session: fallback, reason: "no_endpoint" };
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs || 60000) : null;
    const headers = { "Content-Type": "application/json" };
    if (settings.key) {
      headers["X-API-Key"] = settings.key;
      headers["X-API-Base"] = settings.base;
      headers["X-API-Model"] = settings.model;
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: C.clip(text, 80), prompt: C.buildPrompt(text) }),
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const payload = await response.json();
      const raw = payload && (payload.session || payload.data || payload.result);
      if (!raw) throw new Error("missing_session");
      const normalized = C.normalizeModel(raw, text, fallback);
      if (!normalized.ok) {
        return { ok: false, mode: "offline", session: fallback, reason: normalized.reason || "invalid_model_output" };
      }
      return {
        ok: true,
        mode: normalized.session.mode,
        session: normalized.session,
        reason: normalized.session.mode === "offline" ? "model_output_not_specific" : "",
        meta: payload.meta || {}
      };
    } catch (error) {
      return { ok: false, mode: "offline", session: fallback, reason: reasonOf(error) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function compile(text, options) {
    const opts = options || {};
    const fallback = C.compileLocal(text);
    const settings = getSettings();

    if (settings.key && settings.base && settings.model && settings.mode === "direct") {
      return compileDirect(text, fallback, settings, opts);
    }

    return compileProxy(text, fallback, settings.key ? settings : normalizeSettings({}), opts);
  }

  async function health() {
    const settings = getSettings();
    if (settings.key && settings.base && settings.mode === "direct") {
      try {
        const response = await fetch(`${settings.base}/models`, {
          method: "GET",
          headers: { "Authorization": `Bearer ${settings.key}` }
        });
        return { ok: response.ok, mode: "direct", status: response.status };
      } catch (error) {
        return { ok: false, mode: "direct", reason: reasonOf(error) };
      }
    }
    const url = endpoint();
    if (!url) return { ok: false, reason: "no_endpoint" };
    const base = url.replace(/\/api\/compile\/?$/, "/api/health");
    try {
      const response = await fetch(base, { method: "GET" });
      return await response.json();
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  }

  const api = {
    endpoint,
    compile,
    health,
    getSettings,
    saveSettings,
    clearSettings
  };
  root.QTreeLLM = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
