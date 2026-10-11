const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
const num = new Intl.NumberFormat('en-IN');

/** Whole rupees print without paise (₹540); anything else always shows two decimals (₹340.10). */
export const money = v => { const n = Number(v || 0); return Number.isInteger(n) ? inr0.format(n) : inr2.format(n); };
export const moneyRound = v => inr0.format(Number(v || 0));
export const compactMoney = v => compact.format(Number(v || 0));
export const number = v => num.format(Number(v || 0));
export const percent = (v, digits = 1) => `${Number(v || 0).toFixed(digits).replace(/\.0+$/, '')}%`;

/** Parse "YYYY-MM-DD[ HH:MM:SS]" as a local date (no timezone shift). */
export function parseDate(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0)) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
export const dateLabel = value => { const d = parseDate(value); return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; };
export const shortDate = value => { const d = parseDate(value); return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'; };
export const dateTimeLabel = value => { const d = parseDate(value); return d ? `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : '—'; };
export function relativeDay(value) {
  const d = parseDate(value); if (!d) return '—';
  const days = Math.round((new Date().setHours(12, 0, 0, 0) - new Date(d).setHours(12, 0, 0, 0)) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 30 ? `${days} days ago` : dateLabel(value);
}
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (days, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + days); return d; };

export const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase() || '').join('') || '?';
export const titleCase = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
export const plural = (n, one, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;
export const PAYMENT_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer', credit: 'Credit (pay later)' };
export const delta = (current, previous) => (previous > 0 ? ((current - previous) / previous) * 100 : null);
