# Email Webhook - Google Apps Script Setup

The system sends transactional email (welcome, password reset, upload reminders)
through a Google Apps Script Web App that runs under your Gmail/Workspace
account. The API posts JSON to the script's URL; the script renders a branded
HTML email and sends it with `GmailApp`.

```
API (api/src/services/email.service.js)
   │  POST JSON  { type, to, ... }
   ▼
GOOGLE_SCRIPT_URL  ──►  appscript/Code.gs  ──►  Gmail  ──►  recipient
```

## Email types sent

| Type | Triggered when | Payload |
|---|---|---|
| `welcome` | Admin creates a user (`POST /api/admin/users`) | `to, name, password, loginUrl` |
| `reset` | User requests password reset (`POST /api/auth/forgot-password`) | `to, name, resetLink` |
| `reminder` | Admin sends an upload reminder (`POST /api/notifications/send-reminder`) | `to, name, monthLabel, message, loginUrl` |

All three render full branded HTML (navy + coral theme) with a plain-text fallback.

---

## One-time setup

### 1. Create the Apps Script project
1. Go to **https://script.google.com** → **New project**.
2. Delete the default `Code.gs` contents and paste the entire contents of
   [`Code.gs`](./Code.gs) from this folder.
3. (Optional) Edit the `BRAND_NAME` / `FROM_NAME` constants at the top if you
   want a different sender display name.
4. **Save** (💾).

### 2. Grant the Gmail permission
1. In the editor, choose the function **`testSend`** (or `sendWelcomeEmail`) and
   click **Run** once. *(If `testSend` isn't present, just run `doGet`.)*
2. Google shows an authorization prompt → **Review permissions** → pick your
   account → **Advanced** → **Go to <project> (unsafe)** → **Allow**.
   This is expected: you're authorizing *your own* script to send mail as you.

### 3. Deploy as a Web App
1. Click **Deploy ▸ New deployment**.
2. **Select type** (gear icon) → **Web app**.
3. Configure:
   - **Description:** `Ogilvy Orbit email webhook`
   - **Execute as:** **Me** (your account - required to send mail)
   - **Who has access:** **Anyone**
     *(This only exposes the email-sending endpoint; it does not expose your
     inbox. The endpoint ignores anything but the expected JSON payloads.)*
4. Click **Deploy**, then **copy the Web app URL** - it looks like:
   ```
   https://script.google.com/macros/s/AKfy....../exec
   ```

### 4. Point the API at the script
Set the environment variable in your deployment (Railway → service → Variables):

```
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/AKfy....../exec
```

Also make sure `FRONTEND_URL` is set to your app's URL (used for the
"Log in" / "Upload" / reset links). If it's a comma-separated CORS list, the
API uses the **first** entry for email links.

Redeploy / restart the API so it picks up the variable.

> If `GOOGLE_SCRIPT_URL` is **not** set, the API logs a warning and silently
> skips sending - the app keeps working, just without email.

---

## Testing

**Health check** - open the `/exec` URL in a browser. You should see:
```json
{ "status": "ok", "service": "Ogilvy Orbit Email Service" }
```

**End-to-end:**
- *Welcome* → Admin page → create a user with your own email → check inbox.
- *Reset* → Login page → "Forgot password" → enter your email → check inbox.
- *Reminder* → Upload Tracker page → select a pending user → "Send reminder" →
  the user gets both an in-app notification **and** an email.

**From the script editor (quick preview):** run `testSend` (sends a sample
welcome email to your own address). You can duplicate it to preview the
`reminder` / `reset` types by changing the `type` field.

---

## Quotas & notes

- Gmail sending limits: **~100 recipients/day** for free `@gmail.com`,
  **~1,500/day** for Google Workspace. Reminder sends are one email per
  recipient, so a large reminder batch counts against this quota.
- **Updating the script:** after editing `Code.gs`, you must
  **Deploy ▸ Manage deployments ▸ ✏️ Edit ▸ Version: New version ▸ Deploy**
  for changes to go live. The `/exec` URL stays the same.
- Sender address is the Google account that owns the script. To send from a
  shared address, create the script under that Workspace account (or configure
  a "Send mail as" alias and adjust the `from` option in `GmailApp.sendEmail`).
- Deliverability: first messages may land in spam until recipients mark them
  "not spam". For high volume, consider a dedicated provider (SendGrid/Postmark)
  instead of Gmail.
