import crypto from "node:crypto";

const COOKIE = "asbs_session";

export function passwordsMatch(input, expected) {
  const a = crypto.createHash("sha256").update(String(input)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

export function signSession(secret, ttlMs = 12 * 60 * 60 * 1000) {
  const exp = Date.now() + ttlMs;
  const body = `v1.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(secret, token) {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp > Date.now();
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function sessionCookie(token, { secure = false } = {}) {
  const flags = [`${COOKIE}=${encodeURIComponent(token)}`, "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=43200"];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
