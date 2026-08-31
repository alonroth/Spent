import "server-only";

import type Database from "better-sqlite3";
import { getDb } from "../index";
import { normalizeMerchant } from "@/server/lib/merchant-key";
import type { ReviewReason } from "@/lib/types";

type ReasonType = ReviewReason["type"];

interface EligibleTransaction {
  id: number;
  account_number: string;
  provider: string;
  description: string;
  currency: string;
  amount: number;
  month: string;
}

interface PriceIncreaseCandidate {
  transactionId: number;
  previousAmount: number;
  currency: string;
  stableMonths: number;
  increasePercent: number;
}

interface ReviewReasonRow {
  transaction_id: number;
  reason_type: ReasonType;
  previous_amount: number | null;
  currency: string | null;
  stable_months: number | null;
  increase_percent: number | null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function previousMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${monthNumber === 1 ? year - 1 : year}-${String(monthNumber === 1 ? 12 : monthNumber - 1).padStart(2, "0")}`;
}

function streamKey(row: EligibleTransaction): string {
  return [
    normalizeMerchant(row.description),
    row.provider,
    row.account_number,
    row.currency,
  ].join("\u0000");
}

function findCandidates(rows: EligibleTransaction[]): PriceIncreaseCandidate[] {
  const streams = new Map<string, Map<string, EligibleTransaction[]>>();
  for (const row of rows) {
    const key = streamKey(row);
    const byMonth = streams.get(key) ?? new Map<string, EligibleTransaction[]>();
    const monthRows = byMonth.get(row.month) ?? [];
    monthRows.push(row);
    byMonth.set(row.month, monthRows);
    streams.set(key, byMonth);
  }

  const candidates: PriceIncreaseCandidate[] = [];
  for (const byMonth of streams.values()) {
    for (const [month, monthRows] of byMonth) {
      if (monthRows.length !== 1) continue;
      const current = monthRows[0];
      const baselineRows: EligibleTransaction[] = [];
      let cursor = previousMonth(month);
      for (let i = 0; i < 3; i++) {
        const previousRows = byMonth.get(cursor);
        if (!previousRows || previousRows.length !== 1) {
          baselineRows.length = 0;
          break;
        }
        baselineRows.push(previousRows[0]);
        cursor = previousMonth(cursor);
      }
      if (baselineRows.length !== 3) continue;

      const previousAmount = roundMoney(Math.abs(baselineRows[0].amount));
      const currentAmount = roundMoney(Math.abs(current.amount));
      if (previousAmount <= 0 || currentAmount < roundMoney(previousAmount * 1.05)) continue;
      if (!baselineRows.every((row) => roundMoney(Math.abs(row.amount)) === previousAmount)) continue;

      let stableMonths = 3;
      while (byMonth.get(cursor)?.length === 1) {
        const row = byMonth.get(cursor)![0];
        if (roundMoney(Math.abs(row.amount)) !== previousAmount) break;
        stableMonths++;
        cursor = previousMonth(cursor);
      }

      candidates.push({
        transactionId: current.id,
        previousAmount,
        currency: current.currency,
        stableMonths,
        increasePercent: roundMoney(((currentAmount - previousAmount) / previousAmount) * 100),
      });
    }
  }
  return candidates;
}

function eligibleRows(db: Database.Database, workspaceId: number): EligibleTransaction[] {
  return db.prepare(`
    SELECT id, account_number, provider, description,
           COALESCE(charged_currency, original_currency) AS currency,
           charged_amount AS amount, substr(date, 1, 7) AS month
    FROM transactions
    WHERE workspace_id = ?
      AND source = 'bank'
      AND kind = 'expense'
      AND status = 'completed'
      AND is_excluded = 0
      AND type = 'normal'
      AND charged_amount < 0
  `).all(workspaceId) as EligibleTransaction[];
}

function insertPriceReasons(
  db: Database.Database,
  workspaceId: number,
  candidates: PriceIncreaseCandidate[],
): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO transaction_review_reasons
      (workspace_id, transaction_id, reason_type, previous_amount, currency, stable_months, increase_percent)
    VALUES (?, ?, 'recurring_price_increase', ?, ?, ?, ?)
  `);
  const mark = db.prepare(`
    UPDATE transactions SET needs_review = 1, updated_at = datetime('now')
    WHERE workspace_id = ? AND id = ?
  `);
  for (const candidate of candidates) {
    const result = insert.run(
      workspaceId,
      candidate.transactionId,
      candidate.previousAmount,
      candidate.currency,
      candidate.stableMonths,
      candidate.increasePercent,
    );
    if (result.changes > 0) mark.run(workspaceId, candidate.transactionId);
  }
}

