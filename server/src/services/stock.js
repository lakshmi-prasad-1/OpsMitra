/** Append-only stock ledger. Call inside the same transaction that changes products.quantity. */
export async function logMovement(connection, { ownerId, productId, type, change, after, refType = null, refId = null, note = null, at = null }) {
  const columns = ['owner_id', 'product_id', 'movement_type', 'quantity_change', 'quantity_after', 'ref_type', 'ref_id', 'note'];
  const values = [ownerId, productId, type, change, after, refType, refId, note];
  if (at) { columns.push('created_at'); values.push(at); }
  await connection.execute(`INSERT INTO stock_movements (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
}
