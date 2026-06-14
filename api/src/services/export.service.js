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
