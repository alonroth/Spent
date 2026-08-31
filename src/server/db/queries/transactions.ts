import "server-only";

import { randomUUID } from "node:crypto";
import { getDb } from "../index";
import { computeDedupHash } from "../../lib/dedup";
import { detectKind } from "../../lib/transfers";
import type {
  TransactionWithCategory,
  ReviewTransaction,
  MonthlySummary,
  MerchantSummary,
  CategoryBreakdown,
} from "@/lib/types";
import {
  batchSetLowConfidenceReviewReasons,
  getActiveReviewReasons,
  resolveAllReviewReasons,
  ensureInitialRecurringPriceScan,
} from "./transaction-review-reasons";
import {
  isTransactionSortField,
  TRANSACTION_SORT_SQL,
} from "@/lib/transaction-sort";
export type TransactionKindFilter = "expense" | "income" | "all";

export class DeploymentConflictError extends Error {}

function assertMutableTransaction(workspaceId: number, id: number): void {
  const member = getDb().prepare(`SELECT 1 FROM transactions
    WHERE workspace_id = ? AND id = ? AND (is_deployed = 1 OR deployment_id IS NOT NULL)`).get(workspaceId, id);
  if (member) throw new DeploymentConflictError("reverse the deployment before changing this transaction");
}

export function isDeploymentMember(workspaceId: number, id: number): boolean {
  return Boolean(getDb().prepare(`SELECT 1 FROM transactions
    WHERE workspace_id = ? AND id = ? AND (is_deployed = 1 OR deployment_id IS NOT NULL)`).get(workspaceId, id));
}

function deploymentDate(originDate: string, index: number): string {
  const date = new Date(`${originDate.slice(0, 10)}T12:00:00Z`);
  return `${date.getUTCFullYear() + Math.floor((date.getUTCMonth() + index) / 12)}-${String(((date.getUTCMonth() + index) % 12) + 1).padStart(2, "0")}-01`;
}

function splitMinorUnits(amount: number, months: number): number[] {
  const sign = amount < 0 ? -1 : 1;
  const units = Math.round(Math.abs(amount) * 100);
  const base = Math.floor(units / months);
  const remainder = units % months;
  return Array.from({ length: months }, (_, index) => sign * (base + (index < remainder ? 1 : 0)) / 100);
}

export interface DeploymentMetadata {
  deploymentId: number;
  role: "origin" | "slice";
  originId: number;
  originDate: string;
  sliceIndex: number | null;
  totalMonths: number;
}

export function createExpenseDeployment(workspaceId: number, originId: number, months: number): DeploymentMetadata {
  if (months !== 6 && months !== 12) throw new Error("months must be 6 or 12");
  const db = getDb();
  return db.transaction(() => {
    const origin = db.prepare(`SELECT * FROM transactions WHERE workspace_id = ? AND id = ?`).get(workspaceId, originId) as Record<string, unknown> | undefined;
    if (!origin) throw new Error("transaction not found");
    if (origin.is_deployed || origin.deployment_id) throw new DeploymentConflictError("transaction is already deployed");
    if (origin.status !== "completed" || origin.kind !== "expense" || origin.type !== "normal" || origin.is_excluded || origin.source === "recurring" || Number(origin.charged_amount) >= 0) {
      throw new DeploymentConflictError("only visible completed normal expenses can be deployed");
    }
    const deploymentId = Number(db.prepare(`INSERT INTO expense_deployments (workspace_id, origin_transaction_id, months, origin_date) VALUES (?, ?, ?, ?)`).run(workspaceId, originId, months, String(origin.date).slice(0, 10)).lastInsertRowid);
    const charged = splitMinorUnits(Number(origin.charged_amount), months);
    const original = splitMinorUnits(Number(origin.original_amount), months);
    const insert = db.prepare(`INSERT INTO transactions (
      workspace_id, account_number, date, processed_date, original_amount, original_currency,
      charged_amount, charged_currency, description, memo, type, status, identifier,
      category_id, category_source, ai_confidence, provider, credential_id, sync_run_id,
      dedup_hash, dedup_sequence, kind, needs_review, is_excluded, source,
      deployment_id, deployment_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', 'completed', ?, ?, ?, ?, ?, ?, ?, ?, 0, 'expense', 0, 0, 'bank', ?, ?)`);
    for (let index = 0; index < months; index++) {
      const date = deploymentDate(String(origin.date), index);
      insert.run(workspaceId, origin.account_number, date, date, original[index], origin.original_currency,
        charged[index], origin.charged_currency, origin.description, origin.memo,
        `deployment:${deploymentId}:${index + 1}`, origin.category_id, origin.category_source,
        origin.ai_confidence, origin.provider, origin.credential_id, origin.sync_run_id,
        `deployment:${deploymentId}:${index + 1}`, deploymentId, index + 1);
    }
    db.prepare("UPDATE transactions SET is_deployed = 1, updated_at = datetime('now') WHERE workspace_id = ? AND id = ?").run(workspaceId, originId);
    return { deploymentId, role: "origin" as const, originId, originDate: String(origin.date).slice(0, 10), sliceIndex: null, totalMonths: months };
  })();
}

