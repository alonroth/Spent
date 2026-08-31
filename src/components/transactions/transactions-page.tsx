"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/app-shell";
import { TransactionsTable } from "@/components/dashboard/transactions-table";
import { TransactionsPeriodSelector } from "./transactions-period-selector";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { KpiCards } from "./kpi-cards";
import { WidgetsRow } from "./widgets-row";
import {
  getCategories,
  getTransactions,
  getTransactionTotals,
  getTransactionMerchants,
  getTransactionsSummary,
  listIntegrations,
} from "@/lib/api";
import type { TransactionKindFilter } from "@/lib/api";
import { expandCategoryFilterIds } from "@/lib/transaction-filters";
import {
  nextSortState,
  type SortOrder,
  type TransactionSortField,
} from "@/lib/transaction-sort";
import {
  addMonths,
  formatMonth,
  formatMonthLabel,
  getMonthRange,
} from "@/lib/formatters";
import type { Locale } from "@/i18n/routing";
import { ManualTransactionDialog } from "./manual-transaction-dialog";

function monthDate(value: string): Date {
  return new Date(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    1,
  );
}

function monthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftRange(from: string, to: string, amount: number) {
  const start = addMonths(monthDate(from), amount);
  const end = addMonths(monthDate(to), amount);
  return {
    from: getMonthRange(start).from,
    to: getMonthRange(end).to,
  };
}

