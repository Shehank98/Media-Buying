import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export async function generateExcel(data, title) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ogilvy Orbit';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title);

  if (data.length === 0) {
    sheet.addRow(['No data available']);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // Extract headers from first row
  const headers = Object.keys(data[0]);
  sheet.addRow(headers);

  // Style headers
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

  // Add data rows
  for (const row of data) {
    sheet.addRow(headers.map((h) => row[h]));
  }

  // Auto-width columns
  sheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const cellLength = cell.value ? String(cell.value).length : 0;
      if (cellLength > maxLength) {
        maxLength = cellLength;
      }
    });
    column.width = Math.min(maxLength + 2, 50);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generatePdf(data, title) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.fontSize(18).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(1);

    if (data.length === 0) {
      doc.fontSize(12).text('No data available', { align: 'center' });
      doc.end();
      return;
    }

    const headers = Object.keys(data[0]);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / headers.length;
    const startX = doc.page.margins.left;
    let y = doc.y;

    // Draw header row
    doc.font('Helvetica-Bold').fontSize(9);
    headers.forEach((header, i) => {
      doc.text(header, startX + i * colWidth, y, {
        width: colWidth,
        align: 'left',
      });
    });

    y += 20;
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    y += 5;

    // Draw data rows
    doc.font('Helvetica').fontSize(8);
    for (const row of data) {
      // Check if we need a new page
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      headers.forEach((header, i) => {
        const value = row[header] != null ? String(row[header]) : '';
        doc.text(value, startX + i * colWidth, y, {
          width: colWidth,
          align: 'left',
        });
      });

      y += 18;
    }

    doc.end();
  });
}

// ─── Property & Rate-History PDF (media-buyer view) ──────────────────────────

const PP = {
  navy: '#0A1729', coral: '#E85D24', coralDk: '#C44A18', ink: '#16243C',
  soft: '#6B7790', muted2: '#93A0B5', line: '#E5E8ED', green: '#15814B', red: '#C5391F',
};
const rs = (v) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  if (n === 0) return 'Added value';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
};
const dt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export async function generatePropertyHistoryPdf({ title, filtersText, groups, totals, includeHistory }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 44, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentW = right - left;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensure = (h) => { if (doc.y + h > bottom()) { doc.addPage(); doc.y = doc.page.margins.top; } };

    // Header band
    doc.save().rect(0, 0, doc.page.width, 84).fill(PP.navy).restore();
    doc.roundedRect(left, 25, 34, 34, 17).fill(PP.coral);
    doc.fillColor('#FFF3EC').font('Helvetica-Bold').fontSize(17).text('O', left, 34, { width: 34, align: 'center' });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text('Ogilvy Orbit', left + 44, 29);
    doc.fillColor('#9FB0C9').font('Helvetica').fontSize(9.5).text(title || 'Property & Rate History', left + 44, 49);
    doc.fillColor('#9FB0C9').font('Helvetica').fontSize(8).text('Generated ' + dt(new Date()), left, 31, { width: contentW, align: 'right' });

    doc.fillColor(PP.ink);
    doc.y = 100;
    if (filtersText) {
      doc.font('Helvetica').fontSize(9).fillColor(PP.soft).text(filtersText, left, doc.y, { width: contentW });
      doc.moveDown(0.3);
    }
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(PP.ink)
      .text(`${totals.properties} ${totals.properties === 1 ? 'property' : 'properties'}  ·  ${rs(totals.cost)} total committed`, { width: contentW });
    doc.moveDown(0.7);

    if (!groups || groups.length === 0) {
      doc.font('Helvetica').fontSize(11).fillColor(PP.soft).text('No properties match the selected filters.', { align: 'center' });
      doc.end();
      return;
    }

    for (const g of groups) {
      ensure(46);
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor(PP.coralDk).text(g.name, left, doc.y);
      doc.moveTo(left, doc.y + 3).lineTo(right, doc.y + 3).strokeColor(PP.line).lineWidth(1).stroke();
      doc.moveDown(0.6);

      for (const p of g.properties) {
        ensure(64);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(PP.ink).text(p.propertyName, { width: contentW });
        doc.font('Helvetica').fontSize(8.5).fillColor(PP.soft)
          .text(`${p.channelMasterName}  ·  ${p.clientName}  ·  ${p.agencyName}  ·  ${p.propertyType}`, { width: contentW });
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(9).fillColor(PP.ink)
          .text(`Current rate: `, { continued: true })
          .font('Helvetica-Bold').text(rs(p.cost), { continued: true })
          .font('Helvetica').fillColor(PP.soft).text(`     Bonus: `, { continued: true })
          .font('Helvetica-Bold').fillColor(PP.ink).text(p.bonusPct != null ? p.bonusPct + '%' : '—');
        if (p.notes) {
          doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(PP.soft).text(`Notes: ${trunc(p.notes, 140)}`, { width: contentW });
        }

        if (includeHistory && p.timeline && p.timeline.length) {
          doc.moveDown(0.25);
          ensure(28);
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PP.muted2).text('RATE HISTORY', { characterSpacing: 0.8 });
          doc.moveDown(0.15);
          // columns
          const cDate = left, cRate = left + 95, cChg = left + 190, cNote = left + 255, cBy = right - 95;
          const noteW = cBy - cNote - 8;
          // header
          const hy = doc.y;
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PP.soft);
          doc.text('DATE', cDate, hy); doc.text('RATE', cRate, hy); doc.text('CHANGE', cChg, hy);
          doc.text('NOTE', cNote, hy); doc.text('BY', cBy, hy);
          doc.y = hy + 11;
          doc.moveTo(left, doc.y - 2).lineTo(right, doc.y - 2).strokeColor('#EEF0F3').lineWidth(0.5).stroke();

          for (const ev of p.timeline) {
            ensure(13);
            const ry = doc.y;
            let chgTxt = '—', chgColor = PP.soft;
            if (ev.prevCost == null) { chgTxt = 'Initial'; chgColor = PP.muted2; }
            else if (Number(ev.prevCost) !== 0) {
              const pct = ((Number(ev.cost) - Number(ev.prevCost)) / Number(ev.prevCost)) * 100;
              const up = pct >= 0;
              chgTxt = (up ? '+' : '') + pct.toFixed(0) + '%';
              chgColor = up ? PP.green : PP.red;
            }
            doc.font('Helvetica').fontSize(8).fillColor(PP.ink).text(dt(ev.date), cDate, ry, { width: 90 });
            doc.font('Helvetica-Bold').fontSize(8).fillColor(PP.ink).text(rs(ev.cost), cRate, ry, { width: 90 });
            doc.font('Helvetica-Bold').fontSize(8).fillColor(chgColor).text(chgTxt, cChg, ry, { width: 60 });
            doc.font('Helvetica').fontSize(8).fillColor(PP.soft).text(trunc(ev.note, 46), cNote, ry, { width: noteW });
            doc.font('Helvetica').fontSize(8).fillColor(PP.soft).text(trunc(ev.by, 16), cBy, ry, { width: 90 });
            doc.y = ry + 12.5;
          }
        }
        doc.moveDown(0.7);
      }
    }

    doc.end();
  });
}
