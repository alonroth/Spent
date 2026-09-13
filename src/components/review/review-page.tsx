"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  HelpCircle,
  Loader2,
  MoreHorizontal,
  Search,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/app-shell";
import { TransactionSourceCell } from "@/components/transactions/transaction-source-cell";
import {
  approveTransactionCategory,
  getCategories,
  getReviewQueue,
  reviewQueueQueryKey,
  setTransactionExcluded,
  updateTransactionCategory,
  type ReviewQueue,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { translateCategoryName } from "@/lib/i18n-data";
import type { Category, ReviewTransaction } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUrlQueryState } from "@/hooks/use-url-query-state";

type ReviewView =
  | { kind: "pending"; index: number }
  | { kind: "history"; index: number };

function replaceCategory(
  transaction: ReviewTransaction,
  category: Category,
): ReviewTransaction {
  return {
    ...transaction,
    categoryId: category.id,
    categoryName: category.name,
    categoryColor: category.color,
    categorySource: "user",
    needsReview: false,
  };
}

function ReviewCategoryPicker({
  current,
  categories,
  updating,
  search,
  onSearchChange,
  onCategoryChange,
}: {
  current: ReviewTransaction;
  categories: Category[];
  updating: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (category: Category) => void;
}) {
  const t = useTranslations("review");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const visibleCategories = useMemo(() => {
    const parentIds = new Set(categories.map((category) => category.parentId));
    const query = search.trim().toLocaleLowerCase(locale);
    return categories.filter((category) =>
      !parentIds.has(category.id) &&
      (!query || translateCategoryName(category.name, tCat).toLocaleLowerCase(locale).includes(query)),
    );
  }, [categories, locale, search, tCat]);

  return (
    <Popover>
      <PopoverTrigger
        className="flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        disabled={updating}
      >
        <span className="size-2.5 rounded-full" style={{ backgroundColor: current.categoryColor ?? "var(--muted-foreground)" }} />
        <span className="flex-1">{current.categoryName ? translateCategoryName(current.categoryName, tCat) : t("uncategorized")}</span>
        <Tag className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input autoFocus className="h-8 ps-8" placeholder={t("searchCategories")} value={search} onChange={(event) => onSearchChange(event.target.value)} />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {(["expense", "income"] as const).map((kind) => {
            const matchingCategories = visibleCategories.filter((category) => category.kind === kind);
            if (matchingCategories.length === 0) return null;
            return (
              <div key={kind} className="pb-1">
                <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {kind === "expense" ? t("expenseCategories") : t("incomeCategories")}
                </p>
                {matchingCategories.map((category) => (
                  <button key={category.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-start text-sm hover:bg-accent focus:bg-accent focus:outline-none" onClick={() => onCategoryChange(category)}>
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                    {translateCategoryName(category.name, tCat)}
                  </button>
                ))}
              </div>
            );
          })}
          {visibleCategories.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t("noCategories")}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ReviewPage() {
  const t = useTranslations("review");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const { searchParams, pushQuery } = useUrlQueryState();
  const pickerQuery = searchParams.get("pickerQ") ?? "";
  const [history, setHistory] = useState<ReviewTransaction[]>([]);
  const [view, setView] = useState<ReviewView>({ kind: "pending", index: 0 });
  const [updating, setUpdating] = useState(false);

  const reviewQuery = useQuery({
    queryKey: reviewQueueQueryKey,
    queryFn: getReviewQueue,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });

  const queue = reviewQuery.data?.transactions ?? [];
  const current = view.kind === "history" ? history[view.index] : queue[view.index];
  const isHistory = view.kind === "history";
  const totalResolved = history.length;
  const totalAtSessionStart = totalResolved + queue.length;

  const invalidateRelated = () => {
    queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["categories"] });
  };

  const updateHistoryCategory = (category: Category) => {
    if (view.kind !== "history" || !current) return;
    setHistory((items) =>
      items.map((item, index) => index === view.index ? replaceCategory(item, category) : item),
    );
  };

  const resolveCurrent = (
    updated: ReviewTransaction,
    removedIds = new Set([updated.id]),
  ) => {
    if (!current || isHistory) return;
    const currentIndex = view.index;
    const nextQueue = queue.filter((item) => !removedIds.has(item.id));
    setHistory((items) => [...items, updated]);
    queryClient.setQueryData<ReviewQueue>(reviewQueueQueryKey, (previous) => {
      if (!previous) return previous;
      return {
        total: Math.max(0, previous.total - removedIds.size),
        transactions: previous.transactions.filter((item) => !removedIds.has(item.id)),
      };
    });
    setView({ kind: "pending", index: Math.min(currentIndex, Math.max(0, nextQueue.length - 1)) });
  };

  const handleApprove = async () => {
    if (!current || isHistory) return;
    setUpdating(true);
    try {
      await approveTransactionCategory(current.id);
      resolveCurrent({ ...current, needsReview: false });
      invalidateRelated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setUpdating(false);
    }
  };

  const handleCategoryChange = async (category: Category) => {
    if (!current) return;
    setUpdating(true);
    try {
      await updateTransactionCategory(current.id, category.id);
      const updated = replaceCategory(current, category);
      if (isHistory) updateHistoryCategory(category);
      else resolveCurrent(updated);
      invalidateRelated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setUpdating(false);
    }
  };

  const handleExclude = async (alwaysForMerchant: boolean) => {
    if (!current || isHistory) return;
    setUpdating(true);
    try {
      await setTransactionExcluded(current.id, true, alwaysForMerchant);
      const removedIds = new Set(
        queue
          .filter((item) =>
            alwaysForMerchant
              ? item.provider === current.provider && item.description === current.description
              : item.id === current.id,
          )
          .map((item) => item.id),
      );
      resolveCurrent({ ...current, isExcluded: true, needsReview: false }, removedIds);
      queryClient.invalidateQueries({ queryKey: ["excluded-merchants"] });
      invalidateRelated();
      toast.success(alwaysForMerchant ? t("excludeMerchantSuccess") : t("excludeSuccess"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setUpdating(false);
    }
  };

  const handleSkip = () => {
    if (!current || isHistory || queue.length < 2) return;
    queryClient.setQueryData<ReviewQueue>(reviewQueueQueryKey, (previous) => {
      if (!previous) return previous;
      const remaining = previous.transactions.filter((item) => item.id !== current.id);
      return { ...previous, transactions: [...remaining, current] };
    });
    setView({ kind: "pending", index: 0 });
  };

  const goBack = () => {
    if (view.kind === "pending") {
      if (history.length > 0) setView({ kind: "history", index: history.length - 1 });
      return;
    }
    if (view.index > 0) setView({ kind: "history", index: view.index - 1 });
  };

  const goForward = () => {
    if (view.kind !== "history") return;
    if (view.index < history.length - 1) setView({ kind: "history", index: view.index + 1 });
    else setView({ kind: "pending", index: 0 });
  };

  const canGoBack = view.kind === "history" ? view.index > 0 : history.length > 0;
  const canGoForward = view.kind === "history";

  return (
    <>
      <PageHeader title={t("pageTitle")} meta={reviewQuery.data ? t("remaining", { count: reviewQuery.data.total }) : undefined} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4 md:p-6 lg:p-8">
        {reviewQuery.isPending ? <ReviewSkeleton /> : null}
        {reviewQuery.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="size-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
            <Button variant="outline" onClick={() => reviewQuery.refetch()}>{t("retry")}</Button>
          </div>
        ) : null}
        {!reviewQuery.isPending && !reviewQuery.isError && !current ? <CompleteState /> : null}
        {current ? (
          <Card className="my-auto border border-border shadow-sm">
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{isHistory ? t("reviewed") : t("reviewing")}</p>
                  <CardTitle className="mt-1 font-serif text-2xl font-normal">{current.description}</CardTitle>
                </div>
                {current.aiConfidence != null ? (
                  <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <HelpCircle className="size-3.5" />
                    {t("confidence", { score: current.aiConfidence })}
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-6 py-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t("amount")}</p>
                  <p className={cn("mt-1 text-3xl font-semibold tabular-nums", current.chargedAmount < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                    {formatCurrency(current.chargedAmount, current.chargedCurrency ?? current.originalCurrency, locale)}
                  </p>
                </div>
                <div className="text-end text-sm text-muted-foreground">
                  <p>{formatDate(current.date)}</p>
                  {current.type === "installments" && current.installmentNumber && current.installmentTotal ? (
                    <p className="mt-1">{t("installment", { current: current.installmentNumber, total: current.installmentTotal })}</p>
                  ) : null}
                </div>
              </div>

              {current.reviewReasons.length > 0 ? (
                <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  {current.reviewReasons.map((reason, index) => (
                    <p key={`${reason.type}-${index}`} className="text-amber-900 dark:text-amber-100">
                      {reason.type === "recurring_price_increase"
                        ? t("priceIncreaseReason", {
                            amount: formatCurrency(reason.previousAmount, reason.currency, locale),
                            months: reason.stableMonths,
                            percent: reason.increasePercent,
                          })
                        : t("lowConfidenceReason")}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-4 border-y border-border py-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("account")}</p>
                  <TransactionSourceCell provider={current.provider} accountLabel={current.accountLabel} />
                </div>
                {current.memo ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t("memo")}</p>
                    <p className="text-sm">{current.memo}</p>
                  </div>
                ) : null}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">{t("category")}</p>
                <ReviewCategoryPicker
                  current={current}
                  categories={categoriesQuery.data ?? []}
                  updating={updating}
                  search={pickerQuery}
                  onSearchChange={(value) => pushQuery({ pickerQ: value || null })}
                  onCategoryChange={(category) => {
                    pushQuery({ pickerQ: null });
                    handleCategoryChange(category);
                  }}
                />
                <p className="mt-2 text-xs text-muted-foreground">{isHistory ? t("reviewedCategoryHint") : t("categoryHint")}</p>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={goBack} disabled={!canGoBack || updating}><ChevronLeft className="size-4 rtl:rotate-180" />{t("back")}</Button>
                {isHistory ? <Button variant="ghost" size="sm" onClick={goForward} disabled={!canGoForward || updating}>{t("forward")}<ChevronRight className="size-4 rtl:rotate-180" /></Button> : null}
                {!isHistory ? <Button variant="ghost" size="sm" onClick={handleSkip} disabled={updating || queue.length < 2}>{t("skip")}</Button> : null}
              </div>
              {!isHistory ? (
                <div className="flex w-full gap-2 sm:w-auto">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                      disabled={updating}
                      aria-label={t("moreActions")}
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleExclude(false)}>
                        {t("excludeTransaction")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExclude(true)}>
                        {t("excludeMerchant")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button onClick={handleApprove} disabled={updating} className="min-w-32 flex-1 sm:flex-none"><>{updating ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t("approve")}</></Button>
                </div>
              ) : <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><CircleCheckBig className="size-4 text-emerald-600 dark:text-emerald-400" />{t("reviewed")}</span>}
            </CardFooter>
          </Card>
        ) : null}
        {current ? <p className="mt-5 text-center text-xs text-muted-foreground">{t("progress", { current: Math.min(totalAtSessionStart, isHistory ? view.index + 1 : totalResolved + 1), total: totalAtSessionStart })}</p> : null}
      </main>
    </>
  );

  function CompleteState() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><CircleCheckBig className="size-7" /></div>
        <h2 className="mt-4 font-serif text-2xl">{t("allDoneTitle")}</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t("allDoneDescription")}</p>
        {history.length > 0 ? (
          <Button className="mt-5" variant="outline" onClick={() => setView({ kind: "history", index: history.length - 1 })}>
            <ChevronLeft className="size-4 rtl:rotate-180" />
            {t("back")}
          </Button>
        ) : null}
      </div>
    );
  }
}

function ReviewSkeleton() {
  return <Card className="my-auto border border-border"><CardHeader><Skeleton className="h-4 w-24" /><Skeleton className="mt-2 h-8 w-48" /></CardHeader><CardContent className="space-y-6 py-5"><Skeleton className="h-16 w-40" /><Skeleton className="h-20 w-full" /><Skeleton className="h-11 w-full" /></CardContent></Card>;
}
