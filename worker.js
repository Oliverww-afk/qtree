"use strict";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-API-Base, X-API-Model"
};

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function safeBase(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "0.0.0.0" || host === "[::1]") return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return false;
    return true;
  } catch (error) {
    return false;
  }
}

function parseJsonContent(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(text); } catch (error) { /* continue */ }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("model_not_json");
}

async function callModel(prompt, base, key, model) {
  if (!safeBase(base)) throw new Error("invalid_model_base");
  const response = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) throw new Error(`model_http_${response.status}`);
  const payload = await response.json();
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
  return parseJsonContent(content);
}

async function compile(request, env) {
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim().slice(0, 80);
  const prompt = String(body.prompt || "").trim();
  if (!text) return json(400, { ok: false, error: "empty_text" });
  if (!prompt || prompt.length > 12000) return json(400, { ok: false, error: "missing_prompt" });

  const headerKey = String(request.headers.get("X-API-Key") || "").trim();
  const headerBase = String(request.headers.get("X-API-Base") || "").trim();
  const headerModel = String(request.headers.get("X-API-Model") || "").trim();
  const hasAnyHeader = !!(headerKey || headerBase || headerModel);
  if (hasAnyHeader && (!headerKey || !headerBase || !headerModel)) {
    return json(400, { ok: false, error: "incomplete_model_credentials" });
  }

  const remote = hasAnyHeader
    ? { base: headerBase, key: headerKey, model: headerModel }
    : (env.MODEL_API_KEY && env.MODEL_API_BASE && env.MODEL_API_MODEL
      ? { base: env.MODEL_API_BASE, key: env.MODEL_API_KEY, model: env.MODEL_API_MODEL }
      : null);

  if (!remote) return json(503, { ok: false, error: "model_not_configured" });

  const started = Date.now();
  const session = await callModel(prompt, remote.base, remote.key, remote.model);
  return json(200, {
    ok: true,
    session,
    meta: { provider: "worker", model: remote.model, elapsed_ms: Date.now() - started }
  });
}

async function health(env) {
  if (!env.MODEL_API_KEY || !env.MODEL_API_BASE || !env.MODEL_API_MODEL) {
    return json(200, { ok: false, provider: "worker", error: "model_not_configured" });
  }
  try {
    const response = await fetch(`${env.MODEL_API_BASE.replace(/\/+$/, "")}/models`, {
      headers: { "Authorization": `Bearer ${env.MODEL_API_KEY}` }
    });
    return json(200, { ok: response.ok, provider: "worker", model: env.MODEL_API_MODEL, status: response.status });
  } catch (error) {
    return json(503, { ok: false, provider: "worker", error: String(error && error.message || error) });
  }
}

async function unsaid(request, env) {
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim().slice(0, 200);
  if (!text) return json(400, { ok: false, error: "empty_text" });
  if (!env.UNSAID_KV) return json(503, { ok: false, error: "unsaid_not_configured" });
  await env.UNSAID_KV.put(
    `unsaid:${Date.now()}:${crypto.randomUUID()}`,
    JSON.stringify({ ts: new Date().toISOString(), text })
  );
  return json(200, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "GET" && url.pathname === "/api/health") return health(env);
    if (request.method === "POST" && url.pathname === "/api/compile") {
      try {
        return await compile(request, env);
      } catch (error) {
        return json(502, { ok: false, error: String(error && error.message || error) });
      }
    }
    if (request.method === "POST" && url.pathname === "/api/unsaid") {
      try {
        return await unsaid(request, env);
      } catch (error) {
        return json(502, { ok: false, error: String(error && error.message || error) });
      }
    }
    return json(404, { ok: false, error: "not_found" });
  }
};
