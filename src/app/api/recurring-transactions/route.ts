import { NextResponse } from "next/server";
import { createRecurringTransaction, listRecurringTransactions } from "@/server/db/queries/recurring-transactions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
export async function GET(request:Request){return NextResponse.json(listRecurringTransactions(getWorkspaceIdFromRequest(request)));}
export async function POST(request:Request){try { const body=await request.json(); return NextResponse.json(createRecurringTransaction(getWorkspaceIdFromRequest(request),body),{status:201}); } catch (e) { return NextResponse.json({error:e instanceof Error?e.message:"invalid body"},{status:400}); }}

