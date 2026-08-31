-- Expense deployments keep the bank/manual origin visible, while generated
-- monthly ledger rows carry the amounts used by reporting.
CREATE TABLE expense_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  origin_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  months INTEGER NOT NULL CHECK(months IN (6, 12)),
  origin_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, origin_transaction_id)
);
CREATE INDEX idx_expense_deployments_origin ON expense_deployments(workspace_id, origin_transaction_id);

ALTER TABLE transactions ADD COLUMN deployment_id INTEGER REFERENCES expense_deployments(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN deployment_index INTEGER;
ALTER TABLE transactions ADD COLUMN is_deployed INTEGER NOT NULL DEFAULT 0 CHECK(is_deployed IN (0,1));
CREATE UNIQUE INDEX idx_transactions_deployment_month
  ON transactions(deployment_id, date) WHERE deployment_id IS NOT NULL;
CREATE INDEX idx_transactions_deployment ON transactions(workspace_id, deployment_id);
CREATE INDEX idx_transactions_deployed_origin ON transactions(workspace_id, is_deployed);
