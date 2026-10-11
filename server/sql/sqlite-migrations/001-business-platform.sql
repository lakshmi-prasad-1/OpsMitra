-- OpsMitra business platform upgrade: accounts/business profile, richer products,
-- stock ledger, suppliers & purchases, payments/credit, discounts, order notes.

-- Accounts ---------------------------------------------------------------
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN business_name TEXT;
ALTER TABLE users ADD COLUMN business_type TEXT;
ALTER TABLE users ADD COLUMN business_phone TEXT;
ALTER TABLE users ADD COLUMN business_address TEXT;
ALTER TABLE users ADD COLUMN gstin TEXT;

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- Products ---------------------------------------------------------------
ALTER TABLE products ADD COLUMN cost_price NUMERIC NOT NULL DEFAULT 0 CHECK (cost_price >= 0);
ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'pcs';
ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE products ADD COLUMN expiry_date TEXT;
ALTER TABLE products ADD COLUMN tax_rate NUMERIC NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100);
CREATE INDEX IF NOT EXISTS idx_products_owner_category ON products(owner_id, category);

-- Customers --------------------------------------------------------------
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN notes TEXT;
ALTER TABLE customers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));

-- Suppliers & purchases --------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_suppliers_owner_name ON suppliers(owner_id, name);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_number TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  purchase_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  request_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_owner_number ON purchases(owner_id, purchase_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_owner_request_key ON purchases(owner_id, request_key);
CREATE INDEX IF NOT EXISTS idx_purchases_owner_date ON purchases(owner_id, purchase_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items(product_id);

-- Stock ledger -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening','sale','sale_void','order','order_cancel','purchase','adjustment')),
  quantity_change INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  ref_type TEXT,
  ref_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(owner_id, product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_owner_date ON stock_movements(owner_id, created_at);

-- Sales: discounts, tax, payments ---------------------------------------
ALTER TABLE sales ADD COLUMN subtotal NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal >= 0);
ALTER TABLE sales ADD COLUMN discount_amount NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE sales ADD COLUMN tax_amount NUMERIC NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE sales ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','upi','card','bank','credit'));
ALTER TABLE sales ADD COLUMN amount_paid NUMERIC NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);
ALTER TABLE sales ADD COLUMN notes TEXT;
UPDATE sales SET subtotal = total_amount, amount_paid = CASE WHEN status = 'completed' THEN total_amount ELSE 0 END;

ALTER TABLE sale_items ADD COLUMN unit_cost NUMERIC NOT NULL DEFAULT 0 CHECK (unit_cost >= 0);
ALTER TABLE sale_items ADD COLUMN tax_rate NUMERIC NOT NULL DEFAULT 0 CHECK (tax_rate >= 0);

CREATE TABLE IF NOT EXISTS customer_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','upi','card','bank')),
  note TEXT,
  paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(owner_id, customer_id, paid_at);

-- Orders -----------------------------------------------------------------
ALTER TABLE orders ADD COLUMN notes TEXT;
ALTER TABLE orders ADD COLUMN expected_date TEXT;
