import { createHash } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validRequestKey(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Hash only normalized business inputs; array order cannot create a different fingerprint. */
export function requestFingerprint(customerId, items, extra = {}) {
  const normalizedItems = items
    .map(item => ({ productId: Number(item.productId), quantity: Number(item.quantity) }))
    .sort((a, b) => a.productId - b.productId);
  return createHash('sha256')
    .update(JSON.stringify({ customerId: customerId === null ? null : Number(customerId), items: normalizedItems, extra }))
    .digest('hex');
}


/** Hash a normalized non-financial payload such as customer fields. */
export function payloadFingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
