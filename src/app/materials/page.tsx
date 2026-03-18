"use client";

import Link from "next/link";
import { Boxes, FileText, Package, Layers, Calculator } from "lucide-react";

const LINK_ITEMS = [
  { href: "/inventory/ecount", label: "재고 현황", Icon: Boxes },
] as const;

const COMING_ITEMS = [
  { label: "하랑 입고 관리", Icon: Package },
  { label: "하랑 현재고", Icon: Layers },
  { label: "원부자재 필요량", Icon: Calculator },
] as const;

export default function MaterialsHubPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold text-slate-100 mb-1">원부자재</h1>
      <p className="text-slate-500 text-sm mb-4">재고·원자재·입고 업무</p>
      <ul className="flex flex-col gap-2">
        {LINK_ITEMS.map(({ href, label, Icon }) => (
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
        {COMING_ITEMS.map(({ label, Icon }) => (
          <li key={label}>
            <div
              className="flex items-center justify-between w-full p-4 rounded-xl border border-slate-700/60 bg-slate-800/30 text-slate-400 cursor-not-allowed"
              aria-disabled
            >
              <div className="flex items-center gap-3">
                <Icon className="w-5 h-5 shrink-0 text-slate-500" strokeWidth={1.8} />
                <span className="font-medium">{label}</span>
              </div>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-700/80 text-slate-500">
                준비중
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
