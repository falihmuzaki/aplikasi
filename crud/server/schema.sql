CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(80) NOT NULL,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Low stock', 'Out of stock')),
  media_name VARCHAR(255),
  media_type VARCHAR(100),
  media_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS products_category_idx ON products(category);
CREATE INDEX IF NOT EXISTS products_status_idx ON products(status);
CREATE INDEX IF NOT EXISTS products_created_at_idx ON products(created_at DESC);

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(64);
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(120);
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_batches BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_idx ON products(sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_idx ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_deleted_at_idx ON products(deleted_at);

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id) ON DELETE CASCADE,
  user_id BIGINT,
  user_name VARCHAR(120),
  delta INTEGER NOT NULL,
  stock_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url TEXT,
  login_otp_hash TEXT,
  login_otp_expires_at TIMESTAMPTZ,
  reset_otp_hash TEXT,
  reset_otp_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_otp_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS register_otp_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS register_otp_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_active_idx ON users(is_active);

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS categories_name_idx ON categories(name);

-- Seed kategori bawaan (idempotent). Juga serap kategori yang sudah terpakai di products.
INSERT INTO categories (name)
VALUES ('Electronics'), ('Home & Living'), ('Accessories'), ('Fashion')
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name)
SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> ''
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  contact_name VARCHAR(120),
  email VARCHAR(255),
  phone VARCHAR(40),
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name VARCHAR(120);

CREATE INDEX IF NOT EXISTS suppliers_name_idx ON suppliers(name);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  order_number VARCHAR(32) UNIQUE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_name VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'partially_received', 'received')),
  notes TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchase_orders_created_at_idx ON purchase_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx ON purchase_orders(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(160) NOT NULL,
  sku VARCHAR(64),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  received_quantity INTEGER NOT NULL DEFAULT 0
    CHECK (received_quantity >= 0 AND received_quantity <= quantity),
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0)
);

CREATE INDEX IF NOT EXISTS purchase_order_items_order_idx ON purchase_order_items(purchase_order_id);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(40),
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(name);

CREATE TABLE IF NOT EXISTS sales_orders (
  id BIGSERIAL PRIMARY KEY,
  order_number VARCHAR(32) UNIQUE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(160) NOT NULL,
  customer_email VARCHAR(255),
  customer_phone VARCHAR(40),
  status VARCHAR(24) NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'partially_returned', 'returned', 'cancelled')),
  notes TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_orders_created_at_idx ON sales_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS sales_orders_customer_idx ON sales_orders(customer_id);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS discount_rate NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_rate >= 0 AND discount_rate <= 100);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id BIGSERIAL PRIMARY KEY,
  sales_order_id BIGINT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(160) NOT NULL,
  sku VARCHAR(64),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  returned_quantity INTEGER NOT NULL DEFAULT 0
    CHECK (returned_quantity >= 0 AND returned_quantity <= quantity),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0)
);

