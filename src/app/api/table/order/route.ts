import { NextResponse } from "next/server";
import { saveAnnualTableOrder } from "@/server/db/queries/annual-table";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { section?: string; order?: unknown } | null;
  if ((body?.section !== "mandatory" && body?.section !== "optional") || !Array.isArray(body.order) || !body.order.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "invalid table order" }, { status: 400 });
  }
  return NextResponse.json(saveAnnualTableOrder(getWorkspaceIdFromRequest(request), body.section, body.order));
}

