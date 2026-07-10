/**
 * Sends an email via the Google Apps Script webhook.
 * Payload types:
 *   welcome: { type, to, name, password, loginUrl }
 *   reset:   { type, to, name, resetLink }
 */
export async function sendEmail(payload) {
  const url = process.env.GOOGLE_SCRIPT_URL;
  if (!url) {
    console.warn('GOOGLE_SCRIPT_URL not set - skipping email send');
    return;
  }

  const { default: fetch } = await import('node-fetch');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Email service responded with ${res.status}`);
  }

  return res.json();
}
