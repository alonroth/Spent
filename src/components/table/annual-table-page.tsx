"use client";
import { useState } from "react";
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AlertTriangle, GripVertical, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { BudgetDetailSheet } from "@/components/dashboard/budget-detail-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createRecurringTransaction,
  deleteRecurringTransaction,
  getAnnualTable,
  getCategories,
  getRecurringTransactions,
  updateAnnualTableOrder,
  updateRecurringTransaction,
} from "@/lib/api";
import { formatCurrency, formatSignedCurrency, getMonthRange } from "@/lib/formatters";
import type {
  AnnualTablePayload,
  AnnualTableRow,
  AnnualTableSection,
  AnnualTableSectionKey,
  Category,
  CategoryKind,
  RecurringTransaction,
} from "@/lib/types";
import { useUrlQueryState } from "@/hooks/use-url-query-state";
import { readPositiveInteger } from "@/lib/url-state";

const monthNames = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat(undefined, { month: "short" }).format(
    new Date(2024, i, 1),
  ),
);
export function AnnualTablePage() {
  const { searchParams, pushQuery } = useUrlQueryState();
  const currentYear = new Date().getFullYear();
  const requestedYear = readPositiveInteger(searchParams, "year", currentYear);
  const year = requestedYear >= 2000 && requestedYear <= 2100 ? requestedYear : currentYear;
  const [open, setOpen] = useState(false);
  const table = useQuery({
    queryKey: ["annual-table", year],
    queryFn: () => getAnnualTable(year),
  });
  const recurring = useQuery({
    queryKey: ["recurring-transactions"],
    queryFn: getRecurringTransactions,
  });
  return (
    <>
      <PageHeader
        title="Table"
        actions={
          <div className="flex gap-2">
            <Select
              value={String(year)}
              onValueChange={(v) => pushQuery({ year: Number(v) === currentYear ? null : v })}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(table.data?.availableYears ?? [year]).map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus />
              Recurring
            </Button>
          </div>
        }
      />
      <main className="space-y-6 p-4 md:p-6 lg:p-8">
        {table.isPending ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : table.data ? (
          <AnnualGrid key={JSON.stringify(table.data.sections)} data={table.data} />
        ) : null}
        <RecurringList rules={recurring.data ?? []} />
      </main>
      <RecurringDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
function AnnualGrid({ data }: { data: AnnualTablePayload }) {
  const [row, setRow] = useState<string | null>(null);
  const [col, setCol] = useState<number | null>(null);
  const [sections, setSections] = useState(data.sections);
  const [dragging, setDragging] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    categoryId: number;
    from: string;
    to: string;
  } | null>(null);

  const openCategory = (categoryId: number, monthIndex?: number) => {
    if (monthIndex === undefined) {
      setSelection({
        categoryId,
        from: `${data.year}-01-01`,
        to: `${data.year}-12-31`,
      });
      return;
    }
    setSelection({
      categoryId,
      ...getMonthRange(new Date(data.year, monthIndex, 1)),
    });
  };
  const reorder = (
    section: AnnualTableSectionKey,
    from: string,
    to: string,
  ) => {
    if (section !== "mandatory" && section !== "optional") return;
    const current = sections.find((s) => s.key === section)?.rows ?? [];
    const next = [...current];
    const fromIndex = next.findIndex(
      (r) =>
        (r.categoryId == null ? "uncategorized" : String(r.categoryId)) ===
        from,
    );
    const toIndex = next.findIndex(
      (r) =>
        (r.categoryId == null ? "uncategorized" : String(r.categoryId)) === to,
    );
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    const previous = sections;
    setSections((prev) =>
      prev.map((s) => (s.key === section ? { ...s, rows: next } : s)),
    );
    updateAnnualTableOrder(
      section,
      next.map((r) =>
        r.categoryId == null ? "uncategorized" : String(r.categoryId),
      ),
    ).catch(() => setSections(previous));
  };
  const hover = { row, col, setRow, setCol };
  return (
    <>
      <div className="max-h-[calc(100vh-9rem)] overflow-auto rounded-xl border bg-card">
        <table className="min-w-[1050px] w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-muted-foreground">
              <th className="sticky start-0 top-0 z-40 bg-muted/60 px-4 py-3 text-start">
                Category
              </th>
              {monthNames.map((m, i) => (
                <th
                  key={m}
                  onMouseEnter={() => setCol(i)}
                  className={`sticky top-0 z-30 px-3 py-3 text-end font-medium ${col === i ? "bg-primary/10" : "bg-muted/60"}`}
                >
                  {m}
                </th>
              ))}
              <th
                onMouseEnter={() => setCol(12)}
                className={`sticky end-0 top-0 z-40 px-4 py-3 text-end ${col === 12 ? "bg-primary/10" : "bg-muted/60"}`}
              >
                Average
              </th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <Section
                key={section.key}
                section={section}
                year={data.year}
                hover={hover}
                dragging={dragging}
                setDragging={setDragging}
                onReorder={reorder}
                onOpenCategory={openCategory}
              />
            ))}
          </tbody>
          <tfoot className="font-semibold">
            <Footer
              label="Income"
              amounts={data.incomeTotals}
              mode="income"
              hover={hover}
            />
            <Footer
              label="Expenses"
              amounts={data.expenseTotals}
              mode="expense"
              hover={hover}
            />
            <Footer
              label="Net"
              amounts={data.netTotals}
              mode="net"
              hover={hover}
            />
          </tfoot>
        </table>
      </div>
      <BudgetDetailSheet
        categoryId={selection?.categoryId ?? null}
        from={selection?.from ?? `${data.year}-01-01`}
        to={selection?.to ?? `${data.year}-12-31`}
        onClose={() => setSelection(null)}
      />
    </>
  );
}
type Hover = {
  row: string | null;
  col: number | null;
  setRow: (v: string | null) => void;
  setCol: (v: number | null) => void;
};
type AmountMode = "income" | "expense" | "net";

