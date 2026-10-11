/** Minimal RFC-4180 style CSV helpers (quoted fields, escaped quotes, CRLF/LF). */
/** Byte-order mark so Excel opens UTF-8 files (₹, Hindi/Tamil names) correctly. */
export const CSV_BOM = String.fromCharCode(0xFEFF);
export function toCsv(rows) {
  return rows.map(r => r.map(v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`; // neutralise spreadsheet formulas
    return `"${s.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}

export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else field += c;
  }
  row.push(field); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

export function downloadCsv(filename, rows) {
  const blob = new Blob([CSV_BOM, toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
