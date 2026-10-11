/** Query helpers for replay-safe writes. Table/column names are deliberately fixed here. */
export async function findIdempotentSale(executor, ownerId, requestKey) {
  const [rows] = await executor.execute(
    `SELECT s.id, s.sale_number AS saleNumber, s.total_amount AS totalAmount,
            s.source_order_id AS sourceOrderId, s.status AS saleStatus, s.request_hash AS requestHash,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS lineCount
     FROM sales s WHERE s.owner_id = ? AND s.request_key = ? LIMIT 1 FOR UPDATE`,
    [ownerId, requestKey],
  );
  return rows[0] || null;
}

export async function findIdempotentOrder(executor, ownerId, requestKey) {
  const [rows] = await executor.execute(
    `SELECT o.id, o.order_number AS orderNumber, o.status,
            o.total_amount AS totalAmount, o.stock_deducted AS stockDeducted,
            o.request_hash AS requestHash, s.id AS saleId
     FROM orders o LEFT JOIN sales s
       ON s.owner_id = o.owner_id AND s.source_order_id = o.id
     WHERE o.owner_id = ? AND o.request_key = ? LIMIT 1 FOR UPDATE`,
    [ownerId, requestKey],
  );
  return rows[0] || null;
}

export function idempotencyReplayState(record, requestHash) {
  if (!record) return 'missing';
  return typeof record.requestHash === 'string' && record.requestHash === requestHash ? 'replay' : 'conflict';
}

export function saleResponse(record) {
  return {
    id: Number(record.id),
    saleNumber: record.saleNumber,
    totalAmount: Number(record.totalAmount),
    sourceOrderId: record.sourceOrderId == null ? null : Number(record.sourceOrderId),
    saleStatus: record.saleStatus,
    items: Number(record.lineCount || 0),
  };
}

export function orderResponse(record) {
  return {
    id: Number(record.id),
    orderNumber: record.orderNumber,
    status: record.status,
    totalAmount: Number(record.totalAmount),
    stockDeducted: Number(record.stockDeducted) === 1,
    saleId: record.saleId == null ? null : Number(record.saleId),
  };
}


export async function findIdempotentCustomer(executor, ownerId, requestKey) {
  const [rows] = await executor.execute(
    `SELECT id, name, phone, email, request_hash AS requestHash
     FROM customers WHERE owner_id = ? AND request_key = ? LIMIT 1 FOR UPDATE`,
    [ownerId, requestKey],
  );
  return rows[0] || null;
}

export function customerResponse(record) {
  return { id: Number(record.id), name: record.name, phone: record.phone, email: record.email };
}
