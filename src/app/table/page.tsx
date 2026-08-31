import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AnnualTablePage } from "@/components/table/annual-table-page";
import { getDb } from "@/server/db/index";
export const dynamic = "force-dynamic";
export default function TablePage(){ const row=getDb().prepare("SELECT COUNT(*) count FROM bank_credentials").get() as {count:number}; if(!row.count) redirect("/setup"); return <AppShell><AnnualTablePage /></AppShell>; }

