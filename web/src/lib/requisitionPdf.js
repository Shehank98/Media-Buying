// Branded PDF export for a Media Buying Requisition (MBR).
// The header logo comes from the shared brand loader (web/public/brand-logo.jpg,
// falling back to the built-in orbit mark) so it matches the sidebar and every
// other export.

import { loadBrandLogo, fitLogo } from './brandLogo.js';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

const DEADLINES = {
  'annual': { label: 'Annual buy', lead: 'two weeks' },
  'campaign-special': { label: 'Campaign special buy', lead: 'one week' },
  'new-client': { label: 'New client', lead: 'one to two weeks' },
};

// Build the label/value rows shown in the PDF (mirrors the email details).
function buildRows(r) {
  const period = (r.campaignStart || r.campaignEnd) ? `${fmtDate(r.campaignStart)}  to  ${fmtDate(r.campaignEnd)}` : '-';
  const rows = [
    ['Date', fmtDate(r.createdAt)],
    ['Client', r.clientName + (r.agencyName ? `  (${r.agencyName})` : r.isNewClient ? '  (new client)' : '')],
    ['Brand / Campaign', r.brandCampaign || '-'],
    ['Target Group (TG)', r.targetGroup || '-'],
    ['Campaign Period', period],
    ['Budget', [r.budgetPct ? `${r.budgetPct}%` : '', r.budgetAmount ? 'LKR ' + Number(r.budgetAmount).toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''].filter(Boolean).join('  -  ') || '-'],
    ['Medium', (r.mediums || []).join(', ') || '-'],
  ];
  const st = r.stations || {}, dl = r.deliverables || {}, dp = r.daypartMandates || {};
  (r.mediums || []).forEach((m) => { if (st[m]) rows.push([`${m} - Channels / Stations / Publications`, st[m]]); });
  if (r.buyingProperty) rows.push(['Buying Property / Sponsorships / Key Integrations', r.buyingProperty]);
  (r.mediums || []).forEach((m) => { if (dl[m]) rows.push([`${m} - Deliverables & Specifications`, dl[m]]); });
  (r.mediums || []).forEach((m) => { if (dp[m]) rows.push([`${m} - Daypart Mandates`, dp[m]]); });
  if (r.discussionPoints) rows.push(['Discussion Points & Special Instructions', r.discussionPoints]);
  const dead = DEADLINES[r.deadlineType];
  const dParts = [];
  if (dead) dParts.push(dead.label);
  if (r.deadlineDate) dParts.push(`by ${fmtDate(r.deadlineDate)}`);
  const dBase = dParts.join(' - ');
  rows.push(['Deadline', dBase ? (dead ? `${dBase} (buying unit needs ${dead.lead})` : dBase) : '-']);
  rows.push(['Requested by', `${r.requesterName || '-'}${r.requesterRole ? ` (${r.requesterRole})` : ''}`]);
  return rows;
}

export async function exportRequisitionPdf(r) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 14;

  // Fitted rather than forced to a fixed box, so a logo of any aspect ratio
  // renders undistorted.
  const logo = await loadBrandLogo();
  if (logo) {
    const { width, height } = fitLogo(logo, 46, 19);
    try { doc.addImage(logo.dataUrl, logo.format, M, 12, width, height); } catch { /* keep the report */ }
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(16, 36, 60);
  doc.text('Media Buying Requisition', pageW - M, 19, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`MBR #${r.id}  ·  ${fmtDate(r.createdAt)}`, pageW - M, 25, { align: 'right' });

  autoTable(doc, {
    startY: 38,
    theme: 'grid',
    head: [['Field', 'Details']],
    body: buildRows(r),
    styles: { fontSize: 9, cellPadding: 3, valign: 'top', lineColor: [229, 232, 237], textColor: [22, 36, 60] },
    headStyles: { fillColor: [10, 23, 41], textColor: [255, 255, 255], fontSize: 9.5 },
    columnStyles: { 0: { cellWidth: 62, fontStyle: 'bold', textColor: [59, 74, 99] }, 1: { cellWidth: pageW - 2 * M - 62 } },
    margin: { left: M, right: M },
  });

  doc.save(`MBR-${r.clientName || 'requisition'}-${new Date().toISOString().slice(0, 10)}.pdf`.replace(/[^a-z0-9.\-]+/gi, '_'));
}
