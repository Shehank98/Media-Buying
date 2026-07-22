/**
 * Ogilvy Orbit Email Service
 *
 * Deploy as a Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Set GOOGLE_SCRIPT_URL in Railway to the deployed web app URL.
 *
 * Payload shapes:
 *   Welcome:  { type: "welcome",  to, name, password, loginUrl }
 *   Reset:    { type: "reset",    to, name, resetLink }
 *   Reminder: { type: "reminder", to, name, monthLabel, message, loginUrl }
 *   Package:  { type: "package",  to, name, packageName, intro, lineItems:[{label,rate}], responseLink, pdfBase64?, pdfFileName? }
 */

var BRAND_NAME = "Ogilvy Orbit";
var FROM_NAME  = "Shehan Kavishka";

// Brand palette (mirrors the app design system)
var C_NAVY    = "#0A1729";
var C_NAVY_2  = "#0F1F3D";
var C_CORAL   = "#E85D24";
var C_CORAL_D = "#C44A18";
var C_CORAL_L = "#F2A07C";
var C_INK     = "#16243C";
var C_MUTED   = "#6B7790";
var C_MUTED_2 = "#93A0B5";
var C_NAVY300 = "#9FB0C9";
var C_BG      = "#EEF1F5";
var C_LINE    = "#E5E8ED";