export function reverseExpenseDeployment(workspaceId: number, transactionId: number): void {
  const db = getDb();
  db.transaction(() => {
    const row = db.prepare(`SELECT d.id, d.origin_transaction_id AS originId FROM transactions t
      LEFT JOIN expense_deployments d ON d.id = t.deployment_id
      WHERE t.workspace_id = ? AND t.id = ?`).get(workspaceId, transactionId) as { id: number | null; originId: number | null } | undefined;
    const originDeployment = db.prepare("SELECT id, origin_transaction_id AS originId FROM expense_deployments WHERE workspace_id = ? AND origin_transaction_id = ?").get(workspaceId, transactionId) as { id: number; originId: number } | undefined;
    const deployment = originDeployment ?? (row?.id ? { id: row.id, originId: row.originId! } : undefined);
    if (!deployment) throw new Error("deployment not found");
    db.prepare("DELETE FROM transactions WHERE workspace_id = ? AND deployment_id = ?").run(workspaceId, deployment.id);
    db.prepare("UPDATE transactions SET is_deployed = 0, updated_at = datetime('now') WHERE workspace_id = ? AND id = ?").run(workspaceId, deployment.originId);
    db.prepare("DELETE FROM expense_deployments WHERE workspace_id = ? AND id = ?").run(workspaceId, deployment.id);
  })();
}

interface RawTransaction {
  accountNumber: string;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  type: "normal" | "installments";
  status: "completed" | "pending";
  identifier?: string | number;
  installmentNumber?: number;
  installmentTotal?: number;
}

interface InsertResult {
  added: number;
  updated: number;
  transactionIds: number[];
}

export function insertTransactions(
  workspaceId: number,
  transactions: RawTransaction[],
  provider: string,
  credentialId: number,
  syncRunId: number
): InsertResult {
  const db = getDb();
  let added = 0;
  let updated = 0;
  const transactionIds: number[] = [];

  const hashCounts = new Map<string, number>();

  const existingCountStmt = db.prepare(
    "SELECT COUNT(*) as count FROM transactions WHERE workspace_id = ? AND dedup_hash = ?"
  );
  const existingStatusStmt = db.prepare(
    "SELECT status FROM transactions WHERE workspace_id = ? AND dedup_hash = ? AND dedup_sequence = ?"
  );

  const insertStmt = db.prepare(`
    INSERT INTO transactions (
      workspace_id, account_number, date, processed_date, original_amount, original_currency,
      charged_amount, charged_currency, description, memo, type, status,
      identifier, installment_number, installment_total, provider, credential_id,
      sync_run_id, dedup_hash, dedup_sequence, kind
    ) VALUES (
      @workspaceId, @accountNumber, @date, @processedDate, @originalAmount, @originalCurrency,
      @chargedAmount, @chargedCurrency, @description, @memo, @type, @status,
      @identifier, @installmentNumber, @installmentTotal, @provider, @credentialId,
      @syncRunId, @dedupHash, @dedupSequence, @kind
    )
    ON CONFLICT(workspace_id, dedup_hash, dedup_sequence) DO UPDATE SET
      status = CASE WHEN transactions.status = 'pending' THEN excluded.status ELSE transactions.status END,
      charged_amount = CASE WHEN transactions.status = 'pending' THEN excluded.charged_amount ELSE transactions.charged_amount END,
      processed_date = CASE WHEN transactions.status = 'pending' THEN excluded.processed_date ELSE transactions.processed_date END,
      kind = transactions.kind,
      updated_at = CASE WHEN transactions.status = 'pending' THEN datetime('now') ELSE transactions.updated_at END
  `);

  const batchInsert = db.transaction(() => {
    for (const txn of transactions) {
      const hash = computeDedupHash({
        accountNumber: txn.accountNumber,
        date: txn.date,
        originalAmount: txn.originalAmount,
        originalCurrency: txn.originalCurrency,
        description: txn.description,
        identifier: txn.identifier,
        installmentNumber: txn.installmentNumber,
        installmentTotal: txn.installmentTotal,
      });

      const batchCount = (hashCounts.get(hash) ?? 0) + 1;
      hashCounts.set(hash, batchCount);

      const { count: existingCount } = existingCountStmt.get(workspaceId, hash) as {
        count: number;
      };

      const sequence = batchCount - 1;
      const kind = detectKind(txn.description, provider, txn.chargedAmount);

      const params = {
        workspaceId,
        accountNumber: txn.accountNumber,
        date: txn.date,
        processedDate: txn.processedDate,
        originalAmount: txn.originalAmount,
        originalCurrency: txn.originalCurrency,
        chargedAmount: txn.chargedAmount,
        chargedCurrency: txn.chargedCurrency ?? null,
        description: txn.description,
        memo: txn.memo ?? null,
        type: txn.type,
        status: txn.status,
        identifier: txn.identifier != null ? String(txn.identifier) : null,
        installmentNumber: txn.installmentNumber ?? null,
        installmentTotal: txn.installmentTotal ?? null,
        provider,
        credentialId,
        syncRunId: syncRunId,
        dedupHash: hash,
        dedupSequence: sequence,
        kind,
      };

      if (batchCount > existingCount) {
        insertStmt.run(params);
        const row = db.prepare("SELECT id FROM transactions WHERE workspace_id = ? AND dedup_hash = ? AND dedup_sequence = ?").get(workspaceId, hash, sequence) as { id: number };
        transactionIds.push(row.id);
        added++;
      } else {
        const existing = existingStatusStmt.get(workspaceId, hash, sequence) as { status: string } | undefined;
        const result = insertStmt.run(params);
        if (result.changes > 0) {
          if (existing?.status === "pending" && txn.status === "completed") {
            const row = db.prepare("SELECT id FROM transactions WHERE workspace_id = ? AND dedup_hash = ? AND dedup_sequence = ?").get(workspaceId, hash, sequence) as { id: number };
            transactionIds.push(row.id);
          }
          updated++;
        }
      }
    }
  });

  batchInsert();
  return { added, updated, transactionIds };
}

