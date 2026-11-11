const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileConfig(env = {}) {
  const siteKey = String(env.TURNSTILE_SITE_KEY || "").trim();
  const secret = String(env.TURNSTILE_SECRET_KEY || "").trim();
  return { enabled: Boolean(siteKey && secret), siteKey, secret };
}

export function turnstilePublic(env = {}) {
  const config = turnstileConfig(env);
  if (!config.enabled) return { enabled: false };
  return { enabled: true, siteKey: config.siteKey };
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error("Turnstile verification timed out.");
    error.name = "TimeoutError";
    controller.abort(error);
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancel() { clearTimeout(timer); },
  };
}

export async function checkTurnstile(body, env = {}, fetchImpl = globalThis.fetch, timeoutMs = 8000) {
  const config = turnstileConfig(env);
  if (!config.enabled) return { ok: true, skipped: true };
  const token = typeof body?.turnstileToken === "string" ? body.turnstileToken.trim() : "";
  if (!token || token.length > 2048) {
    return { ok: false, status: 400, message: "Please confirm you are a person, then submit again." };
  }
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ secret: config.secret, response: token }),
      signal: timeout.signal,
    });
    if (!response.ok) return { ok: true, skipped: true, unavailable: true };
    const data = await response.json();
    if (data && data.success === true) return { ok: true };
    return { ok: false, status: 400, message: "Please confirm you are a person, then submit again." };
  } catch {
    return { ok: true, skipped: true, unavailable: true };
  } finally {
    timeout.cancel();
  }
}
