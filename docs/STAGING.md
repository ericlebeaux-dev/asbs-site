# Staging site (not production)

The live site stays on GitHub Pages from `main` at `www.americanstandardbusinesssolutions.com`. This staging service is a separate Node app on Render. It uses the branch `cursor/asbs-website-completion-0d43`. It does not change GitHub Pages, DNS, or `main`.

A public staging URL does not exist yet. Creating one needs a Render account signed in as the GitHub owner of `ericlebeaux-dev/asbs-site`. No Render, Fly, or Railway credentials were available in this workspace, so the service was not deployed.

## What you click

1. Open [https://dashboard.render.com](https://dashboard.render.com).
2. Sign up or log in with GitHub. Use the GitHub account that owns `ericlebeaux-dev/asbs-site`.
3. If Render asks to install its GitHub app, allow it for `asbs-site` only when that choice is offered.
4. Click **New**, then **Blueprint**.
5. Choose the repository `ericlebeaux-dev/asbs-site`.
6. Confirm the branch is `cursor/asbs-website-completion-0d43`. Render reads `render.yaml` from that branch. If the screen shows `main`, switch it to this branch before you apply. Do not deploy `main`.
7. If Render asks about preview environments, choose **No**.
8. Fill in `ASBS_DASHBOARD_PASSWORD` with a long password you will use for `/dashboard.html`. Render creates `ASBS_SESSION_SECRET` for you. Leave the Google fields alone; they are not in this form.
9. Click **Apply**.
10. Wait until the service says it is live. Open the `onrender.com` address Render shows. It will not be the production domain.
11. Open `https://that-address/api/health`. You should see `"ok": true` and `"livePackageCheckout": false`. `calendar.connected` stays false until you finish `docs/GOOGLE_CALENDAR_SETUP.md`.

Do not add `www.americanstandardbusinesssolutions.com` as a custom domain on this service. Do not merge the pull request. Do not change the GitHub Pages source.

## Secrets

Set secrets only in the Render **Environment** tab:

- `ASBS_DASHBOARD_PASSWORD` (you type this during the blueprint)
- `ASBS_SESSION_SECRET` (Render generates this)
- Later: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

Do not commit them, and do not paste them into chat. After you add the Google values, Render redeploys. Then `/api/health` should show `calendar.connected` true.

## What testers should expect

- A yellow bar says this is a staging preview, not the live ASBS website.
- Free consultations, intake, and vendor registration work on this server.
- Package prices are visible. There is no package checkout.
- The free plan sleeps after about 15 minutes of quiet. The next visit waits while it wakes up.
- Leads, bookings, and uploaded files sit on the service disk. A restart or a new deploy on the free plan clears them. Use this for a test, not as the permanent customer list.
- Until Google Calendar is connected, a booking is saved only on this server, and the page says it is not on Google Calendar.
