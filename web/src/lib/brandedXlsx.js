// Branded Excel export for the in-page "Export" buttons.
//
// SheetJS (the `xlsx` package) cannot embed images at all, so any sheet that has
// to carry the company logo is written with ExcelJS instead. This module is the
// adapter: it takes the same array-of-arrays the SheetJS call sites already
// build, so converting a call site is a one-line change rather than a rewrite.
//
//   const wb = XLSX.utils.book_new();
//   const ws = XLSX.utils.aoa_to_sheet(rows);
//   XLSX.utils.book_append_sheet(wb, ws, 'Summary');
//   XLSX.writeFile(wb, 'file.xlsx');
//        ↓
//   await writeBrandedWorkbook([{ name: 'Summary', aoa: rows }], 'file.xlsx');
//
// NOT for machine-readable round-trip files. The bulk-import template and the
// failed/duplicate-row exports are re-uploaded and parsed, and the parser expects
// headers on row 1 - a logo shifts them down and breaks the import. Those stay on
// SheetJS deliberately. CSV cannot hold an image either.
//
// `xlsx` is still used everywhere for READING uploads; this only replaces writes.

import { loadBrandLogo } from './brandLogo.js';

// ExcelJS is ~1MB, so it is imported on demand - it must never be pulled into
// the initial bundle just because a page has an Export button.
let exceljsPromise;
function getExcelJS() {
  if (!exceljsPromise) exceljsPromise = import('exceljs').then((m) => m.default || m);
  return exceljsPromise;
}

// Excel column width is measured in characters; SheetJS uses {wch}. Accept both
// that and a plain number so existing `!cols` arrays can be passed straight in.
function colWidth(c) {
  if (c == null) return null;
  if (typeof c === 'number') return c;
  if (typeof c === 'object' && typeof c.wch === 'number') return c.wch;
  return null;
}

/**
 * Float the logo over the top rows of a sheet.
 * @returns {number} rows reserved (0 when there is no logo)
 */
function addSheetLogo(workbook, sheet, logo) {
  if (!logo) return 0;
  try {
    const imageId = workbook.addImage({
      base64: logo.dataUrl,
      extension: logo.format === 'JPEG' ? 'jpeg' : 'png',
    });
    const height = 46;
    const width = Math.min(190, height * logo.ratio);
    sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width, height } });
    const rows = Math.ceil(height / 20) + 1;
    // getRow() materialises the row, which both sets the height AND reserves the
    // space so a later addRow() lands underneath. Do not also push empty rows.
    for (let r = 1; r <= rows; r++) sheet.getRow(r).height = 20;
    return rows;
  } catch {
    return 0; // a logo problem must never cost the user their export
  }
}

/**
 * Write a branded .xlsx and trigger the browser download.
 *
 * @param {Array<{name?: string, aoa?: any[][], json?: object[], cols?: any[]}>} sheets
 *   Each sheet supplies EITHER `aoa` (array of arrays, header row included) or
 *   `json` (array of objects; headers derived from the first object's keys).
 * @param {string} fileName  including the .xlsx extension
 */
export async function writeBrandedWorkbook(sheets, fileName) {
  const [ExcelJS, logo] = await Promise.all([getExcelJS(), loadBrandLogo()]);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ogilvy Orbit';
  workbook.created = new Date();

  (sheets || []).forEach((s, i) => {
    // Excel caps sheet names at 31 chars and forbids : \ / ? * [ ]
    const name = String(s?.name || `Sheet${i + 1}`).replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || `Sheet${i + 1}`;
    const sheet = workbook.addWorksheet(name);

    let rows = s?.aoa;
    if (!rows && Array.isArray(s?.json)) {
      const headers = s.json.length ? Object.keys(s.json[0]) : [];
      rows = [headers, ...s.json.map((o) => headers.map((h) => o[h]))];
    }
    rows = Array.isArray(rows) ? rows : [];

    addSheetLogo(workbook, sheet, logo);
    for (const r of rows) sheet.addRow(Array.isArray(r) ? r : [r]);

    const cols = s?.cols;
    if (Array.isArray(cols)) {
      cols.forEach((c, ci) => {
        const w = colWidth(c);
        if (w) sheet.getColumn(ci + 1).width = w;
      });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
