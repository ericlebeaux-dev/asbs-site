# Connect Google Calendar (owner steps)

Do this after the Render staging site is live. Use the Google account that owns the calendar where appointments should appear. Do this yourself. Do not paste the client secret or the refresh token into chat, email, or git. Put them only in the Render **Environment** tab.

The site needs two permissions:

- `https://www.googleapis.com/auth/calendar.readonly` (see when you are busy)
- `https://www.googleapis.com/auth/calendar.events` (add, move, and cancel the appointment)

Appointments are created with no guests and with Google’s “do not email anyone” setting, so the customer does not get a Google Calendar invitation.

## 1. Create the Google project

1. Open [Google Cloud Console](https://console.cloud.google.com/) while signed in to the calendar’s Google account.
2. Create a project named `ASBS Scheduling`.
3. Open [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) and click **Enable**.

## 2. Set up the consent screen

The menu may say **Google Auth platform**.

1. Open **Google Auth platform**, then **Branding** (or **OAuth consent screen** if you still see that name).
2. If it says the platform is not configured, click **Get started**.
3. App name: `ASBS Scheduling`.
4. User support email: the same Google account.
5. Audience: **External**. A personal Gmail account does not offer Internal. If you only see Internal, you are in a work account. Switch to the Google account that owns the calendar.
6. Contact email: the same Google account.
7. Agree to the user-data policy if asked, then finish.
8. Open **Data access** (or **Scopes**) and add these two, exactly:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
9. Open **Audience** and add that same Google account as a **test user**.

Leave the app in **Testing** for this first pass. A testing refresh token stops working after 7 days. After you have booked one test appointment, you can click **Publish app** so you do not have to repeat this every week. Publishing shows an “unverified app” warning because Calendar access is a sensitive permission. On that warning, choose **Advanced**, then continue, only because this is your own app. You do not need to file Google’s verification form to test with your own calendar. If Google will not let you publish, stay in Testing, keep yourself as a test user, and repeat section 4 when the token stops working.

## 3. Create the OAuth client

1. Open **Google Auth platform** → **Clients** (or **APIs & Services** → **Credentials**).
2. Click **Create client**.
3. Application type: **Web application**.
4. Name: `ASBS staging`.
5. Authorized redirect URI: `https://developers.google.com/oauthplayground`
6. Leave authorized JavaScript origins empty.
7. Click **Create**.
8. Copy the **Client ID** and the **Client secret** immediately. Google may show the secret only once. If you miss it, open the client and reset the secret.
9. In Render, open the `asbs-staging` service → **Environment**. Add:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   Save. You can add the refresh token in the next step before the redeploy finishes.

## 4. Get the refresh token

1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the gear icon.
3. Check **Use your own OAuth credentials**. Paste the client ID and client secret. This matters: if you skip it, Google revokes the playground token within a day.
4. Set OAuth flow to **Server-side**.
5. Set access type to **Offline**.
6. Check **Force prompt: Consent** if that box is there, so Google issues a refresh token.
7. Close the settings.
8. In the scope box, enter both scopes, one per line. Do not pick the broader `https://www.googleapis.com/auth/calendar` scope.
9. Click **Authorize APIs**. Sign in with the calendar’s Google account.
10. If Google says the app is not verified, click **Advanced**, then **Go to ASBS Scheduling**. Continue only because you created this app.
11. Allow both calendar permissions.
12. Click **Exchange authorization code for tokens**.
13. Copy the **Refresh token**. It usually starts with `1//`.
14. In Render → **Environment**, set `GOOGLE_REFRESH_TOKEN` to that value. `GOOGLE_CALENDAR_ID` is already `primary`, which is the main calendar on that Google account.
15. Save. Render redeploys.

## 5. Check that it worked

1. Open `https://your-staging-address/api/health`.
2. `calendar.connected` should be `true`.
3. On the staging site, book one appointment with an email you control. Use a time you can spare.
4. Confirm the event is on your calendar.
5. Confirm that the test email did **not** receive a Google Calendar invitation.

If `/api/health` stays disconnected, the three Google values are missing or the service has not finished redeploying. If a booking says authorization failed, the refresh token expired or was revoked. Repeat section 4. Do not send the new token in chat.