export function TransactionsPage() {
  const t = useTranslations("transactions");
  const locale = useLocale() as Locale;
  const searchParams = useSearchParams();
  const requestedMonth = searchParams.get("month");
  const focusId = Number(searchParams.get("focus")) || undefined;
  const [period, setPeriod] = useState<
    | { mode: "month"; month: string }
    | { mode: "range"; from: string; to: string }
  >(() => {
    const now = new Date();
    const month = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : undefined;
    return {
      mode: "month",
      month: month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    };
  });
  const [search, setSearch] = useState("");
  const [merchantFilter, setMerchantFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<number[]>([]);
  const [accountFilter, setAccountFilter] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState<TransactionKindFilter>("all");
  const [sortField, setSortField] = useState<TransactionSortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const filterOptions: { value: TransactionKindFilter; label: string }[] = [
    { value: "all", label: t("filterAll") },
    { value: "income", label: t("filterIncome") },
    { value: "expense", label: t("filterExpenses") },
  ];

  const selectedDate = period.mode === "month" ? monthDate(period.month) : monthDate(period.from);
  const monthRange = getMonthRange(selectedDate);
  const from = period.mode === "month" ? monthRange.from : period.from;
  const to = period.mode === "month" ? monthRange.to : period.to;

  const allCategoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => listIntegrations(),
  });

  const expandedCategoryIds = expandCategoryFilterIds(
    categoryFilter,
    allCategoriesQuery.data ?? []
  );

  const merchantsQuery = useQuery({
    queryKey: ["transaction-merchants", from, to, kind],
    queryFn: () => getTransactionMerchants({ from, to, kind }),
  });

  const transactionsQuery = useQuery({
    queryKey: [
      "transactions",
      from,
      to,
      search,
      merchantFilter,
      categoryFilter,
      accountFilter,
      page,
      kind,
      sortField,
      sortOrder,
    ],
    queryFn: () =>
      getTransactions({
        from,
        to,
        search: search || undefined,
        merchants: merchantFilter.length > 0 ? merchantFilter : undefined,
        categoryIds: expandedCategoryIds,
        credentialIds:
          accountFilter.length > 0 ? accountFilter : undefined,
        limit: 300,
        offset: page * 300,
        kind,
        sort: sortField,
        order: sortOrder,
      }),
    placeholderData: keepPreviousData,
  });

  const totalsQuery = useQuery({
    queryKey: [
      "transactions-totals",
      from,
      to,
      search,
      merchantFilter,
      expandedCategoryIds,
      accountFilter,
      kind,
    ],
    queryFn: () =>
      getTransactionTotals({
        from,
        to,
        search: search || undefined,
        merchants: merchantFilter.length > 0 ? merchantFilter : undefined,
        categoryIds: expandedCategoryIds,
        credentialIds: accountFilter.length > 0 ? accountFilter : undefined,
        kind,
      }),
    placeholderData: keepPreviousData,
  });

  const summaryQuery = useQuery({
    queryKey: ["transactions-summary", from, to],
    queryFn: () => getTransactionsSummary({ from, to }),
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories", kind === "income" ? "income" : "expense"],
    queryFn: () =>
      kind === "income" ? getCategories("income") : getCategories("expense"),
  });

  const periodLabel = period.mode === "month"
    ? formatMonthLabel(selectedDate, locale)
    : `${formatMonth(period.from, locale)} – ${formatMonth(period.to, locale)}`;

  const summaryInitialLoading =
    summaryQuery.isPending && summaryQuery.data === undefined;
  const tableInitialLoading =
    transactionsQuery.isPending && transactionsQuery.data === undefined;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        meta={periodLabel}
        actions={
          <div className="flex items-center gap-2">
            <TransactionsPeriodSelector
              mode={period.mode}
              month={period.mode === "month" ? period.month : period.from.slice(0, 7)}
              from={from}
              to={to}
              label={periodLabel}
              onPrev={() => {
                if (period.mode === "month") {
                  const date = addMonths(selectedDate, -1);
                  setPeriod({ mode: "month", month: monthValue(date) });
                } else {
                  const shifted = shiftRange(period.from, period.to, -1);
                  setPeriod({ mode: "range", ...shifted });
                }
              }}
              onNext={() => {
                if (period.mode === "month") {
                  const date = addMonths(selectedDate, 1);
                  setPeriod({ mode: "month", month: monthValue(date) });
                } else {
                  const shifted = shiftRange(period.from, period.to, 1);
                  setPeriod({ mode: "range", ...shifted });
                }
              }}
              onMonthChange={(month) => setPeriod({ mode: "month", month })}
              onRangeApply={(rangeFrom, rangeTo) => setPeriod({ mode: "range", from: `${rangeFrom}-01`, to: getMonthRange(new Date(Number(rangeTo.slice(0, 4)), Number(rangeTo.slice(5, 7)), 0)).to })}
              onReset={() => {
                const now = new Date();
                setPeriod({ mode: "month", month: monthValue(now) });
              }}
            />
            <ManualTransactionDialog />
          </div>
        }
      />

      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <AINotConnectedBanner />
        <KpiCards summary={summaryQuery.data} loading={summaryInitialLoading} />

        <WidgetsRow
          summary={summaryQuery.data}
          loading={summaryInitialLoading}
        />

        <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-border bg-card p-1 w-fit">
          {filterOptions.map((opt) => {
            const active = kind === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setKind(opt.value);
                  setPage(0);
                  setCategoryFilter([]);
                  setMerchantFilter([]);
                }}
                className={
                  active
                    ? "rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-colors"
                    : "rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <TransactionsTable
            focusId={focusId}
            transactions={transactionsQuery.data?.transactions ?? []}
            total={transactionsQuery.data?.total ?? 0}
            categories={categoriesQuery.data ?? []}
            integrations={integrationsQuery.data ?? []}
            merchants={merchantsQuery.data ?? []}
            loading={tableInitialLoading}
            isFetching={transactionsQuery.isFetching}
            totals={totalsQuery.data}
            totalsLoading={totalsQuery.isPending && totalsQuery.data === undefined}
            sortField={sortField}
            sortOrder={sortOrder}
            onSortChange={(field) => {
              const next = nextSortState(sortField, sortOrder, field);
              setSortField(next.field);
              setSortOrder(next.order);
              setPage(0);
            }}
            search={search}
            onSearchChange={setSearch}
            merchantFilter={merchantFilter}
            onMerchantFilterChange={(merchants) => {
              setMerchantFilter(merchants);
              setPage(0);
            }}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={(ids) => {
              setCategoryFilter(ids);
              setPage(0);
            }}
            accountFilter={accountFilter}
            onAccountFilterChange={(ids) => {
              setAccountFilter(ids);
              setPage(0);
            }}
            page={page}
            onPageChange={setPage}
          />
        </div>
      </div>
    </>
  );
}