export interface ManualTransactionInput {
  date: string;
  description: string;
  amount: number;
  kind: "expense" | "income";
  categoryId?: number | null;
  memo?: string | null;
}

/** Insert a transaction entered by the user, using the normal ledger shape. */
export function createManualTransaction(
  workspaceId: number,
  input: ManualTransactionInput,
): { id: number } {
  const description = input.description.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error("date is required");
  }
  if (!description || !Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("description and a positive amount are required");
  }

  const db = getDb();
  const categoryId = input.categoryId ?? null;
  if (categoryId !== null) {
    const category = db
      .prepare("SELECT kind, parent_id FROM categories WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, categoryId) as { kind: string; parent_id: number | null } | undefined;
    const hasChildren = db
      .prepare("SELECT 1 FROM categories WHERE workspace_id = ? AND parent_id = ? LIMIT 1")
      .get(workspaceId, categoryId);
    if (!category || category.kind !== input.kind || hasChildren) {
      throw new Error("category must be a matching leaf");
    }
  }

  const syncRun = db
    .prepare("SELECT id FROM sync_runs WHERE workspace_id = ? AND provider = 'manual' ORDER BY id LIMIT 1")
    .get(workspaceId) as { id: number } | undefined;
  const syncRunId = syncRun?.id ?? Number(
    db.prepare(
      "INSERT INTO sync_runs (workspace_id, provider, started_at, completed_at, status, scrape_from_date) VALUES (?, 'manual', datetime('now'), datetime('now'), 'completed', '1970-01-01')",
    ).run(workspaceId).lastInsertRowid,
  );
  const amount = input.kind === "expense" ? -input.amount : input.amount;
  const dedupHash = computeDedupHash({
    accountNumber: "Manual",
    date: input.date,
    originalAmount: amount,
    originalCurrency: "ILS",
    description,
    identifier: randomUUID(),
  });
  const result = db.prepare(`
    INSERT INTO transactions (
      workspace_id, account_number, date, processed_date, original_amount, original_currency,
      charged_amount, charged_currency, description, memo, type, status, category_id,
      category_source, provider, sync_run_id, dedup_hash, dedup_sequence, kind
    ) VALUES (?, 'Manual', ?, ?, ?, 'ILS', ?, 'ILS', ?, ?, 'normal', 'completed', ?,
      ?, 'manual', ?, ?, 0, ?)
  `).run(
    workspaceId,
    input.date,
    input.date,
    amount,
    amount,
    description,
    input.memo?.trim() || null,
    categoryId,
    categoryId === null ? null : "user",
    syncRunId,
    dedupHash,
    input.kind,
  );
  return { id: Number(result.lastInsertRowid) };
}

export function deleteManualTransaction(workspaceId: number, id: number): void {
  assertMutableTransaction(workspaceId, id);
  const result = getDb()
    .prepare("DELETE FROM transactions WHERE workspace_id = ? AND id = ? AND provider = 'manual'")
    .run(workspaceId, id);
  if (result.changes === 0) {
    throw new Error("manual transaction not found");
  }
}

interface QueryParams {
  from?: string;
  to?: string;
  search?: string;
  merchants?: string[];
  category?: number;
  /**
   * Multi-id filter for parent-category aggregation. Takes precedence over
   * `category` when present and non-empty. Use it to fetch transactions
   * across all children of a parent category.
   */
  categoryIds?: number[];
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
  kind?: TransactionKindFilter;
  provider?: string;
  /** @deprecated Use credentialIds */
  credentialId?: number;
  credentialIds?: number[];
}

export interface TransactionTotalsParams {
  from?: string;
  to?: string;
  search?: string;
  merchants?: string[];
  categoryIds?: number[];
  kind?: TransactionKindFilter;
  credentialIds?: number[];
}

