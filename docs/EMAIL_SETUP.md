# Confirmation email (owner steps)

Do this on the Render staging service after the site is deployed. The calendar connection stays as it is. This is a second Google sign-in, for the business mailbox only.

The site sends from `americanstandardsolutions@gmail.com` with the Gmail API. Gmail sends as whichever Google account issued the refresh token. The existing calendar token belongs to the calendar owner, so it cannot be reused for this mailbox. Do not replace `GOOGLE_REFRESH_TOKEN`.

A failed send does not undo a saved booking, intake, contact form, quote, or vendor registration. Until this token is set, `/api/health` reports `mail.configured: false` and the form still saves.

Do not paste the client secret or either refresh token into chat, email, or git. Put the new token only in the Render **Environment** tab.

## 1. Turn on Gmail for the existing project

Use the same Google Cloud project you already created for calendar, `ASBS Scheduling`.

1. Open [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) and click **Enable**.
2. Open **Google Auth platform**, then **Data access** (or **Scopes**).
3. Add exactly this scope. Leave the two Calendar scopes in place:
   - `https://www.googleapis.com/auth/gmail.send`
4. Open **Audience** and add `americanstandardsolutions@gmail.com` as a **test user**. Keep the calendar account as a test user too.

Leave the app in **Testing**. A testing refresh token stops working after 7 days. When this one expires, repeat section 2. Do not click **Publish app** only for mail unless you already decided to publish for Calendar. Gmail send is a sensitive scope, and an unverified public app will show a warning.

## 2. Issue a refresh token for the business mailbox

Use a private browser window so Google does not reuse the calendar account.

1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the gear icon. Check **Use your own OAuth credentials**.
3. Enter the same OAuth client id and client secret already stored on Render as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Close the gear panel. In **Step 1**, paste this scope and click **Authorize APIs**:
   - `https://www.googleapis.com/auth/gmail.send`
5. When Google asks which account, choose `americanstandardsolutions@gmail.com`. Do not choose the calendar account.
6. If you see an unverified-app warning, choose **Advanced**, then continue, only because this is your own app and your own mailbox.
7. In **Step 2**, click **Exchange authorization code for tokens**.
8. Copy the **refresh token** only. Leave the access token behind. Access tokens expire in about an hour. The refresh token is the value the server stores.

That refresh token is only for sending mail. It does not read the mailbox.

## 3. Put it on Render

1. Open the Render service `asbs-staging`, then **Environment**.
2. Add a variable named `GOOGLE_GMAIL_REFRESH_TOKEN`.
3. Paste the refresh token from section 2. Do not change `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, or `GOOGLE_CLIENT_SECRET`.
4. Save. Render redeploys.

After the deploy, open `https://asbs-staging.onrender.com/api/health`. `mail.configured` should be `true` and `mail.from` should be `americanstandardsolutions@gmail.com`. Then submit one test form with your own address. You should get the thank-you note, and the same mailbox should get an internal notice. Do not send that test to a customer.

## What the message says

The visitor note thanks them for reaching out to American Standard Business Solutions, lists what they submitted, and says someone will reach out promptly. A booking includes the date and time in Central Time. It is signed:

```
Eric LeBeaux
American Standard Business Solutions
(281) 954-5167
```

The internal notice goes to `americanstandardsolutions@gmail.com`. It names the submission type and whether the visitor note was sent. The cancellation code is only in the visitor's booking note.

Google Calendar still does not invite the visitor. Those events stay with no guests and `sendUpdates=none`.
