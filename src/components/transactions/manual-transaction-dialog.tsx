"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { createManualTransaction, getCategories } from "@/lib/api";
import type { Category, CategoryKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function ManualTransactionDialog() {
  const t = useTranslations("transactions");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const categoriesQuery = useQuery({ queryKey: ["categories", "manual", kind], queryFn: () => getCategories(kind) });
  const categories = useMemo(
    () => (categoriesQuery.data ?? []).filter((category: Category) => !categoriesQuery.data?.some((child) => child.parentId === category.id)),
    [categoriesQuery.data],
  );

  const reset = () => {
    setDate(today());
    setDescription("");
    setAmount("");
    setMemo("");
    setCategoryId("");
    setKind("expense");
  };

  const save = async () => {
    const parsedAmount = Number(amount);
    if (!date || !description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    setSaving(true);
    try {
      await createManualTransaction({ date, description, amount: parsedAmount, kind, categoryId: categoryId ? Number(categoryId) : null, memo });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["transaction-merchants"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
        queryClient.invalidateQueries({ queryKey: ["home"] }),
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
      ]);
      toast.success(t("manualSaved"));
      setOpen(false);
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("manualSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const valid = date && description.trim() && Number(amount) > 0;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus />{t("addManual")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("manualTitle")}</DialogTitle>
            <DialogDescription>{t("manualDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Label className="flex-col items-stretch gap-2">{t("manualType")}
                <Select value={kind} onValueChange={(value) => { setKind((value ?? "expense") as CategoryKind); setCategoryId(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="expense">{t("filterExpenses")}</SelectItem><SelectItem value="income">{t("filterIncome")}</SelectItem></SelectContent>
                </Select>
              </Label>
              <Label className="flex-col items-stretch gap-2">{t("headerDate")}
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </Label>
            </div>
            <Label className="flex-col items-stretch gap-2">{t("headerDescription")}
              <Input autoFocus value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("manualDescriptionPlaceholder")} />
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <Label className="flex-col items-stretch gap-2">{t("headerAmount")}
                <Input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
              </Label>
              <Label className="flex-col items-stretch gap-2">{t("headerCategory")}
                <Select value={categoryId} onValueChange={(value) => setCategoryId(value ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("manualNoCategory")}>
                      {(value: string) =>
                        categories.find((category) => String(category.id) === value)?.name ??
                        t("manualNoCategory")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>{categories.map((category) => <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>)}</SelectContent>
                </Select>
              </Label>
            </div>
            <Label className="flex-col items-stretch gap-2">{t("manualMemo")}
              <Input value={memo} onChange={(event) => setMemo(event.target.value)} />
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>{t("manualCancel")}</Button>
            <Button onClick={save} disabled={!valid || saving}>{saving ? t("manualSaving") : t("manualSave")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

