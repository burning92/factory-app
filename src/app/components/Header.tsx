"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Package, Plus, List, Settings, ClipboardList, Calculator, FileText, Boxes } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { MenuItemConfig } from "@/types/auth";

const DEFAULT_MENUS: { href: string; label: string; key: string; Icon: typeof Package }[] = [
  { href: "/production/outbound", label: "출고 입력", key: "outbound", Icon: Package },
  { href: "/production/outbound-history", label: "출고 현황", key: "outbound-history", Icon: ClipboardList },
  { href: "/production/history", label: "사용량 계산", key: "history", Icon: Calculator },
  { href: "/production/history/completed", label: "생산일지 목록", key: "completed", Icon: FileText },
  { href: "/production/dough-usage", label: "반죽사용량 입력", key: "dough-usage", Icon: Plus },
  { href: "/production/dough-logs", label: "반죽 내역 관리", key: "dough-logs", Icon: List },
  { href: "/inventory/ecount", label: "재고 현황", key: "ecount", Icon: Boxes },
  { href: "/production/admin", label: "기준 정보 관리", key: "admin", Icon: Settings },
];

const KEY_TO_ICON: Record<string, typeof Package> = {
  outbound: Package,
  "outbound-history": ClipboardList,
  history: Calculator,
  completed: FileText,
  "dough-usage": Plus,
  "dough-logs": List,
  ecount: Boxes,
  admin: Settings,
};

/** 구글 스타일 점 9개(와플) 아이콘 */
function WaffleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="5" cy="5" r="2" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="12" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
    </svg>
  );
}

export default function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const popoverRef = useRef<HTMLDivElement>(null);
  const { profile, uiSettings, signOut } = useAuth();
  const isMaster = profile?.role === "master";

  const logoUrl = uiSettings?.logo_url?.trim() || "/helmet-logo.png";
  const brandName = uiSettings?.brand_name?.trim() || "생산관리";
  const primaryColor = uiSettings?.primary_color?.trim() || "#06b6d4";

  const menuItems =
    uiSettings?.menu_config && uiSettings.menu_config.length > 0
      ? uiSettings.menu_config
          .filter((m): m is MenuItemConfig => m.visible !== false && !!m.path)
          .map((m) => ({
            href: m.path,
            label: m.label || m.key,
            key: m.key,
            Icon: KEY_TO_ICON[m.key] ?? Package,
          }))
      : DEFAULT_MENUS;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }
  }, [open]);

  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-700/60 bg-space-900/95 backdrop-blur px-4 sm:px-6 print:hidden"
      style={{ ["--header-primary" as string]: primaryColor }}
    >
      <Link
        href="/"
        className="flex items-center gap-2 text-slate-100 hover:text-white transition-colors"
      >
        {logoUrl.startsWith("http") ? (
          <img src={logoUrl} alt="로고" width={28} height={28} className="object-contain shrink-0 rounded" />
        ) : (
          <Image
            src={logoUrl}
            alt="로고"
            width={28}
            height={28}
            className="object-contain shrink-0"
          />
        )}
        <span className="font-semibold text-sm hidden sm:inline">{brandName}</span>
      </Link>

      <div className="relative flex items-center gap-2" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-center w-10 h-10 rounded-full text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          aria-label="메뉴 열기"
          aria-expanded={open}
        >
          <WaffleIcon className="w-5 h-5" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-[280px] rounded-xl border border-slate-600 bg-space-800 shadow-xl py-3 px-3">
            <p className="text-xs font-medium text-slate-500 px-3 mb-2">업무 메뉴</p>
            <div className="grid grid-cols-2 gap-1">
              {menuItems.map(({ href, label, Icon }) => {
                const isActive = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`flex flex-col items-center justify-center gap-2 py-4 px-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-cyan-500/20 text-cyan-300"
                        : "text-slate-300 hover:bg-slate-700/80 hover:text-slate-100"
                    }`}
                  >
                    <Icon className="w-6 h-6 shrink-0" strokeWidth={1.8} />
                    <span className="text-center leading-tight">{label}</span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-600 space-y-1">
              {isMaster && (
                <Link
                  href="/manage"
                  onClick={() => setOpen(false)}
                  className="block w-full py-2 text-center text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  관리 (사업장/사용자)
                </Link>
              )}
              <button
                type="button"
                onClick={() => { setOpen(false); signOut(); }}
                className="w-full py-2 text-center text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                로그아웃
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