export interface TransactionTotals {
  income: number;
  expense: number;
  net: number;
  count: number;
}

function appendCredentialIdsFilter(
  conditions: string[],
  values: (string | number)[],
  credentialIds: number[] | undefined,
  columnPrefix = ""
): void {
  if (!credentialIds || credentialIds.length === 0) return;
  const col = `${columnPrefix}credential_id`;
  const placeholders = credentialIds.map(() => "?").join(",");
  conditions.push(`${col} IN (${placeholders})`);
  for (const id of credentialIds) values.push(id);
}

function resolveSortSql(sort: string | undefined): string {
  if (isTransactionSortField(sort)) {
    return TRANSACTION_SORT_SQL[sort];
  }
  return TRANSACTION_SORT_SQL.date;
}

const TRANSACTION_LIST_FROM = `
  FROM transactions t
  LEFT JOIN categories c ON t.category_id = c.id
  LEFT JOIN bank_credentials bc ON t.credential_id = bc.id
  LEFT JOIN expense_deployments d ON d.workspace_id = t.workspace_id
    AND (d.id = t.deployment_id OR d.origin_transaction_id = t.id)`;

const TRANSACTION_LIST_SELECT = `
  SELECT t.*, c.name AS category_name, c.color AS category_color,
         bc.label AS account_label, d.id AS deployment_meta_id,
         d.origin_transaction_id AS deployment_origin_id, d.origin_date AS deployment_origin_date,
         d.months AS deployment_months
  ${TRANSACTION_LIST_FROM}`;

export function queryTransactions(
  workspaceId: number,
  params: QueryParams
): { transactions: TransactionWithCategory[]; total: number } {
  const db = getDb();
  const conditions: string[] = ["t.workspace_id = ?"];
  const values: (string | number)[] = [workspaceId];

  if (params.from) {
    conditions.push("substr(t.date, 1, 10) >= ?");
    values.push(params.from);
  }
  if (params.to) {
    conditions.push("substr(t.date, 1, 10) <= ?");
    values.push(params.to);
  }
  if (params.search) {
    conditions.push("(t.description LIKE ? OR t.memo LIKE ?)");
    const term = `%${params.search}%`;
    values.push(term, term);
  }
  if (params.merchants && params.merchants.length > 0) {
    const placeholders = params.merchants.map(() => "?").join(",");
    conditions.push(`t.description IN (${placeholders})`);
    values.push(...params.merchants);
  }
  if (params.categoryIds && params.categoryIds.length > 0) {
    const placeholders = params.categoryIds.map(() => "?").join(",");
    conditions.push(`t.category_id IN (${placeholders})`);
    for (const cid of params.categoryIds) values.push(cid);
  } else if (params.category !== undefined) {
    conditions.push("t.category_id = ?");
    values.push(params.category);
  }
  const kind: TransactionKindFilter = params.kind ?? "all";
  if (kind === "income") {
    conditions.push("t.charged_amount > 0");
  } else if (kind === "expense") {
    conditions.push("t.charged_amount < 0");
  }
  if (params.provider) {
    conditions.push("t.provider = ?");
    values.push(params.provider);
  }
  const credentialIds =
    params.credentialIds && params.credentialIds.length > 0
      ? params.credentialIds
      : params.credentialId != null
        ? [params.credentialId]
        : undefined;
  appendCredentialIdsFilter(conditions, values, credentialIds, "t.");

  const where = `WHERE ${conditions.join(" AND ")}`;

  const sortSql = resolveSortSql(params.sort);
  const sortOrder = params.order === "asc" ? "ASC" : "DESC";
  const limit = Math.min(params.limit ?? 50, 300);
  const offset = params.offset ?? 0;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM transactions t ${where}`)
    .get(...values) as { total: number };

  const rows = db
    .prepare(
      `${TRANSACTION_LIST_SELECT}
       ${where}
       ORDER BY ${sortSql} ${sortOrder}, t.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset);

  return {
    transactions: rows.map(mapTransactionRow),
    total: countRow.total,
  };
}

