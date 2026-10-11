/** Parse ?page=&pageSize= with sane bounds. */
export function pageParams(query, defaultSize = 25, maxSize = 100) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export const pageMeta = (page, pageSize, total) => ({ page, pageSize, total: Number(total), pages: Math.max(1, Math.ceil(Number(total) / pageSize)) });
/** Escape LIKE wildcards in user search text (use with ESCAPE '\'). */
export const likePattern = text => `%${String(text || '').replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
export const isDateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
export function nextDay(dateOnly) { const d = new Date(`${dateOnly}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank', 'credit'];
export function paymentStatus(total, paid) {
  const t = Math.round(Number(total) * 100), p = Math.round(Number(paid) * 100);
  return p >= t ? 'paid' : p <= 0 ? 'unpaid' : 'partial';
}
