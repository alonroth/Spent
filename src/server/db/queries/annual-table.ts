import "server-only";
import { getDb } from "../index";
import type { AnnualTableOrder, AnnualTablePayload, AnnualTableRow, AnnualTableSection, AnnualTableSectionKey } from "@/lib/types";
import { getWorkspaceSetting, setWorkspaceSetting } from "./settings";

const MONTHS = Array.from({ length: 12 }, (_, i) => i);
const zeros = () => Array<number>(12).fill(0);
// A category's average is the average of months in which it actually appears.
// Empty months are absence of data, not zero-valued observations.
const averageFor = (amounts: number[]) => {
  const populated = amounts.filter((amount) => amount !== 0);
  return populated.length === 0
    ? 0
    : populated.reduce((sum, amount) => sum + amount, 0) / populated.length;
};
const median = (v: number[]) => { const s = [...v].sort((a,b)=>a-b), n=s.length; return n % 2 ? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2; };
function outliers(amounts: number[], year: number): Array<"high"|"low"|null> {
  const now = new Date(); const count = year === now.getFullYear() ? now.getMonth() : 12; const result: Array<"high"|"low"|null> = Array(12).fill(null); if (count < 6) return result;
  const values = amounts.slice(0, count), med = median(values), mad = median(values.map(v=>Math.abs(v-med)));
  values.forEach((value,i) => { const diff=Math.abs(value-med); let flagged=false; if (mad === 0) flagged = diff >= Math.max(100, Math.abs(med)*.2); else flagged = Math.abs(.6745*(value-med)/mad) >= 3.5 && diff >= 100; if (flagged) result[i] = value > med ? "high" : "low"; }); return result;
}
const ORDER_KEY = "annual_table_order";
const emptyOrder = (): AnnualTableOrder => ({ mandatory: [], optional: [] });
function readOrder(workspaceId: number): AnnualTableOrder {
  try {
    const parsed = JSON.parse(getWorkspaceSetting(workspaceId, ORDER_KEY) ?? "{}");
    return {
      mandatory: Array.isArray(parsed.mandatory) ? parsed.mandatory.filter((id: unknown): id is string => typeof id === "string") : [],
      optional: Array.isArray(parsed.optional) ? parsed.optional.filter((id: unknown): id is string => typeof id === "string") : [],
    };
  } catch { return emptyOrder(); }
}
export function saveAnnualTableOrder(workspaceId: number, section: "mandatory" | "optional", order: string[]): AnnualTableOrder {
  const current = readOrder(workspaceId);
  current[section] = [...new Set(order.filter((id) => id === "uncategorized" || /^\d+$/.test(id)))];
  setWorkspaceSetting(workspaceId, ORDER_KEY, JSON.stringify(current));
  return current;
}
function applyOrder(rows: AnnualTableRow[], order: string[]): AnnualTableRow[] {
  const byId = new Map(rows.map((row) => [row.categoryId == null ? "uncategorized" : String(row.categoryId), row]));
  return [...order.map((id) => byId.get(id)).filter((row): row is AnnualTableRow => row !== undefined), ...rows.filter((row) => !order.includes(row.categoryId == null ? "uncategorized" : String(row.categoryId)))];
}
export function getAnnualTable(workspaceId: number, year: number): AnnualTablePayload {
  const db = getDb(); const start=`${year}-01-01`, end=`${year}-12-31`;
  const categories = db.prepare(`SELECT c.id,c.name,c.kind,c.expense_type FROM categories c WHERE c.workspace_id=? AND c.id NOT IN (SELECT parent_id FROM categories WHERE parent_id IS NOT NULL) ORDER BY c.name COLLATE NOCASE`).all(workspaceId) as {id:number;name:string;kind:"income"|"expense";expense_type:"mandatory"|"optional"|null}[];
  const sums = db.prepare(`SELECT t.category_id, CAST(substr(transaction_calendar_date(t.date),6,2) AS INTEGER)-1 AS month, SUM(ABS(t.charged_amount)) AS amount FROM transactions t WHERE t.workspace_id=? AND transaction_calendar_date(t.date)>=? AND transaction_calendar_date(t.date)<=? AND t.status='completed' AND t.is_excluded=0 AND t.is_deployed=0 AND t.kind IN ('income','expense') GROUP BY t.category_id, month`).all(workspaceId,start,end) as {category_id:number|null;month:number;amount:number}[];
  const byCategory = new Map<number|null,number[]>(); for (const sum of sums) { const arr=byCategory.get(sum.category_id)??zeros(); arr[sum.month]=sum.amount; byCategory.set(sum.category_id,arr); }
  const sections: AnnualTableSection[] = (["income","mandatory","optional"] as AnnualTableSectionKey[]).map(key=>({key,rows:[],totals:zeros(),average:0})); const section = new Map(sections.map(s=>[s.key,s]));
  for (const c of categories) { const key:AnnualTableSectionKey = c.kind === "income" ? "income" : c.expense_type === "mandatory" ? "mandatory" : "optional"; const amounts=byCategory.get(c.id)??zeros(); const row:AnnualTableRow={categoryId:c.id,name:c.name,amounts,average:averageFor(amounts),outliers:outliers(amounts,year)}; section.get(key)!.rows.push(row); }
  const uncategorized = byCategory.get(null); if (uncategorized) { const incomeAmounts=zeros(), expenseAmounts=zeros(); const rows=db.prepare(`SELECT CAST(substr(transaction_calendar_date(date),6,2) AS INTEGER)-1 AS month, kind, SUM(ABS(charged_amount)) AS amount FROM transactions WHERE workspace_id=? AND transaction_calendar_date(date)>=? AND transaction_calendar_date(date)<=? AND status='completed' AND is_excluded=0 AND is_deployed=0 AND kind IN ('income','expense') AND category_id IS NULL GROUP BY month,kind`).all(workspaceId,start,end) as {month:number;kind:"income"|"expense";amount:number}[]; rows.forEach(r=>(r.kind==="income"?incomeAmounts:expenseAmounts)[r.month]=r.amount); if(incomeAmounts.some(Boolean)) section.get("income")!.rows.push({categoryId:null,name:"Uncategorized",amounts:incomeAmounts,average:averageFor(incomeAmounts),outliers:Array(12).fill(null),isUncategorized:true}); if(expenseAmounts.some(Boolean)) section.get("optional")!.rows.push({categoryId:null,name:"Uncategorized",amounts:expenseAmounts,average:averageFor(expenseAmounts),outliers:Array(12).fill(null),isUncategorized:true}); }
  for (const s of sections) { for (const row of s.rows) row.amounts.forEach((a,i)=>s.totals[i]+=a); s.average=averageFor(s.totals); }
  const order = readOrder(workspaceId);
  for (const key of ["mandatory", "optional"] as const) {
    const target = section.get(key)!;
    target.rows = applyOrder(target.rows, order[key]);
  }
  const incomeTotals=section.get("income")!.totals, expenseTotals=MONTHS.map(i=>section.get("mandatory")!.totals[i]+section.get("optional")!.totals[i]);
  const years=(db.prepare(`SELECT DISTINCT CAST(substr(transaction_calendar_date(date),1,4) AS INTEGER) AS year FROM transactions WHERE workspace_id=? UNION SELECT ? ORDER BY year DESC`).all(workspaceId,new Date().getFullYear()) as {year:number}[]).map(r=>r.year);
  return {year,availableYears:years,sections,incomeTotals,expenseTotals,netTotals:MONTHS.map(i=>incomeTotals[i]-expenseTotals[i])};
}