CREATE INDEX IF NOT EXISTS sales_order_items_order_idx ON sales_order_items(sales_order_id);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0);

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(32);
UPDATE sales_orders SET invoice_number = 'INV-' || SUBSTRING(order_number FROM 4) WHERE invoice_number IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_invoice_number_idx ON sales_orders(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales_payments (
  id BIGSERIAL PRIMARY KEY,
  sales_order_id BIGINT NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('payment', 'refund')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method VARCHAR(24) NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'qris', 'card', 'other')),
  reference VARCHAR(120),
  notes VARCHAR(500),
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  recorded_by_name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_payments_order_idx ON sales_payments(sales_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS warehouses (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  address TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO warehouses (name, is_default)
VALUES ('Gudang Utama', TRUE)
ON CONFLICT (name) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS warehouses_one_default_idx ON warehouses(is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS warehouse_stocks (
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  PRIMARY KEY (warehouse_id, product_id)
);

INSERT INTO warehouse_stocks (warehouse_id, product_id, stock)
SELECT w.id, p.id, p.stock
FROM warehouses w CROSS JOIN products p
WHERE w.is_default
ON CONFLICT (warehouse_id, product_id) DO NOTHING;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS warehouse_id BIGINT REFERENCES warehouses(id) ON DELETE RESTRICT;
UPDATE purchase_orders SET warehouse_id=(SELECT id FROM warehouses WHERE is_default LIMIT 1) WHERE warehouse_id IS NULL;

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS warehouse_id BIGINT REFERENCES warehouses(id) ON DELETE RESTRICT;
UPDATE sales_orders SET warehouse_id=(SELECT id FROM warehouses WHERE is_default LIMIT 1) WHERE warehouse_id IS NULL;

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS warehouse_id BIGINT REFERENCES warehouses(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS stock_transfers (
  id BIGSERIAL PRIMARY KEY,
  source_warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  destination_warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes VARCHAR(500),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_warehouse_id <> destination_warehouse_id)
);

CREATE TABLE IF NOT EXISTS stocktakes (
  id BIGSERIAL PRIMARY KEY,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  notes VARCHAR(500),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stocktake_items (
  id BIGSERIAL PRIMARY KEY,
  stocktake_id BIGINT NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  expected_quantity INTEGER NOT NULL CHECK (expected_quantity >= 0),
  counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
  UNIQUE (stocktake_id, product_id)
);

CREATE TABLE IF NOT EXISTS product_batches (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  batch_number VARCHAR(120) NOT NULL,
  serial_number VARCHAR(120),
  expires_at DATE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, warehouse_id, batch_number, serial_number)
);

CREATE INDEX IF NOT EXISTS product_batches_expiry_idx ON product_batches(expires_at) WHERE expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_batches_identity_idx ON product_batches(product_id, warehouse_id, batch_number, COALESCE(serial_number, ''));

CREATE TABLE IF NOT EXISTS sales_order_item_batches (
  sales_order_item_id BIGINT NOT NULL REFERENCES sales_order_items(id) ON DELETE CASCADE,
  product_batch_id BIGINT NOT NULL REFERENCES product_batches(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  returned_quantity INTEGER NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0 AND returned_quantity <= quantity),
  PRIMARY KEY (sales_order_item_id, product_batch_id)
);

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS due_date DATE;

CREATE TABLE IF NOT EXISTS purchase_payments (
  id BIGSERIAL PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method VARCHAR(24) NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'qris', 'card', 'other')),
  reference VARCHAR(120),
  notes VARCHAR(500),
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  recorded_by_name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_returns (
  id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_order_id BIGINT REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed')),
  reason VARCHAR(500),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES purchase_orders(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id BIGSERIAL PRIMARY KEY,
  supplier_return_id BIGINT NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE IF NOT EXISTS operating_expenses (
  id BIGSERIAL PRIMARY KEY,
  description VARCHAR(200) NOT NULL,
  category VARCHAR(80) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(24) NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'qris', 'card', 'other')),
  reference VARCHAR(120),
  notes VARCHAR(500),
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  recorded_by_name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operating_expenses_created_at_idx ON operating_expenses(created_at DESC);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id BIGSERIAL PRIMARY KEY,
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_amount NUMERIC(12,2) NOT NULL CHECK (opening_amount >= 0),
  closing_amount NUMERIC(12,2) CHECK (closing_amount >= 0),
  expected_amount NUMERIC(12,2),
  difference_amount NUMERIC(12,2),
  opened_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  opened_by_name VARCHAR(120),
  closed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  closed_by_name VARCHAR(120),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CHECK ((status = 'open' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_user_idx ON cash_sessions(opened_by) WHERE status = 'open' AND opened_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS cash_sessions_opened_at_idx ON cash_sessions(opened_at DESC);

ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS cash_session_id BIGINT REFERENCES cash_sessions(id) ON DELETE SET NULL;
ALTER TABLE operating_expenses ADD COLUMN IF NOT EXISTS cash_session_id BIGINT REFERENCES cash_sessions(id) ON DELETE SET NULL;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS difference_amount NUMERIC(12,2);
