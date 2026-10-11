-- One-time migration adding replay-safe customer, sale, and order request keys to an existing Phase 4 database.
-- Back up the database and stop the API before running this script. Do not run it twice.
-- For an original Phase 3 database, run migration 001 and then 002 before this migration.
-- If migration 002 (linked order-sales integration) was already applied, run this migration only.
USE opsmitra;

ALTER TABLE customers
  ADD COLUMN request_key CHAR(36) NULL AFTER email,
  ADD COLUMN request_hash CHAR(64) NULL AFTER request_key,
  ADD UNIQUE KEY uq_customers_owner_request_key (owner_id, request_key);

ALTER TABLE orders
  ADD COLUMN request_key CHAR(36) NULL AFTER stock_deducted,
  ADD COLUMN request_hash CHAR(64) NULL AFTER request_key,
  ADD UNIQUE KEY uq_orders_owner_request_key (owner_id, request_key);

ALTER TABLE sales
  ADD COLUMN request_key CHAR(36) NULL AFTER source_order_id,
  ADD COLUMN request_hash CHAR(64) NULL AFTER request_key,
  ADD UNIQUE KEY uq_sales_owner_request_key (owner_id, request_key);