function formatTableAmount(amount: number, mode: AmountMode): string {
  if (mode === "expense") {
    return `${amount < 0 ? "+" : ""}${formatCurrency(amount, "ILS")}`;
  }
  if (mode === "income") {
    return amount < 0
      ? formatSignedCurrency(amount, "ILS")
      : formatCurrency(amount, "ILS");
  }
  return formatCurrency(amount, "ILS");
}
function Section({
  section,
  year,
  hover,
  dragging,
  setDragging,
  onReorder,
  onOpenCategory,
}: {
  section: AnnualTableSection;
  year: number;
  hover: Hover;
  dragging: string | null;
  setDragging: (v: string | null) => void;
  onReorder: (section: AnnualTableSectionKey, from: string, to: string) => void;
  onOpenCategory: (categoryId: number, monthIndex?: number) => void;
}) {
  const labels: Record<AnnualTableSection["key"], string> = {
    income: "Income",
    mandatory: "Mandatory expenses",
    optional: "Optional expenses",
  };
  const amountMode: AmountMode = section.key === "income" ? "income" : "expense";
  return (
    <>
      {
        <tr className="border-y bg-muted/35">
          <th
            colSpan={14}
            className="px-4 py-2 text-start text-xs uppercase tracking-wider"
          >
            {labels[section.key]}
          </th>
        </tr>
      }
      {section.rows.map((r: AnnualTableRow) => {
        const key = `${section.key}-${r.categoryId ?? "uncategorized"}`,
          id = r.categoryId == null ? "uncategorized" : String(r.categoryId),
          canDrag = section.key !== "income";
        return (
          <tr
            key={key}
            draggable={canDrag}
            onDragStart={() => canDrag && setDragging(id)}
            onDragOver={(e) => canDrag && e.preventDefault()}
            onDrop={() => {
              if (dragging && canDrag) onReorder(section.key, dragging, id);
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            onMouseEnter={() => hover.setRow(key)}
            className={`border-b last:border-b-0 ${hover.row === key ? "bg-primary/8" : ""} ${dragging === id ? "opacity-50" : ""}`}
          >
            <th
              className={`sticky start-0 z-10 px-4 py-2.5 text-start font-medium ${hover.row === key ? "bg-primary/8" : "bg-card"}`}
            >
              <span className="inline-flex items-center gap-1.5">
                {canDrag ? (
                  <GripVertical
                    aria-label="Drag to reorder"
                    className="h-4 w-4 cursor-grab text-muted-foreground"
                  />
                ) : null}
                {r.isUncategorized && (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                )}
                {r.categoryId != null ? (
                  <button
                    type="button"
                    className="cursor-pointer text-start underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => onOpenCategory(r.categoryId!)}
                  >
                    {r.name}
                  </button>
                ) : (
                  r.name
                )}
              </span>
            </th>
            {r.amounts.map((a, i) => (
              <td
                key={i}
                onMouseEnter={() => hover.setCol(i)}
                title={
                  r.outliers[i]
                    ? `Unusually ${r.outliers[i]} for this category`
                    : undefined
                }
                className={`${r.categoryId != null ? "p-0" : "px-3 py-2.5"} text-end tabular-nums ${r.outliers[i] === "high" ? "bg-destructive/10 text-destructive" : r.outliers[i] === "low" ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : hover.col === i ? "bg-primary/8" : ""}`}
                style={amountMode === "expense" && a < 0 ? { color: "var(--status-on-track)" } : undefined}
              >
                {r.categoryId != null ? (
                  <button
                    type="button"
                    aria-label={`Open ${r.name} for ${monthNames[i]} ${year}`}
                    className="block w-full cursor-pointer px-3 py-2.5 text-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    style={amountMode === "expense" && a < 0 ? { color: "var(--status-on-track)" } : undefined}
                    onClick={() => onOpenCategory(r.categoryId!, i)}
                  >
                    {a ? formatTableAmount(a, amountMode) : "—"}
                  </button>
                ) : (
                  a ? (
                    <span style={amountMode === "expense" && a < 0 ? { color: "var(--status-on-track)" } : undefined}>
                      {formatTableAmount(a, amountMode)}
                    </span>
                  ) : "—"
                )}
              </td>
            ))}
            <td
              onMouseEnter={() => hover.setCol(12)}
              className={`sticky end-0 z-10 px-4 py-2.5 text-end tabular-nums ${hover.col === 12 ? "bg-primary/10" : "bg-card"}`}
            >
              <span style={amountMode === "expense" && r.average < 0 ? { color: "var(--status-on-track)" } : undefined}>
                {formatTableAmount(r.average, amountMode)}
              </span>
            </td>
          </tr>
        );
      })}
      <tr className="border-b bg-muted/35 font-medium">
        <th className="sticky start-0 z-10 bg-muted/35 px-4 py-2.5 text-start">
          Subtotal
        </th>
        {section.totals.map((a: number, i: number) => (
          <td
            key={i}
            onMouseEnter={() => hover.setCol(i)}
            className={`px-3 py-2.5 text-end tabular-nums ${hover.col === i ? "bg-primary/10" : ""}`}
          >
            <span style={amountMode === "expense" && a < 0 ? { color: "var(--status-on-track)" } : undefined}>
              {formatTableAmount(a, amountMode)}
            </span>
          </td>
        ))}
        <td
          onMouseEnter={() => hover.setCol(12)}
          className={`sticky end-0 z-10 px-4 py-2.5 text-end tabular-nums ${hover.col === 12 ? "bg-primary/10" : "bg-muted/35"}`}
        >
          <span style={amountMode === "expense" && section.average < 0 ? { color: "var(--status-on-track)" } : undefined}>
            {formatTableAmount(section.average, amountMode)}
          </span>
        </td>
      </tr>
    </>
  );
}
function Footer({
  label,
  amounts,
  mode,
  hover,
}: {
  label: string;
  amounts: number[];
  mode: AmountMode;
  hover: Hover;
}) {
  return (
    <tr
      onMouseEnter={() => hover.setRow(`footer-${label}`)}
      className={label === "Net" ? "border-t-2" : ""}
    >
      <th
        className={`sticky start-0 z-10 px-4 py-3 text-start ${hover.row === `footer-${label}` ? "bg-primary/8" : "bg-card"}`}
      >
        {label}
      </th>
      {amounts.map((a, i) => (
        <td
          key={i}
          onMouseEnter={() => hover.setCol(i)}
          className={`px-3 py-3 text-end tabular-nums ${label === "Net" && a < 0 ? "text-destructive" : ""} ${hover.col === i ? "bg-primary/10" : ""}`}
        >
          <span style={mode === "expense" && a < 0 ? { color: "var(--status-on-track)" } : undefined}>
            {formatTableAmount(a, mode)}
          </span>
        </td>
      ))}
      <td
        className={`sticky end-0 z-10 ${hover.col === 12 ? "bg-primary/10" : "bg-card"}`}
      />
    </tr>
  );
}
async function invalidateRecurringLedgerQueries(qc: QueryClient) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["recurring-transactions"] }),
    qc.invalidateQueries({ queryKey: ["annual-table"] }),
    qc.invalidateQueries({ queryKey: ["transactions"] }),
    qc.invalidateQueries({ queryKey: ["transaction-merchants"] }),
    qc.invalidateQueries({ queryKey: ["transactions-totals"] }),
    qc.invalidateQueries({ queryKey: ["transactions-summary"] }),
    qc.invalidateQueries({ queryKey: ["summary"] }),
    qc.invalidateQueries({ queryKey: ["home"] }),
    qc.invalidateQueries({ queryKey: ["categories"] }),
    qc.invalidateQueries({ queryKey: ["category-detail"] }),
    qc.invalidateQueries({ queryKey: ["review-queue"] }),
  ]);
}

