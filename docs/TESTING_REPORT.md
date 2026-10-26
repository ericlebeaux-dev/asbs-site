# Testing report — October 26, 2026

Command: `npm test` (`node --test test/*.test.js`) on Node v22.23.4.

Result: **21 passed, 0 failed, 0 skipped.**

## Automated

| Check | Result |
|---|---|
| Chicago time conversion on Oct 27, 2026 (CDT), Nov 3, 2026 (CST), and Mar 9, 2026 (CDT) | Passed |
| Slots only on weekdays, inside 9:00–11:00 and 1:00–3:00, and a 45-minute visit cannot end after the window | Passed |
| No Sunday slots | Passed |
| Double book and 15-minute buffer rejected; cancel reopens the time; bad cancel code rejected | Passed |
| Disconnected calendar is disclosed and does not claim an event was created | Passed |
| Connected calendar mock creates one event, omits attendees, uses `sendUpdates=none`, and a failed create leaves the slot open | Passed |
| Intake validation, consent, sensitive-field rejection, and same-email update | Passed |
| Vendor PDF stored privately; anonymous download rejected; wrong dashboard password rejected | Passed |
| Dashboard unavailable until a password is configured | Passed |
| `/server/app.js`, `/.env`, and path traversal to server code return 404 | Passed |
| Package page shows the five approved prices, says online checkout is off, has no pending-approval label, and has no Stripe link | Passed |
| Render `PORT` selects the listen port and `0.0.0.0`; a local start with no `PORT` stays on `127.0.0.1:8787` | Passed |
| Internal links and in-page anchors resolve | Passed |
| Client HTML/JS has no private key, `ya29.` token, or `sk_live_` secret | Passed |

## Staging server smoke

`npm start` on `127.0.0.1:8787` with a password set only in that process, not in git.

| Request | Result |
|---|---|
| `/`, services, packages, consult, intake, vendors, about, contact, privacy, terms, refund, thanks, dashboard | 200 |
| `/api/health` | 200, `calendar.connected: false`, `livePackageCheckout: false` |
| `/api/slots?type=discovery_15` | 216 open slots; first slot respected the 24-hour notice |
| `/server/app.js` | 404 |

Headless Chrome loaded `/consult.html` from that server. After scripts ran, the DOM included the sentence “Google Calendar is not connected” and hundreds of time buttons labeled in Central Time, including 10:00 AM and 1:00 PM slots.

Screenshots of the homepage (desktop and 390px wide), the packages page, and the consultation page were taken. The consultation screenshot itself was captured before the slot request finished; the DOM dump above is the check that slots render.

## Not run or blocked

| Check | Result |
|---|---|
| Create a real event on the owner's Google Calendar | Blocked. No server OAuth credentials. The owner's calendar was not changed. |
| Public staging URL | Blocked. `render.yaml` is ready. Deploy needs the owner’s Render account. GitHub Pages still publishes `main` to the production domain and was not changed. |
| Customer or owner email delivery | Not run. The new forms do not send mail. The existing quote form still posts to FormSubmit and was not submitted. |
| Stripe charge, package checkout, or subscription | Not run. Not enabled. |
| Google Analytics hits | Not run. No measurement ID. |
| Full keyboard audit with a screen reader, or an automated axe scan | Not run. Forms have labels, skip links, and visible focus styles. |
| Every page clicked on a physical phone | Not run. Homepage was rendered at 390px in headless Chrome. Other pages use the same layout classes. |

Do not describe the Google Calendar acceptance test as passed. The in-memory and mock-calendar tests passed. A booking on the owner's calendar has not been made.
