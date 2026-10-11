export const MYSQL_INT_UNSIGNED_MAX = 4294967295;
const UINT_PATTERN = /^(?:0|[1-9]\d*)$/;
const INT_PATTERN = /^[1-9]\d*$/;

function integerValue(value, pattern) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 && value <= MYSQL_INT_UNSIGNED_MAX ? value : null;
  if (typeof value !== 'string' || !pattern.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MYSQL_INT_UNSIGNED_MAX ? parsed : null;
}

export const positiveInt = (value) => { const parsed = integerValue(value, INT_PATTERN); return parsed !== null && parsed > 0; };
export const positiveId = (value) => {
  const valid = typeof value === 'number' ? Number.isSafeInteger(value) && value > 0 : typeof value === 'string' && INT_PATTERN.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  return Boolean(valid);
};
export const nonNegativeInt = (value) => integerValue(value, UINT_PATTERN) !== null;
export const asUnsignedInt = (value) => integerValue(value, UINT_PATTERN);
export const cleanString = (value) => typeof value === 'string' ? value.trim() : '';
export const validMoney = (value) => {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : '';
  return /^\d{1,10}(?:\.\d{1,2})?$/.test(text) && Number.isFinite(Number(text)) && Number(text) >= 0;
};
export function badRequest(res, message, field) {
  return res.status(400).json({ error: 'VALIDATION_ERROR', message, ...(field ? { field } : {}) });
}
export const MAX_AMOUNT_CENTS = 999999999999n; // DECIMAL(12,2) maximum: 9,999,999,999.99
export function calculateAmountCents(unitPrice, quantity) {
  const amount = Number(unitPrice);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MYSQL_INT_UNSIGNED_MAX) return null;
  const unitPriceCents = BigInt(Math.round(amount * 100));
  const totalCents = unitPriceCents * BigInt(quantity);
  if (unitPriceCents < 0n || totalCents > MAX_AMOUNT_CENTS) return null;
  return totalCents;
}
export function amountCentsToNumber(cents) {
  return Number(cents) / 100;
}
