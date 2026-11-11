import crypto from "node:crypto";
import { documentReceiptMessage } from "../hubspot.js";
import { auditSnapshot, createDocumensoClient } from "./documenso.js";
import { fileRule, magicMatches, safeOriginalName } from "./files.js";
import { readUploadForm } from "./multipart.js";
import { GET_EXPIRES_SECONDS, MAX_FILES, SSE_ALGORITHM, TICKET_TTL_MS } from "./settings.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BANNED = new Set(["ssn", "ein", "tin", "taxid", "socialsecurity", "socialsecuritynumber"]);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token, expectedHash) {
  const actual = Buffer.from(hashToken(token));
  const expected = Buffer.from(String(expectedHash || ""));
  return actual.length === expected.length && expected.length > 0 && crypto.timingSafeEqual(actual, expected);
}

function ticketKey(ticketId) {
  return `tickets/${ticketId}.json`;
}

function manifestKey(leadId) {
  return `leads/${leadId}/manifest.json`;
}

function nowIso(now) {
  return new Date(now).toISOString();
}

function assertNoTin(body) {
  for (const key of Object.keys(body || {})) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (BANNED.has(normalized)) fail(400, "That form could not be accepted.");
  }
}

function contactFrom(body) {
  assertNoTin(body);
  if (typeof body?.company_url === "string" && body.company_url.trim()) return null;
  const name = String(body?.name || "").trim().replace(/\s+/g, " ");
  const email = String(body?.email || "").trim().toLowerCase();
  const phone = String(body?.phone || "").trim();
  const organization = String(body?.organization || "").trim();
  if (name.length < 2 || name.length > 120) fail(400, "Enter your name.");
  if (!EMAIL.test(email) || email.length > 160) fail(400, "Enter an email address.");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) fail(400, "Enter a phone number.");
  if (organization.length < 2 || organization.length > 160) fail(400, "Enter the business name.");
  return { name, email, phone, organization };
}

function bearer(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(\S+)$/);
  return match ? match[1] : "";
}

async function loadTicket(store, ticketId) {
  return store.getJson(ticketKey(ticketId));
}

async function saveTicket(store, ticket) {
  await store.putJson(ticketKey(ticket.id), ticket);
}

async function requireTicket(store, req, now) {
  const header = bearer(req);
  const ticketId = String(req.headers["x-upload-ticket"] || "");
  if (!header || !/^[0-9a-f-]{36}$/i.test(ticketId)) fail(401, "The upload session is not valid.");
  const ticket = await loadTicket(store, ticketId);
  if (!ticket || !tokenMatches(header, ticket.tokenHash)) fail(401, "The upload session is not valid.");
  if (Date.parse(ticket.expiresAt) <= now) fail(401, "The upload session expired.");
  return ticket;
}

function audit(manifest, action, actor, extra = {}) {
  manifest.audit.push({
    at: manifest.updatedAt,
    action,
    actor,
    documentId: extra.documentId || "",
    key: extra.key || "",
  });
}

