const VALID_STATUSES = new Set(['pending', 'processing', 'ready', 'completed', 'cancelled']);

/** Pure transition policy; actual stock changes must run inside the caller's DB transaction. */
export function getOrderTransition(currentStatus, nextStatus, stockDeducted) {
  if (!VALID_STATUSES.has(currentStatus) || !VALID_STATUSES.has(nextStatus)) {
    return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'Status must be pending, processing, ready, completed, or cancelled.' };
  }
  if (currentStatus === 'completed' && !stockDeducted) {
    return { ok: false, status: 409, code: 'ORDER_STOCK_INCONSISTENT', message: 'This completed order is missing its stock-deduction marker. Review the order before changing it.' };
  }
  if (currentStatus !== 'completed' && stockDeducted) {
    return { ok: false, status: 409, code: 'ORDER_STOCK_INCONSISTENT', message: 'This order is marked as having deducted stock but is not completed. Review the order before changing it.' };
  }
  const transitions = {
    pending: new Set(['pending', 'processing', 'ready', 'completed', 'cancelled']),
    processing: new Set(['processing', 'ready', 'completed', 'cancelled']),
    ready: new Set(['ready', 'completed', 'cancelled']),
    completed: new Set(['completed', 'cancelled']),
    cancelled: new Set(['cancelled'])
  };
  if (!transitions[currentStatus].has(nextStatus)) {
    const message = currentStatus === 'cancelled'
      ? 'A cancelled order cannot be reopened. Create a new order instead.'
      : currentStatus === 'completed'
        ? 'A completed order can only remain completed or be cancelled.'
        : 'Order status cannot move backwards. Choose a later status or cancel the order.';
    return { ok: false, status: 400, code: 'INVALID_ORDER_TRANSITION', message };
  }
  return {
    ok: true,
    shouldDeductStock: currentStatus !== 'completed' && nextStatus === 'completed' && !stockDeducted,
    shouldRestoreStock: currentStatus === 'completed' && nextStatus === 'cancelled' && Boolean(stockDeducted),
    stockDeductedAfterTransition: nextStatus === 'completed'
  };
}
