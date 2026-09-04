"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  TableProperties,
  Settings as SettingsIcon,
  Star,
  ClipboardCheck,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { getReviewQueue, reviewQueueQueryKey } from "@/lib/api";

interface NavDef {
  href: string;
  labelKey: string;
  Icon: React.ComponentType<{ className?: string }>;
  match: (p: string) => boolean;
}

const NAV: NavDef[] = [
  {
    href: "/",
    labelKey: "home",
    Icon: LayoutDashboard,
    match: (p: string) => p === "/",
  },
  {
    href: "/table",
    labelKey: "table",
    Icon: TableProperties,
    match: (p: string) => p.startsWith("/table"),
  },
  {
    href: "/budget",
    labelKey: "budget",
    Icon: Wallet,
    match: (p: string) => p.startsWith("/budget"),
  },
  {
    href: "/transactions",
    labelKey: "transactions",
    Icon: ArrowLeftRight,
    match: (p: string) => p.startsWith("/transactions"),
  },
  {
    href: "/review",
    labelKey: "review",
    Icon: ClipboardCheck,
    match: (p: string) => p.startsWith("/review"),
  },
];

const FOOTER_NAV: NavDef[] = [
  {
    href: "/settings",
    labelKey: "settings",
    Icon: SettingsIcon,
    match: (p: string) => p.startsWith("/settings"),
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const reviewQueue = useQuery({
    queryKey: reviewQueueQueryKey,
    queryFn: getReviewQueue,
  });
  const reviewCount = reviewQueue.data?.total ?? 0;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 pb-1 pt-3">
        <Link
          href="/"
          className="-mx-1 flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors duration-200 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          <img
            src="/logo_lightmode.svg"
            alt="Spent"
            className="h-7 w-auto shrink-0 dark:hidden"
          />
          <img
            src="/logo_darkmode.svg"
            alt="Spent"
            className="hidden h-7 w-auto shrink-0 dark:block"
          />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="font-serif text-[17px] font-semibold leading-tight tracking-tight">
              Spent
            </div>
            <div className="mt-px text-[10px] font-semibold leading-tight tracking-[0.08em] text-muted-foreground">
              {t("brandTagline")}
            </div>
          </div>
        </Link>
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const label = t(item.labelKey);
                const isReview = item.href === "/review";
                const disabled = isReview && reviewCount === 0;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={disabled ? (
                        <button type="button" aria-label={label}>
                          <item.Icon />
                          <span>{label}</span>
                          <ReviewBadge count={reviewCount} />
                        </button>
                      ) : (
                        <Link href={item.href}>
                          <item.Icon />
                          <span>{label}</span>
                          {isReview ? <ReviewBadge count={reviewCount} /> : null}
                        </Link>
                      )}
                      isActive={item.match(pathname)}
                      tooltip={label}
                      disabled={disabled}
                    />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {FOOTER_NAV.map((item) => {
                const label = t(item.labelKey);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={
                        <Link href={item.href}>
                          <item.Icon />
                          <span>{label}</span>
                        </Link>
                      }
                      isActive={item.match(pathname)}
                      tooltip={label}
                    />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <a
                  href="https://github.com/Shaya16/Spent"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Star />
                  <span>{t("starOnGitHub")}</span>
                </a>
              }
              tooltip={t("starOnGitHub")}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function ReviewBadge({ count }: { count: number }) {
  return (
    <span
      aria-label={String(count)}
      className="ms-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:end-0.5 group-data-[collapsible=icon]:top-0.5"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