export function getTransactionTotals(
  workspaceId: number,
  params: TransactionTotalsParams,
): TransactionTotals {
  const db = getDb();
  const conditions: string[] = [
    "t.workspace_id = ?",
    "t.status = 'completed'",
    "t.is_excluded = 0",
    "t.is_deployed = 0",
  ];
  const values: (string | number)[] = [workspaceId];

  if (params.from) {
    conditions.push("substr(t.date, 1, 10) >= ?");
    values.push(params.from);
  }
  if (params.to) {
    conditions.push("substr(t.date, 1, 10) <= ?");
    values.push(params.to);
  }
  if (params.search) {
    conditions.push("(t.description LIKE ? OR t.memo LIKE ?)");
    const term = `%${params.search}%`;
    values.push(term, term);
  }
  if (params.merchants && params.merchants.length > 0) {
    const placeholders = params.merchants.map(() => "?").join(",");
    conditions.push(`t.description IN (${placeholders})`);
    values.push(...params.merchants);
  }
  if (params.categoryIds && params.categoryIds.length > 0) {
    const placeholders = params.categoryIds.map(() => "?").join(",");
    conditions.push(`t.category_id IN (${placeholders})`);
    values.push(...params.categoryIds);
  }
  if (params.kind === "income") conditions.push("t.charged_amount > 0");
  if (params.kind === "expense") conditions.push("t.charged_amount < 0");
  appendCredentialIdsFilter(conditions, values, params.credentialIds, "t.");

  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN t.charged_amount > 0 THEN t.charged_amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN t.charged_amount < 0 THEN ABS(t.charged_amount) ELSE 0 END), 0) AS expense,
         COALESCE(SUM(t.charged_amount), 0) AS net,
         COUNT(*) AS count
       FROM transactions t
       WHERE ${conditions.join(" AND ")}`,
    )
    .get(...values) as TransactionTotals;

  return row;
}

/**
 * The actionable review queue. Keep its inclusion rules in one place so the
 * sidebar badge and the review screen can never disagree.
 */
export function getReviewTransactions(
  workspaceId: number,
): { transactions: ReviewTransaction[]; total: number } {
  const db = getDb();
  ensureInitialRecurringPriceScan(workspaceId);
  const where = `WHERE t.workspace_id = ?
    AND t.needs_review = 1
    AND t.status = 'completed'
    AND t.is_excluded = 0`;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM transactions t ${where}`)
    .get(workspaceId) as { total: number };

  const rows = db
    .prepare(
      `${TRANSACTION_LIST_SELECT}
       ${where}
       ORDER BY substr(t.date, 1, 10) DESC, t.id DESC`,
    )
    .all(workspaceId);

  const transactions = rows.map(mapTransactionRow);
  const reasons = getActiveReviewReasons(workspaceId, transactions.map((transaction) => transaction.id));
  return {
    transactions: transactions.map((transaction) => ({ ...transaction, reviewReasons: reasons.get(transaction.id) ?? [] })),
    total: countRow.total,
  };
}

export function getTransactionMerchants(
  workspaceId: number,
  params: { from?: string; to?: string; kind?: TransactionKindFilter },
): string[] {
  const conditions: string[] = ["workspace_id = ?"];
  const values: (string | number)[] = [workspaceId];
  if (params.from) {
    conditions.push("substr(date, 1, 10) >= ?");
    values.push(params.from);
  }
  if (params.to) {
    conditions.push("substr(date, 1, 10) <= ?");
    values.push(params.to);
  }
  if (params.kind === "income") conditions.push("charged_amount > 0");
  if (params.kind === "expense") conditions.push("charged_amount < 0");

  const rows = getDb()
    .prepare(
      `SELECT DISTINCT description
       FROM transactions
       WHERE ${conditions.join(" AND ")} AND description <> ''
       ORDER BY description COLLATE NOCASE ASC`,
    )
    .all(...values) as { description: string }[];
  return rows.map((row) => row.description);
}

export function getUncategorizedTransactionIds(workspaceId: number): number[] {
  const rows = getDb()
    .prepare(
      "SELECT id FROM transactions WHERE workspace_id = ? AND category_id IS NULL AND kind != 'transfer' AND status = 'completed' AND is_excluded = 0 ORDER BY date DESC"
    )
    .all(workspaceId) as { id: number }[];
  return rows.map((r) => r.id);
}

export function getUncategorizedIdsByKind(
  workspaceId: number,
  kind: "expense" | "income"
): number[] {
  const rows = getDb()
    .prepare(
      "SELECT id FROM transactions WHERE workspace_id = ? AND category_id IS NULL AND kind = ? AND status = 'completed' AND is_excluded = 0 ORDER BY date DESC"
    )
    .all(workspaceId, kind) as { id: number }[];
  return rows.map((r) => r.id);
}

export function getTransactionsForCategorization(
  workspaceId: number,
  ids: number[]
): { id: number; description: string; chargedAmount: number; originalCurrency: string; memo: string | null }[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT id, description, charged_amount as chargedAmount,
              original_currency as originalCurrency, memo
       FROM transactions WHERE workspace_id = ? AND id IN (${placeholders})`
    )
    .all(workspaceId, ...ids) as { id: number; description: string; chargedAmount: number; originalCurrency: string; memo: string | null }[];
}

export function updateTransactionCategory(
  workspaceId: number,
  id: number,
  categoryId: number,
  source: "ai" | "user"
): void {
  assertMutableTransaction(workspaceId, id);
  getDb()
    .prepare(
      `UPDATE transactions
       SET category_id = ?, category_source = ?, updated_at = datetime('now')
       WHERE workspace_id = ? AND id = ?`
    )
    .run(categoryId, source, workspaceId, id);
}

export function batchUpdateCategories(
  workspaceId: number,
  updates: { id: number; categoryId: number; aiConfidence?: number | null }[]
): void {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE transactions
     SET category_id = ?, category_source = 'ai', ai_confidence = ?, updated_at = datetime('now')
     WHERE workspace_id = ? AND id = ? AND category_source IS NOT 'user'`
  );

  db.transaction(() => {
    for (const { id, categoryId, aiConfidence } of updates) {
      stmt.run(categoryId, aiConfidence ?? null, workspaceId, id);
    }
  })();
}


