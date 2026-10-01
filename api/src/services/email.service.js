/**
 * Sends an email via the Google Apps Script webhook.
 * Payload types:
 *   welcome: { type, to, name, password, loginUrl }
 *   reset:   { type, to, name, resetLink }
 *   announcement: { type, to, name, title, message, link }
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

  // Apps Script always answers 200 - a failure inside the script comes back as
  // { sent: false, error } and an access/deployment problem as an HTML page.
  // Surface both as errors so callers log them instead of failing silently.
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch {
    throw new Error('Email service returned a non-JSON response - check the Apps Script deployment (Execute as: Me, Who has access: Anyone)');
  }
  if (body && body.sent === false) {
    throw new Error(`Email service error: ${body.error || 'unknown'}`);
  }
  return body;
}
