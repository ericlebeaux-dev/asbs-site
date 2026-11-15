import { submitDocumentReceipt } from "../hubspot.js";
import { checkTurnstileClosed } from "../turnstile.js";
import { pocPage } from "./page.js";
import { createDocsService } from "./service.js";
import { docsSettings } from "./settings.js";
import { createS3DocStore } from "./s3-store.js";

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  res.end(body);
}

function requestHost(req) {
  const forwarded = req.headers["x-forwarded-host"] || req.headers.host || "";
  return String(forwarded).split(",")[0].trim().split(":")[0].toLowerCase();
}

let cachedStore = null;
let cachedKey = "";

function storeFor(ctx) {
  if (ctx.docsStore) return ctx.docsStore;
  const settings = docsSettings(ctx.config.env);
  if (!settings.ready) return null;
  const key = `${settings.endpoint}|${settings.bucket}|${settings.keyId}`;
  if (!cachedStore || cachedKey !== key) {
    cachedStore = createS3DocStore(settings);
    cachedKey = key;
  }
  return cachedStore;
}

function serviceFor(ctx) {
  const settings = docsSettings(ctx.config.env);
  const store = storeFor(ctx);
  if (!settings.pageEnabled || !store || (!settings.ready && !ctx.docsStore)) return null;
  return {
    settings,
    service: createDocsService({
      store,
      settings: ctx.docsStore ? { ...settings, ready: true, maxBytes: settings.maxBytes } : settings,
      documensoFetch: ctx.documensoFetch || globalThis.fetch,
      now: () => ctx.config.now().getTime(),
    }),
  };
}

async function noteHubSpot(ctx, result) {
  if (!result?.email || !result?.receipt) return;
  await submitDocumentReceipt({
    email: result.email,
    message: result.receipt,
    leadId: result.leadId,
    env: ctx.config.env,
    fetchImpl: ctx.hubspot?.fetchImpl,
    log: ctx.hubspot?.log,
  });
}

export function serveDocsPage(req, res, ctx) {
  const settings = docsSettings(ctx.config.env);
  if (!settings.pageEnabled || (!settings.ready && !ctx.docsStore)) {
    send(res, 404, { message: "That address was not found." });
    return;
  }
  const html = pocPage();
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  res.end(html);
}

export async function handleDocsRequest(req, res, url, ctx) {
  if (!url.pathname.startsWith("/api/poc/")) return false;
  const active = serviceFor(ctx);
  if (!active) {
    send(res, 404, { message: "That address was not found." });
    return true;
  }
  const { service } = active;
  try {
    if (req.method === "POST" && url.pathname === "/api/poc/session") {
      const body = await readJson(req);
      const turnstile = await checkTurnstileClosed(body, ctx.config.env, ctx.turnstileFetch, requestHost(req));
      if (!turnstile.ok) {
        send(res, turnstile.status, { message: turnstile.message });
        return true;
      }
      const session = await service.issueSession(body);
      if (session.quiet) {
        send(res, 201, { accepted: true });
        return true;
      }
      send(res, 201, session);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/poc/uploads") {
      const result = await service.acceptUpload(req);
      await noteHubSpot(ctx, result);
      send(res, 201, { recorded: true, uploadId: result.uploadId });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/poc/authorization") {
      send(res, 201, await service.requestSignature(req));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/poc/authorization/status") {
      if (!ctx.isOwner(req)) {
        send(res, 401, { message: "Sign in to the private dashboard." });
        return true;
      }
      const body = await readJson(req);
      const result = await service.refreshSignature(String(body.leadId || ""));
      await noteHubSpot(ctx, result);
      send(res, 200, { status: result.status });
      return true;
    }
    const lead = url.pathname.match(/^\/api\/poc\/leads\/([0-9a-f-]{36})$/);
    if (req.method === "GET" && lead) {
      if (!ctx.isOwner(req)) {
        send(res, 401, { message: "Sign in to the private dashboard." });
        return true;
      }
      send(res, 200, await service.listForOwner(lead[1]));
      return true;
    }
    const link = url.pathname.match(/^\/api\/poc\/documents\/([0-9a-f-]{36})\/link$/);
    if (req.method === "POST" && link) {
      if (!ctx.isOwner(req)) {
        send(res, 401, { message: "Sign in to the private dashboard." });
        return true;
      }
      const body = await readJson(req);
      send(res, 200, await service.viewLink(String(body.leadId || ""), link[1]));
      return true;
    }
    const remove = url.pathname.match(/^\/api\/poc\/documents\/([0-9a-f-]{36})$/);
    if (req.method === "DELETE" && remove) {
      if (!ctx.isOwner(req)) {
        send(res, 401, { message: "Sign in to the private dashboard." });
        return true;
      }
      const body = await readJson(req);
      send(res, 200, await service.remove(String(body.leadId || ""), remove[1]));
      return true;
    }
    send(res, 404, { message: "That address was not found." });
    return true;
  } catch (error) {
    if (!error.status) {
      console.log(JSON.stringify({
        event: "docs",
        status: 0,
        message: String(error?.message || "error").replace(/api_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300),
      }));
    }
    send(res, error.status || 500, { message: error.status ? error.message : "The document request could not be completed." });
    return true;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        const error = new Error("The form could not be read.");
        error.status = 400;
        reject(error);
      }
    });
    req.on("error", () => {
      const error = new Error("The form could not be read.");
      error.status = 400;
      reject(error);
    });
  });
}
