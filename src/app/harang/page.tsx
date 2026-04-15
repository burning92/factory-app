"use client";

import Link from "next/link";
import { Box, ClipboardList, Layers, Settings, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const HUB_ITEMS = [
  {
    href: "/harang/inbound",
    label: "입고관리",
    description: "입고내역 조회 및 신규 입고 등록",
    Icon: ClipboardList,
  },
  {
    href: "/harang/inventory",
    label: "재고현황",
    description: "품목별 현재고, LOT별 잔량, 입출고 이력 조회",
    Icon: Layers,
  },
] as const;

const ADMIN_ITEMS = [
  { href: "/harang/admin/raw-materials", label: "원재료 마스터" },
  { href: "/harang/admin/packaging-materials", label: "부자재 마스터" },
  { href: "/harang/admin/product-bom", label: "제품 BOM 마스터" },
] as const;

export default function HarangHubPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  return (
    <div className="min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-0 p-4 md:p-6 max-w-5xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-900">하랑 운영</h1>
        <p className="mt-1 text-sm text-slate-600">입고관리와 재고현황을 중심으로 운영합니다.</p>
      </header>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {HUB_ITEMS.map(({ href, label, description, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="group flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 shadow-sm"
            >
              <Icon className="w-5 h-5 text-cyan-700 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-slate-900 font-medium">{label}</p>
                <p className="text-xs text-slate-600 truncate">{description}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-cyan-700" />
            </Link>
          </li>
        ))}
      </ul>

      {isAdmin && (
        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Settings className="w-4 h-4 text-cyan-700" />
            <h2 className="text-sm font-semibold text-slate-800">관리자 마스터 관리</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {ADMIN_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-800 hover:bg-slate-50"
              >
                <Box className="w-4 h-4 text-cyan-700" />
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
