import { mailerFromEnv } from "../server/mail.js";

const mailer = mailerFromEnv(process.env);
const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_GMAIL_REFRESH_TOKEN"]
  .filter((name) => !String(process.env[name] || "").trim());

if (!mailer.configured) {
  console.log(JSON.stringify({
    sent: false,
    reason: "not_configured",
    missing,
    needed: {
      GOOGLE_CLIENT_ID: "Google OAuth client id",
      GOOGLE_CLIENT_SECRET: "Google OAuth client secret",
      GOOGLE_GMAIL_REFRESH_TOKEN: "OAuth refresh token for americanstandardsolutions@gmail.com with the gmail.send scope",
    },
  }, null, 2));
  process.exit(2);
}

const result = await mailer.notify({
  kind: "intake",
  name: "TEST ASBS audit",
  email: "americanstandardsolutions@gmail.com",
  phone: "000-000-0000",
  organization: "TEST - delete me",
  ownerSubject: "[TEST] ASBS audit fix",
  summaryLines: ["TEST lead from the audit-fix branch. Do not contact."],
  ownerOnly: true,
});
console.log(JSON.stringify({ sent: result.ownerSent === true, ownerSent: result.ownerSent === true, reason: result.reason || null }));
process.exit(result.ownerSent ? 0 : 1);
