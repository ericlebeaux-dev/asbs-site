import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../server/app.js";
import { createDocumensoClient } from "../server/docs/documenso.js";
import { createMemoryDocStore } from "../server/docs/memory-store.js";
import { encryptedPutInput } from "../server/docs/s3-store.js";
import { documentReceiptMessage } from "../server/hubspot.js";

const NOW = Date.parse("2026-11-11T01:00:00.000Z");
const PDF = Buffer.from("%PDF-1.4\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function docsEnv(extra = {}) {
  return {
    ASBS_ENV: "staging",
    ASBS_DASHBOARD_PASSWORD: "test-dashboard-password",
    ASBS_SESSION_SECRET: "test-session-secret",
    DOCS_ENABLED: "1",
    DOCS_S3_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    DOCS_S3_REGION: "us-west-004",
    DOCS_S3_BUCKET: "asbs-docs-test",
    DOCS_S3_KEY_ID: "key",
    DOCS_S3_SECRET: "secret",
    TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    DOCUMENSO_API_TOKEN: "api_test",
    DOCUMENSO_TEMPLATE_ID: "envelope_template",
    ...extra,
  };
}

function turnstileOk(hostname = "127.0.0.1") {
  return async () => new Response(JSON.stringify({ success: true, hostname }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function boot(overrides = {}) {
  const store = Object.hasOwn(overrides, "store") ? overrides.store : createMemoryDocStore();
  const hubspotCalls = [];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asbs-docs-"));
  const app = createApp({
    dataDir,
    rootDir: path.resolve("."),
    now: () => new Date(NOW),
    calendar: { configured: false, reason: "test", async listBusy() { throw new Error("no"); } },
    mailer: { configured: false, async notify() { return { sent: false }; } },
    hubspotFetch: async (_url, init) => {
      hubspotCalls.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    },
    turnstileFetch: overrides.turnstileFetch || turnstileOk(),
    documensoFetch: overrides.documensoFetch || (async () => new Response("{}", { status: 404 })),
    docsStore: store,
    env: docsEnv(overrides.env),
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  return {
    app,
    store,
    hubspotCalls,
    dataDir,
    base: `http://127.0.0.1:${app.server.address().port}`,
    async stop() {
      app.server.close();
      await once(app.server, "close");
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function uploadFile(base, auth, { role, filename, type, bytes }) {
  const form = new FormData();
  form.append("role", role);
  form.append("file", new File([bytes], filename, { type }));
  const response = await fetch(base + "/api/poc/uploads", { method: "POST", headers: auth, body: form });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : {} };
}

async function json(base, method, pathname, body, headers = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : {}, headers: response.headers };
}

const contact = {
  name: "TEST ASBS Fixes - Do Not Contact",
  organization: "TEST - delete me",
  email: "docs-poc@example.com",
  phone: "000-000-0000",
  company_url: "",
  turnstileToken: "token",
};

test("the proof of concept stays hidden until document storage is configured", async () => {
  const ctx = await boot({ env: { DOCS_ENABLED: "" }, store: null, docsOff: true });
  try {
    const page = await fetch(ctx.base + "/poc/onboarding");
    const session = await json(ctx.base, "POST", "/api/poc/session", contact);
    assert.equal(page.status, 404);
    assert.equal(session.status, 404);
  } finally {
    await ctx.stop();
  }
});

test("upload tickets expire, cannot be reused, and reject the wrong type, size, or magic bytes", async () => {
  const ctx = await boot({ env: { DOCS_MAX_BYTES: "16" } });
  try {
    const session = await json(ctx.base, "POST", "/api/poc/session", contact);
    assert.equal(session.status, 201);
    const auth = { Authorization: `Bearer ${session.data.ticket}`, "X-Upload-Ticket": session.data.ticketId };
    const page = await fetch(ctx.base + "/poc/onboarding");
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /STAGING PROOF OF CONCEPT, do not upload real tax documents/);
    assert.match(html, /noindex/);
    assert.match(page.headers.get("x-robots-tag"), /noindex/);
    assert.match(html, /body\.append\("file"/);
    assert.equal(html.includes('method: "PUT"'), false);

    const asJson = await json(ctx.base, "POST", "/api/poc/uploads", {
      role: "w9", filename: "w9.pdf", contentType: "application/pdf", data: PDF.toString("base64"),
    }, auth);
    assert.equal(asJson.status, 400);

    const wrongType = await uploadFile(ctx.base, auth, {
      role: "w9", filename: "notes.txt", type: "text/plain", bytes: Buffer.from("hello notes"),
    });
    assert.equal(wrongType.status, 400);

    const tooBig = await uploadFile(ctx.base, auth, {
      role: "w9", filename: "w9.pdf", type: "application/pdf", bytes: Buffer.concat([PDF, Buffer.alloc(20)]),
    });
    assert.equal(tooBig.status, 400);

    const spoofed = await uploadFile(ctx.base, auth, {
      role: "w9", filename: "w9.pdf", type: "application/pdf", bytes: PNG,
    });
    assert.equal(spoofed.status, 400);
    const before = await ctx.store.getJson(`leads/${session.data.leadId}/manifest.json`);
    assert.equal(before.documents.length, 0);

    const good = await uploadFile(ctx.base, auth, {
      role: "w9", filename: "w9.pdf", type: "application/pdf", bytes: PDF,
    });
    assert.equal(good.status, 201);
    const manifest = await ctx.store.getJson(`leads/${session.data.leadId}/manifest.json`);
    const saved = manifest.documents[0];
    const meta = await ctx.store.head(saved.key);
    assert.equal(meta.encryption, "AES256");
    assert.equal(meta.size, PDF.length);
    assert.equal(saved.sha256, crypto.createHash("sha256").update(PDF).digest("hex"));
    assert.equal(manifest.audit.some((item) => item.action === "upload"), true);
    const again = await uploadFile(ctx.base, auth, {
      role: "w9", filename: "w9-again.pdf", type: "application/pdf", bytes: PDF,
    });
    assert.equal(again.status, 409);
    const receipt = ctx.hubspotCalls.at(-1);
    assert.deepEqual(receipt.fields.map((field) => field.name), ["email", "message"]);
    assert.equal(receipt.fields[1].value, "documents received: W9; authorization: pending");
    assert.equal(JSON.stringify(receipt).includes("%PDF"), false);
    assert.equal(JSON.stringify(receipt).toLowerCase().includes("tin"), false);

    const ticket = await ctx.store.getJson(`tickets/${session.data.ticketId}.json`);
    ticket.expiresAt = new Date(NOW - 1000).toISOString();
    await ctx.store.putJson(`tickets/${session.data.ticketId}.json`, ticket);
    const expired = await uploadFile(ctx.base, auth, {
      role: "coi", filename: "coi.pdf", type: "application/pdf", bytes: PDF,
    });
    assert.equal(expired.status, 401);
  } finally {
    await ctx.stop();
  }
});

test("Turnstile must succeed for the document flow and viewing requires the dashboard session", async () => {
  const unreachable = await boot({
    turnstileFetch: async () => { throw new Error("cloudflare down"); },
  });
  try {
    const refused = await json(unreachable.base, "POST", "/api/poc/session", contact);
    assert.equal(refused.status, 503);
    assert.equal(refused.data.ticket, undefined);
  } finally {
    await unreachable.stop();
  }

  const ctx = await boot();
  try {
    const session = await json(ctx.base, "POST", "/api/poc/session", contact);
    const auth = { Authorization: `Bearer ${session.data.ticket}`, "X-Upload-Ticket": session.data.ticketId };
    const created = await uploadFile(ctx.base, auth, {
      role: "coi", filename: "coi.png", type: "image/png", bytes: PNG,
    });
    assert.equal(created.status, 201);
    const manifest = await ctx.store.getJson(`leads/${session.data.leadId}/manifest.json`);
    const documentId = manifest.documents[0].id;

    const anonymous = await json(ctx.base, "POST", `/api/poc/documents/${documentId}/link`, { leadId: session.data.leadId });
    assert.equal(anonymous.status, 401);
    const login = await json(ctx.base, "POST", "/api/auth/login", { password: "test-dashboard-password" });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const link = await json(ctx.base, "POST", `/api/poc/documents/${documentId}/link`, { leadId: session.data.leadId }, { cookie });
    assert.equal(link.status, 200);
    assert.equal(link.data.expiresIn, 60);
    assert.match(link.data.url, /^https:\/\/storage\.example\/get\//);
    const after = await ctx.store.getJson(`leads/${session.data.leadId}/manifest.json`);
    assert.equal(after.audit.some((item) => item.action === "view"), true);
    assert.equal(JSON.stringify(after).includes("%PDF"), false);
    const anonymousDelete = await json(ctx.base, "DELETE", `/api/poc/documents/${documentId}`, { leadId: session.data.leadId });
    assert.equal(anonymousDelete.status, 401);
    const removed = await json(ctx.base, "DELETE", `/api/poc/documents/${documentId}`, { leadId: session.data.leadId }, { cookie });
    assert.equal(removed.status, 200);
    const deleted = await ctx.store.getJson(`leads/${session.data.leadId}/manifest.json`);
    assert.equal(deleted.documents.some((item) => item.id === documentId), false);
    assert.equal(deleted.audit.some((item) => item.action === "delete"), true);
  } finally {
    await ctx.stop();
  }
});

test("signature status is polled from a mocked Documenso client", async () => {
  const calls = [];
  const documensoFetch = async (url, init = {}) => {
    const entry = { url, method: init.method || "GET", authorization: init.headers?.Authorization || "" };
    if (url.endsWith("/envelope/use")) entry.payload = JSON.parse(String(init.body.get("payload")));
    calls.push(entry);
    if (url.endsWith("/envelope/envelope_template")) {
      return new Response(JSON.stringify({ id: "envelope_template", type: "TEMPLATE", recipients: [{ id: 7, role: "SIGNER", email: "" }] }), { status: 200 });
    }
    if (url.endsWith("/envelope/use")) {
      return new Response(JSON.stringify({
        id: "envelope_created",
        status: "PENDING",
        recipients: [{ signingUrl: "https://app.documenso.com/sign/sample" }],
      }), { status: 200 });
    }
    if (url.endsWith("/envelope/envelope_created")) {
      return new Response(JSON.stringify({
        id: "envelope_created",
        status: "COMPLETED",
        completedAt: "2026-11-11T02:00:00.000Z",
        envelopeItems: [{ id: "item_1" }],
        recipients: [{ name: "TEST", email: "docs-poc@example.com", role: "SIGNER", signingStatus: "SIGNED", signedAt: "2026-11-11T02:00:00.000Z", token: "secret-token" }],
      }), { status: 200 });
    }
    if (url.includes("/download?version=signed")) {
      return new Response(PDF, { status: 200, headers: { "Content-Type": "application/pdf" } });
    }
    if (url.endsWith("/envelope/envelope_created/certificate/download")) {
      return new Response(PDF, { status: 200, headers: { "Content-Type": "application/pdf" } });
    }
    return new Response(JSON.stringify({ message: "no", code: "not_found" }), { status: 400 });
  };
  const ctx = await boot({ documensoFetch });
  try {
    const session = await json(ctx.base, "POST", "/api/poc/session", contact);
    const auth = { Authorization: `Bearer ${session.data.ticket}`, "X-Upload-Ticket": session.data.ticketId };
    const requested = await json(ctx.base, "POST", "/api/poc/authorization", {}, auth);
    assert.equal(requested.status, 201);
    assert.equal(requested.data.signingUrl, "https://app.documenso.com/sign/sample");
    const used = calls.find((item) => item.url.endsWith("/envelope/use"));
    assert.equal(used.authorization, "api_test");
    assert.equal(used.payload.envelopeId, "envelope_template");
    assert.equal(used.payload.distributeDocument, true);
    assert.equal(used.payload.recipients[0].id, 7);
    assert.equal(calls.some((item) => item.url.endsWith("/envelope/distribute")), false);
    const login = await json(ctx.base, "POST", "/api/auth/login", { password: "test-dashboard-password" });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const denied = await json(ctx.base, "POST", "/api/poc/authorization/status", { leadId: session.data.leadId });
    assert.equal(denied.status, 401);
    const status = await json(ctx.base, "POST", "/api/poc/authorization/status", { leadId: session.data.leadId }, { cookie });
    assert.equal(status.status, 200);
    assert.equal(status.data.status, "signed");
    const manifest = await ctx.store.getJson(`leads/${session.data.leadId}/manifest.json`);
    assert.equal(manifest.authorization.status, "signed");
    assert.equal(JSON.stringify(manifest).includes("secret-token"), false);
    assert.equal(manifest.documents.some((item) => item.role === "signed-auth" && item.sha256.length === 64), true);
    assert.equal(manifest.documents.some((item) => item.role === "certificate"), true);
    assert.equal(calls.some((item) => item.url.endsWith("/certificate/download")), true);
    assert.equal(calls.some((item) => item.url.includes("version=certificate")), false);
    const signed = manifest.documents.find((item) => item.role === "signed-auth");
    const bytes = await ctx.store.getBytes(signed.key);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), signed.sha256);
  } finally {
    await ctx.stop();
  }
});

test("Documenso accepts an envelope id or a numeric template id and logs without the token", async () => {
  const lines = [];
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method || "GET",
        authorization: init.headers?.Authorization || "",
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
      if (url.endsWith("/template/25481")) {
        return new Response(JSON.stringify({ id: 25481, envelopeId: "envelope_from_template", recipients: [{ id: 9, role: "SIGNER", email: "" }] }), { status: 200 });
      }
      if (url.endsWith("/template/use")) {
        return new Response(JSON.stringify({ id: 789, envelopeId: "envelope_from_template", status: "DRAFT", recipients: [{ id: 9, email: "signer@example.com" }] }), { status: 200 });
      }
      if (url.endsWith("/envelope/distribute")) {
        return new Response(JSON.stringify({ success: true, id: "envelope_from_template", recipients: [{ signingUrl: "https://app.documenso.com/sign/draft" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "missing", code: "missing" }), { status: 404 });
    };
    const client = createDocumensoClient({
      baseUrl: "https://app.documenso.com/api/v2",
      token: "Bearer api_secret_token",
      templateId: "25481",
      fetchImpl,
      log: (line) => lines.push(line),
    });
    const created = await client.createForSigner({ name: "Signer", email: "signer@example.com", externalId: "lead-1" });
    assert.equal(created.envelopeId, "envelope_from_template");
    assert.equal(created.signingUrl, "https://app.documenso.com/sign/draft");
    assert.equal(calls[0].authorization, "api_secret_token");
    assert.equal(calls[1].body.templateId, 25481);
    assert.equal(calls[1].body.recipients[0].id, 9);
    assert.equal(calls[1].body.distributeDocument, true);
    assert.equal(calls[2].url.endsWith("/envelope/distribute"), true);
    assert.equal(calls[2].body.envelopeId, "envelope_from_template");
    assert.equal(calls[2].body.meta.distributionMethod, "EMAIL");
    const logged = lines.map((line) => JSON.parse(line));
    assert.equal(logged.some((item) => item.step === "template.get" && item.status === 200), true);
    assert.equal(logged.some((item) => item.step === "envelope.distribute" && item.status === 200), true);
    assert.equal(lines.join("\n").includes("api_secret_token"), false);
});

test("the HubSpot document note cannot carry a file or a TIN", () => {
  const message = documentReceiptMessage({ received: ["W9", "COI", "signed-auth"], authorization: "signed" });
  assert.equal(message, "documents received: W9, COI; authorization: signed");
  assert.equal(message.toLowerCase().includes("tin"), false);
  assert.equal(message.includes("%PDF"), false);
  const input = encryptedPutInput({
    bucket: "asbs-intake-docs-staging",
    key: "leads/example/file.pdf",
    body: PDF,
    contentType: "application/pdf",
  });
  assert.equal(input.Bucket, "asbs-intake-docs-staging");
  assert.equal(input.ServerSideEncryption, "AES256");
  assert.equal(input.Key.startsWith("leads/"), true);
});
