"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TransactionsPeriodSelectorProps {
  mode: "month" | "range";
  month: string;
  from: string;
  to: string;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onMonthChange: (month: string) => void;
  onRangeApply: (from: string, to: string) => void;
  onReset: () => void;
}

export function TransactionsPeriodSelector({
  mode,
  month,
  from,
  to,
  label,
  onPrev,
  onNext,
  onMonthChange,
  onRangeApply,
  onReset,
}: TransactionsPeriodSelectorProps) {
  const t = useTranslations("transactions");
  const [open, setOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"month" | "range">(mode);
  const [draftMonth, setDraftMonth] = useState(month);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setPickerMode(mode);
      setDraftMonth(month);
      setDraftFrom(from);
      setDraftTo(to);
    }
    setOpen(nextOpen);
  };

  const applyRange = () => {
    if (!draftFrom || !draftTo) return;
    const ordered = draftFrom <= draftTo
      ? [draftFrom, draftTo]
      : [draftTo, draftFrom];
    onRangeApply(ordered[0], ordered[1]);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-input bg-background px-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onPrev}
        aria-label={t("previousPeriod")}
      >
        <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
      </Button>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          className="min-w-[140px] rounded-sm px-2 py-1.5 text-center text-sm font-medium tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("changePeriod")}
        >
          {label}
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]" align="center">
          <div className="flex items-center gap-1 rounded-md bg-muted p-1">
            {(["month", "range"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPickerMode(option)}
                className={`flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                  pickerMode === option
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option === "month" ? t("periodMonth") : t("periodRange")}
              </button>
            ))}
          </div>

          {pickerMode === "month" ? (
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                {t("selectMonth")}
                <input
                  type="month"
                  value={draftMonth}
                  onChange={(event) => setDraftMonth(event.target.value)}
                  className="mt-1.5 block h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </label>
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onReset();
                    setOpen(false);
                  }}
                >
                  {t("thisMonth")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onMonthChange(draftMonth);
                    setOpen(false);
                  }}
                >
                  {t("done")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-muted-foreground">
                  {t("startMonth")}
                  <input
                    type="month"
                    value={draftFrom.slice(0, 7)}
                    onChange={(event) => setDraftFrom(event.target.value)}
                    className="mt-1.5 block h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  {t("endMonth")}
                  <input
                    type="month"
                    value={draftTo.slice(0, 7)}
                    min={draftFrom.slice(0, 7)}
                    onChange={(event) => setDraftTo(event.target.value)}
                    className="mt-1.5 block h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onReset();
                    setOpen(false);
                  }}
                >
                  {t("thisMonth")}
                </Button>
                <Button
                  size="sm"
                  disabled={!draftFrom || !draftTo}
                  onClick={applyRange}
                >
                  {t("applyRange")}
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onNext}
        aria-label={t("nextPeriod")}
      >
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
      </Button>
    </div>
  );
}

