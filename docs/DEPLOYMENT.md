# Deployment and rollback

## Do not publish this branch as production

GitHub Pages for `ericlebeaux-dev/asbs-site` builds `main` and serves it on `www.americanstandardbusinesssolutions.com`. Changing the Pages branch, merging this branch, or editing DNS would change the live site. Those actions need the owner's approval.

## Staging

The shareable test site is a free Render web service described in `render.yaml` and `docs/STAGING.md`. It deploys branch `cursor/asbs-website-completion-0d43` only. It is not the production domain.

The owner has to sign in to Render and apply that blueprint. No host account was available here, so there is no public staging URL yet. Secrets (`ASBS_DASHBOARD_PASSWORD`, `ASBS_SESSION_SECRET`, and the Google OAuth values) are set in Render’s environment. They are not committed.

The server uses Render’s `PORT` and listens on `0.0.0.0` when `PORT` is set. Local `npm start` still uses `127.0.0.1:8787`.

GitHub Pages alone cannot keep the dashboard password or the Google refresh token safe, and it cannot run `server/`. The HTML can sit on Pages after approval, but scheduling, intake storage, vendor files, and the dashboard need this Node process or a replacement the owner chooses.

## Backup

- The git history is the backup of the website code. Production today is `main`.
- Customer and vendor records live in `data/` on the server. That directory is gitignored. Back it up with the server if you start using it. It is not created on GitHub Pages.

## Rollback

- Before a merge, rollback is “do not merge.” Production stays on the current `main` commit.
- After a merge, revert the merge commit on `main` and let Pages rebuild. Do not force-push `main` unless the owner asks.
- Stop the Node process to take the staging app offline. Existing Pages content is unchanged by stopping it.

## After a future approved launch

- Load the homepage, a package page, the consultation page, intake, and contact on a phone.
- Book a test appointment and confirm the calendar result matches `/api/health`.
- Submit a test intake and confirm one dashboard record, not two, if the email repeats.
- Confirm package buttons still do not open Stripe.
- Confirm the invoice link still pays an invoice only if you intend to keep it.