export function getMonthlySummary(
  workspaceId: number,
  months: number
): MonthlySummary[] {
  return getDb()
    .prepare(
      `SELECT strftime('%Y-%m', date) as month,
              SUM(ABS(charged_amount)) as amount
       FROM transactions
       WHERE workspace_id = ?
         AND date >= date('now', '-' || ? || ' months')
         AND status = 'completed'
         AND kind = 'expense'
         AND is_excluded = 0
         AND is_deployed = 0
       GROUP BY month
       ORDER BY month ASC`
    )
    .all(workspaceId, months) as MonthlySummary[];
}

export function getTopMerchants(
  workspaceId: number,
  from: string,
  to: string,
  limit = 10
): MerchantSummary[] {
  return getDb()
    .prepare(
      `SELECT description as name,
              SUM(ABS(charged_amount)) as amount,
              COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ? AND status = 'completed' AND kind = 'expense'
         AND is_excluded = 0
         AND is_deployed = 0
       GROUP BY description
       ORDER BY amount DESC
       LIMIT ?`
    )
    .all(workspaceId, from, to, limit) as MerchantSummary[];
}

export function getCategoryBreakdown(
  workspaceId: number,
  from: string,
  to: string
): CategoryBreakdown[] {
  return getDb()
    .prepare(
      `SELECT
         COALESCE(t.category_id, 0) as categoryId,
         COALESCE(c.name, 'Uncategorized') as name,
         COALESCE(c.color, '#B5B3AC') as color,
         SUM(ABS(t.charged_amount)) as amount,
         COUNT(*) as count
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.workspace_id = ? AND substr(t.date, 1, 10) >= ? AND substr(t.date, 1, 10) <= ? AND t.status = 'completed' AND t.kind = 'expense'
         AND t.is_excluded = 0
         AND t.is_deployed = 0
       GROUP BY t.category_id
       ORDER BY amount DESC`
    )
    .all(workspaceId, from, to) as CategoryBreakdown[];
}

export interface CategorySpend {
  categoryId: number;
  amount: number;
  count: number;
}

export function getCategorySpendInRange(
  workspaceId: number,
  from: string,
  to: string
): CategorySpend[] {
  return getDb()
    .prepare(
      `SELECT category_id as categoryId,
              SUM(ABS(charged_amount)) as amount,
              COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ? AND status = 'completed' AND kind = 'expense' AND category_id IS NOT NULL
         AND is_excluded = 0
         AND is_deployed = 0
       GROUP BY category_id`
    )
    .all(workspaceId, from, to) as CategorySpend[];
}

export interface CategoryTopMerchant {
  categoryId: number;
  merchant: string;
  amount: number;
}

export function getTopMerchantPerCategory(
  workspaceId: number,
  from: string,
  to: string
): CategoryTopMerchant[] {
  return getDb()
    .prepare(
      `SELECT category_id as categoryId, description as merchant, amount
       FROM (
         SELECT category_id, description, SUM(ABS(charged_amount)) as amount,
                ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY SUM(ABS(charged_amount)) DESC) as rn
         FROM transactions
         WHERE workspace_id = ? AND substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ? AND status = 'completed' AND kind = 'expense' AND category_id IS NOT NULL
           AND is_excluded = 0
           AND is_deployed = 0
         GROUP BY category_id, description
       )
       WHERE rn = 1`
    )
    .all(workspaceId, from, to) as CategoryTopMerchant[];
}

export interface DailySpendPoint {
  date: string;
  amount: number;
}

export function getCategorySpendByDay(
  workspaceId: number,
  categoryId: number,
  from: string,
  to: string
): DailySpendPoint[] {
  return getDb()
    .prepare(
      `WITH RECURSIVE days(d) AS (
         SELECT date(?)
         UNION ALL
         SELECT date(d, '+1 day') FROM days WHERE d < date(?)
       )
       SELECT days.d as date,
              COALESCE(SUM(ABS(t.charged_amount)), 0) as amount
       FROM days
       LEFT JOIN transactions t
         ON substr(t.date, 1, 10) = days.d
         AND t.workspace_id = ?
         AND t.category_id = ?
         AND t.kind = 'expense'
         AND t.status = 'completed'
         AND t.is_excluded = 0
         AND t.is_deployed = 0
       GROUP BY days.d
       ORDER BY days.d ASC`
    )
    .all(from, to, workspaceId, categoryId) as DailySpendPoint[];
}

export interface TopMerchantForCategory {
  merchant: string;
  amount: number;
  count: number;
}

