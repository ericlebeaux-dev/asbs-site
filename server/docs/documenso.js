function normalizeToken(value) {
  let token = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  token = token.replace(/^Bearer\s+/i, "").trim();
  return token.replace(/[\r\n]/g, "");
}

function scrub(value, token) {
  let text = String(value || "");
  if (token) text = text.split(token).join("[redacted]");
  text = text.replace(/api_[A-Za-z0-9_-]+/g, "[redacted]");
  text = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return text.slice(0, 300);
}

function logStep(log, step, { status = 0, ok = false, code = "", message = "" } = {}, token = "") {
  log(JSON.stringify({
    event: "documenso",
    step,
    status,
    ok: Boolean(ok),
    code: scrub(code, token).slice(0, 80),
    message: scrub(message, token),
  }));
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: String(text).slice(0, 300) };
  }
}

function errorText(body) {
  const issues = Array.isArray(body?.issues)
    ? body.issues.map((item) => item?.message).filter(Boolean).join("; ")
    : "";
  return [body?.message, issues].filter(Boolean).join(" ");
}

function signerOf(template) {
  const recipients = Array.isArray(template?.recipients) ? template.recipients : [];
  return recipients.find((item) => String(item.role || "").toUpperCase() === "SIGNER") || recipients[0] || null;
}

function recipientId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function signingUrlFrom(payload) {
  const recipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
  const match = recipients.find((item) => item.signingUrl) || recipients[0];
  return match?.signingUrl || "";
}

function envelopeIdFrom(payload) {
  if (typeof payload?.envelopeId === "string" && payload.envelopeId) return payload.envelopeId;
  if (typeof payload?.id === "string" && payload.id) return payload.id;
  return "";
}

function isPdf(bytes) {
  const sample = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  return sample.length >= 4 && sample.subarray(0, 4).equals(Buffer.from("%PDF"));
}

export function createDocumensoClient({ baseUrl, token, templateId, fetchImpl, deleteCompleted = false, log = console.log }) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  const authToken = normalizeToken(token);
  const configuredId = String(templateId || "").trim();
  const writeLog = (step, details) => logStep(log, step, details, authToken);

  function headers(extra = {}) {
    return { Authorization: authToken, Accept: "application/json", ...extra };
  }

  async function request(step, path, options = {}) {
    try {
      return await fetchImpl(`${root}${path}`, {
        ...options,
        headers: headers(options.headers || {}),
      });
    } catch (error) {
      writeLog(step, { status: 0, ok: false, message: error?.message || "network" });
      fail(502, "The signature service could not be reached.");
    }
  }

  async function readJson(step, response) {
    const body = parseJson(await response.text());
    if (response.ok) writeLog(step, { status: response.status, ok: true });
    else writeLog(step, { status: response.status, ok: false, code: body.code || "", message: errorText(body) });
    return body;
  }

  async function readDownload(step, response) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      const body = parseJson(bytes.toString("utf8"));
      writeLog(step, { status: response.status, ok: false, code: body.code || "", message: errorText(body) });
      return null;
    }
    writeLog(step, { status: response.status, ok: true });
    if (!isPdf(bytes)) return null;
    return { bytes, contentType: "application/pdf" };
  }

  async function distribute(envelopeId) {
    const response = await request("envelope.distribute", "/envelope/distribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envelopeId, meta: { distributionMethod: "EMAIL" } }),
    });
    const body = await readJson("envelope.distribute", response);
    if (!response.ok) fail(502, `The signature email could not be sent (${response.status}).`);
    return body;
  }

  function createdResult(body) {
    return {
      envelopeId: envelopeIdFrom(body),
      signingUrl: signingUrlFrom(body),
      status: body.status || "",
    };
  }

  async function finishCreate(body) {
    const created = createdResult(body);
    if (!created.envelopeId) fail(502, "The signature request did not return a document id.");
    if (created.status === "DRAFT" || (!created.status && !created.signingUrl)) {
      const sent = await distribute(created.envelopeId);
      created.signingUrl = signingUrlFrom(sent) || created.signingUrl;
      created.status = "PENDING";
    }
    return created;
  }

  return {
    async createForSigner({ name, email, externalId }) {
      const numeric = /^[0-9]+$/.test(configuredId);
      if (numeric) {
        const templateResponse = await request("template.get", `/template/${encodeURIComponent(configuredId)}`);
        const template = await readJson("template.get", templateResponse);
        if (!templateResponse.ok) fail(502, `The signature template could not be read (${templateResponse.status}).`);
        const id = recipientId(signerOf(template)?.id);
        if (id == null) fail(502, "The signature template has no signer.");
        const createdResponse = await request("template.use", "/template/use", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: Number(configuredId),
            externalId,
            distributeDocument: true,
            recipients: [{ id, email, name }],
          }),
        });
        const created = await readJson("template.use", createdResponse);
        if (!createdResponse.ok) fail(502, `The signature request could not be created (${createdResponse.status}).`);
        return finishCreate(created);
      }

      const templateResponse = await request("envelope.get", `/envelope/${encodeURIComponent(configuredId)}`);
      const template = await readJson("envelope.get", templateResponse);
      if (!templateResponse.ok) fail(502, `The signature template could not be read (${templateResponse.status}).`);
      const id = recipientId(signerOf(template)?.id);
      if (id == null) fail(502, "The signature template has no signer.");
      const form = new FormData();
      form.append("payload", JSON.stringify({
        envelopeId: String(template.id || configuredId),
        externalId,
        distributeDocument: true,
        recipients: [{ id, email, name }],
      }));
      const createdResponse = await request("envelope.use", "/envelope/use", { method: "POST", body: form });
      const created = await readJson("envelope.use", createdResponse);
      if (!createdResponse.ok) fail(502, `The signature request could not be created (${createdResponse.status}).`);
      return finishCreate(created);
    },
    async readEnvelope(envelopeId) {
      const response = await request("envelope.read", `/envelope/${encodeURIComponent(envelopeId)}`);
      const body = await readJson("envelope.read", response);
      if (!response.ok) fail(502, `The signature status could not be read (${response.status}).`);
      return body;
    },
    async downloadItem(itemId, version) {
      const response = await request("envelope.item.download", `/envelope/item/${encodeURIComponent(itemId)}/download?version=${encodeURIComponent(version)}`);
      return readDownload("envelope.item.download", response);
    },
    async downloadCertificate(envelopeId) {
      const response = await request("envelope.certificate.download", `/envelope/${encodeURIComponent(envelopeId)}/certificate/download`);
      return readDownload("envelope.certificate.download", response);
    },
    async deleteEnvelope(envelopeId) {
      if (!deleteCompleted) return { attempted: false, ok: false };
      const response = await request("envelope.delete", "/envelope/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelopeId }),
      });
      await readJson("envelope.delete", response);
      return { attempted: true, ok: response.ok, status: response.status };
    },
  };
}

export function auditSnapshot(envelope) {
  const recipients = Array.isArray(envelope?.recipients) ? envelope.recipients : [];
  return {
    id: envelope?.id || envelope?.envelopeId || "",
    status: envelope?.status || "",
    completedAt: envelope?.completedAt || null,
    recipients: recipients.map((item) => ({
      name: item.name || "",
      email: item.email || "",
      role: item.role || "",
      signingStatus: item.signingStatus || item.status || "",
      signedAt: item.signedAt || null,
    })),
  };
}