export function createDocsService({ store, settings, documensoFetch, now = () => Date.now() }) {
  const documenso = settings.signatureReady
    ? createDocumensoClient({
      baseUrl: settings.documensoBaseUrl,
      token: settings.documensoToken,
      templateId: settings.documensoTemplateId,
      fetchImpl: documensoFetch,
      deleteCompleted: settings.deleteCompleted,
    })
    : null;

  return {
    async issueSession(body) {
      if (contactFrom(body) === null) return { quiet: true };
      const contact = contactFrom(body);
      const leadId = crypto.randomUUID();
      const ticketId = crypto.randomUUID();
      const token = crypto.randomBytes(32).toString("base64url");
      const at = nowIso(now());
      const manifest = {
        leadId,
        contact,
        createdAt: at,
        updatedAt: at,
        documents: [],
        authorization: { status: "pending" },
        audit: [],
      };
      audit(manifest, "ticket", "signer");
      await store.putJson(manifestKey(leadId), manifest);
      await saveTicket(store, {
        id: ticketId,
        leadId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now() + TICKET_TTL_MS).toISOString(),
        maxFiles: MAX_FILES,
        uploads: [],
      });
      return { quiet: false, leadId, ticketId, ticket: token, expiresIn: Math.floor(TICKET_TTL_MS / 1000) };
    },

    async acceptUpload(req) {
      let ticket;
      try {
        ticket = await requireTicket(store, req, now());
      } catch (error) {
        req.resume();
        throw error;
      }
      const form = await readUploadForm(req, settings.maxBytes);
      const role = form.fields.role === "w9" || form.fields.role === "coi" ? form.fields.role : "";
      const file = form.file;
      const rule = fileRule(file?.contentType);
      if (!role || !file || !rule) fail(400, "Upload a PDF, PNG, or JPEG.");
      if (!file.bytes.length || file.bytes.length > settings.maxBytes) fail(400, "That file is too large.");
      if (!magicMatches(file.contentType, file.bytes)) fail(400, "The file contents do not match its type.");
      if (ticket.uploads.length >= ticket.maxFiles) fail(400, "This session cannot accept more files.");
      if (ticket.uploads.some((item) => item.role === role && item.status === "complete")) {
        fail(409, "That document is already on file.");
      }
      const uploadId = crypto.randomUUID();
      const key = `leads/${ticket.leadId}/${uploadId}.${rule.ext}`;
      const sha256 = crypto.createHash("sha256").update(file.bytes).digest("hex");
      await store.putBytes(key, file.bytes, file.contentType, { encryption: SSE_ALGORITHM });
      const manifest = await store.getJson(manifestKey(ticket.leadId));
      manifest.updatedAt = nowIso(now());
      manifest.documents.push({
        id: uploadId,
        role,
        key,
        sha256,
        size: file.bytes.length,
        contentType: file.contentType,
        originalName: safeOriginalName(file.filename),
        uploadedAt: manifest.updatedAt,
      });
      audit(manifest, "upload", "signer", { documentId: uploadId, key });
      await store.putJson(manifestKey(ticket.leadId), manifest);
      ticket.uploads.push({
        id: uploadId,
        role,
        key,
        contentType: file.contentType,
        size: file.bytes.length,
        originalName: safeOriginalName(file.filename),
        status: "complete",
      });
      await saveTicket(store, ticket);
      return {
        uploadId,
        leadId: ticket.leadId,
        email: manifest.contact.email,
        receipt: documentReceiptMessage({
          received: manifest.documents.map((item) => (item.role === "w9" ? "W9" : item.role === "coi" ? "COI" : "")),
          authorization: manifest.authorization.status,
        }),
      };
    },

    async requestSignature(req) {
      if (!documenso) fail(503, "Signature is not configured.");
      const ticket = await requireTicket(store, req, now());
      const manifest = await store.getJson(manifestKey(ticket.leadId));
      if (!manifest?.contact) fail(404, "That record was not found.");
      const created = await documenso.createForSigner({
        name: manifest.contact.name,
        email: manifest.contact.email,
        externalId: ticket.leadId,
      });
      manifest.updatedAt = nowIso(now());
      manifest.authorization = {
        status: "pending",
        envelopeId: created.envelopeId,
        templateId: settings.documensoTemplateId,
        updatedAt: manifest.updatedAt,
      };
      audit(manifest, "signature", "signer", { documentId: created.envelopeId });
      await store.putJson(manifestKey(ticket.leadId), manifest);
      return {
        leadId: ticket.leadId,
        status: "pending",
        signingUrl: created.signingUrl || "",
      };
    },

    async refreshSignature(leadId) {
      if (!documenso) fail(503, "Signature is not configured.");
      const manifest = await store.getJson(manifestKey(leadId));
      if (!manifest?.authorization?.envelopeId) fail(404, "There is no signature request.");
      if (manifest.authorization.status === "signed") {
        return { leadId, status: "signed", alreadyStored: true };
      }
      const envelope = await documenso.readEnvelope(manifest.authorization.envelopeId);
      if (envelope.status !== "COMPLETED") {
        manifest.updatedAt = nowIso(now());
        manifest.authorization.status = "pending";
        manifest.authorization.updatedAt = manifest.updatedAt;
        await store.putJson(manifestKey(leadId), manifest);
        return { leadId, status: "pending" };
      }
      const item = (envelope.envelopeItems || [])[0];
      if (!item?.id) fail(502, "The signed file could not be found.");
      const signed = await documenso.downloadItem(item.id, "signed");
      if (!signed?.bytes?.length) fail(502, "The signed file could not be downloaded.");
      const signedKey = `leads/${leadId}/auth/${crypto.randomUUID()}.pdf`;
      const signedHash = crypto.createHash("sha256").update(signed.bytes).digest("hex");
      await store.putBytes(signedKey, signed.bytes, "application/pdf");
      const certificate = await documenso.downloadCertificate(manifest.authorization.envelopeId);
      let certificateKey = "";
      let certificateHash = "";
      if (certificate?.bytes?.length && String(certificate.contentType).includes("pdf")) {
        certificateKey = `leads/${leadId}/auth/${crypto.randomUUID()}-certificate.pdf`;
        certificateHash = crypto.createHash("sha256").update(certificate.bytes).digest("hex");
        await store.putBytes(certificateKey, certificate.bytes, "application/pdf");
      }
      const snapshot = auditSnapshot(envelope);
      const auditKey = `leads/${leadId}/auth/${crypto.randomUUID()}-audit.json`;
      const auditBytes = Buffer.from(JSON.stringify(snapshot));
      const auditHash = crypto.createHash("sha256").update(auditBytes).digest("hex");
      await store.putBytes(auditKey, auditBytes, "application/json");
      const deletion = await documenso.deleteEnvelope(manifest.authorization.envelopeId);
      manifest.updatedAt = nowIso(now());
      manifest.documents.push(
        { id: crypto.randomUUID(), role: "signed-auth", key: signedKey, sha256: signedHash, size: signed.bytes.length, contentType: "application/pdf", originalName: "signed-authorization.pdf", uploadedAt: manifest.updatedAt },
        { id: crypto.randomUUID(), role: "audit", key: auditKey, sha256: auditHash, size: auditBytes.length, contentType: "application/json", originalName: "signature-audit.json", uploadedAt: manifest.updatedAt },
      );
      if (certificateKey) {
        manifest.documents.push({
          id: crypto.randomUUID(),
          role: "certificate",
          key: certificateKey,
          sha256: certificateHash,
          size: certificate.bytes.length,
          contentType: "application/pdf",
          originalName: "signature-certificate.pdf",
          uploadedAt: manifest.updatedAt,
        });
      }
      manifest.authorization.status = "signed";
      manifest.authorization.updatedAt = manifest.updatedAt;
      manifest.authorization.deletion = deletion;
      audit(manifest, "signature", "system", { documentId: manifest.authorization.envelopeId, key: signedKey });
      await store.putJson(manifestKey(leadId), manifest);
      return {
        leadId,
        email: manifest.contact.email,
        status: "signed",
        receipt: documentReceiptMessage({
          received: manifest.documents.map((item) => (item.role === "w9" ? "W9" : item.role === "coi" ? "COI" : "")),
          authorization: "signed",
        }),
      };
    },

    async listForOwner(leadId) {
      const manifest = await store.getJson(manifestKey(leadId));
      if (!manifest) fail(404, "That record was not found.");
      return {
        leadId: manifest.leadId,
        contact: manifest.contact,
        authorization: { status: manifest.authorization?.status || "pending" },
        documents: manifest.documents.map((item) => ({
          id: item.id,
          role: item.role,
          sha256: item.sha256,
          size: item.size,
          contentType: item.contentType,
          originalName: item.originalName,
          uploadedAt: item.uploadedAt,
        })),
        audit: manifest.audit,
      };
    },

    async viewLink(leadId, documentId) {
      const manifest = await store.getJson(manifestKey(leadId));
      const document = manifest?.documents?.find((item) => item.id === documentId);
      if (!document) fail(404, "That document was not found.");
      const signed = await store.presignGet({ key: document.key });
      manifest.updatedAt = nowIso(now());
      audit(manifest, "view", "owner", { documentId, key: document.key });
      await store.putJson(manifestKey(leadId), manifest);
      return { url: signed.url, expiresIn: signed.expiresIn || GET_EXPIRES_SECONDS };
    },

    async remove(leadId, documentId) {
      const manifest = await store.getJson(manifestKey(leadId));
      const document = manifest?.documents?.find((item) => item.id === documentId);
      if (!document) fail(404, "That document was not found.");
      await store.delete(document.key);
      manifest.documents = manifest.documents.filter((item) => item.id !== documentId);
      manifest.updatedAt = nowIso(now());
      audit(manifest, "delete", "owner", { documentId, key: document.key });
      await store.putJson(manifestKey(leadId), manifest);
      return { deleted: true };
    },
  };
}