export function getTopMerchantsForCategory(
  workspaceId: number,
  categoryId: number,
  from: string,
  to: string,
  limit = 8
): TopMerchantForCategory[] {
  return getDb()
    .prepare(
      `SELECT description as merchant,
              SUM(ABS(charged_amount)) as amount,
              COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND category_id = ?
         AND substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ?
         AND status = 'completed'
         AND kind = 'expense'
         AND is_excluded = 0
         AND is_deployed = 0
       GROUP BY description
       ORDER BY amount DESC
       LIMIT ?`
    )
    .all(workspaceId, categoryId, from, to, limit) as TopMerchantForCategory[];
}

export function getPeriodTotal(
  workspaceId: number,
  from: string,
  to: string
): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(ABS(charged_amount)), 0) as total
       FROM transactions
       WHERE workspace_id = ? AND substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ? AND status = 'completed' AND kind = 'expense'
         AND is_excluded = 0
         AND is_deployed = 0`
    )
    .get(workspaceId, from, to) as { total: number };
  return row.total;
}

export function getPeriodCount(
  workspaceId: number,
  from: string,
  to: string
): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ? AND status = 'completed' AND kind = 'expense'
         AND is_excluded = 0`
    )
    .get(workspaceId, from, to) as { count: number };
  return row.count;
}

interface TransactionRow {
  id: number;
  account_number: string;
  date: string;
  processed_date: string;
  original_amount: number;
  original_currency: string;
  charged_amount: number;
  charged_currency: string | null;
  description: string;
  memo: string | null;
  type: string;
  status: string;
  identifier: string | null;
  installment_number: number | null;
  installment_total: number | null;
  category_id: number | null;
  category_source: string | null;
  ai_confidence: number | null;
  provider: string;
  credential_id: number | null;
  sync_run_id: number;
  source: string;
  deployment_id: number | null;
  deployment_index: number | null;
  is_deployed: number;
  deployment_meta_id?: number | null;
  deployment_origin_id?: number | null;
  deployment_origin_date?: string | null;
  deployment_months?: number | null;
  recurring_transaction_id: number | null;
  kind: string;
  needs_review: number;
  is_excluded: number;
  created_at: string;
  updated_at: string;
  category_name?: string | null;
  category_color?: string | null;
  account_label?: string | null;
}

function mapTransactionRow(row: unknown): TransactionWithCategory {
  const r = row as TransactionRow;
  return {
    id: r.id,
    accountNumber: r.account_number,
    date: r.date,
    processedDate: r.processed_date,
    originalAmount: r.original_amount,
    originalCurrency: r.original_currency,
    chargedAmount: r.charged_amount,
    chargedCurrency: r.charged_currency,
    description: r.description,
    memo: r.memo,
    type: r.type as "normal" | "installments",
    status: r.status as "completed" | "pending",
    identifier: r.identifier,
    installmentNumber: r.installment_number,
    installmentTotal: r.installment_total,
    categoryId: r.category_id,
    categorySource: r.category_source as "ai" | "user" | null,
    aiConfidence: r.ai_confidence,
    provider: r.provider,
    credentialId: r.credential_id ?? null,
    accountLabel: r.account_label ?? null,
    syncRunId: r.sync_run_id ?? null,
    source: r.deployment_id != null ? "deployment" : (r.source ?? "bank") as "bank" | "recurring" | "deployment",
    recurringTransactionId: r.recurring_transaction_id ?? null,
    kind: r.kind as "expense" | "income" | "transfer",
    needsReview: r.needs_review === 1,
    isExcluded: r.is_excluded === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    categoryName: r.category_name ?? null,
    categoryColor: r.category_color ?? null,
    deployment: r.deployment_meta_id != null ? {
      deploymentId: r.deployment_meta_id,
      role: r.is_deployed === 1 ? "origin" : "slice",
      originId: r.deployment_origin_id!,
      originDate: r.deployment_origin_date!,
      sliceIndex: r.deployment_index,
      totalMonths: r.deployment_months!,
    } : null,
  };
}

export function setTransactionKind(
  workspaceId: number,
  id: number,
  kind: "expense" | "income" | "transfer"
): void {
  assertMutableTransaction(workspaceId, id);
  getDb()
    .prepare(
      `UPDATE transactions
       SET kind = ?, updated_at = datetime('now')
       WHERE workspace_id = ? AND id = ?`
    )
    .run(kind, workspaceId, id);
}

export function setTransactionNeedsReview(
  workspaceId: number,
  id: number,
  value: boolean
): void {
  if (value) {
    batchSetLowConfidenceReviewReasons(workspaceId, [{ id, active: true }]);
  } else {
    resolveAllReviewReasons(workspaceId, id);
  }
}

interface TransactionContext {
  id: number;
  description: string;
  categoryId: number | null;
  categorySource: "ai" | "user" | null;
  kind: "expense" | "income" | "transfer";
  provider: string;
}

