function authHeaders(token, extra = {}) {
  return { Authorization: token, Accept: "application/json", ...extra };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 180) };
  }
}

function signerOf(template) {
  const recipients = Array.isArray(template?.recipients) ? template.recipients : [];
  return recipients.find((item) => String(item.role || "").toUpperCase() === "SIGNER") || recipients[0] || null;
}

function signingUrlFrom(payload) {
  const recipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
  const match = recipients.find((item) => item.signingUrl) || recipients[0];
  return match?.signingUrl || "";
}

export function createDocumensoClient({ baseUrl, token, templateId, fetchImpl, deleteCompleted = false }) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  async function call(path, options = {}) {
    const response = await fetchImpl(`${root}${path}`, {
      ...options,
      headers: authHeaders(token, options.headers || {}),
    });
    return response;
  }

  return {
    async createForSigner({ name, email, externalId }) {
      const templateResponse = await call(`/envelope/${encodeURIComponent(templateId)}`);
      const template = await readJson(templateResponse);
      if (!templateResponse.ok) {
        const error = new Error("The signature template could not be read.");
        error.status = 502;
        throw error;
      }
      const signer = signerOf(template);
      if (!signer || signer.id == null) {
        const error = new Error("The signature template has no signer.");
        error.status = 502;
        throw error;
      }
      const form = new FormData();
      form.append("payload", JSON.stringify({
        envelopeId: template.envelopeId || template.id || templateId,
        externalId,
        distributeDocument: true,
        recipients: [{ id: signer.id, email, name }],
      }));
      const createdResponse = await call("/envelope/use", { method: "POST", body: form });
      const created = await readJson(createdResponse);
      if (!createdResponse.ok) {
        const error = new Error("The signature request could not be created.");
        error.status = 502;
        throw error;
      }
      return {
        envelopeId: created.id || created.envelopeId,
        signingUrl: signingUrlFrom(created),
        status: created.status || "PENDING",
      };
    },
    async readEnvelope(envelopeId) {
      const response = await call(`/envelope/${encodeURIComponent(envelopeId)}`);
      const body = await readJson(response);
      if (!response.ok) {
        const error = new Error("The signature status could not be read.");
        error.status = 502;
        throw error;
      }
      return body;
    },
    async downloadItem(itemId, version) {
      const response = await call(`/envelope/item/${encodeURIComponent(itemId)}/download?version=${encodeURIComponent(version)}`);
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      return { bytes, contentType: response.headers.get("content-type") || "application/pdf" };
    },
    async deleteEnvelope(envelopeId) {
      if (!deleteCompleted) return { attempted: false, ok: false };
      const response = await call("/envelope/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelopeId }),
      });
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
