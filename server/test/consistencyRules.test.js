import test from 'node:test';
import assert from 'node:assert/strict';
import { positiveInt, positiveId, nonNegativeInt, validMoney, calculateAmountCents, amountCentsToNumber, cleanString, MAX_AMOUNT_CENTS, MYSQL_INT_UNSIGNED_MAX } from '../src/utils/validation.js';
import { dateKeysEndingAt } from '../src/utils/dates.js';
import { getOrderTransition } from '../src/services/orderRules.js';
import { createSaleFromOrder } from '../src/services/orderSales.js';
import { validRequestKey, requestFingerprint, payloadFingerprint } from '../src/utils/idempotency.js';
import { idempotencyReplayState } from '../src/services/idempotency.js';

test('stock and quantity validators reject empty, fractional, negative, unsafe and out-of-range values', () => {
  assert.equal(positiveInt(1), true);
  assert.equal(positiveInt(0), false);
  assert.equal(positiveInt(1.5), false);
  assert.equal(positiveInt('1e3'), false);
  assert.equal(positiveId('5000000000'), true);
  assert.equal(positiveId('1e3'), false);
  assert.equal(nonNegativeInt(0), true);
  assert.equal(nonNegativeInt(-1), false);
  assert.equal(nonNegativeInt(''), false);
  assert.equal(nonNegativeInt(MYSQL_INT_UNSIGNED_MAX), true);
  assert.equal(nonNegativeInt(MYSQL_INT_UNSIGNED_MAX + 1), false);
});

test('cleanString trims text and rejects non-string values', () => {
  assert.equal(cleanString('  OpsMitra  '), 'OpsMitra');
  assert.equal(cleanString(null), '');
  assert.equal(cleanString(42), '');
});

test('money validation and cents arithmetic stay inside DECIMAL(12,2)', () => {
  assert.equal(validMoney('10.25'), true);
  assert.equal(validMoney('10.256'), false);
  assert.equal(validMoney('10000000000'), false);
  assert.equal(calculateAmountCents(10.25, 3), 3075n);
  assert.equal(amountCentsToNumber(3075n), 30.75);
  assert.equal(calculateAmountCents(9999999999.99, 2), null);
  assert.equal(MAX_AMOUNT_CENTS, 999999999999n);
});

test('report date keys follow the database date and handle month/year boundaries', () => {
  assert.deepEqual(dateKeysEndingAt('2026-01-02', 4), ['2025-12-30','2025-12-31','2026-01-01','2026-01-02']);
  assert.deepEqual(dateKeysEndingAt('2024-03-01', 3), ['2024-02-28','2024-02-29','2024-03-01']);
  assert.throws(() => dateKeysEndingAt('2026-02-30', 7), /invalid/i);
});

test('order completion deducts once and cancellation of a completed order restores once', () => {
  assert.deepEqual(getOrderTransition('ready','completed',false), { ok:true, shouldDeductStock:true, shouldRestoreStock:false, stockDeductedAfterTransition:true });
  assert.deepEqual(getOrderTransition('completed','completed',true), { ok:true, shouldDeductStock:false, shouldRestoreStock:false, stockDeductedAfterTransition:true });
  assert.deepEqual(getOrderTransition('completed','cancelled',true), { ok:true, shouldDeductStock:false, shouldRestoreStock:true, stockDeductedAfterTransition:false });
  assert.deepEqual(getOrderTransition('pending','cancelled',false), { ok:true, shouldDeductStock:false, shouldRestoreStock:false, stockDeductedAfterTransition:false });
});

test('cancelled orders cannot be reopened and inconsistent stock markers are rejected', () => {
  assert.equal(getOrderTransition('cancelled','pending',false).ok, false);
  assert.equal(getOrderTransition('completed','ready',true).ok, false);
  assert.equal(getOrderTransition('completed','cancelled',false).code, 'ORDER_STOCK_INCONSISTENT');
  assert.equal(getOrderTransition('pending','ready',true).code, 'ORDER_STOCK_INCONSISTENT');
});


test('order transitions reject backwards status changes but allow idempotent updates', () => {
  assert.equal(getOrderTransition('processing', 'pending', false).code, 'INVALID_ORDER_TRANSITION');
  assert.equal(getOrderTransition('ready', 'processing', false).code, 'INVALID_ORDER_TRANSITION');
  assert.equal(getOrderTransition('pending', 'pending', false).ok, true);
  assert.equal(getOrderTransition('cancelled', 'cancelled', false).ok, true);
});

