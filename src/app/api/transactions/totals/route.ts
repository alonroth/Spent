import { NextResponse } from "next/server";
import { getTransactionTotals, type TransactionKindFilter } from "@/server/db/queries/transactions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

function parseKind(raw: string | null): TransactionKindFilter | undefined {
  return raw === "expense" || raw === "income" || raw === "all" ? raw : undefined;
}

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const categoryIds = searchParams.getAll("categoryIds").map(Number).filter(Number.isFinite);
  const credentialIds = searchParams.getAll("credentialIds").map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return NextResponse.json(getTransactionTotals(workspaceId, {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    categoryIds: categoryIds.length ? categoryIds : undefined,
    credentialIds: credentialIds.length ? credentialIds : undefined,
    kind: parseKind(searchParams.get("kind")),
  }));
}
