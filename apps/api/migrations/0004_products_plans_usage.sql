CREATE TABLE products (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  price_inr INTEGER NOT NULL,
  message_limit_monthly INTEGER,
  training_limit_lifetime INTEGER,
  project_limit INTEGER,
  crawl_max_pages INTEGER,
  upload_mb_total INTEGER,
  branding_powered_by_chattydevs INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(product_id, slug),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  UNIQUE(user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE usage_periods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE user_product_stats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  trainings_used INTEGER NOT NULL DEFAULT 0,
  upload_bytes_used INTEGER NOT NULL DEFAULT 0,
  documents_uploaded INTEGER NOT NULL DEFAULT 0,
  pages_crawled INTEGER NOT NULL DEFAULT 0,
  last_training_at TEXT,
  UNIQUE(user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

ALTER TABLE projects ADD COLUMN product_id TEXT;

INSERT INTO products (id, slug, name, created_at)
VALUES ('prod_axion', 'axion', 'Axion', datetime('now'));

INSERT INTO plans (
  id,
  product_id,
  slug,
  name,
  price_inr,
  message_limit_monthly,
  training_limit_lifetime,
  project_limit,
  crawl_max_pages,
  upload_mb_total,
  branding_powered_by_chattydevs,
  created_at
) VALUES
  ('plan_axion_free', 'prod_axion', 'free', 'Free', 0, 20, 3, 1, 25, 10, 1, datetime('now')),
  ('plan_axion_starter', 'prod_axion', 'starter', 'Starter', 499, 500, NULL, 3, NULL, NULL, 0, datetime('now')),
  ('plan_axion_pro', 'prod_axion', 'pro', 'Pro', 999, 2000, NULL, 10, NULL, NULL, 0, datetime('now'));

UPDATE projects
SET product_id = 'prod_axion'
WHERE product_id IS NULL;
