import { NextResponse } from "next/server";
import { getAnnualTable } from "@/server/db/queries/annual-table";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
export async function GET(request: Request) { const year=Number(new URL(request.url).searchParams.get("year") ?? new Date().getFullYear()); if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({error:"invalid year"},{status:400}); return NextResponse.json(getAnnualTable(getWorkspaceIdFromRequest(request),year)); }

