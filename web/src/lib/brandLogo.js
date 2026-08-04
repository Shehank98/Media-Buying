// Single source of truth for the brand logo used in every DOCUMENT the app
// generates - the PDFs, the PowerPoint deck and the Excel exports.
//
// Drop the company logo at web/public/brand-logo.jpg (or .png) and it appears in
// all of them automatically - there is deliberately no second place to configure.
// The chain falls back to the built-in orbit mark so exports keep working (and
// stay branded) when no custom logo has been added yet.
//
// NOT the sidebar. The sidebar shows the animated orbit lockup + an "Ogilvy
// Orbit" wordmark (Layout.jsx / .brand-name in index.css) and deliberately
// ignores this file, so changing the document logo never touches the app chrome.
//
// Mirrored server-side by api/src/utils/brandLogo.js, which reads the same files
// out of web/dist for the PDFKit/ExcelJS exports.

// The custom logo files, in preference order. PNG first because it can carry
// transparency; a .jpg works too (exports put it on a white chip where the
// background is dark).
export const BRAND_LOGO_FILES = ['/brand-logo.png', '/brand-logo.jpg'];

// Documents fall back to the built-in orbit mark, so an export is always branded
// even before a custom logo is added.
export const BRAND_LOGO_CANDIDATES = [...BRAND_LOGO_FILES, '/orbit-logo.png'];

// Resolved once per page load - every export reuses it rather than re-fetching.
let cached;

function readAsDataUrl(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(blob);
  });
}

// Natural pixel size, so callers can preserve the aspect ratio of whatever logo
// was dropped in instead of stretching it into a fixed box.
function measure(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * @returns {Promise<{dataUrl: string, width: number, height: number, ratio: number, format: string}|null>}
 *   null when no candidate loads - callers must treat the logo as optional and
 *   still produce the document.
 */
export async function loadBrandLogo() {
  if (cached !== undefined) return cached;
  for (const src of BRAND_LOGO_CANDIDATES) {
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      const blob = await res.blob();
      // A dev server / SPA fallback can answer a missing file with index.html;
      // only trust a response that is actually an image.
      if (!blob.type.startsWith('image/')) continue;
      const dataUrl = await readAsDataUrl(blob);
      if (!dataUrl) continue;
      const dims = await measure(dataUrl);
      if (!dims) continue;
      cached = {
        dataUrl,
        width: dims.width,
        height: dims.height,
        ratio: dims.width / dims.height,
        format: blob.type === 'image/jpeg' ? 'JPEG' : 'PNG', // jsPDF addImage format
      };
      return cached;
    } catch { /* try the next candidate */ }
  }
  cached = null;
  return cached;
}

/**
 * Fit a logo into a bounding box without distorting it.
 * @returns {{width: number, height: number}} in the caller's units
 */
export function fitLogo(logo, maxW, maxH) {
  if (!logo) return { width: 0, height: 0 };
  const w = Math.min(maxW, maxH * logo.ratio);
  const h = w / logo.ratio;
  return { width: w, height: h };
}

/**
 * Draw the logo into a jsPDF header, vertically centred in a band.
 *
 * Set `chip` for a dark band: it paints a white rounded panel behind the logo.
 * A JPG cannot carry transparency, so without this an opaque logo would show as
 * a bare white rectangle on navy; with it, it reads as a deliberate badge (and
 * dark-ink logos stay legible).
 *
 * @returns {{x: number, y: number, width: number, height: number, endX: number, endY: number}|null}
 *   null when there is no logo, so callers can fall back to a text lockup.
 */
export function drawPdfLogo(doc, logo, x, bandTop, bandH, { maxW = 46, maxH = 16, chip = false, pad = 2 } = {}) {
  if (!logo) return null;
  const { width, height } = fitLogo(logo, maxW, maxH);
  const y = bandTop + (bandH - height) / 2;
  try {
    if (chip) {
      doc.setFillColor(255, 255, 255);
      // roundedRect isn't available on very old jsPDF builds; fall back to rect.
      if (typeof doc.roundedRect === 'function') {
        doc.roundedRect(x - pad, y - pad, width + pad * 2, height + pad * 2, pad, pad, 'F');
      } else {
        doc.rect(x - pad, y - pad, width + pad * 2, height + pad * 2, 'F');
      }
    }
    doc.addImage(logo.dataUrl, logo.format, x, y, width, height);
  } catch {
    return null; // a corrupt image must never abort the export
  }
  return { x, y, width, height, endX: x + width, endY: y + height };
}
