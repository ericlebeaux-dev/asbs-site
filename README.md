# American Standard Business Solutions

Public website for American Standard Business Solutions, LLC, plus a small staging server for free consultations, intake, vendor registration, and a private dashboard.

The live site is GitHub Pages from `main` at <https://www.americanstandardbusinesssolutions.com/>. Do not merge this work, change the Pages source, or change DNS until the owner approves it.

## Run the staging server

```bash
export ASBS_DASHBOARD_PASSWORD='choose-a-long-password'
export ASBS_SESSION_SECRET='choose-another-long-secret'
npm start
```

Open <http://127.0.0.1:8787/>. The server listens on `127.0.0.1` unless `ASBS_HOST` is set. Copy `.env.example` for the full list of settings. Do not commit `.env` or the `data/` directory.

`npm test` runs the Node test suite. It does not call Google and it does not send email.

## What is intentionally off

- Consulting package checkout. Proposed prices are labeled pending owner approval.
- Customer email invitations. Calendar events, when credentials exist, are created with `sendUpdates=none` and without attendees.
- Google Analytics, until `ASBS_GA_MEASUREMENT_ID` is a real `G-` id in `assets/js/config.js`.
- Writing to Google Calendar, until the owner sets the OAuth variables in `.env.example` on the server.

See `docs/DEPLOYMENT.md` and `docs/OWNER_APPROVAL_CHECKLIST.md`.
