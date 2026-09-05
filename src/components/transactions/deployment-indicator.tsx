"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Transaction } from "@/lib/types";

interface DeploymentIndicatorProps {
  deployment: Transaction["deployment"];
  linkToOrigin?: boolean;
  className?: string;
}

export function DeploymentIndicator({
  deployment,
  linkToOrigin = true,
  className = "",
}: DeploymentIndicatorProps) {
  const t = useTranslations("transactions");
  if (!deployment) return null;

  const classes = `text-xs text-muted-foreground ${className}`.trim();
  if (deployment.role === "origin") {
    return <span className={classes}>{t("deployedAcross", { months: deployment.totalMonths })}</span>;
  }

  const label = t("deploymentMonth", {
    n: deployment.sliceIndex ?? 0,
    total: deployment.totalMonths,
  });
  if (!linkToOrigin) return <span className={classes}>{label}</span>;

  return (
    <Link
      href={`/transactions?month=${deployment.originDate.slice(0, 7)}&focus=${deployment.originId}`}
      className={`${classes} underline-offset-2 hover:underline`}
    >
      {label}
    </Link>
  );
}
