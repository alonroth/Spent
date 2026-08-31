import "server-only";

import { getDb } from "../index";
import type { RecurringTransaction } from "@/lib/types";

type Input = Omit<RecurringTransaction, "id" | "active" | "createdAt" | "updatedAt"> & { active?: boolean };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function map(row: Record<string, unknown>): RecurringTransaction {
  return { id: Number(row.id), description: String(row.description), amount: Number(row.amount), kind: row.kind as "income" | "expense", categoryId: Number(row.category_id), startMonth: String(row.start_month), endMonth: row.end_month as string | null, active: Number(row.active) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function currentMonth(): string { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).slice(0, 7); }
function monthRange(start: string, end: string): string[] {
  const out: string[] = []; let cursor = start;
  while (cursor <= end) { out.push(cursor); const [y,m] = cursor.split("-").map(Number); cursor = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2,"0")}`; }
  return out;
}
function validate(db: ReturnType<typeof getDb>, workspaceId: number, input: Input) {
  if (!input.description.trim() || !Number.isFinite(input.amount) || input.amount <= 0 || !MONTH.test(input.startMonth) || (input.endMonth && (!MONTH.test(input.endMonth) || input.endMonth < input.startMonth))) throw new Error("invalid recurring transaction");
  const category = db.prepare("SELECT kind, parent_id FROM categories WHERE workspace_id = ? AND id = ?").get(workspaceId, input.categoryId) as { kind: string; parent_id: number | null } | undefined;
  if (!category || category.kind !== input.kind || category.parent_id === null && db.prepare("SELECT 1 FROM categories WHERE parent_id = ? LIMIT 1").get(input.categoryId)) throw new Error("category must be a matching leaf");
}
function syncRunId(db: ReturnType<typeof getDb>, workspaceId: number): number {
  const existing = db.prepare("SELECT id FROM sync_runs WHERE workspace_id = ? AND provider = 'recurring' ORDER BY id LIMIT 1").get(workspaceId) as { id: number } | undefined;
  if (existing) return existing.id;
  return Number(db.prepare("INSERT INTO sync_runs (workspace_id, provider, started_at, completed_at, status, scrape_from_date) VALUES (?, 'recurring', datetime('now'), datetime('now'), 'completed', '1970-01-01')").run(workspaceId).lastInsertRowid);
}
export function listRecurringTransactions(workspaceId: number): RecurringTransaction[] { return getDb().prepare("SELECT * FROM recurring_transactions WHERE workspace_id = ? ORDER BY active DESC, description COLLATE NOCASE").all(workspaceId).map((r) => map(r as Record<string, unknown>)); }
export function generateRecurringOccurrences(workspaceId: number): void {
  const db = getDb(); const today = currentMonth(); const rules = listRecurringTransactions(workspaceId).filter((r) => r.active);
  const runId = rules.length ? syncRunId(db, workspaceId) : null;
  const insert = db.prepare(`INSERT OR IGNORE INTO transactions (workspace_id, account_number, date, processed_date, original_amount, original_currency, charged_amount, charged_currency, description, type, status, category_id, category_source, provider, sync_run_id, dedup_hash, dedup_sequence, kind, source, recurring_transaction_id, recurrence_month) VALUES (?, 'Recurring', ?, ?, ?, 'ILS', ?, 'ILS', ?, 'normal', 'completed', ?, 'user', 'recurring', ?, ?, 0, ?, 'recurring', ?, ?)`);
  db.transaction(() => { for (const rule of rules) for (const month of monthRange(rule.startMonth, [rule.endMonth, today].filter(Boolean).sort()[0]!)) { const amount = rule.kind === "income" ? rule.amount : -rule.amount; insert.run(workspaceId, `${month}-01`, `${month}-01`, amount, amount, rule.description, rule.categoryId, runId, `recurring:${rule.id}:${month}`, rule.kind, rule.id, month); } })();
}
export function createRecurringTransaction(workspaceId: number, input: Input): RecurringTransaction { const db = getDb(); validate(db, workspaceId, input); const result = db.prepare("INSERT INTO recurring_transactions (workspace_id, description, amount, kind, category_id, start_month, end_month, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(workspaceId, input.description.trim(), input.amount, input.kind, input.categoryId, input.startMonth, input.endMonth ?? null, input.active === false ? 0 : 1); generateRecurringOccurrences(workspaceId); return listRecurringTransactions(workspaceId).find((r) => r.id === Number(result.lastInsertRowid))!; }
export function updateRecurringTransaction(workspaceId: number, id: number, input: Input): RecurringTransaction | null { const db = getDb(); validate(db, workspaceId, input); const exists = db.prepare("SELECT id FROM recurring_transactions WHERE workspace_id = ? AND id = ?").get(workspaceId,id); if (!exists) return null; db.transaction(() => { if (input.active !== false) db.prepare("DELETE FROM transactions WHERE workspace_id = ? AND recurring_transaction_id = ?").run(workspaceId,id); db.prepare("UPDATE recurring_transactions SET description=?, amount=?, kind=?, category_id=?, start_month=?, end_month=?, active=?, updated_at=datetime('now') WHERE workspace_id=? AND id=?").run(input.description.trim(),input.amount,input.kind,input.categoryId,input.startMonth,input.endMonth ?? null,input.active === false?0:1,workspaceId,id); })(); generateRecurringOccurrences(workspaceId); return listRecurringTransactions(workspaceId).find((r)=>r.id===id)!; }
export function deleteRecurringTransaction(workspaceId: number, id: number): boolean { const r = getDb().prepare("DELETE FROM recurring_transactions WHERE workspace_id = ? AND id = ?").run(workspaceId,id); return r.changes > 0; }

