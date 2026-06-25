"use client";

import Link from "next/link";
import { Box, Package, Layers3, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const ITEMS = [
  {
    href: "/harang/admin/inventory-repair",
    label: "재고 데이터 정합",
    description: "재고조정 되돌리기 · 원장↔생산입고 LOT 재연결 (작업 1)",
    Icon: Wrench,
  },
  {
    href: "/harang/admin/raw-materials",
    label: "하랑 원재료 마스터",
    description: "원재료 등록/수정/사용여부 관리",
    Icon: Package,
  },
  {
    href: "/harang/admin/packaging-materials",
    label: "하랑 부자재 마스터",
    description: "부자재 등록/수정/사용여부 관리",
    Icon: Box,
  },
  {
    href: "/harang/admin/product-bom",
    label: "하랑 제품 BOM 마스터",
    description: "제품별 원재료 BOM 라인 관리",
    Icon: Layers3,
  },
] as const;

export default function HarangAdminHubPage() {
  const { profile } = useAuth();
  if (profile?.role !== "admin") {
    return <div className="px-6 py-10 text-slate-600">관리자만 접근할 수 있습니다.</div>;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900">하랑 마스터 관리</h1>
        <p className="mt-1 text-sm text-slate-600">원재료/부자재/BOM 마스터를 관리합니다.</p>

        <ul className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          {ITEMS.map(({ href, label, description, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50"
              >
                <Icon className="w-5 h-5 text-cyan-700" />
                <p className="mt-3 text-sm font-semibold text-slate-900">{label}</p>
                <p className="mt-1 text-xs text-slate-600">{description}</p>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-xs text-slate-500">
          <Link href="/harang/admin/inventory-repair" className="text-cyan-700 hover:text-cyan-900 underline">
            재고 데이터 정합 (작업 1)
          </Link>
          {" · "}
          <Link href="/harang/admin/production-lot-audit" className="text-slate-600 hover:text-slate-900 underline">
            과거 생산입고 LOT 이력
          </Link>
        </p>
      </div>
    </div>
  );
}