function RecurringList({ rules }: { rules: RecurringTransaction[] }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: deleteRecurringTransaction,
    onSuccess: () => invalidateRecurringLedgerQueries(qc),
  });
  const toggle = useMutation({
    mutationFn: (r: RecurringTransaction) =>
      updateRecurringTransaction(r.id, {
        description: r.description,
        amount: r.amount,
        kind: r.kind,
        categoryId: r.categoryId,
        startMonth: r.startMonth,
        endMonth: r.endMonth,
        active: !r.active,
      }),
    onSuccess: () => invalidateRecurringLedgerQueries(qc),
  });
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="font-medium">Recurring transactions</h2>
      {rules.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No recurring transactions yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <span
                className={
                  !r.active ? "text-muted-foreground line-through" : ""
                }
              >
                {r.description} · {formatCurrency(r.amount, "ILS")} ·{" "}
                {r.startMonth}
              </span>
              <span className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggle.mutate(r)}
                >
                  {r.active ? "Stop" : "Restart"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete recurring transaction"
                  onClick={() => {
                    if (
                      confirm(
                        "Delete this rule and all generated transactions?",
                      )
                    )
                      del.mutate(r.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function RecurringDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const cats = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });
  const [kind, setKind] = useState<CategoryKind>("expense"),
    [description, setDescription] = useState(""),
    [amount, setAmount] = useState(""),
    [categoryId, setCategoryId] = useState(""),
    [startMonth, setStartMonth] = useState(
      new Date().toISOString().slice(0, 7),
    ),
    [endMonth, setEndMonth] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createRecurringTransaction({
        description,
        amount: Number(amount),
        kind,
        categoryId: Number(categoryId),
        startMonth,
        endMonth: endMonth || null,
      }),
    onSuccess: (rule) => {
      qc.setQueryData<RecurringTransaction[]>(
        ["recurring-transactions"],
        (current = []) => [...current, rule].sort((a, b) =>
          Number(b.active) - Number(a.active) ||
          a.description.localeCompare(b.description),
        ),
      );
      void invalidateRecurringLedgerQueries(qc);
      onOpenChange(false);
    },
  });
  const eligible = (cats.data ?? []).filter(
    (c: Category) =>
      c.kind === kind && !cats.data?.some((x: Category) => x.parentId === c.id),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New recurring transaction</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label>
            Description
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Label>
          <Label>
            Type
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind((v ?? "expense") as CategoryKind);
                setCategoryId("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <Label>
            Amount
            <Input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Label>
          <Label>
            Category
            <Select
              value={categoryId}
              onValueChange={(v) => setCategoryId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a category">
                  {(value: string) =>
                    eligible.find((category) => String(category.id) === value)?.name ??
                    "Choose a category"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {eligible.map((c: Category) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label>
            Start month
            <Input
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
            />
          </Label>
          <Label>
            End month (optional)
            <Input
              type="month"
              value={endMonth}
              onChange={(e) => setEndMonth(e.target.value)}
            />
          </Label>
          <p className="text-xs text-muted-foreground">
            Creates ledger transactions on the first of each month.
            Bank-imported duplicates are not detected.
          </p>
          <Button
            className="w-full"
            disabled={
              !description || !amount || !categoryId || mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            Create recurring transaction
          </Button>
          {mutation.isError ? (
            <p className="text-sm text-destructive">
              {(mutation.error as Error).message}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