// ─── Router ────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.type === "welcome") {
      sendWelcomeEmail(data);
    } else if (data.type === "reset") {
      sendResetEmail(data);
    } else if (data.type === "reminder") {
      sendReminderEmail(data);
    } else if (data.type === "package") {
      sendPackageEmail(data);
    } else if (data.type === "requisition") {
      sendRequisitionEmail(data);
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

// ─── Shared brand building blocks ────────────────────────────────────────────

// The Ogilvy Orbit lockup: an orbit "O" mark + wordmark with an italic "Orbit".
function brandLockup() {
  return '' +
  '<table cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="vertical-align:middle;padding-right:13px;">' +
      '<div style="width:46px;height:46px;border-radius:50%;background:' + C_CORAL + ';text-align:center;box-shadow:0 6px 16px rgba(232,93,36,.45);">' +
        '<span style="display:inline-block;line-height:46px;color:#FFF3EC;font-family:Georgia,\'Times New Roman\',serif;font-size:24px;">O</span>' +
      '</div>' +
    '</td>' +
    '<td style="vertical-align:middle;">' +
      '<div style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:-0.3px;line-height:1;">Ogilvy <span style="color:' + C_CORAL_L + ';font-family:Georgia,serif;font-style:italic;font-weight:400;">Orbit</span></div>' +
      '<div style="color:' + C_NAVY300 + ';font-size:9.5px;font-weight:700;letter-spacing:3px;margin-top:6px;">OGILVY MEDIA · COLOMBO</div>' +
    '</td>' +
  '</tr></table>';
}

function emailHeader(title, subtitle) {
  return '<tr><td style="background:' + C_NAVY + ';background-image:linear-gradient(160deg,' + C_NAVY_2 + ',' + C_NAVY + ');padding:36px 48px 30px;">' +
    brandLockup() +
    '<h1 style="margin:26px 0 0;color:#ffffff;font-size:25px;font-weight:700;line-height:1.22;letter-spacing:-0.5px;">' + title + '</h1>' +
    (subtitle ? '<p style="margin:9px 0 0;color:' + C_NAVY300 + ';font-size:15px;line-height:1.5;">' + subtitle + '</p>' : '') +
  '</td></tr>';
}

function ctaButton(href, label) {
  return '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
    '<a href="' + href + '" style="display:inline-block;background:' + C_CORAL + ';color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:15px 46px;border-radius:11px;letter-spacing:0.2px;box-shadow:0 8px 20px rgba(232,93,36,.32);">' +
      label +
    '</a>' +
  '</td></tr></table>';
}

// Coloured callout box. tone: 'amber' | 'green' | 'blue' | 'red'
function callout(tone, icon, title, body) {
  var t = {
    amber: ['#FFFBEB', '#FDE68A', '#92400E'],
    green: ['#F0FBF4', '#BBF7D0', '#166534'],
    blue:  ['#F0F9FF', '#BAE6FD', '#0369A1'],
    red:   ['#FEF2F2', '#FECACA', '#991B1B']
  }[tone] || ['#F7F9FB', C_LINE, C_MUTED];
  return '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="background:' + t[0] + ';border:1px solid ' + t[1] + ';border-radius:11px;padding:15px 18px;">' +
      '<table cellpadding="0" cellspacing="0"><tr>' +
        '<td style="padding-right:11px;vertical-align:top;font-size:17px;">' + icon + '</td>' +
        '<td>' +
          '<p style="margin:0 0 3px;color:' + t[2] + ';font-size:13px;font-weight:700;">' + title + '</p>' +
          '<p style="margin:0;color:' + t[2] + ';font-size:13px;line-height:1.6;">' + body + '</p>' +
        '</td>' +
      '</tr></table>' +
    '</td></tr></table>';
}

function emailFooter(note, subNote) {
  return '<tr><td style="background:#F7F9FB;border-top:1px solid ' + C_LINE + ';padding:24px 48px;">' +
    '<table cellpadding="0" cellspacing="0" border="0" align="center"><tr>' +
      '<td style="vertical-align:middle;padding-right:8px;">' +
        '<div style="width:20px;height:20px;border-radius:50%;background:' + C_CORAL + ';text-align:center;">' +
          '<span style="display:inline-block;line-height:20px;color:#FFF3EC;font-family:Georgia,serif;font-size:12px;">O</span>' +
        '</div>' +
      '</td>' +
      '<td style="vertical-align:middle;color:' + C_INK + ';font-size:13px;font-weight:700;letter-spacing:-0.2px;">Ogilvy Orbit</td>' +
    '</tr></table>' +
    '<p style="margin:11px 0 0;color:' + C_MUTED_2 + ';font-size:12px;text-align:center;line-height:1.55;">' + note + '</p>' +
    (subNote ? '<p style="margin:4px 0 0;color:#AEB8C7;font-size:11.5px;text-align:center;line-height:1.55;">' + subNote + '</p>' : '') +
  '</td></tr>';
}

// Wrap header/body/footer rows in the responsive email card shell.
function emailShell(title, inner) {
  return '<!DOCTYPE html>' +
  '<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escHtml(title) + '</title></head>' +
  '<body style="margin:0;padding:0;background:' + C_BG + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:' + C_BG + ';padding:40px 16px;"><tr><td align="center">' +
  '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 28px rgba(10,23,41,.12);">' +
  inner +
  '</table></td></tr></table></body></html>';
}

function bodyOpen()  { return '<tr><td style="padding:38px 48px;">'; }
function bodyClose() { return '</td></tr>'; }
function spacer(h)   { return '<div style="height:' + h + 'px;line-height:' + h + 'px;font-size:1px;">&nbsp;</div>'; }

// ─── Welcome Email ──────────────────────────────────────────────────────────

function sendWelcomeEmail(data) {
  var to       = data.to;
  var name     = data.name     || "User";
  var password = data.password || "-";
  var loginUrl = data.loginUrl || "https://your-app.railway.app";

  var subject = "Welcome to " + BRAND_NAME + ": your account is ready";
  var html    = buildWelcomeHtml(name, to, password, loginUrl);

  GmailApp.sendEmail(to, subject, stripTags(html), { name: FROM_NAME, htmlBody: html });
}

function buildWelcomeHtml(name, email, password, loginUrl) {
  var credRow = function (label, valueHtml, top) {
    return '<tr><td style="padding:12px 22px;' + (top ? 'border-top:1px solid ' + C_LINE + ';' : '') + '">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="color:' + C_MUTED + ';font-size:13px;width:110px;vertical-align:middle;">' + label + '</td>' +
        '<td style="vertical-align:middle;">' + valueHtml + '</td>' +
      '</tr></table>' +
    '</td></tr>';
  };

  var inner =
    emailHeader('Your account is ready', 'Welcome aboard, ' + escHtml(name)) +
    bodyOpen() +
      '<p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">' +
        'Hi <strong>' + escHtml(name) + '</strong>, an account has been created for you on <strong>' + BRAND_NAME + '</strong>. Use the credentials below to sign in.' +
      '</p>' +

      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FB;border:1px solid ' + C_LINE + ';border-radius:13px;margin-bottom:28px;">' +
        '<tr><td style="padding:14px 22px 4px;"><p style="margin:0;color:' + C_MUTED + ';font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Your login credentials</p></td></tr>' +
        credRow('Email', '<span style="color:' + C_INK + ';font-size:14px;font-weight:600;font-family:\'Courier New\',monospace;">' + escHtml(email) + '</span>', true) +
        credRow('Password', '<span style="background:#FDF1EB;color:' + C_CORAL_D + ';font-family:\'Courier New\',monospace;font-size:15px;font-weight:700;padding:4px 12px;border-radius:6px;border:1px solid #F8CDB6;letter-spacing:1px;">' + escHtml(password) + '</span>', true) +
        credRow('Login URL', '<a href="' + loginUrl + '" style="color:' + C_CORAL_D + ';font-size:13px;text-decoration:none;">' + loginUrl + '</a>', true) +
        '<tr><td style="height:8px;"></td></tr>' +
      '</table>' +

      ctaButton(loginUrl, 'Sign in now &rarr;') +
      spacer(28) +

      callout('amber', '&#9888;&#65039;', 'Action required on first login',
        'You&rsquo;ll be asked to set a new password right after signing in. Please don&rsquo;t share your temporary password with anyone.') +
    bodyClose() +
    emailFooter(
      '&copy; ' + new Date().getFullYear() + ' ' + BRAND_NAME + '. This email was sent to ' + escHtml(email) + '.',
      'If you did not expect this email, please contact your system administrator.');

  return emailShell('Welcome to ' + BRAND_NAME, inner);
}

// ─── Reset Email ────────────────────────────────────────────────────────────

function sendResetEmail(data) {
  var to        = data.to;
  var name      = data.name      || "User";
  var resetLink = data.resetLink || "#";

  var subject = "Reset your " + BRAND_NAME + " password";
  var html    = buildResetHtml(name, resetLink);

  GmailApp.sendEmail(to, subject, stripTags(html), { name: FROM_NAME, htmlBody: html });
}

function buildResetHtml(name, resetLink) {
  var inner =
    emailHeader('Reset your password', 'We received a request to reset your password') +
    bodyOpen() +
      '<p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">' +
        'Hi <strong>' + escHtml(name) + '</strong>,<br><br>' +
        'Someone requested a password reset for your <strong>' + BRAND_NAME + '</strong> account. Click the button below to choose a new password.' +
      '</p>' +

      ctaButton(resetLink, 'Reset password &rarr;') +
      spacer(28) +

      callout('blue', '&#8987;', 'This link expires in 1 hour',
        'For your security the reset link is valid for 60 minutes. After that you&rsquo;ll need to request a new one.') +
      spacer(24) +

      callout('red', '&#128274;', 'Didn&rsquo;t request this?',
        'If you didn&rsquo;t request a password reset, your account may be at risk. Contact your administrator. You can safely ignore this email otherwise.') +
    bodyClose() +
    emailFooter(
      '&copy; ' + new Date().getFullYear() + ' ' + BRAND_NAME + '. Automated security email. Please do not reply.',
      'This link is single-use and will expire after 1 hour.');

  return emailShell('Reset your password', inner);
}

// ─── Reminder Email ───────────────────────────────────────────────────────────

function sendReminderEmail(data) {
  var to         = data.to;
  var name       = data.name       || "User";
  var monthLabel = data.monthLabel || "this month";
  var message    = data.message    || ("Please upload your schedule data for " + monthLabel + ".");
  var loginUrl   = data.loginUrl   || "https://your-app.railway.app";

  var subject = "Reminder: upload schedule data for " + monthLabel;
  var html    = buildReminderHtml(name, monthLabel, message, loginUrl);

  GmailApp.sendEmail(to, subject, stripTags(html), { name: FROM_NAME, htmlBody: html });
}

function buildReminderHtml(name, monthLabel, message, loginUrl) {
  var inner =
    emailHeader('Upload reminder', 'Action needed for ' + escHtml(monthLabel)) +
    bodyOpen() +
      '<p style="margin:0 0 22px;color:#374151;font-size:15px;line-height:1.7;">' +
        'Hi <strong>' + escHtml(name) + '</strong>,<br><br>' + escHtml(message) +
      '</p>' +

      '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">' +
        '<tr><td style="background:#FDF1EB;border:1px solid #F6D2BF;border-left:4px solid ' + C_CORAL + ';border-radius:11px;padding:16px 20px;">' +
          '<p style="margin:0;color:' + C_CORAL_D + ';font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Pending upload</p>' +
          '<p style="margin:5px 0 0;color:' + C_INK + ';font-size:20px;font-weight:700;">' + escHtml(monthLabel) + '</p>' +
        '</td></tr>' +
      '</table>' +

      ctaButton(loginUrl, 'Upload schedule data &rarr;') +
      spacer(28) +

      callout('green', '&#9989;', 'Already uploaded?',
        'If you&rsquo;ve already submitted your data for ' + escHtml(monthLabel) + ', no further action is needed. Thank you!') +
    bodyClose() +
    emailFooter(
      '&copy; ' + new Date().getFullYear() + ' ' + BRAND_NAME + '. Automated reminder. Please do not reply.',
      'You are receiving this because you are assigned to upload schedule data.');

  return emailShell('Upload reminder', inner);
}

// ─── Package Email ────────────────────────────────────────────────────────────

function sendPackageEmail(data) {
  var to           = data.to;
  var name         = data.name         || "Team Head";
  var packageName  = data.packageName  || "Media Package";
  var intro        = data.intro        || "";
  var lineItems    = data.lineItems    || [];
  var responseLink = data.responseLink || "#";

  var subject = packageName + ": media package shared with you";
  var html    = buildPackageHtml(name, packageName, intro, lineItems, responseLink);

  var options = { name: FROM_NAME, htmlBody: html };

  // Attach the PDF live from the uploaded base64 (never stored server-side).
  if (data.pdfBase64) {
    var bytes = Utilities.base64Decode(data.pdfBase64);
    var blob  = Utilities.newBlob(bytes, "application/pdf", data.pdfFileName || (packageName + ".pdf"));
    options.attachments = [blob];
  }

  GmailApp.sendEmail(to, subject, stripTags(html), options);
}

function buildPackageHtml(name, packageName, intro, lineItems, responseLink) {
  var rows = "";
  for (var i = 0; i < lineItems.length; i++) {
    var li = lineItems[i] || {};
    var rate = (li.rate === 0 || li.rate) ? "LKR " + Number(li.rate).toLocaleString("en-US") : "";
    rows +=
      '<tr>' +
        '<td style="padding:11px 18px;border-top:1px solid ' + C_LINE + ';color:' + C_INK + ';font-size:13px;">' + escHtml(li.label || "") + '</td>' +
        '<td style="padding:11px 18px;border-top:1px solid ' + C_LINE + ';color:' + C_INK + ';font-size:13px;font-weight:700;text-align:right;font-family:\'Courier New\',monospace;">' + escHtml(rate) + '</td>' +
      '</tr>';
  }

  var inner =
    emailHeader(escHtml(packageName), 'A media package shared with you, ' + escHtml(name)) +
    bodyOpen() +
      (intro
        ? '<p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">' + escHtml(intro) + '</p>'
        : '<p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">Sign in to Ogilvy Orbit to review this package and let us know your interest.</p>') +

      (rows
        ? '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FB;border:1px solid ' + C_LINE + ';border-radius:13px;margin-bottom:28px;border-collapse:separate;overflow:hidden;">' +
            '<tr>' +
              '<td style="padding:11px 18px;color:' + C_MUTED + ';font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Sponsorship</td>' +
              '<td style="padding:11px 18px;color:' + C_MUTED + ';font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;text-align:right;">Package Rate</td>' +
            '</tr>' + rows +
          '</table>'
        : '') +

      ctaButton(responseLink, 'Open in Ogilvy Orbit &rarr;') +
    bodyClose() +
    emailFooter(
      '&copy; ' + new Date().getFullYear() + ' ' + BRAND_NAME + '. Review and respond from your Media Packages inbox.',
      'Sign in with your agency credentials to view the full package.');

  return emailShell(packageName, inner);
}

// ─── Media Buying Requisition (MBR) ─────────────────────────────────────────
// Payload: { type:"requisition", to, cc:[...], clientName, brandCampaign,
//            requesterName, hubName, details:[{label,value}], link }
function sendRequisitionEmail(data) {
  var to      = data.to;
  var cc      = (data.cc || []).filter(function (e) { return e && e !== to; });
  var details = data.details || [];
  var subject = "Media Buying Requisition: " + (data.clientName || "") +
                (data.brandCampaign ? " - " + data.brandCampaign : "");

  var rows = "";
  for (var i = 0; i < details.length; i++) {
    var d = details[i] || {};
    rows +=
      '<tr>' +
        '<td style="padding:9px 16px;border-top:1px solid ' + C_LINE + ';color:' + C_MUTED + ';font-size:12px;font-weight:700;white-space:nowrap;vertical-align:top;">' + escHtml(d.label || "") + '</td>' +
        '<td style="padding:9px 16px;border-top:1px solid ' + C_LINE + ';color:' + C_INK + ';font-size:13px;line-height:1.6;">' + escHtml(d.value || "") + '</td>' +
      '</tr>';
  }

  var inner =
    emailHeader('Media Buying Requisition', 'New requisition from ' + escHtml(data.requesterName || 'a team member')) +
    bodyOpen() +
      '<p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.7;">' +
        'A Media Buying Requisition (MBR) has been raised' + (data.clientName ? ' for <strong>' + escHtml(data.clientName) + '</strong>' : '') + '. ' +
        'The full details are below - open Ogilvy Orbit to review or export the sheet.' +
      '</p>' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FB;border:1px solid ' + C_LINE + ';border-radius:13px;margin-bottom:26px;border-collapse:separate;overflow:hidden;">' +
        rows +
      '</table>' +
      ctaButton(data.link || '#', 'Open in Ogilvy Orbit &rarr;') +
    bodyClose() +
    emailFooter(
      '&copy; ' + new Date().getFullYear() + ' ' + BRAND_NAME + '. Raised via the Media Buying Requisition form.',
      'Sign in with your agency credentials to view or export the requisition.');

  var html    = emailShell('Media Buying Requisition', inner);
  var options = { name: FROM_NAME, htmlBody: html };
  if (cc.length) options.cc = cc.join(",");
  GmailApp.sendEmail(to, subject, stripTags(html), options);
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

// ─── Dev helper ───────────────────────────────────────────────────────────────
// Run this from the editor to send a sample email to yourself. Change `type`
// to "reset", "reminder" or "package" to preview the other templates.
function testSend() {
  var me = Session.getActiveUser().getEmail();
  doPost({ postData: { contents: JSON.stringify({
    type: "welcome",
    to: me,
    name: "Test User",
    password: "TempPass@123",
    loginUrl: "https://example.com",
    // reset:    resetLink: "https://example.com/reset-password?token=abc"
    // reminder: monthLabel: "June 2026", message: "Please upload your June data."
    // package:  packageName: "Avurudu Prime TV", intro: "...", lineItems: [{label:"Hiru TV 30s", rate:250000}], responseLink: "https://example.com/my-packages"
  }) } });
}
