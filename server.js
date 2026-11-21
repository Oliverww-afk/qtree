"use strict";

global.window = globalThis;
require("./data.js");
require("./compiler.js");

const http = require("http");
const fs = require("fs");
const path = require("path");
const C = globalThis.QTreeCompiler;

const ROOT = __dirname;
loadEnv();
const PORT = Number(process.env.QTREE_PORT || 8787);
const MODEL = process.env.QTREE_OLLAMA_MODEL || "qwen2.5:7b";
const OLLAMA = process.env.QTREE_OLLAMA_URL || "http://127.0.0.1:11434";
const API_BASE = (process.env.QTREE_API_BASE || "").replace(/\/+$/, "");
const API_KEY = process.env.QTREE_API_KEY || "";
const API_MODEL = process.env.QTREE_API_MODEL || "";
const UNSAID_FILE = path.join(ROOT, "unsaid.ndjson");

function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function isSafeRemoteBase(value) {
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


const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*"
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 14000) {
        reject(new Error("body_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseModelJson(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(text); } catch (error) { /* continue */ }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("model_not_json");
}

async function callOllama(text) {
  const prompt = C.buildPrompt(text);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: "json",
        messages: [{ role: "user", content: prompt }],
        options: { temperature: 0.2, num_predict: 1800 }
      })
    });
    if (!response.ok) throw new Error(`ollama_http_${response.status}`);
    const payload = await response.json();
    return parseModelJson(payload.message && payload.message.content);
  } finally {
    clearTimeout(timer);
  }
}

async function callRemote(text, base, key, model) {
  if (!isSafeRemoteBase(base)) throw new Error("invalid_model_base");
  const prompt = C.buildPrompt(text);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      signal: controller.signal,
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
    return parseModelJson(content);
  } finally {
    clearTimeout(timer);
  }
}

async function handleCompile(request, response) {
  try {
    const body = JSON.parse(await readBody(request) || "{}");
    const text = String(body.text || "").trim().slice(0, 80);
    if (!text) return sendJson(response, 400, { ok: false, error: "empty_text" });
    if (C.hasCrisis(text)) return sendJson(response, 400, { ok: false, error: "crisis" });

    const headerKey = String(request.headers["x-api-key"] || "").trim();
    const headerBase = String(request.headers["x-api-base"] || "").trim().replace(/\/+$/, "");
    const headerModel = String(request.headers["x-api-model"] || "").trim();
    const hasAnyHeader = !!(headerKey || headerBase || headerModel);
    if (hasAnyHeader && (!headerKey || !headerBase || !headerModel)) {
      return sendJson(response, 400, { ok: false, error: "incomplete_model_credentials" });
    }

    const remote = hasAnyHeader
      ? { base: headerBase, key: headerKey, model: headerModel }
      : (API_KEY && API_BASE && API_MODEL ? { base: API_BASE, key: API_KEY, model: API_MODEL } : null);

    const started = Date.now();
    const session = remote
      ? await callRemote(text, remote.base, remote.key, remote.model)
      : await callOllama(text);
    return sendJson(response, 200, {
      ok: true,
      session,
      meta: { provider: remote ? "remote" : "ollama", model: remote ? remote.model : MODEL, elapsed_ms: Date.now() - started }
    });
  } catch (error) {
    return sendJson(response, 502, {
      ok: false,
      error: error && error.name === "AbortError" ? "timeout" : (error && error.message) || "model_error"
    });
  }
}

async function handleUnsaid(request, response) {
  try {
    const body = JSON.parse(await readBody(request) || "{}");
    const text = String(body.text || "").trim().slice(0, 200);
    if (!text) return sendJson(response, 400, { ok: false, error: "empty_text" });
    if (C.hasCrisis(text)) return sendJson(response, 400, { ok: false, error: "crisis" });
    const record = { ts: new Date().toISOString(), text };
    await fs.promises.appendFile(UNSAID_FILE, `${JSON.stringify(record)}\n`, "utf8");
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    return sendJson(response, 502, { ok: false, error: (error && error.message) || "unsaid_error" });
  }
}

async function handleHealth(response) {
  if (API_KEY && API_BASE && API_MODEL) {
    try {
      const result = await fetch(`${API_BASE}/models`, {
        headers: { "Authorization": `Bearer ${API_KEY}` }
      });
      return sendJson(response, 200, {
        ok: result.ok,
        provider: "remote",
        model: API_MODEL,
        status: result.status
      });
    } catch (error) {
      return sendJson(response, 503, { ok: false, provider: "remote", error: (error && error.message) || "remote_unreachable" });
    }
  }
  try {
    const tags = await fetch(`${OLLAMA}/api/tags`).then((item) => item.json());
    return sendJson(response, 200, {
      ok: true,
      provider: "ollama",
      model: MODEL,
      models: (tags.models || []).map((item) => item.name)
    });
  } catch (error) {
    return sendJson(response, 503, { ok: false, provider: "ollama", error: (error && error.message) || "ollama_unreachable" });
  }
}

function serveStatic(request, response) {
  const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (relative.split("/").some((part) => part.startsWith(".")) ||
      relative === "unsaid.ndjson" ||
      relative.endsWith(".log")) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }
  const file = path.resolve(ROOT, relative);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(file, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Content-Length": Buffer.byteLength(content),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-API-Base, X-API-Model"
    });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    handleHealth(response);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/compile") {
    handleCompile(request, response);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/unsaid") {
    handleUnsaid(request, response);
    return;
  }
  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }
  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`问题树 v2.1: http://127.0.0.1:${PORT}/  model=${MODEL}\n`);
});
