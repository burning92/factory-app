"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const HARANG_PEOPLE_ICON_SRC = "/harang/people-icon.png";
const ARMORED_LOGO_SRC = "/brand/helmet-furnace-mark.png";


type DropdownItem = { href: string; label: string } | { label: string; comingSoon: true };

const DESKTOP_DROPDOWN_PRODUCTION: DropdownItem[] = [
  { href: "/production/outbound", label: "출고 입력" },
  { href: "/production/outbound-history", label: "출고 현황" },
  { href: "/production/history", label: "사용량 계산" },
  { href: "/production/history/completed", label: "생산일지 목록" },
  { href: "/production/dough-usage", label: "반죽사용량 입력" },
  { href: "/production/dough-logs", label: "반죽 내역 관리" },
  { href: "/production/plan", label: "생산계획" },
];

const DESKTOP_DROPDOWN_MATERIALS: DropdownItem[] = [
  { href: "/inventory/ecount", label: "재고 현황" },
  { label: "하랑 입고 관리", comingSoon: true },
  { label: "하랑 현재고", comingSoon: true },
  { label: "원부자재 필요량", comingSoon: true },
];

const DESKTOP_DROPDOWN_DAILY: DropdownItem[] = [
  { href: "/daily/hygiene", label: "영업장환경위생점검일지" },
  { href: "/daily/temperature-humidity", label: "영업장 온·습도점검일지" },
  { href: "/daily/sanitation-facility", label: "위생시설관리점검일지" },
  { href: "/daily/worker-hygiene", label: "작업자 위생점검일지" },
  { href: "/daily/cold-storage-hygiene", label: "냉장 · 냉동온도 및 위생 점검일지" },
  { href: "/daily/process-control-bread", label: "공정관리 점검일지(빵류)" },
  { href: "/daily/material-storage-3f", label: "원부자재 창고 점검표(3F)" },
  { href: "/daily/raw-thawing", label: "원료 해동 일지" },
  { href: "/daily/material-receiving-inspection", label: "원료 입고 검수일지" },
  { label: "제조설비 일지", comingSoon: true },
  { label: "기타 데일리 점검", comingSoon: true },
];

const DESKTOP_DROPDOWN_MANAGEMENT: DropdownItem[] = [
  { href: "/production/admin", label: "제품정보관리" },
  { href: "/manage", label: "사용자관리" },
];

type DropdownKey = "production" | "materials" | "daily" | "management";

