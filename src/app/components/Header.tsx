"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Package, Plus, List, Settings, ClipboardList, Calculator, FileText } from "lucide-react";

const MENUS = [
  { href: "/production/outbound", label: "출고 입력", Icon: Package },
  { href: "/production/outbound-history", label: "출고 현황", Icon: ClipboardList },
  { href: "/production/history", label: "사용량 계산", Icon: Calculator },
  { href: "/production/history/completed", label: "생산일지 목록", Icon: FileText },
  { href: "/production/dough-usage", label: "반죽사용량 입력", Icon: Plus },
  { href: "/production/dough-logs", label: "반죽 내역 관리", Icon: List },
  { href: "/production/admin", label: "기준 정보 관리", Icon: Settings },
] as const;

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
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-700/60 bg-space-900/95 backdrop-blur px-4 sm:px-6 print:hidden">
      <Link
        href="/"
        className="flex items-center gap-2 text-slate-100 hover:text-white transition-colors"
      >
        <Image
          src="/helmet-logo.png"
          alt="로고"
          width={28}
          height={28}
          className="object-contain shrink-0"
        />
        <span className="font-semibold text-sm hidden sm:inline">생산관리</span>
      </Link>

      <div className="relative" ref={popoverRef}>
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
              {MENUS.map(({ href, label, Icon }) => {
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
          </div>
        )}
      </div>
    </header>
  );
}