function makeOrderSaleConnection({ orders = [{ id: 8, customerId: 3, totalAmount: '70.00' }], existing = [], items = [{ productId: 4, quantity: 2, unitPrice: '35.00', lineTotal: '70.00' }] } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id, customer_id AS customerId')) return [orders, []];
      if (sql.startsWith('SELECT id, status FROM sales')) return [existing, []];
      if (sql.startsWith('SELECT product_id AS productId')) return [items, []];
      if (sql.startsWith('INSERT INTO sales')) return [{ insertId: 42 }, []];
      if (sql.startsWith('INSERT INTO sale_items')) return [{ affectedRows: items.length }, []];
      throw new Error(`Unexpected SQL in order-sale helper test: ${sql}`);
    }
  };
}

test('order completion helper creates exactly one linked sale from immutable order-item prices', async () => {
  const db = makeOrderSaleConnection();
  const result = await createSaleFromOrder(db, 7, 8);
  assert.deepEqual(result, { id: 42, saleNumber: 'ORDSALE-8', totalAmount: 70 });
  const insertSale = db.calls.find(c => c.sql.startsWith('INSERT INTO sales'));
  assert.deepEqual(insertSale.params, [7, 'ORDSALE-8', 3, 70, 70, 'cash', 70, 8]);
  assert.ok(db.calls.some(c => c.sql.startsWith('INSERT INTO sale_items')));
});

test('order completion helper rejects duplicate linked sales and empty orders', async () => {
  const duplicate = makeOrderSaleConnection({ existing: [{ id: 20, status: 'completed' }] });
  await assert.rejects(() => createSaleFromOrder(duplicate, 7, 8), error => error.code === 'ORDER_SALE_ALREADY_EXISTS' && error.status === 409);
  assert.equal(duplicate.calls.some(c => c.sql.startsWith('INSERT INTO sales')), false);
  const empty = makeOrderSaleConnection({ items: [] });
  await assert.rejects(() => createSaleFromOrder(empty, 7, 8), error => error.code === 'ORDER_HAS_NO_ITEMS' && error.status === 409);
});


test('write request keys require UUID format and fingerprints are stable for the same normalized payload', () => {
  const key = 'ea0c2e8e-7bc1-4d31-8e95-6e2cbdc81cc0';
  assert.equal(validRequestKey(key), true);
  assert.equal(validRequestKey('not-a-uuid'), false);
  assert.equal(validRequestKey(null), false);
  const left = requestFingerprint(4, [{ productId: 9, quantity: 2 }, { productId: 3, quantity: 1 }]);
  const reordered = requestFingerprint(4, [{ productId: 3, quantity: 1 }, { productId: 9, quantity: 2 }]);
  assert.equal(left, reordered);
  assert.notEqual(left, requestFingerprint(5, [{ productId: 9, quantity: 2 }, { productId: 3, quantity: 1 }]));
  assert.notEqual(left, requestFingerprint(4, [{ productId: 9, quantity: 1 }, { productId: 3, quantity: 1 }]));
  assert.notEqual(left, requestFingerprint(4, [{ productId: 9, quantity: 2 }, { productId: 3, quantity: 1 }], { status: 'pending' }));
  assert.equal(payloadFingerprint({ name: 'Customer', email: 'c@example.com' }), payloadFingerprint({ name: 'Customer', email: 'c@example.com' }));
  assert.notEqual(payloadFingerprint({ name: 'Customer', email: 'c@example.com' }), payloadFingerprint({ name: 'Other', email: 'c@example.com' }));
});


test('order-to-sale linkage refuses corrupted item or order totals before creating revenue', async () => {
  const wrongOrderTotal = makeOrderSaleConnection({ orders: [{ id: 8, customerId: 3, totalAmount: '71.00' }] });
  await assert.rejects(() => createSaleFromOrder(wrongOrderTotal, 7, 8), error => error.code === 'ORDER_TOTAL_INCONSISTENT' && error.status === 409);
  assert.equal(wrongOrderTotal.calls.some(call => call.sql.startsWith('INSERT INTO sales')), false);

  const wrongLine = makeOrderSaleConnection({ items: [{ productId: 4, quantity: 2, unitPrice: '35.00', lineTotal: '69.00' }] });
  await assert.rejects(() => createSaleFromOrder(wrongLine, 7, 8), error => error.code === 'ORDER_LINE_TOTAL_INCONSISTENT' && error.status === 409);
  assert.equal(wrongLine.calls.some(call => call.sql.startsWith('INSERT INTO sales')), false);
});

test('idempotency replay state separates a retry from conflicting key reuse', () => {
  assert.equal(idempotencyReplayState(null, 'same-hash'), 'missing');
  assert.equal(idempotencyReplayState({ requestHash: 'same-hash' }, 'same-hash'), 'replay');
  assert.equal(idempotencyReplayState({ requestHash: 'other-hash' }, 'same-hash'), 'conflict');
  assert.equal(idempotencyReplayState({ requestHash: null }, 'same-hash'), 'conflict');
});
