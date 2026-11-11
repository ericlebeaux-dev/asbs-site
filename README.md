# American Standard Business Solutions

Public website for American Standard Business Solutions, LLC, plus a small staging server for intake, vendor registration, contact messages, and a private dashboard. Free consultations are scheduled directly with ASBS. The public pages do not offer an on-site time picker.

The live site is GitHub Pages from `main` at <https://www.americanstandardbusinesssolutions.com/>. Do not merge this work, change the Pages source, or change DNS until the owner approves it.

## Run the staging server

```bash
export ASBS_DASHBOARD_PASSWORD='choose-a-long-password'
export ASBS_SESSION_SECRET='choose-another-long-secret'
npm start
```

Open <http://127.0.0.1:8787/>. The server listens on `127.0.0.1` unless `ASBS_HOST` is set. On Render it uses the `PORT` Render provides and listens on `0.0.0.0`. Copy `.env.example` for the full list of settings. Do not commit `.env` or the `data/` directory.

`npm test` runs the Node test suite. It does not call Google and it does not send email.

Confirmation email is sent only when `GOOGLE_GMAIL_REFRESH_TOKEN` is set on the server. That token is separate from the calendar refresh token. See `docs/EMAIL_SETUP.md`. A failed send does not undo a saved form.

## What is intentionally off

- Consulting package checkout. The five package prices are approved. Online checkout stays off. Paid work starts only after a written agreement.
- On-site consultation booking. `consult.html` does not load open times or call the Render booking API. Visitors use the phone number, email address, or contact form.
- Google Calendar invitations. Unused booking code, when credentials exist, still creates events with `sendUpdates=none` and without attendees. The site's own confirmation email is a separate Gmail send and stays off until `GOOGLE_GMAIL_REFRESH_TOKEN` is set.
- Google Analytics, until `ASBS_GA_MEASUREMENT_ID` is a real `G-` id in `assets/js/config.js`.
- Writing to Google Calendar, until the owner sets the OAuth variables in `.env.example` on the server.

See `docs/STAGING.md`, `docs/GOOGLE_CALENDAR_SETUP.md`, `docs/DEPLOYMENT.md`, and `docs/OWNER_APPROVAL_CHECKLIST.md`.

## Staging document proof of concept

`GET /poc/onboarding` on the staging API is off unless `DOCS_ENABLED=1` and the Backblaze B2 settings below are all set. It is not part of the GitHub Pages site. The page says not to upload real tax documents. The authorization form text is a sample created in Documenso, not in this repository.

The browser posts each file to the staging API as `multipart/form-data`. The API checks the type, the 10 MB cap, and the file's first bytes, then writes the object with SSE-B2 (`ServerSideEncryption: AES256`). It does not use a presigned PUT, and it does not accept the file as base64 JSON. The staging bucket is `asbs-intake-docs-staging` in `us-west-004` (`https://s3.us-west-004.backblazeb2.com`). The application key cannot change bucket settings, and custom CORS rules cannot be set from the B2 web UI, so the bucket stays at the default of no origins. Uploads do not need a CORS origin. An owner download is a 60-second presigned GET opened as a normal browser navigation, which also does not need CORS. The upload ticket lasts about 15 minutes and allows 5 files. Leave `DOCS_ENABLED` unset until the page should be turned on. While it is unset, `/poc/onboarding` and `/api/poc/` respond 404 and the rest of the API is unchanged.

Turnstile on this page fails closed, including when siteverify cannot be reached, and the hostname must match the request host. The normal intake form still treats a Turnstile outage as allow-through. Leave `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` unset to keep the honeypot-only behavior.

Documenso uses API v2 at `DOCUMENSO_BASE_URL` (default `https://app.documenso.com/api/v2`). `DOCUMENSO_API_TOKEN` is sent as the raw Authorization value, without a Bearer prefix. `DOCUMENSO_TEMPLATE_ID` may be the template envelope id (`envelope_...`) or the legacy numeric template id. An envelope id uses `POST /envelope/use` with a JSON string in the multipart `payload` field and `distributeDocument: true`. A numeric id uses `POST /template/use`. A draft that was not emailed is sent with `POST /envelope/distribute`. The free plan has no webhooks, so an owner status check polls, then stores the signed PDF, the certificate from `GET /envelope/{envelopeId}/certificate/download`, and an audit snapshot. Each Documenso call logs its step, HTTP status, and a short error message. The token, file bytes, and tax identifiers are not logged. Completed envelopes often cannot be deleted; set `DOCUMENSO_DELETE_COMPLETED=1` only if deletion should be attempted.

No TIN or file bytes are written to HubSpot, logs, or analytics. A short status line may be sent to the existing HubSpot form: `documents received: W9, COI; authorization: pending`.

| Variable | Purpose |
| --- | --- |
| DOCS_ENABLED | `1` turns the proof of concept on |
| DOCS_S3_ENDPOINT | B2 S3 endpoint |
| DOCS_S3_REGION | B2 region, such as `us-west-004` |
| DOCS_S3_BUCKET | Private bucket name |
| DOCS_S3_KEY_ID | B2 application key id |
| DOCS_S3_SECRET | B2 application key |
| DOCS_MAX_BYTES | Optional cap, never above 10 MB |
| DOCUMENSO_API_TOKEN | Documenso API token |
| DOCUMENSO_TEMPLATE_ID | Sample template id |
| DOCUMENSO_BASE_URL | Optional API base |
| DOCUMENSO_DELETE_COMPLETED | `1` attempts to delete the envelope after download |
