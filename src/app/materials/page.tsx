"use client";

import Link from "next/link";
import { Boxes, Package, ClipboardList, Refrigerator, PackageSearch, ShoppingCart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const LINK_ITEMS = [
  { href: "/inventory/ecount", label: "재고 현황", Icon: Boxes },
  { href: "/production/outbound", label: "생산 출고 입력", Icon: Package },
  { href: "/production/outbound-history", label: "생산 출고 현황", Icon: ClipboardList },
  { href: "/daily/raw-thawing", label: "원료 해동 일지", Icon: Refrigerator },
  { href: "/materials/material-receiving-inspection", label: "원료 입고 검수일지", Icon: PackageSearch },
  { href: "/materials/purchasing", label: "원재료 발주 판단(1차)", Icon: ShoppingCart },
  { href: "/materials/purchasing/vendors", label: "공급처 관리", Icon: ShoppingCart },
  { href: "/materials/purchasing/setup", label: "공급처별 발주조건 입력", Icon: ShoppingCart },
] as const;

const WORKER_MATERIAL_HREFS = new Set<string>(["/inventory/ecount", "/production/outbound-history"]);

export default function MaterialsHubPage() {
  const { profile } = useAuth();
  const isRestrictedWorker = profile?.role === "worker";
  const visibleLinks = isRestrictedWorker
    ? LINK_ITEMS.filter((item) => WORKER_MATERIAL_HREFS.has(item.href))
    : LINK_ITEMS;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold text-slate-100 mb-1">원부자재</h1>
      <p className="text-slate-500 text-sm mb-4">
        {isRestrictedWorker ? "재고·출고 현황 조회" : "재고·원자재·입고 업무"}
      </p>
      <ul className="flex flex-col gap-2">
        {visibleLinks.map(({ href, label, Icon }) => (
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
