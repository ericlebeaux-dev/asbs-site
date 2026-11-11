import { sanitizeDocumensoToken, sanitizeTemplateId } from "./documenso.js";

const DEFAULT_MAX = 10 * 1024 * 1024;

function text(value) {
  return String(value || "").trim();
}

export function docsSettings(env = {}) {
  const maxRaw = Number(env.DOCS_MAX_BYTES);
  const maxBytes = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.min(Math.floor(maxRaw), DEFAULT_MAX) : DEFAULT_MAX;
  const settings = {
    enabled: text(env.DOCS_ENABLED) === "1",
    endpoint: text(env.DOCS_S3_ENDPOINT),
    region: text(env.DOCS_S3_REGION),
    bucket: text(env.DOCS_S3_BUCKET),
    keyId: text(env.DOCS_S3_KEY_ID),
    secret: text(env.DOCS_S3_SECRET),
    maxBytes,
    documensoToken: sanitizeDocumensoToken(env.DOCUMENSO_API_TOKEN),
    documensoTemplateId: sanitizeTemplateId(env.DOCUMENSO_TEMPLATE_ID),
    documensoBaseUrl: text(env.DOCUMENSO_BASE_URL) || "https://app.documenso.com/api/v2",
    deleteCompleted: text(env.DOCUMENSO_DELETE_COMPLETED) === "1",
  };
  settings.ready = Boolean(
    settings.enabled
    && settings.endpoint
    && settings.region
    && settings.bucket
    && settings.keyId
    && settings.secret,
  );
  settings.signatureReady = Boolean(settings.ready && settings.documensoToken && settings.documensoTemplateId);
  return settings;
}

export const SSE_ALGORITHM = "AES256";
export const GET_EXPIRES_SECONDS = 60;
export const TICKET_TTL_MS = 15 * 60 * 1000;
export const MAX_FILES = 5;
