# Owner approval checklist

Prices for the five consulting packages were approved on October 26, 2026. Online checkout stays off. The October 26 legal addenda are still drafts.

## Content and offers

- [x] Approve the five package prices as published: $249, $599, $1,299, $2,499, and $999–$2,499/month. Checkout stays off.
- [ ] Confirm the Quick Bid pre-purchase call length. The scheduler uses 30 minutes until you say otherwise.
- [ ] Confirm weekday-only consultations inside 9:00–11:00 a.m. and 1:00–3:00 p.m. Central. Office hours on the contact page remain 8:00 a.m.–5:00 p.m.
- [ ] Confirm 24 hours of minimum notice and 15 minutes between appointments.
- [ ] Decide whether unpublished contract work may be named on the site. It was not added.
- [ ] Provide a LinkedIn company URL if you want it linked. None was on the current site.
- [ ] Legal review of the October 26 privacy, terms, and refund drafts.

## Access you set yourself

Do not send passwords, refresh tokens, or private keys in chat. Put them only in the server environment or a local `.env` that is not committed.

- [ ] Create the Render staging service with the clicks in `docs/STAGING.md`. Set `ASBS_DASHBOARD_PASSWORD` in Render. Render generates `ASBS_SESSION_SECRET`.
- [ ] Connect Google Calendar with the clicks in `docs/GOOGLE_CALENDAR_SETUP.md`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` in Render only. `GOOGLE_CALENDAR_ID` is `primary`. After redeploy, `/api/health` should show `calendar.connected` true.
- [ ] Book one appointment with a test email you control. Confirm the event is on the calendar and that the test customer did not get a Google invitation.
- [ ] Add a Google Analytics measurement ID in `assets/js/config.js` only if you want Analytics.
- [ ] Add the Search Console verification file or DNS record yourself when you are ready. No token was invented.

## Release

- [ ] Use the Render `onrender.com` address from `docs/STAGING.md`. Do not attach the production domain.
- [ ] Approve who may receive email before any confirmation mail is turned on. It is off now.
- [ ] Approve before any consulting package can be paid online. The current Pay Invoice link remains the existing invoice link only.
- [ ] Approve merging to `main`. That is what publishes the live site. This branch does not.
