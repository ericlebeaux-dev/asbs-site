# American Standard Business Solutions

Public website for American Standard Business Solutions, LLC, plus a small staging server for free consultations, intake, vendor registration, and a private dashboard.

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
- Google Calendar invitations. Calendar events, when credentials exist, are created with `sendUpdates=none` and without attendees. The site's own confirmation email is a separate Gmail send and stays off until `GOOGLE_GMAIL_REFRESH_TOKEN` is set.
- Google Analytics, until `ASBS_GA_MEASUREMENT_ID` is a real `G-` id in `assets/js/config.js`.
- Writing to Google Calendar, until the owner sets the OAuth variables in `.env.example` on the server.

See `docs/STAGING.md`, `docs/GOOGLE_CALENDAR_SETUP.md`, `docs/DEPLOYMENT.md`, and `docs/OWNER_APPROVAL_CHECKLIST.md`.
