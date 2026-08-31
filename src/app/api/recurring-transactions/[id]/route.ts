import { NextResponse } from "next/server";
import { deleteRecurringTransaction, updateRecurringTransaction } from "@/server/db/queries/recurring-transactions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) { try { const id=Number((await params).id), result=updateRecurringTransaction(getWorkspaceIdFromRequest(request),id,await request.json()); return result?NextResponse.json(result):NextResponse.json({error:"not found"},{status:404}); } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"invalid body"},{status:400}); } }
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}) { return deleteRecurringTransaction(getWorkspaceIdFromRequest(request),Number((await params).id))?NextResponse.json({success:true}):NextResponse.json({error:"not found"},{status:404}); }

