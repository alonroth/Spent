"use client";

import { useState, useCallback } from "react";
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
  const [period, setPeriod] = useState<
    | { mode: "month"; month: string }
    | { mode: "range"; from: string; to: string }
  >(() => {
    const now = new Date();
    return { mode: "month", month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` };
  });
  const [viewMode, setViewMode] = useState<CategoryViewMode>(readViewMode);
  const queryClient = useQueryClient();

  const handleViewModeChange = useCallback((mode: CategoryViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Storage may be unavailable; in-memory state still works.
    }
  }, []);

  const monthDate = (value: string) =>
    new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1);
  const monthValue = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const selectedDate = period.mode === "month" ? monthDate(period.month) : monthDate(period.from);
  const { from, to } = period.mode === "month" ? getMonthRange(selectedDate) : period;

  const shiftPeriod = (amount: number) => {
    if (period.mode === "month") {
      setPeriod({ mode: "month", month: monthValue(addMonths(selectedDate, amount)) });
      return;
    }
    setPeriod({
      mode: "range",
      from: getMonthRange(addMonths(monthDate(period.from), amount)).from,
      to: getMonthRange(addMonths(monthDate(period.to), amount)).to,
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
    : `${formatMonth(period.from, locale)} – ${formatMonth(period.to, locale)}`;
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
              onMonthChange={(month) => setPeriod({ mode: "month", month })}
              onRangeApply={(rangeFrom, rangeTo) => setPeriod({
                mode: "range",
                from: `${rangeFrom}-01`,
                to: getMonthRange(new Date(Number(rangeTo.slice(0, 4)), Number(rangeTo.slice(5, 7)), 0)).to,
              })}
              onReset={() => setPeriod({ mode: "month", month: monthValue(new Date()) })}
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
        />
      </div>
    </>
  );
}
