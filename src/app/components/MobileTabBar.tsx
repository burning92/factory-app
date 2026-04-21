"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  LayoutDashboard,
  Package,
  Boxes,
  CalendarDays,
  User,
  Inbox,
  Factory,
  Layers,
  ListOrdered,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const TAB_HOME = { href: "/", label: "홈", Icon: Home };
const TAB_PRODUCTION = { href: "/production", label: "생산", Icon: Package };
const TAB_MATERIALS = { href: "/materials", label: "원부자재", Icon: Boxes };
const TAB_DAILY = { href: "/daily", label: "데일리", Icon: CalendarDays };
/** 임원 대시보드 (/executive 및 하위 상세) — 100 조직 보기 시 전원 */
const TAB_EXECUTIVE = { href: "/executive", label: "대시보드", Icon: LayoutDashboard };
const TAB_ACCOUNT = { href: "/account", label: "계정", Icon: User };
const TAB_HARANG_INBOUND = { href: "/harang/inbound", label: "입고", Icon: Inbox };
const TAB_HARANG_PRODUCTION = { href: "/harang/production-input", label: "생산", Icon: Factory };
const TAB_HARANG_INVENTORY = { href: "/harang/inventory", label: "재고", Icon: Layers };
const TAB_HARANG_REQUESTS = { href: "/harang/production-requests", label: "요청", Icon: ListOrdered };

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function MobileTabBar() {
  const pathname = usePathname();
  const { viewOrganizationCode, profile } = useAuth();
  const viewIsHarang = viewOrganizationCode === "200";
  const isRestrictedWorker = profile?.role === "worker";

  const tabs = viewIsHarang
    ? [
        TAB_HOME,
        TAB_HARANG_INBOUND,
        TAB_HARANG_INVENTORY,
        TAB_HARANG_REQUESTS,
        TAB_HARANG_PRODUCTION,
        TAB_ACCOUNT,
      ]
    : isRestrictedWorker
      ? [TAB_HOME, TAB_PRODUCTION, TAB_MATERIALS, TAB_EXECUTIVE, TAB_ACCOUNT]
      : [TAB_HOME, TAB_PRODUCTION, TAB_MATERIALS, TAB_DAILY, TAB_EXECUTIVE, TAB_ACCOUNT];

  return (
    <nav
      className={
        viewIsHarang
          ? "md:hidden print:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-slate-600/45 bg-slate-800/95 backdrop-blur-md"
          : "md:hidden print:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-slate-700/60 bg-space-900/98 backdrop-blur"
      }
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
      role="navigation"
      aria-label="하단 메뉴"
    >
      {tabs.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-2 min-w-0 flex-1 text-[10px] font-medium transition-colors ${
              active ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Icon className="w-5 h-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
