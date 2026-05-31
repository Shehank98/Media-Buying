/**
 * Media Buying Records System — Email Service
 *
 * Deploy as a Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Set GOOGLE_SCRIPT_URL in Railway to the deployed web app URL.
 *
 * Payload shapes:
 *   Welcome:  { type: "welcome", to, name, password, loginUrl }
 *   Reset:    { type: "reset",   to, name, resetLink }
 */

var BRAND_NAME = "Media Buying Records";
var FROM_NAME  = "Media Buying Records";

// ─── Router ────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.type === "welcome") {
      sendWelcomeEmail(data);
    } else if (data.type === "reset") {
      sendResetEmail(data);
    } else {
      throw new Error("Unknown email type: " + data.type);
    }

    return ok({ sent: true });
  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return ok({ sent: false, error: err.message });
  }
}

// keep GET alive for health-check pings
function doGet(e) {
  return ok({ status: "ok", service: BRAND_NAME + " Email Service" });
}

function ok(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Welcome Email ──────────────────────────────────────────────────────────

function sendWelcomeEmail(data) {
  var to       = data.to;
  var name     = data.name     || "User";
  var password = data.password || "—";
  var loginUrl = data.loginUrl || "https://your-app.railway.app";

  var subject = "Welcome to " + BRAND_NAME + " — Your Account is Ready";
  var html    = buildWelcomeHtml(name, to, password, loginUrl);

  GmailApp.sendEmail(to, subject, stripTags(html), {
    name:     FROM_NAME,
    htmlBody: html,
  });
}

// ─── Reset Email ────────────────────────────────────────────────────────────

function sendResetEmail(data) {
  var to        = data.to;
  var name      = data.name      || "User";
  var resetLink = data.resetLink || "#";

  var subject = "Reset Your Password — " + BRAND_NAME;
  var html    = buildResetHtml(name, resetLink);

  GmailApp.sendEmail(to, subject, stripTags(html), {
    name:     FROM_NAME,
    htmlBody: html,
  });
}

// ─── Welcome HTML Template ──────────────────────────────────────────────────

function buildWelcomeHtml(name, email, password, loginUrl) {
  return '<!DOCTYPE html>' +
  '<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Welcome to ' + BRAND_NAME + '</title></head>' +
  '<body style="margin:0;padding:0;background:#f0f4f8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' +

  // Wrapper
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 16px;">' +
  '<tr><td align="center">' +

  // Card
  '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(10,23,41,.10);">' +

  // ── Header ──
  '<tr><td style="background:#0A1729;padding:40px 48px 32px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr>' +
      '<td>' +
        '<div style="display:inline-block;background:#E85D24;border-radius:10px;padding:10px 14px;margin-bottom:20px;">' +
          '<span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.5px;">MB</span>' +
        '</div>' +
        '<h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;line-height:1.2;letter-spacing:-0.5px;">' +
          'Your account is ready' +
        '</h1>' +
        '<p style="margin:8px 0 0;color:#8ba4c2;font-size:15px;">Welcome to ' + BRAND_NAME + ', ' + escHtml(name) + '</p>' +
      '</td>' +
    '</tr>' +
    '</table>' +
  '</td></tr>' +

  // ── Body ──
  '<tr><td style="padding:40px 48px;">' +

    '<p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">' +
      'Hi <strong>' + escHtml(name) + '</strong>, an account has been created for you on the ' +
      '<strong>' + BRAND_NAME + '</strong> platform. Use the credentials below to sign in.' +
    '</p>' +

    // Credentials box
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:32px;">' +
    '<tr><td style="padding:8px 24px 4px;">' +
      '<p style="margin:0;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Your Login Credentials</p>' +
    '</td></tr>' +

    // Email row
    '<tr><td style="padding:12px 24px;border-top:1px solid #e2e8f0;">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="color:#64748b;font-size:13px;width:120px;">Email</td>' +
        '<td style="color:#0A1729;font-size:14px;font-weight:600;font-family:\'Courier New\',monospace;">' + escHtml(email) + '</td>' +
      '</tr></table>' +
    '</td></tr>' +

    // Password row
    '<tr><td style="padding:12px 24px;border-top:1px solid #e2e8f0;">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="color:#64748b;font-size:13px;width:120px;">Password</td>' +
        '<td>' +
          '<span style="background:#fff3e0;color:#E85D24;font-family:\'Courier New\',monospace;font-size:15px;font-weight:700;padding:4px 12px;border-radius:6px;border:1px solid #ffd0a8;letter-spacing:1px;">' + escHtml(password) + '</span>' +
        '</td>' +
      '</tr></table>' +
    '</td></tr>' +

    // Login URL row
    '<tr><td style="padding:12px 24px 16px;border-top:1px solid #e2e8f0;">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="color:#64748b;font-size:13px;width:120px;">Login URL</td>' +
        '<td><a href="' + loginUrl + '" style="color:#2563eb;font-size:13px;text-decoration:none;">' + loginUrl + '</a></td>' +
      '</tr></table>' +
    '</td></tr>' +
    '</table>' +

    // CTA Button
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">' +
    '<tr><td align="center">' +
      '<a href="' + loginUrl + '" style="display:inline-block;background:#E85D24;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:16px 48px;border-radius:10px;letter-spacing:0.3px;">' +
        'Sign In Now &rarr;' +
      '</a>' +
    '</td></tr>' +
    '</table>' +

    // Security notice
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;">' +
      '<table cellpadding="0" cellspacing="0"><tr>' +
        '<td style="padding-right:12px;vertical-align:top;font-size:18px;">&#9888;&#65039;</td>' +
        '<td>' +
          '<p style="margin:0 0 4px;color:#92400e;font-size:13px;font-weight:700;">Action required on first login</p>' +
          '<p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">' +
            'You will be prompted to set a new password immediately after signing in. ' +
            'Please do not share your temporary password with anyone.' +
          '</p>' +
        '</td>' +
      '</tr></table>' +
    '</td></tr>' +
    '</table>' +

  '</td></tr>' +

  // ── Footer ──
  '<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 48px;">' +
    '<p style="margin:0 0 4px;color:#94a3b8;font-size:12px;text-align:center;">' +
      '&copy; ' + new Date().getFullYear() + ' ' + BRAND_NAME + '. This email was sent to ' + escHtml(email) + '.' +
    '</p>' +
    '<p style="margin:0;color:#cbd5e1;font-size:12px;text-align:center;">' +
      'If you did not expect this email, please contact your system administrator.' +
    '</p>' +
  '</td></tr>' +

  '</table>' +
  '</td></tr></table>' +
  '</body></html>';
}

// ─── Reset HTML Template ────────────────────────────────────────────────────

function buildResetHtml(name, resetLink) {
  return '<!DOCTYPE html>' +
  '<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Reset Your Password</title></head>' +
  '<body style="margin:0;padding:0;background:#f0f4f8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' +

  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 16px;">' +
  '<tr><td align="center">' +

  '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(10,23,41,.10);">' +

  // ── Header ──
  '<tr><td style="background:#0A1729;padding:40px 48px 32px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td>' +
      '<div style="display:inline-block;background:#E85D24;border-radius:10px;padding:10px 14px;margin-bottom:20px;">' +
        '<span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.5px;">MB</span>' +
      '</div>' +
      '<h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;line-height:1.2;letter-spacing:-0.5px;">Reset your password</h1>' +
      '<p style="margin:8px 0 0;color:#8ba4c2;font-size:15px;">We received a request to reset your password</p>' +
    '</td></tr></table>' +
  '</td></tr>' +

  // ── Body ──
  '<tr><td style="padding:40px 48px;">' +

    '<p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">' +
      'Hi <strong>' + escHtml(name) + '</strong>,<br><br>' +
      'Someone requested a password reset for your <strong>' + BRAND_NAME + '</strong> account. ' +
      'Click the button below to choose a new password.' +
    '</p>' +

    // CTA Button
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">' +
    '<tr><td align="center">' +
      '<a href="' + resetLink + '" style="display:inline-block;background:#E85D24;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:16px 48px;border-radius:10px;letter-spacing:0.3px;">' +
        'Reset Password &rarr;' +
      '</a>' +
    '</td></tr>' +
    '</table>' +

    // Expiry notice
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">' +
    '<tr><td style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;">' +
      '<table cellpadding="0" cellspacing="0"><tr>' +
        '<td style="padding-right:12px;vertical-align:top;font-size:18px;">&#8987;</td>' +
        '<td>' +
          '<p style="margin:0 0 4px;color:#0369a1;font-size:13px;font-weight:700;">This link expires in 1 hour</p>' +
          '<p style="margin:0;color:#0369a1;font-size:13px;line-height:1.6;">' +
            'For your security, the password reset link is only valid for 60 minutes. ' +
            'After that, you will need to request a new one.' +
          '</p>' +
        '</td>' +
      '</tr></table>' +
    '</td></tr>' +
    '</table>' +

    // Fallback URL
    '<p style="margin:0 0 8px;color:#64748b;font-size:13px;">If the button above does not work, copy and paste this link into your browser:</p>' +
    '<p style="margin:0 0 28px;word-break:break-all;">' +
      '<a href="' + resetLink + '" style="color:#2563eb;font-size:13px;text-decoration:none;">' + resetLink + '</a>' +
    '</p>' +

    // Security notice
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;">' +
      '<table cellpadding="0" cellspacing="0"><tr>' +
        '<td style="padding-right:12px;vertical-align:top;font-size:18px;">&#128274;</td>' +
        '<td>' +
          '<p style="margin:0 0 4px;color:#991b1b;font-size:13px;font-weight:700;">Did not request this?</p>' +
          '<p style="margin:0;color:#991b1b;font-size:13px;line-height:1.6;">' +
            'If you did not request a password reset, your account may be at risk. ' +
            'Please contact your system administrator immediately. You can safely ignore this email.' +
          '</p>' +
        '</td>' +
      '</tr></table>' +
    '</td></tr>' +
    '</table>' +

  '</td></tr>' +

  // ── Footer ──
  '<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 48px;">' +
    '<p style="margin:0 0 4px;color:#94a3b8;font-size:12px;text-align:center;">' +
      '&copy; ' + new Date().getFullYear() + ' ' + BRAND_NAME + '. Automated security email — please do not reply.' +
    '</p>' +
    '<p style="margin:0;color:#cbd5e1;font-size:12px;text-align:center;">' +
      'This link is single-use and will expire after 1 hour.' +
    '</p>' +
  '</td></tr>' +

  '</table>' +
  '</td></tr></table>' +
  '</body></html>';
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
