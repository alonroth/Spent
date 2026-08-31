"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, ExternalLink, ShieldCheck, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionShell, SettingCard } from "@/components/settings/section-shell";
import { getSettings, updateSettings } from "@/lib/api";

export default function SecuritySettingsPage() {
  const t = useTranslations("settings.security");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      updateSettings({
        remoteAccessEnabled: enabled,
        ...(enabled
          ? {
              remoteAccessPassword: password,
              remoteAccessPasswordConfirmation: confirmation,
            }
          : {}),
      }),
    onSuccess: () => {
      setPassword("");
      setConfirmation("");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success(tCommon("saved"));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    },
  });

  const remote = settings?.remoteAccess;
  const canEnable = password.length >= 12 && password === confirmation;

  return (
    <SectionShell title={t("title")} description={t("description")}>
      <SettingCard
        title={t("cardTitle")}
        description={t("cardDescription")}
      >
        <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/20 p-4">
          {remote?.enabled && remote.running ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="font-medium">
              {remote?.enabled && remote.running ? t("statusOn") : t("statusOff")}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {remote?.enabled && !remote.running ? t("statusError") : t("statusHint")}
            </p>
          </div>
        </div>

        {remote?.url ? (
          <div className="mt-4 space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div>
              <Label htmlFor="remote-url">{t("urlLabel")}</Label>
              <div className="mt-1 flex gap-2">
                <Input id="remote-url" readOnly value={remote.url} className="font-mono text-xs" />
                <Button variant="outline" size="icon" aria-label={t("copyUrl")} onClick={() => void navigator.clipboard?.writeText(remote.url ?? "")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {remote.certificateUrl ? (
              <a className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4" href={remote.certificateUrl}>
                {t("downloadCertificate")} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-muted-foreground">
          <p>{t("warningTrustedNetwork")}</p>
          <p className="mt-2">{t("warningDisablePublicWifi")}</p>
          <p className="mt-2">{t("certificateHint")}</p>
        </div>

        <div className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="remote-password">{t("passwordLabel")}</Label>
            <Input
              id="remote-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("passwordPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="remote-password-confirm">{t("confirmPasswordLabel")}</Label>
            <Input
              id="remote-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {remote?.enabled ? (
            <Button variant="outline" onClick={() => mutation.mutate(false)} disabled={mutation.isPending}>
              {t("disable")}
            </Button>
          ) : null}
          <Button onClick={() => mutation.mutate(true)} disabled={!canEnable || mutation.isPending}>
            {mutation.isPending ? tCommon("saving") : remote?.configured ? t("enableOrUpdate") : t("enable")}
          </Button>
        </div>
      </SettingCard>
    </SectionShell>
  );
}
