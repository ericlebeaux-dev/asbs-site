import assert from "node:assert/strict";
import test from "node:test";
import { buildMessages, mailerFromEnv } from "../server/mail.js";

function decode(raw) {
  const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}

test("confirmation and owner notice name the request and keep the cancellation code off the owner copy", () => {
  const messages = buildMessages({
    kind: "booking",
    name: "Test Customer",
    email: "visitor@example.com",
    phone: "(281) 555-0100",
    organization: "Example Consulting Co",
    summaryLines: [
      "Consultation: 15-minute discovery",
      "When: Tuesday, October 27, 2026 at 9:00 AM CDT",
      "Cancellation code: secret-code",
    ],
  });
  assert.match(messages.customer.text, /Thank you for reaching out to American Standard Business Solutions/);
  assert.match(messages.customer.text, /Tuesday, October 27, 2026 at 9:00 AM CDT/);
  assert.match(messages.customer.text, /Cancellation code: secret-code/);
  assert.match(messages.customer.text, /Someone will reach out promptly/);
  assert.match(messages.customer.text, /Eric LeBeaux\nAmerican Standard Business Solutions\n\(281\) 954-5167/);
  assert.equal(messages.customer.subject, "Thank you for contacting American Standard Business Solutions");
  assert.equal(messages.owner.to, "americanstandardsolutions@gmail.com");
  assert.doesNotMatch(messages.owner.text, /secret-code/);
  assert.match(messages.owner.text, /visitor@example.com/);
  const failed = buildMessages({ kind: "quote", email: "visitor@example.com", summaryLines: ["Services: Paper"] }, { customerSent: false });
  assert.match(failed.owner.text, /could not be sent/);
  assert.match(failed.owner.text, /still saved/);
});

test("Gmail send posts two messages and a failed send does not throw", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes("oauth2.googleapis.com")) {
      return { ok: true, json: async () => ({ access_token: "test-token", expires_in: 3600 }) };
    }
    return { ok: false, json: async () => ({}) };
  };
  const mailer = mailerFromEnv({
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_GMAIL_REFRESH_TOKEN: "gmail-token",
    GOOGLE_REFRESH_TOKEN: "calendar-token",
  }, fetchImpl);
  const result = await mailer.notify({
    kind: "contact",
    name: "Test Customer",
    email: "visitor@example.com",
    summaryLines: ["Topic: other", "Message: Hello"],
  });
  assert.equal(result.sent, false);
  assert.equal(result.customerSent, false);
  assert.equal(result.ownerSent, false);
  assert.equal(calls.length, 3);
  const raw = JSON.parse(calls[1].options.body).raw;
  const message = decode(raw);
  assert.match(message, /From: American Standard Business Solutions <americanstandardsolutions@gmail.com>/);
  assert.match(message, /To: visitor@example.com/);
  assert.match(message, /Eric LeBeaux/);
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
});

test("mail stays off unless the business Gmail refresh token is set", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error("network should not be used");
  };
  const calendarOnly = mailerFromEnv({
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REFRESH_TOKEN: "calendar-token",
  }, fetchImpl);
  assert.equal(calendarOnly.configured, false);
  const result = await calendarOnly.notify({ kind: "intake", email: "visitor@example.com", summaryLines: [] });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "not_configured");
  assert.equal(called, false);
});
