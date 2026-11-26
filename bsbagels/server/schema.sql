-- The Rail — B's Bagels operations platform. SQLite schema (version 1).
-- Conventions: dates are ISO 'YYYY-MM-DD' in America/Indiana/Indianapolis business days;
-- timestamps are ISO-8601 UTC. Missing history is an explicit status row, never a zero.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ── Security ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('crew','lead','manager','owner')),
  secret_hash TEXT NOT NULL,            -- scrypt$N$salt$hash (PIN for crew/lead, password for manager/owner)
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','es')),
  station TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,                 -- e.g. assumption.update, ticket.adjust, import.apply, login.fail
  entity TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);

-- ── Provenance ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,                  -- e.g. WB:2026_Bagels_Daily, IMP:3f2a…
  kind TEXT NOT NULL,                   -- workbook_sheet | toast_item_selection | toast_sales_by_day | manual
  label TEXT NOT NULL,
  filename TEXT,
  sha256 TEXT,
  period_start TEXT,
  period_end TEXT,
  row_count INTEGER,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  imported_by TEXT,
  notes TEXT
);

-- ── Verified history ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_sales (
  date TEXT PRIMARY KEY,
  net_sales REAL,                       -- NULL when not supplied
  orders INTEGER,
  guests INTEGER,
  status TEXT NOT NULL CHECK (status IN ('actual','not_supplied','blank_in_source','partial')),
  source_id TEXT REFERENCES sources(id)
);
-- One row per calendar date the bagel series covers. status='no_records' means Toast had no named
-- bagel entries that day — unknown whether closed. total is NULL then, not 0.
CREATE TABLE IF NOT EXISTS bagel_day (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('recorded','no_records','not_covered')),
  total INTEGER,
  basis TEXT NOT NULL DEFAULT 'sent_date',
  source_id TEXT REFERENCES sources(id),
  note TEXT
);
CREATE TABLE IF NOT EXISTS bagel_daily (
  date TEXT NOT NULL,
  flavor TEXT NOT NULL,
  units INTEGER NOT NULL,
  source_id TEXT REFERENCES sources(id),
  PRIMARY KEY (date, flavor)
);
CREATE TABLE IF NOT EXISTS item_monthly (
  month TEXT NOT NULL,                  -- YYYY-MM
  item TEXT NOT NULL,
  menu_group TEXT,
  qty REAL NOT NULL,
  net REAL,
  partial_note TEXT,                    -- e.g. 'Nov 1–16 only'
  source_id TEXT REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS item_monthly_m ON item_monthly(month, item);
CREATE TABLE IF NOT EXISTS modifier_monthly (
  month TEXT NOT NULL,
  option_group TEXT,
  parent TEXT,
  modifier TEXT NOT NULL,
  qty REAL NOT NULL,
  net REAL,
  source_id TEXT REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS modifier_monthly_m ON modifier_monthly(month, option_group);
CREATE TABLE IF NOT EXISTS item_daily (
  date TEXT NOT NULL,
  item TEXT NOT NULL,
  menu_group TEXT,
  qty REAL NOT NULL,
  net REAL,
  basis TEXT NOT NULL DEFAULT 'sent_date',
  source_id TEXT REFERENCES sources(id),
  PRIMARY KEY (date, item, source_id)
);
CREATE TABLE IF NOT EXISTS modifier_daily (
  date TEXT NOT NULL,
  option_group TEXT,
  parent TEXT,
  modifier TEXT NOT NULL,
  qty REAL NOT NULL,
  source_id TEXT REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS modifier_daily_d ON modifier_daily(date);

-- ── Reference ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flavors (
  name TEXT PRIMARY KEY,
  name_es TEXT NOT NULL,
  short TEXT NOT NULL,
  gluten_free INTEGER NOT NULL DEFAULT 0,
  seasonal INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS menu_items (
  name TEXT PRIMARY KEY,                -- Toast item name
  kind TEXT NOT NULL,                   -- sandwich | single | half_dozen | dozen | named_bagel | spread_retail | other
  bagels_per_unit INTEGER NOT NULL DEFAULT 0,
  recipe_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  display_name TEXT
);
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_es TEXT,
  subtitle_es TEXT,
  kind TEXT NOT NULL,                   -- sandwich | method | spread
  headline TEXT,
  headline_es TEXT,
  status TEXT NOT NULL DEFAULT 'source',  -- source | needs_confirmation | approved
  status_note TEXT,
  source TEXT,
  photo TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS recipe_steps (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  title TEXT NOT NULL, title_es TEXT,
  amount TEXT, amount_es TEXT,
  body TEXT, body_es TEXT,
  PRIMARY KEY (recipe_id, n)
);
-- Machine-readable portions used by the planner. component keys: bacon_strip, sausage_patty, egg_oz,
-- cream_cheese_oz, potato_pancake, salad_oz, turkey_oz, pastrami_oz, lox_oz, avocado_half, …
CREATE TABLE IF NOT EXISTS recipe_components (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  component TEXT NOT NULL,
  qty REAL,                             -- NULL when unknown → planner falls back to an assumption key
  unit TEXT NOT NULL,
  assumption_key TEXT,
  note TEXT,
  PRIMARY KEY (recipe_id, component)
);
CREATE TABLE IF NOT EXISTS assumptions (
  key TEXT PRIMARY KEY,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  label TEXT NOT NULL,
  label_es TEXT,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('assumption','confirmed')),
  basis TEXT,
  owner TEXT,
  updated_at TEXT,
  updated_by TEXT
);

-- ── Operations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_counts (
  id INTEGER PRIMARY KEY,
  counted_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  item TEXT NOT NULL,                   -- flavor name, or e.g. 'cream_cheese:Plain', 'bacon_cooked'
  state TEXT NOT NULL,                  -- frozen | thawed | baked | bulk_lb | tub_8oz | cooked | raw
  qty REAL NOT NULL,
  unit TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  note TEXT
);
CREATE INDEX IF NOT EXISTS inv_item ON inventory_counts(item, state, counted_at);
CREATE TABLE IF NOT EXISTS catering_orders (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  ready_by TEXT,
  label TEXT NOT NULL,                  -- short reference, no customer personal data required
  bagels_json TEXT NOT NULL DEFAULT '{}',   -- {"Plain":12,"Everything":12,"Assorted":24}
  sandwiches_json TEXT NOT NULL DEFAULT '{}',
  spreads_json TEXT NOT NULL DEFAULT '{}',  -- {"Plain":16} in oz
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('tentative','confirmed','cancelled','done')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS plan_adjustments (
  date TEXT NOT NULL,
  ticket_key TEXT NOT NULL,
  qty REAL NOT NULL,
  reason TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (date, ticket_key)
);
CREATE TABLE IF NOT EXISTS ticket_status (
  date TEXT NOT NULL,
  ticket_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done','skipped','partial')),
  qty_done REAL,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (date, ticket_key)
);
CREATE TABLE IF NOT EXISTS handoffs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('open','mid','close')),
  note TEXT NOT NULL,
  flags_json TEXT NOT NULL DEFAULT '[]',
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS waste_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  item TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT NOT NULL,
  reason TEXT NOT NULL,                 -- end_of_day | burnt | dropped | expired | quality | other
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS checklists (
  id TEXT PRIMARY KEY,                  -- opening | closing | …
  name TEXT NOT NULL, name_es TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | approved
  items_json TEXT NOT NULL,             -- [{id,text,text_es,station}]
  updated_at TEXT, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS checklist_runs (
  date TEXT NOT NULL,
  checklist_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (date, checklist_id, item_id)
);
CREATE TABLE IF NOT EXISTS training_signoffs (
  user_id INTEGER NOT NULL REFERENCES users(id),
  recipe_id TEXT NOT NULL,
  signed_by INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, recipe_id)
);

-- ── Forecasting ─────────────────────────────────────────────────────────────
-- Frozen copy of what the plan said for a date, so accuracy is scored against what crew actually saw.
CREATE TABLE IF NOT EXISTS forecast_snapshots (
  target_date TEXT NOT NULL,
  made_on TEXT NOT NULL,                -- last history date used
  model TEXT NOT NULL,
  total_point REAL NOT NULL,
  total_lo REAL, total_hi REAL,
  flavors_json TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (target_date, made_on, model)
);
