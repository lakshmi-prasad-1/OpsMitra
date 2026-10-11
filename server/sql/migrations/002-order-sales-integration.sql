-- One-time migration for an existing Phase 4 database that already has owner_id columns.
-- Back up the database and stop the API before running this migration.
-- If starting from the original Phase 3 database, run 001-phase4-owner-scope.sql first.
USE opsmitra;

-- Refuse to silently migrate corrupt order rows. Reconcile the cited source rows first if this fails.
DROP PROCEDURE IF EXISTS opsmitra_phase4_preflight_002;
DELIMITER //
CREATE PROCEDURE opsmitra_phase4_preflight_002()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM orders o
    WHERE (o.status = 'completed' AND o.stock_deducted <> 1)
       OR (o.status <> 'completed' AND o.stock_deducted <> 0)
       OR NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
       OR COALESCE((SELECT SUM(oi.line_total) FROM order_items oi WHERE oi.order_id = o.id), 0) <> o.total_amount
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Order-sales migration stopped: order status, stock marker, items, or totals are inconsistent. Back up and reconcile source orders before retrying.';
  END IF;
END//
DELIMITER ;
CALL opsmitra_phase4_preflight_002();
DROP PROCEDURE opsmitra_phase4_preflight_002;

ALTER TABLE sales
  ADD COLUMN status ENUM('completed','voided') NOT NULL DEFAULT 'completed' AFTER sale_date,
  ADD COLUMN source_order_id BIGINT UNSIGNED NULL AFTER status,
  ADD UNIQUE KEY uq_sales_owner_source_order (owner_id, source_order_id),
  ADD INDEX idx_sales_source_order (source_order_id),
  ADD INDEX idx_sales_owner_status_date (owner_id, status, sale_date),
  ADD CONSTRAINT fk_sales_source_order FOREIGN KEY (source_order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- Reconcile already-completed orders into revenue records. updated_at is the best available
-- completion-time proxy in the prior schema; we do not invent missing item amounts.
INSERT INTO sales (owner_id, sale_number, customer_id, total_amount, sale_date, status, source_order_id)
SELECT o.owner_id, CONCAT('ORDSALE-', o.id), o.customer_id, o.total_amount, o.updated_at, 'completed', o.id
FROM orders o
LEFT JOIN sales s ON s.owner_id = o.owner_id AND s.source_order_id = o.id
WHERE o.status = 'completed' AND o.stock_deducted = 1 AND s.id IS NULL;

INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
SELECT s.id, oi.product_id, oi.quantity, oi.unit_price, oi.line_total
FROM orders o
JOIN sales s ON s.owner_id = o.owner_id AND s.source_order_id = o.id
JOIN order_items oi ON oi.order_id = o.id
WHERE s.status = 'completed'
  AND NOT EXISTS (SELECT 1 FROM sale_items existing_item WHERE existing_item.sale_id = s.id);
