const TABLES = { sales: 'sale_number', orders: 'order_number', purchases: 'purchase_number' };

/** Human-friendly sequential document numbers (INV-0001). Run inside the write transaction. */
export async function nextNumber(executor, table, ownerId, prefix) {
  const column = TABLES[table];
  if (!column) throw new Error(`Unsupported numbering table ${table}.`);
  const [[row]] = await executor.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id = ?`, [ownerId]);
  let next = Number(row.n) + 1;
  for (;;) {
    const candidate = `${prefix}-${String(next).padStart(4, '0')}`;
    const [taken] = await executor.execute(`SELECT 1 AS found FROM ${table} WHERE owner_id = ? AND ${column} = ? LIMIT 1`, [ownerId, candidate]);
    if (!taken.length) return candidate;
    next++;
  }
}
