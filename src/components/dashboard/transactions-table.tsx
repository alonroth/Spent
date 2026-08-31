"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MoreHorizontal,
  HelpCircle,
  Check,
  ArrowDownRight,
  ArrowUpRight,
  Wallet,
  Store,
  Tags,
  EyeOff,
  Eye,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@/lib/formatters";
import {
  updateTransactionCategory,
  setTransactionKind,
  approveTransactionCategory,
  getCategories,
  setTransactionExcluded,
  deleteManualTransaction,
  deployExpense,
  reverseExpenseDeployment,
} from "@/lib/api";
import { toast } from "sonner";
import { translateCategoryName, translateProviderName } from "@/lib/i18n-data";
import {
  getAccountDisplayLabel,
  TransactionSourceCell,
} from "@/components/transactions/transaction-source-cell";
import {
  TransactionMultiFilter,
  MultiFilterOption,
} from "@/components/transactions/transaction-multi-filter";
import {
  formatMultiFilterDisplay,
  getCategoryDescendantIds,
  isCategoryFilterChecked,
  toggleCategoryFilterSelection,
} from "@/lib/transaction-filters";
import { SortableTableHead } from "@/components/transactions/sortable-table-head";
import type { SortOrder, TransactionSortField } from "@/lib/transaction-sort";
import { cn } from "@/lib/utils";
import { ProviderBadge } from "@/components/setup/provider-badge";
import type {
  TransactionWithCategory,
  Category,
  Integration,
} from "@/lib/types";
import type { TransactionTotals } from "@/lib/api";
import { BANK_PROVIDERS } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

type Kind = "expense" | "income" | "transfer";

function isActionableReview(txn: TransactionWithCategory): boolean {
  return txn.needsReview && txn.status === "completed" && !txn.isExcluded;
}

interface TransactionsTableProps {
  transactions: TransactionWithCategory[];
  total: number;
  categories: Category[];
  integrations: Integration[];
  merchants: string[];
  loading: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  merchantFilter: string[];
  onMerchantFilterChange: (merchants: string[]) => void;
  categoryFilter: number[];
  onCategoryFilterChange: (categoryIds: number[]) => void;
  accountFilter: number[];
  onAccountFilterChange: (credentialIds: number[]) => void;
  page: number;
  onPageChange: (page: number) => void;
  sortField: TransactionSortField;
  sortOrder: SortOrder;
  onSortChange: (field: TransactionSortField) => void;
  isFetching?: boolean;
  totals?: TransactionTotals;
  totalsLoading?: boolean;
  focusId?: number;
}

const PAGE_SIZE = 300;

