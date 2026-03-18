"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Package, Plus, List, Settings, ClipboardList, Calculator, FileText, Boxes, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { MenuItemConfig } from "@/types/auth";

const HARANG_PEOPLE_ICON_SRC = "/harang/people-icon.png";
const ARMORED_LOGO_SRC = "/brand/helmet-furnace-mark.png";

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
  const {
    profile,
    uiSettings,
    organization,
    viewOrganizationCode,
    canSwitchOrganization,
    setViewOrganizationCodeSafe,
  } = useAuth();
  const isAdmin = profile?.role === "admin";
  /** 헤더 메뉴/로고 분기는 보기용 조직 기준 */
  const viewIsHarang = viewOrganizationCode === "200";

  const effectiveLogoUrl = viewIsHarang ? HARANG_PEOPLE_ICON_SRC : ARMORED_LOGO_SRC;
  const brandName = viewIsHarang ? "하랑" : (uiSettings?.brand_name?.trim() || "생산관리");
  const primaryColor = uiSettings?.primary_color?.trim() || "#06b6d4";

  const baseMenuItems =
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

  /** 200(하랑) 보기일 때 업무 메뉴 영역 비움. viewOrganizationCode 기준 */
  const menuItems = viewIsHarang ? [] : baseMenuItems;

  /** admin일 때만 그리드 상단에 "관리" 노출 (모바일에서 스크롤 없이 보이도록). manager/worker에는 미포함 */
  const displayMenuItems = isAdmin
    ? [{ href: "/manage", label: "관리 (사업장/사용자)", key: "manage", Icon: Users }, ...menuItems]
    : menuItems;

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
        {effectiveLogoUrl.startsWith("http") ? (
          <img src={effectiveLogoUrl} alt="로고" width={28} height={28} className="object-contain shrink-0 rounded" />
        ) : (
          <Image
            src={effectiveLogoUrl}
            alt="로고"
            width={28}
            height={28}
            className="object-contain shrink-0"
          />
        )}
        <span className="font-semibold text-sm hidden sm:inline">{brandName}</span>
      </Link>

      {canSwitchOrganization && (
        <div className="flex items-center gap-1 shrink-0" role="group" aria-label="조직 보기 전환">
          <button
            type="button"
            onClick={() => setViewOrganizationCodeSafe("100")}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewOrganizationCode === "100"
                ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/80 border border-transparent"
            }`}
          >
            아머드프레시
          </button>
          <button
            type="button"
            onClick={() => setViewOrganizationCodeSafe("200")}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewOrganizationCode === "200"
                ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/80 border border-transparent"
            }`}
          >
            하랑
          </button>
        </div>
      )}

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
          <div className="absolute right-0 top-full mt-1 w-[280px] max-h-[min(70vh,480px)] flex flex-col rounded-xl border border-slate-600 bg-space-800 shadow-xl overflow-hidden">
            <p className="text-xs font-medium text-slate-500 px-3 py-2 shrink-0">업무 메뉴</p>
            <div className="grid grid-cols-2 gap-1 px-3 pb-2 overflow-y-auto overflow-x-hidden min-h-0 flex-1 relative z-0">
              {displayMenuItems.map(({ href, label, Icon }) => {
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
            <div className="shrink-0 mt-0 pt-2 pb-3 px-3 border-t border-slate-600 bg-space-800 relative z-10 flex flex-col">
              <p className="text-xs font-medium text-slate-500 px-0 mb-1">계정</p>
              <Link
                href="/account/change-password"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center w-full min-h-[44px] py-2 text-center text-xs text-slate-500 hover:text-slate-300 transition-colors rounded cursor-pointer touch-manipulation"
              >
                비밀번호 변경
              </Link>
              <Link
                href="/logout"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center w-full min-h-[44px] py-2 text-center text-xs text-slate-500 hover:text-slate-300 transition-colors rounded cursor-pointer touch-manipulation"
              >
                로그아웃
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
