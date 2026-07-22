"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Box,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Layers,
  ListOrdered,
  Package,
  Scale,
  Settings,
  User,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminLikeRole } from "@/lib/roles";

const PRIMARY_ITEMS = [
  {
    href: "/harang/simple-inventory",
    label: "간편 재고",
    description: "입고·재고조사·실사 기준 소모량 리포트 (권장)",
    Icon: Package,
  },
  {
    href: "/harang/inbound",
    label: "입고관리",
    description: "재고 증가 — 입고 등록",
    Icon: ClipboardList,
  },
  {
    href: "/harang/outbound",
    label: "출고관리",
    description: "완제품 출고 등록·조회",
    Icon: ClipboardList,
  },
  {
    href: "/harang/defect-disposal",
    label: "불량·폐기",
    description: "재고 감소 — 폐기 등록",
    Icon: Scale,
  },
  {
    href: "/harang/inventory/finished-products",
    label: "완제품 재고",
    description: "완제품 LOT 잔량 조회",
    Icon: Layers,
  },
  {
    href: "/account",
    label: "계정",
    description: "로그아웃 및 비밀번호 변경",
    Icon: User,
  },
] as const;

const LEGACY_ITEMS = [
  {
    href: "/harang/inventory",
    label: "원부자재 재고현황",
    description: "레거시 원장·LOT 이력 조회 (간편 재고 정본 아님)",
    Icon: Layers,
  },
  {
    href: "/harang/outbound/clients",
    label: "출고처관리",
    description: "출고처 마스터 (레거시)",
    Icon: ClipboardList,
  },
  {
    href: "/harang/production-requests",
    label: "생산요청",
    description: "BOM·작업지시 기반 생산요청 (레거시)",
    Icon: ListOrdered,
  },
  {
    href: "/harang/production-input",
    label: "생산입력",
    description: "생산입고·LOT 사용량 차감 (레거시)",
    Icon: ClipboardList,
  },
  {
    href: "/harang/stock-adjustment",
    label: "실사 재고조정",
    description: "생산 사이클·BOM 분배 조정 (레거시)",
    Icon: Scale,
  },
  {
    href: "/harang/admin/inventory-repair",
    label: "재고 정합 진단",
    description: "원장 불일치·복구 도구 (레거시 · 관리자)",
    Icon: Settings,
  },
] as const;

const ADMIN_ITEMS = [
  { href: "/harang/admin/raw-materials", label: "원재료 마스터" },
  { href: "/harang/admin/packaging-materials", label: "부자재 마스터" },
  { href: "/harang/admin/product-bom", label: "제품 BOM 마스터" },
] as const;

function HubLink({
  href,
  label,
  description,
  Icon,
  legacy,
}: {
  href: string;
  label: string;
  description: string;
  Icon: typeof Package;
  legacy?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 p-4 rounded-xl border bg-white hover:bg-slate-50 shadow-sm ${
        legacy ? "border-slate-200 opacity-90" : "border-slate-200"
      }`}
    >
      <Icon className="w-5 h-5 text-cyan-700 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-slate-900 font-medium flex items-center gap-2 flex-wrap">
          {label}
          {legacy ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
              레거시
            </span>
          ) : null}
        </p>
        <p className="text-xs text-slate-600 truncate">{description}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-cyan-700" />
    </Link>
  );
}

export default function HarangHubPage() {
  const { profile } = useAuth();
  const isAdmin = isAdminLikeRole(profile?.role);
  const [legacyOpen, setLegacyOpen] = useState(false);

  return (
    <div className="min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-0 p-4 md:p-6 max-w-5xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-900">하랑 운영</h1>
        <p className="mt-1 text-sm text-slate-600">
          간편 재고(입고 + 재고조사 + 계산 소모량)를 중심으로 운영합니다. 생산입력·BOM 조정은 레거시입니다.
        </p>
      </header>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PRIMARY_ITEMS.map((item) => (
          <li key={item.href}>
            <HubLink {...item} />
          </li>
        ))}
      </ul>

      {isAdmin ? (
        <section className="mt-6 rounded-xl border border-slate-300 bg-slate-50/80 overflow-hidden">
          <button
            type="button"
            onClick={() => setLegacyOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <span>레거시 메뉴 (생산·BOM·원장 복구) — 기본 숨김</span>
            {legacyOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {legacyOpen ? (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 pt-0 border-t border-slate-200">
              {LEGACY_ITEMS.map((item) => (
                <li key={item.href}>
                  <HubLink {...item} legacy />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

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