export function TransactionsTable({
  transactions,
  total,
  categories,
  integrations,
  merchants,
  loading,
  search,
  onSearchChange,
  merchantFilter,
  onMerchantFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  accountFilter,
  onAccountFilterChange,
  page,
  onPageChange,
  sortField,
  sortOrder,
  onSortChange,
  isFetching = false,
  totals,
  totalsLoading = false,
  focusId,
}: TransactionsTableProps) {
  const t = useTranslations("transactions");
  const tCat = useTranslations("categoriesSeeded");
  const tBanks = useTranslations("banks");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryPickerSearch, setCategoryPickerSearch] = useState("");
  const [merchantSearch, setMerchantSearch] = useState("");
  const totalPages = Math.ceil(total / PAGE_SIZE);
  useEffect(() => {
    if (!focusId) return;
    const row = document.getElementById(`transaction-${focusId}`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, transactions]);

  const otherKinds: Record<Kind, Array<{ value: Kind; label: string }>> = {
    expense: [
      { value: "income", label: t("markAsIncome") },
      { value: "transfer", label: t("markAsTransfer") },
    ],
    income: [
      { value: "expense", label: t("markAsExpense") },
      { value: "transfer", label: t("markAsTransfer") },
    ],
    transfer: [
      { value: "expense", label: t("markAsExpense") },
      { value: "income", label: t("markAsIncome") },
    ],
  };

  const handleCategoryChange = async (txnId: number, categoryId: number) => {
    setUpdatingId(txnId);
    try {
      await updateTransactionCategory(txnId, categoryId);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleKindChange = async (txnId: number, next: Kind) => {
    setUpdatingId(txnId);
    try {
      await setTransactionKind(txnId, next);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleApprove = async (txnId: number) => {
    setUpdatingId(txnId);
    try {
      await approveTransactionCategory(txnId);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    } finally {
      setUpdatingId(null);
    }
  };

  const invalidateAfterExclude = () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["excluded-merchants"] });
    queryClient.invalidateQueries({ queryKey: ["review-queue"] });
  };

  const handleExcludeToggle = async (
    txn: TransactionWithCategory,
    alwaysForMerchant = false,
  ) => {
    const nextExcluded = !txn.isExcluded;
    setUpdatingId(txn.id);
    try {
      await setTransactionExcluded(txn.id, nextExcluded, alwaysForMerchant);
      invalidateAfterExclude();
      if (nextExcluded) {
        toast.success(
          alwaysForMerchant
            ? t("excludeMerchantToast", { merchant: txn.description })
            : t("excludeToast"),
        );
      } else {
        toast.success(t("includeToast"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteManual = async (txn: TransactionWithCategory) => {
    if (!window.confirm(t("deleteManualConfirm", { description: txn.description }))) {
      return;
    }
    setUpdatingId(txn.id);
    try {
      await deleteManualTransaction(txn.id);
      invalidateAfterExclude();
      queryClient.invalidateQueries({ queryKey: ["transaction-merchants"] });
      toast.success(t("deleteManualSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteManualFailed"));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeployment = async (txn: TransactionWithCategory, months?: 6 | 12) => {
    const reversing = !months;
    if (reversing && !window.confirm(t("reverseDeploymentConfirm"))) return;
    setUpdatingId(txn.id);
    try {
      if (months) await deployExpense(txn.id, months); else await reverseExpenseDeployment(txn.id);
      invalidateAfterExclude();
      queryClient.invalidateQueries({ queryKey: ["transactions-totals"] });
      toast.success(reversing ? t("reverseDeploymentSuccess") : t("deploymentSuccess", { months }));
    } catch (err) { toast.error(err instanceof Error ? err.message : t("deploymentFailed")); }
    finally { setUpdatingId(null); }
  };

  const incomeCategoriesQuery = useQuery({
    queryKey: ["categories", "income"],
    queryFn: () => getCategories("income"),
  });
  const expenseCategoriesQuery = useQuery({
    queryKey: ["categories", "expense"],
    queryFn: () => getCategories("expense"),
  });

  const categoriesForKind = (rowKind: Kind): Category[] => {
    if (rowKind === "income") return incomeCategoriesQuery.data ?? [];
    if (rowKind === "expense") return expenseCategoriesQuery.data ?? [];
    return [];
  };

  const filteredCategoryPickerOptions = (rowKind: Kind): Category[] => {
    const query = categoryPickerSearch.trim().toLocaleLowerCase(locale);
    return categoriesForKind(rowKind).filter((category) =>
      translateCategoryName(category.name, tCat)
        .toLocaleLowerCase(locale)
        .includes(query),
    );
  };

  const accountOptions = integrations
    .map((integration) => {
      const info = BANK_PROVIDERS.find((b) => b.id === integration.provider);
      const providerName = translateProviderName(
        integration.provider,
        info?.name ?? integration.provider,
        tBanks
      );
      const { primary } = getAccountDisplayLabel(
        providerName,
        integration.label
      );
      return { integration, info, providerName, primary };
    })
    .sort((a, b) => a.primary.localeCompare(b.primary));

  const showAccountFilter = accountOptions.length > 1;

  const toggleFilterId = <T,>(ids: T[], id: T): T[] =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

  const accountLabels = accountFilter
    .map(
      (id) =>
        accountOptions.find((o) => o.integration.id === id)?.primary
    )
    .filter((name): name is string => name != null);

  const accountDisplayValue = formatMultiFilterDisplay(
    accountLabels,
    t("filterAny"),
    (count) => t("filterSelectedCount", { count })
  );

  const categoryLabels = categoryFilter
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => c != null)
    .map((c) => translateCategoryName(c.name, tCat));

  const categoryDisplayValue = formatMultiFilterDisplay(
    categoryLabels,
    t("filterAny"),
    (count) => t("filterSelectedCount", { count })
  );

  const merchantDisplayValue = formatMultiFilterDisplay(
    merchantFilter,
    t("filterAny"),
    (count) => t("filterSelectedCount", { count }),
  );
  const filteredMerchants = merchants.filter((merchant) =>
    merchant.toLocaleLowerCase(locale).includes(merchantSearch.trim().toLocaleLowerCase(locale)),
  );

  const hasActiveFilters =
    categoryFilter.length > 0 || accountFilter.length > 0 || merchantFilter.length > 0;

  const handleClearFilters = () => {
    onCategoryFilterChange([]);
    onAccountFilterChange([]);
    onMerchantFilterChange([]);
    onPageChange(0);
  };

  const allCategoryIds = [
    ...new Set(
      categories.flatMap((c) => getCategoryDescendantIds(c.id, categories))
    ),
  ];
  const allAccountIds = accountOptions.map((o) => o.integration.id);

  const renderCategoryFilterOptions = (
    parentId: number | null,
    depth: number
  ): React.ReactNode[] => {
    const normalizedSearch = categorySearch.trim().toLocaleLowerCase(locale);
    const categoryMatchesSearch = (category: Category): boolean => {
      if (!normalizedSearch) return true;
      if (translateCategoryName(category.name, tCat).toLocaleLowerCase(locale).includes(normalizedSearch)) {
        return true;
      }
      return categories
        .filter((child) => child.parentId === category.id)
        .some(categoryMatchesSearch);
    };
    const items = categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    const nodes: React.ReactNode[] = [];
    for (const cat of items) {
      const hasChildren = categories.some((c) => c.parentId === cat.id);
      const name = translateCategoryName(cat.name, tCat);
      if (!categoryMatchesSearch(cat)) continue;
      nodes.push(
        <MultiFilterOption
          key={cat.id}
          selected={isCategoryFilterChecked(
            cat.id,
            categoryFilter,
            categories
          )}
          onToggle={() =>
            onCategoryFilterChange(
              toggleCategoryFilterSelection(
                categoryFilter,
                cat.id,
                categories
              )
            )
          }
          className={depth > 0 ? "ps-2" : undefined}
        >
          <div
            className={cn(
              "flex items-center gap-2",
              hasChildren && "font-semibold"
            )}
            style={{ paddingInlineStart: depth > 0 ? depth * 12 : 0 }}
          >
            <div
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: cat.color }}
            />
            {name}
          </div>
        </MultiFilterOption>
      );
      nodes.push(...renderCategoryFilterOptions(cat.id, depth + 1));
    }
    return nodes;
  };

  return (
    <Card className="rounded-2xl border border-border bg-card shadow-none lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="font-serif text-2xl font-normal">
            {t("pageTitle")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder={t("search")}
              value={search}
              onChange={(e) => {
                onSearchChange(e.target.value);
                onPageChange(0);
              }}
              className="h-8 w-[200px]"
            />
            <TransactionMultiFilter
              label={t("filterMerchant")}
              icon={Store}
              displayValue={merchantDisplayValue}
              triggerClassName="w-[200px]"
              searchPlaceholder={t("filterMerchantSearch")}
              searchValue={merchantSearch}
              onSearchChange={setMerchantSearch}
              selectAllLabel={t("filterSelectAll")}
              clearLabel={t("filterClearSelection")}
              onSelectAll={() => onMerchantFilterChange(merchants)}
              onClear={() => onMerchantFilterChange([])}
            >
              {filteredMerchants.map((merchant) => (
                <MultiFilterOption
                  key={merchant}
                  selected={merchantFilter.includes(merchant)}
                  onToggle={() =>
                    onMerchantFilterChange(toggleFilterId(merchantFilter, merchant))
                  }
                >
                  <span className="truncate">{merchant}</span>
                </MultiFilterOption>
              ))}
            </TransactionMultiFilter>
            {showAccountFilter ? (
              <TransactionMultiFilter
                label={t("filterAccount")}
                icon={Wallet}
                displayValue={accountDisplayValue}
                triggerClassName="w-[200px]"
                selectAllLabel={t("filterSelectAll")}
                clearLabel={t("filterClearSelection")}
                onSelectAll={() => onAccountFilterChange(allAccountIds)}
                onClear={() => onAccountFilterChange([])}
              >
                {accountOptions.map(({ integration, info, primary }) => (
                  <MultiFilterOption
                    key={integration.id}
                    selected={accountFilter.includes(integration.id)}
                    onToggle={() =>
                      onAccountFilterChange(
                        toggleFilterId(accountFilter, integration.id)
                      )
                    }
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {info ? (
                        <ProviderBadge
                          color={info.color}
                          name={primary}
                          domain={info.domain}
                          size={16}
                          radius={5}
                        />
                      ) : null}
                      <span className="truncate">{primary}</span>
                    </div>
                  </MultiFilterOption>
                ))}
              </TransactionMultiFilter>
            ) : null}
            <TransactionMultiFilter
              label={t("filterCategory")}
              icon={Tags}
              displayValue={categoryDisplayValue}
              searchPlaceholder={t("filterCategorySearch")}
              searchValue={categorySearch}
              onSearchChange={setCategorySearch}
              selectAllLabel={t("filterSelectAll")}
              clearLabel={t("filterClearSelection")}
              onSelectAll={() => onCategoryFilterChange(allCategoryIds)}
              onClear={() => onCategoryFilterChange([])}
            >
              {renderCategoryFilterOptions(null, 0)}
            </TransactionMultiFilter>
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs text-muted-foreground"
                onClick={handleClearFilters}
              >
                {t("filterClear")}
              </Button>
            ) : null}
          </div>
        </div>
        {hasActiveFilters || search.trim().length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("filterScopedToList")}
          </p>
        ) : null}
      </CardHeader>
      <CardContent
        className={cn(
          isFetching &&
            !loading &&
            "opacity-60 transition-opacity duration-200"
        )}
      >
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {search || categoryFilter.length > 0 || accountFilter.length > 0 || merchantFilter.length > 0
              ? t("emptyWithFilters")
              : t("emptyNoData")}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[32px]" />
                  <SortableTableHead
                    label={t("headerDate")}
                    field="date"
                    activeField={sortField}
                    activeOrder={sortOrder}
                    onSort={onSortChange}
                    className="w-[100px]"
                    sortAscLabel={t("sortAsc")}
                    sortDescLabel={t("sortDesc")}
                  />
                  <SortableTableHead
                    label={t("headerDescription")}
                    field="description"
                    activeField={sortField}
                    activeOrder={sortOrder}
                    onSort={onSortChange}
                    sortAscLabel={t("sortAsc")}
                    sortDescLabel={t("sortDesc")}
                  />
                  <SortableTableHead
                    label={t("headerCategory")}
                    field="category_name"
                    activeField={sortField}
                    activeOrder={sortOrder}
                    onSort={onSortChange}
                    className="w-[150px]"
                    sortAscLabel={t("sortAsc")}
                    sortDescLabel={t("sortDesc")}
                  />
                  <SortableTableHead
                    label={t("headerAccount")}
                    field="account"
                    activeField={sortField}
                    activeOrder={sortOrder}
                    onSort={onSortChange}
                    className="hidden w-[130px] md:table-cell"
                    sortAscLabel={t("sortAsc")}
                    sortDescLabel={t("sortDesc")}
                  />
                  <SortableTableHead
                    label={t("headerAmount")}
                    field="charged_amount"
                    activeField={sortField}
                    activeOrder={sortOrder}
                    onSort={onSortChange}
                    className="w-[120px]"
                    align="end"
                    sortAscLabel={t("sortAsc")}
                    sortDescLabel={t("sortDesc")}
                  />
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((txn) => {
                  const isIncome = txn.chargedAmount > 0;
                  const directionColor = isIncome
                    ? "var(--status-on-track)"
                    : "var(--status-over)";
                  const categoryKind: Kind = isIncome ? "income" : "expense";
                  const categoryName = txn.categoryName
                    ? translateCategoryName(txn.categoryName, tCat)
                    : t("rowUncategorized");
                  const locked = txn.deployment !== null;
                  return (
                    <TableRow
                      key={txn.id}
                      id={`transaction-${txn.id}`}
                      className={cn(
                        "transition-colors duration-200 hover:bg-muted/50",
                        txn.isExcluded && "opacity-50",
                        txn.id === focusId && "bg-[color-mix(in_oklch,var(--status-heads-up)_18%,transparent)]",
                      )}
                    >
                      <TableCell>
                        <div style={{ color: directionColor }}>
                          {isIncome ? (
                            <ArrowUpRight className="h-4 w-4" />
                          ) : (
                            <ArrowDownRight className="h-4 w-4" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {formatDate(txn.date)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{txn.description}</div>
                          {isActionableReview(txn) && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor:
                                  "color-mix(in oklch, var(--status-heads-up) 18%, transparent)",
                                color: "var(--status-heads-up)",
                              }}
                              title={
                                txn.aiConfidence != null
                                  ? t("rowReviewTooltipConfidence", { score: txn.aiConfidence })
                                  : t("rowReviewTooltipUnsure")
                              }
                            >
                              <HelpCircle className="h-3 w-3" />
                              {t("rowReview")}
                              {txn.aiConfidence != null && (
                                <span className="ms-0.5 tabular-nums">
                                  {txn.aiConfidence}/7
                                </span>
                              )}
                            </span>
                          )}
                          {txn.deployment && (
                            txn.deployment.role === "slice" ? (
                            <Link href={`/transactions?month=${txn.deployment.originDate.slice(0, 7)}&focus=${txn.deployment.originId}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                              {t("deploymentMonth", { n: txn.deployment.sliceIndex ?? 0, total: txn.deployment.totalMonths })}
                            </Link>
                            ) : <span className="text-xs text-muted-foreground">
                              {txn.deployment.role === "origin"
                                ? t("deployedAcross", { months: txn.deployment.totalMonths })
                                : t("deploymentMonth", { n: txn.deployment.sliceIndex ?? 0, total: txn.deployment.totalMonths })}
                            </span>
                          )}
                        </div>
                        {txn.memo && (
                          <div className="text-xs text-muted-foreground">
                            {txn.memo}
                          </div>
                        )}
                        {txn.type === "installments" &&
                          txn.installmentNumber &&
                          txn.installmentTotal && (
                            <div className="text-xs text-muted-foreground">
                              {t("rowInstallment", {
                                n: txn.installmentNumber,
                                total: txn.installmentTotal,
                              })}
                            </div>
                          )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Popover>
                            <PopoverTrigger
                              className="inline-flex"
                              disabled={updatingId === txn.id || locked}
                              onClick={() => setCategoryPickerSearch("")}
                            >
                              <Badge
                                variant="outline"
                                className="cursor-pointer transition-colors hover:bg-accent"
                                style={
                                  txn.categoryColor
                                    ? {
                                        borderColor: txn.categoryColor + "40",
                                        backgroundColor: txn.categoryColor + "15",
                                        color: txn.categoryColor,
                                      }
                                    : undefined
                                }
                              >
                                {categoryName}
                              </Badge>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-64 p-0">
                              <div className="border-b border-border p-2">
                                <Input
                                  aria-label={t("filterCategorySearch")}
                                  autoFocus
                                  className="h-8"
                                  placeholder={t("filterCategorySearch")}
                                  value={categoryPickerSearch}
                                  onChange={(event) =>
                                    setCategoryPickerSearch(event.target.value)
                                  }
                                  onKeyDown={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
                                />
                              </div>
                              {filteredCategoryPickerOptions(categoryKind).map((cat) => (
                                <button
                                  type="button"
                                  key={cat.id}
                                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-start text-sm outline-none hover:bg-accent focus:bg-accent"
                                  onClick={() => {
                                    setCategoryPickerSearch("");
                                    handleCategoryChange(txn.id, cat.id);
                                  }}
                                >
                                  <div
                                    className="me-2 h-2 w-2 rounded-full"
                                    style={{ backgroundColor: cat.color }}
                                  />
                                  {translateCategoryName(cat.name, tCat)}
                                </button>
                              ))}
                              {filteredCategoryPickerOptions(categoryKind).length === 0 ? (
                                <p className="px-2 py-2 text-xs text-muted-foreground">
                                  {t("noCategorySearchResults")}
                                </p>
                              ) : null}
                            </PopoverContent>
                          </Popover>
                          {isActionableReview(txn) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleApprove(txn.id)}
                              disabled={updatingId === txn.id}
                              className="h-6 gap-1 px-2 text-[11px] font-medium"
                              style={{
                                borderColor:
                                  "color-mix(in oklch, var(--status-on-track) 35%, transparent)",
                                color: "var(--status-on-track)",
                              }}
                              title={t("rowApproveTooltip")}
                            >
                              <Check className="h-3 w-3" />
                              {t("rowApprove")}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <TransactionSourceCell
                          provider={txn.provider}
                          accountLabel={txn.accountLabel}
                        />
                      </TableCell>
                      <TableCell
                        className="text-end font-medium tabular-nums"
                        style={{ color: directionColor }}
                      >
                        {formatCurrency(txn.chargedAmount, "ILS", locale)}
                      </TableCell>
                      <TableCell className="text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            disabled={updatingId === txn.id}
                            aria-label={t("rowActions")}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {locked ? (
                              <DropdownMenuItem onClick={() => handleDeployment(txn)}>{t("reverseDeployment")}</DropdownMenuItem>
                            ) : <>
                            {otherKinds[txn.kind].map((opt) => (
                              <DropdownMenuItem
                                key={opt.value}
                                onClick={() => handleKindChange(txn.id, opt.value)}
                              >
                                {opt.label}
                              </DropdownMenuItem>
                            ))}
                            {txn.isExcluded ? (
                              <DropdownMenuItem
                                onClick={() => handleExcludeToggle(txn, false)}
                              >
                                <Eye className="me-2 h-3.5 w-3.5" />
                                {t("includeAction")}
                              </DropdownMenuItem>
                            ) : (
                              <>
                                <DropdownMenuItem
                                  onClick={() => handleExcludeToggle(txn, false)}
                                >
                                  <EyeOff className="me-2 h-3.5 w-3.5" />
                                  {t("excludeAction")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleExcludeToggle(txn, true)}
                                >
                                  <EyeOff className="me-2 h-3.5 w-3.5" />
                                  {t("excludeMerchantAction")}
                                </DropdownMenuItem>
                              </>
                            )}
                            {txn.provider === "manual" ? (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => handleDeleteManual(txn)}
                              >
                                <Trash2 className="me-2 h-3.5 w-3.5" />
                                {t("deleteManualAction")}
                              </DropdownMenuItem>
                            ) : null}
                            {txn.status === "completed" && txn.kind === "expense" && txn.type === "normal" && !txn.isExcluded && txn.source !== "recurring" ? <>
                              <DropdownMenuItem onClick={() => handleDeployment(txn, 6)}>{t("deployMonths", { months: 6 })}</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDeployment(txn, 12)}>{t("deployMonths", { months: 12 })}</DropdownMenuItem>
                            </> : null}
                            </>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <tfoot className="border-t bg-muted/50 font-medium">
                <TableRow>
                  <TableCell colSpan={5} className="text-start">
                    <span>{t("filteredTotal", { count: totals?.count ?? 0 })}</span>
                    {totals && totals.count > 0 ? (
                      <span className="ms-2 text-xs font-normal text-muted-foreground">
                        {t("filteredBreakdown", {
                          income: formatCurrency(totals.income, "ILS", locale),
                          expense: formatCurrency(totals.expense, "ILS", locale),
                        })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="text-end font-semibold tabular-nums"
                    style={{
                      color:
                        totals && totals.net >= 0
                          ? "var(--status-on-track)"
                          : "var(--status-over)",
                    }}
                  >
                    {totalsLoading ? (
                      <Skeleton className="ms-auto h-5 w-24" />
                    ) : (
                      formatCurrency(totals?.net ?? 0, "ILS", locale)
                    )}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </tfoot>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <span className="text-xs text-muted-foreground">
                  {t("paginationRange", {
                    from: page * PAGE_SIZE + 1,
                    to: Math.min((page + 1) * PAGE_SIZE, total),
                    total,
                  })}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page - 1)}
                    disabled={page === 0}
                  >
                    {t("previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages - 1}
                  >
                    {t("next")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