export function ensureInitialRecurringPriceScan(workspaceId: number): boolean {
  const db = getDb();
  const state = db.prepare("SELECT 1 FROM recurring_price_review_state WHERE workspace_id = ?").get(workspaceId);
  if (state) return false;
  const candidates = findCandidates(eligibleRows(db, workspaceId));
  const newestByStream = new Map<string, PriceIncreaseCandidate>();
  const allRows = eligibleRows(db, workspaceId);
  const streamById = new Map(allRows.map((row) => [row.id, streamKey(row)]));
  const monthById = new Map(allRows.map((row) => [row.id, row.month]));
  for (const candidate of candidates) {
    const key = streamById.get(candidate.transactionId);
    if (!key) continue;
    const existing = newestByStream.get(key);
    if (!existing || (monthById.get(candidate.transactionId) ?? "") > (monthById.get(existing.transactionId) ?? "") || (monthById.get(candidate.transactionId) === monthById.get(existing.transactionId) && candidate.transactionId > existing.transactionId)) newestByStream.set(key, candidate);
  }
  db.transaction(() => {
    insertPriceReasons(db, workspaceId, [...newestByStream.values()]);
    db.prepare("INSERT INTO recurring_price_review_state (workspace_id) VALUES (?)").run(workspaceId);
  })();
  return true;
}

export function detectRecurringPriceIncreases(workspaceId: number, transactionIds: number[]): void {
  if (transactionIds.length === 0) return;
  const db = getDb();
  const ids = new Set(transactionIds);
  const candidates = findCandidates(eligibleRows(db, workspaceId)).filter((candidate) => ids.has(candidate.transactionId));
  db.transaction(() => insertPriceReasons(db, workspaceId, candidates))();
}

function refreshNeedsReview(db: Database.Database, workspaceId: number, transactionId: number): void {
  db.prepare(`
    UPDATE transactions SET needs_review = CASE WHEN EXISTS (
      SELECT 1 FROM transaction_review_reasons
      WHERE workspace_id = ? AND transaction_id = ? AND resolved_at IS NULL
    ) THEN 1 ELSE 0 END, updated_at = datetime('now')
    WHERE workspace_id = ? AND id = ?
  `).run(workspaceId, transactionId, workspaceId, transactionId);
}

export function setLowConfidenceReviewReason(workspaceId: number, transactionId: number, active: boolean): void {
  const db = getDb();
  db.transaction(() => {
    if (active) {
      db.prepare(`
        INSERT INTO transaction_review_reasons (workspace_id, transaction_id, reason_type)
        VALUES (?, ?, 'low_confidence_category')
        ON CONFLICT(workspace_id, transaction_id, reason_type) DO UPDATE SET
          resolved_at = NULL, updated_at = datetime('now')
      `).run(workspaceId, transactionId);
    } else {
      db.prepare(`
        UPDATE transaction_review_reasons SET resolved_at = datetime('now'), updated_at = datetime('now')
        WHERE workspace_id = ? AND transaction_id = ? AND reason_type = 'low_confidence_category' AND resolved_at IS NULL
      `).run(workspaceId, transactionId);
    }
    refreshNeedsReview(db, workspaceId, transactionId);
  })();
}

export function batchSetLowConfidenceReviewReasons(workspaceId: number, updates: { id: number; active: boolean }[]): void {
  if (updates.length === 0) return;
  const db = getDb();
  const run = db.transaction(() => {
    for (const update of updates) {
      if (update.active) {
        db.prepare(`INSERT INTO transaction_review_reasons (workspace_id, transaction_id, reason_type) VALUES (?, ?, 'low_confidence_category') ON CONFLICT(workspace_id, transaction_id, reason_type) DO UPDATE SET resolved_at = NULL, updated_at = datetime('now')`).run(workspaceId, update.id);
      } else {
        db.prepare(`UPDATE transaction_review_reasons SET resolved_at = datetime('now'), updated_at = datetime('now') WHERE workspace_id = ? AND transaction_id = ? AND reason_type = 'low_confidence_category' AND resolved_at IS NULL`).run(workspaceId, update.id);
      }
      refreshNeedsReview(db, workspaceId, update.id);
    }
  });
  run();
}

export function resolveAllReviewReasons(workspaceId: number, transactionId: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE transaction_review_reasons SET resolved_at = datetime('now'), updated_at = datetime('now') WHERE workspace_id = ? AND transaction_id = ? AND resolved_at IS NULL`).run(workspaceId, transactionId);
    refreshNeedsReview(db, workspaceId, transactionId);
  })();
}

export function getActiveReviewReasons(workspaceId: number, transactionIds: number[]): Map<number, ReviewReason[]> {
  const result = new Map<number, ReviewReason[]>();
  if (transactionIds.length === 0) return result;
  const placeholders = transactionIds.map(() => "?").join(",");
  const rows = getDb().prepare(`
    SELECT transaction_id, reason_type, previous_amount, currency, stable_months, increase_percent
    FROM transaction_review_reasons
    WHERE workspace_id = ? AND resolved_at IS NULL AND transaction_id IN (${placeholders})
    ORDER BY id
  `).all(workspaceId, ...transactionIds) as ReviewReasonRow[];
  for (const row of rows) {
    const reasons = result.get(row.transaction_id) ?? [];
    if (row.reason_type === "low_confidence_category") reasons.push({ type: row.reason_type });
    else if (row.previous_amount != null && row.currency && row.stable_months != null && row.increase_percent != null) {
      reasons.push({ type: row.reason_type, previousAmount: row.previous_amount, currency: row.currency, stableMonths: row.stable_months, increasePercent: row.increase_percent });
    }
    result.set(row.transaction_id, reasons);
  }
  return result;
}
