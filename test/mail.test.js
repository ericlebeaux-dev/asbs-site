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
  const custom = buildMessages({
    kind: "intake",
    email: "visitor@example.com",
    ownerSubject: "[TEST] ASBS audit fix",
    summaryLines: [],
  }, { owner: "americanstandardsolutions@gmail.com" });
  assert.equal(custom.owner.subject, "[TEST] ASBS audit fix");
  assert.equal(custom.owner.to, "americanstandardsolutions@gmail.com");
  assert.doesNotMatch(messages.owner.text, /secret-code/);
  assert.match(messages.owner.text, /visitor@example.com/);
  const failed = buildMessages({ kind: "quote", email: "visitor@example.com", summaryLines: ["Services: Paper"] }, { customerSent: false });
  assert.match(failed.owner.text, /could not be sent/);
  assert.match(failed.owner.text, /still saved/);
});

function gmailFetch(calls, { ok = true } = {}) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("oauth2.googleapis.com")) {
      return { ok: true, json: async () => ({ access_token: "test-token", expires_in: 3600 }) };
    }
    return { ok, json: async () => ({}) };
  };
}

function gmailEnv(extra = {}) {
  return {
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_GMAIL_REFRESH_TOKEN: "gmail-token",
    GOOGLE_REFRESH_TOKEN: "calendar-token",
    ...extra,
  };
}

function sentMessages(calls) {
  return calls
    .filter((call) => call.url.includes("/messages/send"))
    .map((call) => decode(JSON.parse(call.options.body).raw));
}

test("the default sends one owner alert and no customer message", async () => {
  const calls = [];
  const mailer = mailerFromEnv(gmailEnv(), gmailFetch(calls));
  assert.equal(mailer.customerConfirmations, false);
  const result = await mailer.notify({
    kind: "intake",
    name: "Test Customer",
    email: "visitor@example.com",
    summaryLines: ["Interest: operations"],
  });
  assert.equal(result.sent, false);
  assert.equal(result.customerSent, false);
  assert.equal(result.ownerSent, true);
  assert.equal(result.reason, null);
  const messages = sentMessages(calls);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /To: americanstandardsolutions@gmail.com/);
  assert.doesNotMatch(messages[0], /To: visitor@example.com/);
  assert.match(messages[0], /Visitor confirmation email is off/);
  assert.equal(calls.filter((call) => call.url.includes("/messages/send")).length, 1);
});

test("customer confirmation is sent only when ASBS_CUSTOMER_CONFIRMATIONS is 1", async () => {
  const calls = [];
  const mailer = mailerFromEnv(gmailEnv({ ASBS_CUSTOMER_CONFIRMATIONS: "1" }), gmailFetch(calls));
  assert.equal(mailer.customerConfirmations, true);
  const result = await mailer.notify({
    kind: "contact",
    name: "Test Customer",
    email: "visitor@example.com",
    summaryLines: ["Topic: other", "Message: Hello"],
  });
  assert.equal(result.customerSent, true);
  assert.equal(result.ownerSent, true);
  const messages = sentMessages(calls);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /To: visitor@example.com/);
  assert.match(messages[0], /Eric LeBeaux/);
  assert.match(messages[1], /To: americanstandardsolutions@gmail.com/);
  assert.match(messages[1], /The visitor confirmation was sent/);
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");

  const ownerCalls = [];
  const ownerOnly = mailerFromEnv(gmailEnv({ ASBS_CUSTOMER_CONFIRMATIONS: "1" }), gmailFetch(ownerCalls));
  const skipped = await ownerOnly.notify({
    kind: "intake",
    email: "visitor@example.com",
    ownerOnly: true,
    summaryLines: [],
  });
  assert.equal(skipped.customerSent, false);
  assert.equal(skipped.ownerSent, true);
  assert.equal(sentMessages(ownerCalls).length, 1);
  assert.match(sentMessages(ownerCalls)[0], /To: americanstandardsolutions@gmail.com/);
});

test("a failed Gmail send does not throw", async () => {
  const calls = [];
  const mailer = mailerFromEnv(gmailEnv(), gmailFetch(calls, { ok: false }));
  const result = await mailer.notify({
    kind: "contact",
    name: "Test Customer",
    email: "visitor@example.com",
    summaryLines: ["Topic: other"],
  });
  assert.equal(result.sent, false);
  assert.equal(result.customerSent, false);
  assert.equal(result.ownerSent, false);
  assert.equal(result.reason, "send_failed");
  assert.equal(sentMessages(calls).length, 1);
  assert.match(sentMessages(calls)[0], /To: americanstandardsolutions@gmail.com/);
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
