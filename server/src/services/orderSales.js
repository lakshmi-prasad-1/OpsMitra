import { calculateAmountCents, MAX_AMOUNT_CENTS } from '../utils/validation.js';

/**
 * Create the revenue-side record for an order that has just completed.
 * Caller MUST invoke this inside the same transaction as the stock/status changes.
 * It copies the order's price snapshots and never deducts inventory itself.
 */
export async function createSaleFromOrder(connection, ownerId, orderId, { paymentMethod = 'cash' } = {}) {
  const [orders] = await connection.execute(
    'SELECT id, customer_id AS customerId, total_amount AS totalAmount FROM orders WHERE id = ? AND owner_id = ? FOR UPDATE',
    [orderId, ownerId]
  );
  if (!orders.length) {
    const error = new Error('Order not found while creating its sales record.');
    error.status = 404; error.code = 'ORDER_NOT_FOUND'; throw error;
  }
  const order = orders[0];
  const [existing] = await connection.execute(
    'SELECT id, status FROM sales WHERE owner_id = ? AND source_order_id = ? FOR UPDATE',
    [ownerId, orderId]
  );
  if (existing.length) {
    const error = new Error('A sales record is already linked to this order. Review the order state before retrying.');
    error.status = 409; error.code = 'ORDER_SALE_ALREADY_EXISTS'; throw error;
  }
  const [items] = await connection.execute(
    'SELECT product_id AS productId, quantity, unit_price AS unitPrice, line_total AS lineTotal FROM order_items WHERE order_id = ? ORDER BY product_id',
    [orderId]
  );
  if (!items.length) {
    const error = new Error('An order must contain at least one item before it can be completed.');
    error.status = 409; error.code = 'ORDER_HAS_NO_ITEMS'; throw error;
  }
  // Defend reports against corrupted/legacy order records: a linked sale must match
  // the immutable item snapshots exactly, both line-by-line and at order-total level.
  let itemTotalCents = 0n;
  for (const item of items) {
    const quantity = Number(item.quantity);
    const calculatedLine = calculateAmountCents(item.unitPrice, quantity);
    const storedLine = calculateAmountCents(item.lineTotal, 1);
    if (calculatedLine === null || storedLine === null || calculatedLine !== storedLine) {
      const error = new Error('An order line total does not match its stored unit price and quantity. Reconcile this order before completing it.');
      error.status = 409; error.code = 'ORDER_LINE_TOTAL_INCONSISTENT'; throw error;
    }
    itemTotalCents += storedLine;
    if (itemTotalCents > MAX_AMOUNT_CENTS) {
      const error = new Error('The sum of order lines exceeds the supported sales total. Reconcile this order before completing it.');
      error.status = 409; error.code = 'ORDER_TOTAL_INCONSISTENT'; throw error;
    }
  }
  const orderTotalCents = calculateAmountCents(order.totalAmount, 1);
  if (orderTotalCents === null || orderTotalCents !== itemTotalCents) {
    const error = new Error('The order total does not match its stored line items. Reconcile this order before completing it.');
    error.status = 409; error.code = 'ORDER_TOTAL_INCONSISTENT'; throw error;
  }
  const saleNumber = `ORDSALE-${String(order.id)}`;
  // Order sales are settled on completion unless the owner marks them as credit (needs a customer).
  if (paymentMethod === 'credit' && !order.customerId) {
    const error = new Error('Choose a customer on the order before completing it on credit.');
    error.status = 400; error.code = 'CUSTOMER_REQUIRED'; throw error;
  }
  const onCredit = paymentMethod === 'credit';
  const method = paymentMethod;
  const [sale] = await connection.execute(
    "INSERT INTO sales (owner_id, sale_number, customer_id, subtotal, total_amount, payment_method, amount_paid, source_order_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')",
    [ownerId, saleNumber, order.customerId, Number(order.totalAmount), Number(order.totalAmount), method, onCredit ? 0 : Number(order.totalAmount), order.id]
  );
  const [copyResult] = await connection.execute(
    'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total, unit_cost, tax_rate) SELECT ?, oi.product_id, oi.quantity, oi.unit_price, oi.line_total, COALESCE(p.cost_price, 0), COALESCE(p.tax_rate, 0) FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?',
    [sale.insertId, orderId]
  );
  if (Number(copyResult.affectedRows) !== items.length) {
    const error = new Error('The order items could not be copied into the sales record.');
    error.status = 500; error.code = 'ORDER_SALE_ITEM_MISMATCH'; throw error;
  }
  return { id: sale.insertId, saleNumber, totalAmount: Number(order.totalAmount) };
}