export default function Header() {
  const [activeDropdown, setActiveDropdown] = useState<DropdownKey | null>(null);
  const pathname = usePathname();
  const desktopDropdownCloseTimeoutRef = useRef<number | null>(null);
  const {
    profile,
    uiSettings,
    viewOrganizationCode,
    canSwitchOrganization,
    setViewOrganizationCodeSafe,
  } = useAuth();
  /** 헤더 메뉴/로고 분기는 보기용 조직 기준 */
  const viewIsHarang = viewOrganizationCode === "200";

  const effectiveLogoUrl = viewIsHarang ? HARANG_PEOPLE_ICON_SRC : ARMORED_LOGO_SRC;
  const primaryColor = uiSettings?.primary_color?.trim() || "#06b6d4";
  const isAdmin = profile?.role === "admin";


  /** 데스크탑 상단 카테고리: 100 = 생산/원부자재/데일리/계정, 200 = 홈/계정만 */
  const desktopNavItems = viewIsHarang
    ? [
        { href: "/", label: "홈" },
        { href: "/account", label: "계정" },
      ]
    : [
        { href: "/production", label: "생산" },
        { href: "/materials", label: "원부자재" },
        { href: "/daily", label: "데일리" },
        { href: "/account", label: "계정" },
      ];

  /**
   * 데스크탑 상단 카테고리 메뉴 노출 범위
   * - 100 보기: 허브 + 관련 작업 경로에서도 유지
   * - 200 보기: 기존처럼 최소 메뉴(홈/계정)만 유지
   */
  const showDesktopCategoryMenu = viewIsHarang
    ? pathname === "/" || pathname.startsWith("/account")
    : pathname === "/" ||
      ["/production", "/materials", "/daily", "/account", "/inventory", "/manage"].some(
        (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
      );

  const headerClassName =
    viewIsHarang
      ? "sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-700/60 bg-space-900/95 backdrop-blur px-4 sm:px-6 print:hidden"
      : "sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/10 bg-black/30 backdrop-blur-md px-4 sm:px-6 print:hidden";

  const cancelDesktopDropdownClose = () => {
    if (desktopDropdownCloseTimeoutRef.current != null) {
      window.clearTimeout(desktopDropdownCloseTimeoutRef.current);
      desktopDropdownCloseTimeoutRef.current = null;
    }
  };

  const scheduleDesktopDropdownClose = () => {
    cancelDesktopDropdownClose();
    desktopDropdownCloseTimeoutRef.current = window.setTimeout(() => {
      setActiveDropdown(null);
      desktopDropdownCloseTimeoutRef.current = null;
    }, 120);
  };

  return (
    <header
      className={headerClassName}
      style={{ ["--header-primary" as string]: primaryColor }}
    >
      <Link
        href="/"
        className="flex items-center gap-2 text-slate-100 hover:text-white transition-colors shrink-0"
      >
        {effectiveLogoUrl.startsWith("http") ? (
          <img src={effectiveLogoUrl} alt="로고" width={36} height={36} className="object-contain shrink-0 rounded" />
        ) : (
          <Image
            src={effectiveLogoUrl}
            alt="로고"
            width={36}
            height={36}
            className="object-contain shrink-0"
          />
        )}
        {viewIsHarang ? (
          <span className="font-semibold text-sm hidden sm:inline">하랑</span>
        ) : (
          <>
            <span className="font-semibold text-sm hidden sm:inline">AF Factory Hub</span>
            <span className="font-semibold text-sm sm:hidden">AF Hub</span>
          </>
        )}
      </Link>

      <nav className="hidden md:flex flex-1 justify-center items-center gap-6 min-w-0" aria-label="업무 카테고리">
        {showDesktopCategoryMenu && (viewIsHarang ? (
          desktopNavItems.map(({ href, label }) => {
            const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? "text-cyan-300" : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {label}
              </Link>
            );
          })
        ) : (
          <>
            {(["production", "materials", "daily", ...(isAdmin ? (["management"] as const) : [])] as const).map((key) => {
              const href =
                key === "production"
                  ? "/production"
                  : key === "materials"
                    ? "/materials"
                    : key === "daily"
                      ? "/daily"
                      : "/manage";
              const items =
                key === "production"
                  ? DESKTOP_DROPDOWN_PRODUCTION
                  : key === "materials"
                    ? DESKTOP_DROPDOWN_MATERIALS
                    : key === "daily"
                      ? DESKTOP_DROPDOWN_DAILY
                      : DESKTOP_DROPDOWN_MANAGEMENT;
              const isActive = pathname === href || pathname.startsWith(href + "/");
              const isOpen = activeDropdown === key;
              return (
                <div
                  key={key}
                  className="relative"
                  onMouseEnter={() => {
                    cancelDesktopDropdownClose();
                    setActiveDropdown(key);
                  }}
                  onMouseLeave={() => {
                    scheduleDesktopDropdownClose();
                  }}
                >
                  <button
                    type="button"
                    className={`text-sm font-medium whitespace-nowrap transition-colors ${
                      isActive ? "text-cyan-300" : "text-slate-400 hover:text-slate-100"
                    }`}
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    onFocus={() => {
                      cancelDesktopDropdownClose();
                      setActiveDropdown(key);
                    }}
                    onBlur={() => {
                      scheduleDesktopDropdownClose();
                    }}
                  >
                    {key === "production" ? "생산" : key === "materials" ? "원부자재" : key === "daily" ? "데일리" : "관리"}
                  </button>
                  {isOpen && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 top-full mt-0 pt-1 min-w-[200px] z-50"
                      role="menu"
                    >
                      <div className="rounded-lg border border-slate-600 bg-slate-800/95 shadow-xl py-2">
                      {items.map((item, i) =>
                        "comingSoon" in item && item.comingSoon ? (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-slate-500 cursor-not-allowed"
                            role="menuitem"
                            aria-disabled
                          >
                            <span>{item.label}</span>
                            <span className="text-xs text-slate-500 bg-slate-700/80 px-1.5 py-0.5 rounded">준비중</span>
                          </div>
                        ) : "href" in item ? (
                          <Link
                            key={i}
                            href={item.href}
                            className={`block px-4 py-2 text-sm transition-colors ${
                              pathname === item.href || pathname.startsWith(item.href + "/")
                                ? "text-cyan-300 bg-cyan-500/10"
                                : "text-slate-300 hover:bg-slate-700/80 hover:text-slate-100"
                            }`}
                            role="menuitem"
                          >
                            {item.label}
                          </Link>
                        ) : null
                      )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <Link
              href="/account"
              className={`text-sm font-medium whitespace-nowrap transition-colors ${
                pathname === "/account" || pathname.startsWith("/account/")
                  ? "text-cyan-300"
                  : "text-slate-400 hover:text-slate-100"
              }`}
            >
              계정
            </Link>
          </>
        ))}
      </nav>

      <div className="flex items-center gap-2 shrink-0">
        {canSwitchOrganization && (
          <div className="flex items-center gap-1" role="group" aria-label="조직 보기 전환">
            <button
              type="button"
              onClick={() => setViewOrganizationCodeSafe("100")}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                viewOrganizationCode === "100"
                  ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/80 border border-transparent"
              }`}
            >
              <span className="sm:hidden">AFF</span>
              <span className="hidden sm:inline">Armored Fresh Factory</span>
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
              Harang
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