export function getTransactionContext(
  workspaceId: number,
  id: number
): TransactionContext | null {
  const row = getDb()
    .prepare(
      `SELECT id, description, category_id as categoryId,
              category_source as categorySource, kind, provider
       FROM transactions WHERE workspace_id = ? AND id = ?`
    )
    .get(workspaceId, id) as TransactionContext | undefined;
  return row ?? null;
}

export function batchSetNeedsReview(
  workspaceId: number,
  updates: { id: number; needsReview: boolean }[]
): void {
  if (updates.length === 0) return;
  batchSetLowConfidenceReviewReasons(workspaceId, updates.map(({ id, needsReview }) => ({ id, active: needsReview })));
}

export interface NeedsReviewCount {
  categoryId: number;
  count: number;
}

export interface TransactionsSummary {
  income: {
    total: number;
    count: number;
    largest: TransactionWithCategory | null;
  };
  expense: {
    total: number;
    count: number;
    largest: TransactionWithCategory | null;
  };
  net: number;
  topMerchants: { description: string; total: number; count: number }[];
  pendingReviewCount: number;
}

export interface TransactionsSummaryParams {
  /** @deprecated Use credentialIds */
  credentialId?: number;
  credentialIds?: number[];
}

export function getTransactionsSummary(
  workspaceId: number,
  from: string,
  to: string,
  params: TransactionsSummaryParams = {}
): TransactionsSummary {
  const db = getDb();
  const baseConditions = [
    "workspace_id = ?",
    "substr(date, 1, 10) >= ?",
    "substr(date, 1, 10) <= ?",
    "status = 'completed'",
    "is_excluded = 0",
    "is_deployed = 0",
  ];
  const baseValues: (string | number)[] = [workspaceId, from, to];
  const summaryCredentialIds =
    params.credentialIds && params.credentialIds.length > 0
      ? params.credentialIds
      : params.credentialId != null
        ? [params.credentialId]
        : undefined;
  appendCredentialIdsFilter(baseConditions, baseValues, summaryCredentialIds);
  const baseWhere = baseConditions.join(" AND ");

  const incomeAgg = db
    .prepare(
      `SELECT COALESCE(SUM(charged_amount), 0) as total, COUNT(*) as count
       FROM transactions
       WHERE ${baseWhere} AND charged_amount > 0`
    )
    .get(...baseValues) as { total: number; count: number };

  const expenseAgg = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(charged_amount)), 0) as total, COUNT(*) as count
       FROM transactions
       WHERE ${baseWhere} AND charged_amount < 0`
    )
    .get(...baseValues) as { total: number; count: number };

  const pickLargest = (sign: "income" | "expense"): TransactionWithCategory | null => {
    const cmp = sign === "income" ? "> 0" : "< 0";
    const tConditions = [
      "t.workspace_id = ?",
      "substr(t.date, 1, 10) >= ?",
      "substr(t.date, 1, 10) <= ?",
      "t.status = 'completed'",
      "t.is_excluded = 0",
      "t.is_deployed = 0",
      `t.charged_amount ${cmp}`,
    ];
    const tValues: (string | number)[] = [workspaceId, from, to];
    appendCredentialIdsFilter(tConditions, tValues, summaryCredentialIds, "t.");
    const row = db
      .prepare(
        `${TRANSACTION_LIST_SELECT}
         WHERE ${tConditions.join(" AND ")}
         ORDER BY ABS(t.charged_amount) DESC, t.id DESC
         LIMIT 1`
      )
      .get(...tValues);
    return row ? mapTransactionRow(row) : null;
  };

  const topMerchantsRows = db
    .prepare(
      `SELECT description,
              SUM(ABS(charged_amount)) as total,
              COUNT(*) as count
       FROM transactions
       WHERE ${baseWhere} AND charged_amount < 0
       GROUP BY description
       ORDER BY total DESC
       LIMIT 5`
    )
    .all(...baseValues) as { description: string; total: number; count: number }[];

  const pendingReview = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM transactions
       WHERE ${baseWhere} AND needs_review = 1`
    )
    .get(...baseValues) as { count: number };

  return {
    income: {
      total: incomeAgg.total,
      count: incomeAgg.count,
      largest: pickLargest("income"),
    },
    expense: {
      total: expenseAgg.total,
      count: expenseAgg.count,
      largest: pickLargest("expense"),
    },
    net: incomeAgg.total - expenseAgg.total,
    topMerchants: topMerchantsRows,
    pendingReviewCount: pendingReview.count,
  };
}

export function getNeedsReviewCountByCategory(
  workspaceId: number,
  from: string,
  to: string
): NeedsReviewCount[] {
  return getDb()
    .prepare(
      `SELECT category_id as categoryId, COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ?
         AND status = 'completed'
         AND kind = 'expense'
         AND needs_review = 1
         AND category_id IS NOT NULL
       GROUP BY category_id`
    )
    .all(workspaceId, from, to) as NeedsReviewCount[];
}

