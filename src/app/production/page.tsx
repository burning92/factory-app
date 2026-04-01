"use client";

import Link from "next/link";
import { Calculator, FileText, Plus, List, CalendarDays } from "lucide-react";

const HUB_ITEMS = [
  { href: "/production/dough-usage", label: "반죽사용량", Icon: Plus },
  { href: "/production/dough-logs", label: "반죽 내역", Icon: List },
  { href: "/production/history", label: "원료 사용량", Icon: Calculator },
  { href: "/production/history/completed", label: "생산일지", Icon: FileText },
  { href: "/production/plan", label: "생산계획", Icon: CalendarDays },
] as const;

export default function ProductionHubPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold text-slate-100 mb-4">생산</h1>
      <ul className="flex flex-col gap-2">
        {HUB_ITEMS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-center gap-3 w-full p-4 rounded-xl border border-slate-700/60 bg-slate-800/50 hover:bg-slate-700/50 text-slate-200 hover:text-white transition-colors"
            >
              <Icon className="w-5 h-5 shrink-0 text-cyan-400/90" strokeWidth={1.8} />
              <span className="font-medium">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
