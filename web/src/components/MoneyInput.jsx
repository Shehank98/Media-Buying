import { useState, useEffect } from 'react';

// Group the integer part of a numeric string with thousands separators.
function groupInt(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Format a raw value (number or string) for display with comma separators.
// Preserves an in-progress trailing "." and typed decimals so editing feels
// natural. Empty / null / non-numeric -> ''.
export function formatMoney(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).replace(/,/g, '');
  if (s === '') return '';
  // Negative if it starts with "-" OR is written in accounting parentheses,
  // e.g. "(1200)" → -1200.
  const neg = s.trim().startsWith('-') || s.includes('(');
  // Keep only digits and dots (this also strips the sign, parens and spaces),
  // then collapse to a single decimal point.
  s = s.replace(/[^0-9.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }
  let [int = '', dec] = s.split('.');
  int = int.replace(/^0+(?=\d)/, ''); // trim leading zeros, keep a lone 0
  if (int === '' && dec !== undefined) int = '0';
  const grouped = int === '' ? '' : groupInt(int);
  const out = dec !== undefined ? `${grouped}.${dec}` : grouped;
  return (neg && out !== '' ? '-' : '') + out;
}

// Strip formatting back to a raw numeric string ('' when empty).
export function unformatMoney(display) {
  const raw = String(display ?? '').replace(/,/g, '').trim();
  return raw === '' || raw === '-' ? '' : raw;
}

// A text input that shows LKR amounts with thousands separators while typing
// and emits the raw numeric string via onValueChange (matching what a plain
// type="number" input's onChange gave: '' or a numeric string). Drop-in for
// currency fields - pass value (number|string) and onValueChange.
export default function MoneyInput({ value, onValueChange, className = 'input', ...rest }) {
  const [display, setDisplay] = useState(() => formatMoney(value));

  // Re-sync when the external value changes to something other than what we
  // currently show (e.g. a form reset, "copy last month", or async load).
  useEffect(() => {
    const incoming = formatMoney(value);
    if (unformatMoney(incoming) !== unformatMoney(display)) setDisplay(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (e) => {
    const formatted = formatMoney(e.target.value);
    setDisplay(formatted);
    onValueChange?.(unformatMoney(formatted));
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      className={className}
      value={display}
      onChange={handleChange}
    />
  );
}
