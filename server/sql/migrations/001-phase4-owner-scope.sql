-- One-time migration for a Phase 3 database.
-- Backfills existing records to the earliest registered owner, then enables account isolation.
-- Back up the database before running. Stop the API while migrating.
USE opsmitra;

-- Stop before changing any tables if records exist but no account is available to own them.
DROP PROCEDURE IF EXISTS opsmitra_phase4_owner_scope_preflight;
DELIMITER //
CREATE PROCEDURE opsmitra_phase4_owner_scope_preflight()
BEGIN
  DECLARE registered_users BIGINT DEFAULT 0;
  DECLARE legacy_records BIGINT DEFAULT 0;
  SELECT COUNT(*) INTO registered_users FROM users;
  SELECT (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM customers)
       + (SELECT COUNT(*) FROM sales) + (SELECT COUNT(*) FROM orders)
    INTO legacy_records;
  IF registered_users = 0 AND legacy_records > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration stopped: legacy business records exist but users is empty. Create/restore the correct owner account or export and reconcile these records before migrating.';
  END IF;
END//
CALL opsmitra_phase4_owner_scope_preflight()//
DROP PROCEDURE opsmitra_phase4_owner_scope_preflight//
DELIMITER ;

ALTER TABLE products ADD COLUMN owner_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE customers ADD COLUMN owner_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE sales ADD COLUMN owner_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE orders ADD COLUMN owner_id BIGINT UNSIGNED NULL AFTER id;

UPDATE products SET owner_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE owner_id IS NULL;
UPDATE customers SET owner_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE owner_id IS NULL;
UPDATE sales SET owner_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE owner_id IS NULL;
UPDATE orders SET owner_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE owner_id IS NULL;

ALTER TABLE products MODIFY owner_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE customers MODIFY owner_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE sales MODIFY owner_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE orders MODIFY owner_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE products DROP INDEX sku, ADD UNIQUE KEY uq_products_owner_sku (owner_id, sku);
ALTER TABLE sales DROP INDEX sale_number, ADD UNIQUE KEY uq_sales_owner_number (owner_id, sale_number);
ALTER TABLE orders DROP INDEX order_number, ADD UNIQUE KEY uq_orders_owner_number (owner_id, order_number);

ALTER TABLE products ADD CONSTRAINT fk_products_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE customers ADD CONSTRAINT fk_customers_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE sales ADD CONSTRAINT fk_sales_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE orders ADD CONSTRAINT fk_orders_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE products ADD INDEX idx_products_owner_name (owner_id, name), ADD INDEX idx_products_owner_stock (owner_id, quantity, low_stock_threshold);
ALTER TABLE customers ADD INDEX idx_customers_owner_name (owner_id, name);
ALTER TABLE sales ADD INDEX idx_sales_owner_date (owner_id, sale_date);
ALTER TABLE orders ADD INDEX idx_orders_owner_status_date (owner_id, status, order_date);
