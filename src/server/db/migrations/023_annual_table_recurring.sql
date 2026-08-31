ALTER TABLE categories ADD COLUMN expense_type TEXT CHECK(expense_type IN ('mandatory','optional'));

-- Parent groups and income categories intentionally remain unclassified.
UPDATE categories
SET expense_type = 'mandatory'
WHERE kind = 'expense'
  AND id NOT IN (SELECT parent_id FROM categories WHERE parent_id IS NOT NULL)
  AND name IN ('Groceries','Transport','Health','Education','Bills & Utilities','Insurance','Home','Cash & ATM','Kids & Childcare','Pet Care','Fees & Taxes');

UPDATE categories
SET expense_type = 'optional'
WHERE kind = 'expense'
  AND id NOT IN (SELECT parent_id FROM categories WHERE parent_id IS NOT NULL)
  AND expense_type IS NULL;

CREATE TABLE recurring_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  start_month TEXT NOT NULL,
  end_month TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(start_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  CHECK(end_month IS NULL OR end_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  CHECK(end_month IS NULL OR end_month >= start_month)
);
CREATE INDEX idx_recurring_transactions_workspace ON recurring_transactions(workspace_id, active);

-- Recurring occurrences live in the normal ledger, but have no sync run or bank credential.
ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'bank' CHECK(source IN ('bank','recurring'));
ALTER TABLE transactions ADD COLUMN recurring_transaction_id INTEGER REFERENCES recurring_transactions(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN recurrence_month TEXT;
CREATE UNIQUE INDEX idx_transactions_recurring_occurrence
  ON transactions(workspace_id, recurring_transaction_id, recurrence_month)
  WHERE recurring_transaction_id IS NOT NULL;

