CREATE TABLE transaction_review_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  reason_type TEXT NOT NULL CHECK(reason_type IN ('low_confidence_category','recurring_price_increase')),
  previous_amount REAL,
  currency TEXT,
  stable_months INTEGER,
  increase_percent REAL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, transaction_id, reason_type)
);
CREATE INDEX idx_transaction_review_reasons_active
  ON transaction_review_reasons(workspace_id, resolved_at, transaction_id);

CREATE TABLE recurring_price_review_state (
  workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO transaction_review_reasons (workspace_id, transaction_id, reason_type)
SELECT workspace_id, id, 'low_confidence_category'
FROM transactions
WHERE needs_review = 1;
