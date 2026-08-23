import { NextResponse } from "next/server";
import { getAllCategories } from "@/server/db/queries/categories";
import { getTransactionContext } from "@/server/db/queries/transactions";
import { recordCorrection } from "@/server/db/queries/category-corrections";
import { getDb } from "@/server/db";
import { recordMerchantCategory } from "@/server/lib/merchant-memory";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

const MAX_BULK_TRANSACTIONS = 50;

type BulkBody = {
  operation?: unknown;
  ids?: unknown;
  categoryId?: unknown;
};

function parseIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_TRANSACTIONS) {
    return null;
  }
  const ids = value.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    return null;
  }
  return ids;
}

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json().catch(() => ({}))) as BulkBody;
  const ids = parseIds(body.ids);

  if (!ids || (body.operation !== "exclude" && body.operation !== "change-category")) {
    return NextResponse.json({ error: "invalid bulk operation" }, { status: 400 });
  }

  const contexts = ids.map((id) => getTransactionContext(workspaceId, id));
  if (contexts.some((context) => context == null)) {
    return NextResponse.json({ error: "transaction not found" }, { status: 404 });
  }
  const transactions = contexts.filter((context): context is NonNullable<typeof context> => context != null);
  const db = getDb();

  if (body.operation === "exclude") {
    const update = db.prepare(
      `UPDATE transactions
       SET is_excluded = 1, updated_at = datetime('now')
       WHERE workspace_id = ? AND id = ?`,
    );
    db.transaction(() => {
      for (const id of ids) update.run(workspaceId, id);
    })();
    return NextResponse.json({ success: true, updated: ids.length });
  }

  const categoryId = Number(body.categoryId);
  const selectedKind = transactions[0].kind;
  if (
    !Number.isInteger(categoryId) ||
    (selectedKind !== "expense" && selectedKind !== "income") ||
    transactions.some((transaction) => transaction.kind !== selectedKind)
  ) {
    return NextResponse.json({ error: "selected transactions must have one category kind" }, { status: 400 });
  }

  const category = getAllCategories(workspaceId, selectedKind, { leavesOnly: true }).find(
    (item) => item.id === categoryId,
  );
  if (!category) {
    return NextResponse.json({ error: "invalid category" }, { status: 400 });
  }

  const update = db.prepare(
    `UPDATE transactions
     SET category_id = ?, category_source = 'user', needs_review = 0, updated_at = datetime('now')
     WHERE workspace_id = ? AND id = ?`,
  );
  db.transaction(() => {
    for (const transaction of transactions) {
      update.run(categoryId, workspaceId, transaction.id);
      recordMerchantCategory(workspaceId, transaction.description, categoryId, selectedKind, "user");
      if (
        transaction.categorySource === "ai" &&
        transaction.categoryId != null &&
        transaction.categoryId !== categoryId
      ) {
        recordCorrection(
          workspaceId,
          transaction.description,
          transaction.categoryId,
          categoryId,
          selectedKind,
        );
      }
    }
  })();

  return NextResponse.json({ success: true, updated: ids.length });
}
