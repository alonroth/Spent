"use client";

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
} from "@/lib/transaction-sort";
import {
  addMonths,
  formatMonth,
  formatMonthLabel,
  getMonthRange,
} from "@/lib/formatters";
import type { Locale } from "@/i18n/routing";
import { ManualTransactionDialog } from "./manual-transaction-dialog";
import { useUrlQueryState } from "@/hooks/use-url-query-state";
import { readEnum, readPeriod, readPositiveInteger, readPositiveIntegers, readStrings } from "@/lib/url-state";

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
    from: monthValue(start),
    to: monthValue(end),
  };
}

export function TransactionsPage() {
  const t = useTranslations("transactions");
  const locale = useLocale() as Locale;
  const { searchParams, pushQuery } = useUrlQueryState();
  const focusId = Number(searchParams.get("focus")) || undefined;
  const period = readPeriod(searchParams);
  const search = searchParams.get("q") ?? "";
  const merchantFilter = readStrings(searchParams, "merchant");
  const categoryFilter = readPositiveIntegers(searchParams, "category");
  const accountFilter = readPositiveIntegers(searchParams, "account");
  const page = readPositiveInteger(searchParams, "page", 1) - 1;
  const kind = readEnum(searchParams, "kind", ["all", "income", "expense"] as const, "all");
  const sortField = readEnum(searchParams, "sort", ["date", "description", "category_name", "account", "charged_amount"] as const, "date");
  const sortOrder = readEnum(searchParams, "order", ["asc", "desc"] as const, "desc");

  const filterOptions: { value: TransactionKindFilter; label: string }[] = [
    { value: "all", label: t("filterAll") },
    { value: "income", label: t("filterIncome") },
    { value: "expense", label: t("filterExpenses") },
  ];

  const selectedDate = period.mode === "month" ? monthDate(period.month) : monthDate(period.from);
  const monthRange = getMonthRange(selectedDate);
  const from = period.mode === "month" ? monthRange.from : `${period.from}-01`;
  const to = period.mode === "month" ? monthRange.to : getMonthRange(monthDate(period.to)).to;

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
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });

  const periodLabel = period.mode === "month"
    ? formatMonthLabel(selectedDate, locale)
    : `${formatMonth(`${period.from}-01`, locale)} – ${formatMonth(`${period.to}-01`, locale)}`;

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
                  pushQuery({ month: monthValue(date), from: null, to: null });
                } else {
                  const shifted = shiftRange(period.from, period.to, -1);
                  pushQuery({ month: null, from: shifted.from, to: shifted.to });
                }
              }}
              onNext={() => {
                if (period.mode === "month") {
                  const date = addMonths(selectedDate, 1);
                  pushQuery({ month: monthValue(date), from: null, to: null });
                } else {
                  const shifted = shiftRange(period.from, period.to, 1);
                  pushQuery({ month: null, from: shifted.from, to: shifted.to });
                }
              }}
              onMonthChange={(month) => pushQuery({ month, from: null, to: null })}
              onRangeApply={(rangeFrom, rangeTo) => pushQuery({ month: null, from: rangeFrom.slice(0, 7), to: rangeTo.slice(0, 7) })}
              onReset={() => pushQuery({ month: monthValue(new Date()), from: null, to: null })}
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
                  pushQuery({ kind: opt.value === "all" ? null : opt.value, category: null, merchant: null, page: null });
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
            merchantQuery={searchParams.get("merchantQ") ?? ""}
            onMerchantQueryChange={(value) => pushQuery({ merchantQ: value || null })}
            categoryQuery={searchParams.get("categoryQ") ?? ""}
            onCategoryQueryChange={(value) => pushQuery({ categoryQ: value || null })}
            pickerQuery={searchParams.get("pickerQ") ?? ""}
            onPickerQueryChange={(value) => pushQuery({ pickerQ: value || null })}
            sortField={sortField}
            sortOrder={sortOrder}
            onSortChange={(field) => {
              const next = nextSortState(sortField, sortOrder, field);
              pushQuery({ sort: next.field === "date" ? null : next.field, order: next.order === "desc" ? null : next.order, page: null });
            }}
            search={search}
            onSearchChange={(value) => pushQuery({ q: value || null, page: null })}
            merchantFilter={merchantFilter}
            onMerchantFilterChange={(merchants) => {
              pushQuery({ merchant: merchants, page: null });
            }}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={(ids) => {
              pushQuery({ category: ids.map(String), page: null });
            }}
            accountFilter={accountFilter}
            onAccountFilterChange={(ids) => {
              pushQuery({ account: ids.map(String), page: null });
            }}
            page={page}
            onPageChange={(nextPage) => pushQuery({ page: nextPage === 0 ? null : String(nextPage + 1) })}
          />
        </div>
      </div>
    </>
  );
}
