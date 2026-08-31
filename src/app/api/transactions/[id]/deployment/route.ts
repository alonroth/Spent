import { NextResponse } from "next/server";
import {
  createExpenseDeployment,
  reverseExpenseDeployment,
  DeploymentConflictError,
} from "@/server/db/queries/transactions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

function idFrom(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idFrom((await params).id);
  if (!id) return NextResponse.json({ error: "invalid transaction id" }, { status: 400 });
  const body = await request.json().catch(() => ({})) as { months?: unknown };
  if (body.months !== 6 && body.months !== 12) return NextResponse.json({ error: "months must be 6 or 12" }, { status: 400 });
  try {
    return NextResponse.json(createExpenseDeployment(getWorkspaceIdFromRequest(request), id, body.months), { status: 201 });
  } catch (error) {
    if (error instanceof DeploymentConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "not found" }, { status: 404 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idFrom((await params).id);
  if (!id) return NextResponse.json({ error: "invalid transaction id" }, { status: 400 });
  try {
    reverseExpenseDeployment(getWorkspaceIdFromRequest(request), id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "deployment not found" }, { status: 404 });
  }
}
