"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { getSummary } from "@/lib/api";
import { getMonthRange, formatMonth, formatMonthLabel, addMonths } from "@/lib/formatters";
import { PageHeader } from "@/components/layout/app-shell";
import { HeroCard } from "./hero-card";
import { CategoryGrid } from "./category-grid";
import { TransactionsPeriodSelector } from "@/components/transactions/transactions-period-selector";
import { SyncButton } from "./sync-button";
import { CategorizeButton } from "./categorize-button";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CategoryViewMode } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { useUrlQueryState } from "@/hooks/use-url-query-state";
import { readEnum, readPeriod } from "@/lib/url-state";

const VIEW_MODE_KEY = "spent.dashboard.viewMode";

function readViewMode(): CategoryViewMode {
  if (typeof window === "undefined") return "collapsed";
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    return raw === "expanded" ? "expanded" : "collapsed";
  } catch {
    return "collapsed";
  }
}

export function Dashboard() {
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;
  const { searchParams, pushQuery } = useUrlQueryState();
  const period = readPeriod(searchParams);
  const urlViewMode = searchParams.get("view");
  const viewMode = urlViewMode === "expanded" || urlViewMode === "collapsed" ? urlViewMode : readViewMode();
  const filter = readEnum(searchParams, "status", ["all", "needs-action", "on-track", "heads-up", "over", "plenty-left"] as const, "all");
  const sort = readEnum(searchParams, "sort", ["budgeted-first", "most-spent", "least-spent", "alphabetical", "over-pace"] as const, "most-spent");
  const queryClient = useQueryClient();

  const handleViewModeChange = useCallback((mode: CategoryViewMode) => {
    pushQuery({ view: mode });
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Storage may be unavailable; in-memory state still works.
    }
  }, [pushQuery]);

  useEffect(() => {
    if (urlViewMode !== "expanded" && urlViewMode !== "collapsed") return;
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, urlViewMode);
    } catch {
      // Storage may be unavailable; URL state still works.
    }
  }, [urlViewMode]);

  const monthDate = (value: string) =>
    new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1);
  const monthValue = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const selectedDate = period.mode === "month" ? monthDate(period.month) : monthDate(period.from);
  const { from, to } = period.mode === "month"
    ? getMonthRange(selectedDate)
    : { from: `${period.from}-01`, to: getMonthRange(monthDate(period.to)).to };

  const shiftPeriod = (amount: number) => {
    if (period.mode === "month") {
      pushQuery({ month: monthValue(addMonths(selectedDate, amount)), from: null, to: null });
      return;
    }
    pushQuery({
      month: null,
      from: monthValue(addMonths(monthDate(period.from), amount)),
      to: monthValue(addMonths(monthDate(period.to), amount)),
    });
  };

  const summaryQuery = useQuery({
    queryKey: ["summary", from, to],
    queryFn: () => getSummary({ from, to }),
  });

  const handleSyncComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    queryClient.invalidateQueries({ queryKey: ["review-queue"] });
  }, [queryClient]);

  const monthLabel = period.mode === "month"
    ? formatMonthLabel(selectedDate, locale)
    : `${formatMonth(`${period.from}-01`, locale)} – ${formatMonth(`${period.to}-01`, locale)}`;
  const summary = summaryQuery.data;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        meta={monthLabel}
        actions={
          <>
            <TransactionsPeriodSelector
              mode={period.mode}
              month={period.mode === "month" ? period.month : period.from.slice(0, 7)}
              from={from}
              to={to}
              label={monthLabel}
              onPrev={() => shiftPeriod(-1)}
              onNext={() => shiftPeriod(1)}
              onMonthChange={(month) => pushQuery({ month, from: null, to: null })}
              onRangeApply={(rangeFrom, rangeTo) => pushQuery({ month: null, from: rangeFrom.slice(0, 7), to: rangeTo.slice(0, 7) })}
              onReset={() => pushQuery({ month: monthValue(new Date()), from: null, to: null })}
            />
            <CategorizeButton onApplied={handleSyncComplete} />
            <SyncButton onComplete={handleSyncComplete} />
          </>
        }
      />

      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <AINotConnectedBanner />
        <HeroCard
          data={summary}
          loading={summaryQuery.isLoading}
          monthLabel={monthLabel}
        />

        <div className="flex items-center justify-end">
          <Tabs
            value={viewMode}
            onValueChange={(v) =>
              handleViewModeChange(v === "expanded" ? "expanded" : "collapsed")
            }
          >
            <TabsList>
              <TabsTrigger value="collapsed">{t("viewModeGrouped")}</TabsTrigger>
              <TabsTrigger value="expanded">{t("viewModeAll")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <CategoryGrid
          categories={summary?.categoriesWithData ?? []}
          loading={summaryQuery.isLoading}
          periodTotal={summary?.periodTotal ?? 0}
          from={from}
          to={to}
          viewMode={viewMode}
          filter={filter}
          onFilterChange={(next) => pushQuery({ status: next === "all" ? null : next })}
          sort={sort}
          onSortChange={(next) => pushQuery({ sort: next === "most-spent" ? null : next })}
        />
      </div>
    </>
  );
}
