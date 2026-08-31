import { NextResponse } from "next/server";
import { getTransactionMerchants, type TransactionKindFilter } from "@/server/db/queries/transactions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

function parseKind(raw: string | null): TransactionKindFilter | undefined {
  return raw === "expense" || raw === "income" || raw === "all" ? raw : undefined;
}

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  return NextResponse.json(getTransactionMerchants(workspaceId, {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    kind: parseKind(searchParams.get("kind")),
  }));
}
