"use client";

import Link from "next/link";
import { Calculator, FileText, Plus, List, CalendarDays, ChevronRight, Package } from "lucide-react";

const HUB_ITEMS = [
  {
    href: "/production/plan",
    label: "생산계획",
    description: "오늘/이번달 계획 확인",
    badge: "핵심",
    Icon: CalendarDays,
    featured: true,
  },
  {
    href: "/production/history",
    label: "원료 사용량",
    description: "원료 투입량 입력 및 조회",
    badge: "입력",
    Icon: Calculator,
    featured: true,
  },
  {
    href: "/production/dough-usage",
    label: "반죽사용량",
    description: "반죽 기준량 계산",
    badge: "계산",
    Icon: Plus,
    featured: false,
  },
  {
    href: "/production/dough-logs",
    label: "반죽 내역",
    description: "최근 반죽 기록 확인",
    badge: "조회",
    Icon: List,
    featured: false,
  },
  {
    href: "/production/history/completed",
    label: "생산일지",
    description: "생산 완료 기록 확인",
    badge: "기록",
    Icon: FileText,
    featured: false,
  },
  {
    href: "/production/lot-consumption",
    label: "LOT별 생산 소모",
    description: "출고 일지 기준 LOT·원료별 소모 (이카운트 입력 전 확인)",
    badge: "조회",
    Icon: Package,
    featured: false,
  },
] as const;

export default function ProductionHubPage() {
  const todayLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

  return (
    <div className="min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-0 p-4 md:p-6 max-w-4xl mx-auto">
      <header className="mb-4 md:mb-5">
        <h1 className="text-xl md:text-2xl font-semibold text-slate-100">생산</h1>
        <p className="mt-1 text-sm text-slate-400">
          {todayLabel} · 필요한 작업을 빠르게 선택하세요.
        </p>
      </header>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5 md:gap-3">
        {HUB_ITEMS.map(({ href, label, description, badge, Icon, featured }) => (
          <li key={href}>
            <Link
              href={href}
              className={`group flex items-center gap-3 w-full p-4 rounded-xl border text-slate-200 transition-all active:scale-[0.99] ${
                featured
                  ? "border-cyan-600/40 bg-cyan-950/20 hover:bg-cyan-900/25"
                  : "border-slate-700/60 bg-slate-800/50 hover:bg-slate-700/50"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0 text-cyan-400/90" strokeWidth={1.8} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-base text-slate-100">{label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] leading-none border ${
                      featured
                        ? "text-cyan-300 border-cyan-500/45 bg-cyan-500/10"
                        : "text-slate-400 border-slate-600/70 bg-slate-700/40"
                    }`}
                  >
                    {badge}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400 truncate">{description}</p>
              </div>
              <ChevronRight
                className="w-4 h-4 shrink-0 text-slate-500 group-hover:text-cyan-300 transition-colors"
                strokeWidth={2}
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
