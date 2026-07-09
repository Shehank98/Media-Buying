// One-time helper: obtain a Google Drive OAuth refresh token so the app can
// upload backups + rate cards to YOUR own Google Drive (your free 15 GB) —
// which a service account cannot do.
//
// Prerequisites (all free, Google Cloud Console):
//   1. Create a project → enable the "Google Drive API".
//   2. OAuth consent screen: User type "External", add YOUR Gmail as a Test user,
//      then PUBLISH the app ("In production") so the refresh token doesn't expire
//      after 7 days. The only scope used is drive.file (per-file, non-sensitive),
//      which does not require Google's verification review.
//   3. Credentials → Create OAuth client ID → Application type "Desktop app".
//      Copy the Client ID + Client secret.
//
// Run it (from the api/ folder):
//   node scripts/get-drive-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
//   (or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET env vars)
//
// It prints GOOGLE_OAUTH_REFRESH_TOKEN — paste that, the Client ID and the
// Client secret into your Railway variables.

import http from 'http';
import { OAuth2Client } from 'google-auth-library';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.argv[2];
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.argv[3];
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing client id/secret.\n');
  console.error('Usage: node scripts/get-drive-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>');
  console.error('   or: GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/get-drive-refresh-token.mjs');
  process.exit(1);
}

const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const authUrl = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [SCOPE] });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  if (!code) { res.writeHead(400).end('No authorization code in the request.'); return; }
  try {
    const { tokens } = await client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Done. You can close this tab and return to the terminal.</h2>');
    console.log('\n──────────────── SUCCESS ────────────────');
    if (tokens.refresh_token) {
      console.log('Add these three to Railway:\n');
      console.log('GOOGLE_OAUTH_CLIENT_ID=' + CLIENT_ID);
      console.log('GOOGLE_OAUTH_CLIENT_SECRET=' + CLIENT_SECRET);
      console.log('GOOGLE_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token);
    } else {
      console.log('No refresh_token was returned (Google only sends it on the FIRST consent).');
      console.log('Revoke the app at https://myaccount.google.com/permissions and run this again.');
    }
    console.log('──────────────────────────────────────────\n');
    server.close();
    setTimeout(() => process.exit(0), 200);
  } catch (e) {
    res.writeHead(500).end('Token exchange failed: ' + e.message);
    console.error('\nToken exchange failed:', e.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('\n1) Open this URL in your browser and approve access:\n');
  console.log('   ' + authUrl + '\n');
  console.log('2) After you approve, this window captures the token and prints it below.\n');
  console.log('   (Waiting on ' + REDIRECT + ' …)\n');
});
