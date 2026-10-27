/** Confirmation mail. A failed send must never reject the form that already saved. */

export const MAILBOX = "americanstandardsolutions@gmail.com";

const KIND_LABEL = {
  booking: "consultation booking",
  intake: "client intake",
  contact: "message",
  quote: "quote request",
  vendor: "vendor registration",
  reschedule: "updated consultation time",
  cancel: "consultation cancellation",
};

export function mailerFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const clientId = env.GOOGLE_CLIENT_ID || "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET || "";
  const refreshToken = env.GOOGLE_GMAIL_REFRESH_TOKEN || "";
  const configured = Boolean(clientId && clientSecret && refreshToken);
  let cached = null;

  async function accessToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new Error("Gmail authorization failed.");
    }
    cached = {
      token: payload.access_token,
      expiresAt: Date.now() + (Number(payload.expires_in) || 3000) * 1000,
    };
    return cached.token;
  }

  async function send(message) {
    const token = await accessToken();
    const response = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: rfc2822(message) }),
    });
    if (!response.ok) throw new Error("Gmail did not accept the message.");
  }

  return {
    configured,
    from: MAILBOX,
    reason: configured ? null : "Gmail send is not configured.",
    async notify(submission) {
      if (!configured) return { sent: false, reason: "not_configured", customerSent: false, ownerSent: false };
      const messages = buildMessages(submission);
      let customerSent = false;
      let ownerSent = false;
      try {
        await send(messages.customer);
        customerSent = true;
      } catch {
        customerSent = false;
      }
      try {
        await send(buildMessages(submission, { customerSent }).owner);
        ownerSent = true;
      } catch {
        ownerSent = false;
      }
      return {
        sent: customerSent,
        customerSent,
        ownerSent,
        reason: customerSent ? null : "send_failed",
      };
    },
  };
}

export function buildMessages(submission, { customerSent = true } = {}) {
  const kind = KIND_LABEL[submission.kind] || "request";
  const lines = (submission.summaryLines || []).filter(Boolean);
  const customerClosing = submission.kind === "cancel"
    ? "The time is no longer held. Call us if you would like another time."
    : "Someone will reach out promptly.";
  const customerText = [
    "Thank you for reaching out to American Standard Business Solutions.",
    "",
    `We received your ${kind}.`,
    "",
    "What you submitted:",
    ...lines.map((line) => `- ${line}`),
    "",
    "This note confirms we received your request. It is not a contract or an invoice.",
    "",
    customerClosing,
    "",
    "Eric LeBeaux",
    "American Standard Business Solutions",
    "(281) 954-5167",
  ].join("\n");
  const ownerText = [
    "A new submission was saved on the ASBS website.",
    "",
    `Type: ${kind}`,
    `Name: ${submission.name || ""}`,
    `Email: ${submission.email || ""}`,
    `Phone: ${submission.phone || ""}`,
    `Organization: ${submission.organization || ""}`,
    "",
    "Details:",
    ...lines.filter((line) => !/^Cancellation code:/i.test(line)).map((line) => `- ${line}`),
    "",
    customerSent
      ? "The visitor confirmation was sent."
      : "The visitor confirmation could not be sent. The form was still saved.",
  ].join("\n");
  const subjectKind = kind.charAt(0).toUpperCase() + kind.slice(1);
  return {
    customer: {
      to: submission.email,
      subject: "Thank you for contacting American Standard Business Solutions",
      text: customerText,
    },
    owner: {
      to: MAILBOX,
      subject: `ASBS website submission: ${subjectKind}`,
      text: ownerText,
    },
  };
}

function rfc2822({ to, subject, text }) {
  const headers = [
    `From: American Standard Business Solutions <${MAILBOX}>`,
    `To: ${oneLine(to)}`,
    `Subject: ${oneLine(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${text}`, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function oneLine(value) {
  return String(value || "").replace(/[\r\n]/g, " ").trim();
}
