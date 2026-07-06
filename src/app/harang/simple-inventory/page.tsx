"use client";

import Link from "next/link";
import { BarChart3, ClipboardCheck, PackagePlus, Scale } from "lucide-react";

const ITEMS = [
  {
    href: "/harang/inbound",
    label: "입고 등록",
    description: "재고 증가 — 입고만 등록합니다.",
    Icon: PackagePlus,
  },
  {
    href: "/harang/simple-inventory/surveys",
    label: "재고조사",
    description: "LOT별 실사 수량 입력·확정 (스냅샷 저장)",
    Icon: ClipboardCheck,
  },
  {
    href: "/harang/simple-inventory/report",
    label: "소모량 리포트",
    description: "조사 구간별·월별 계산 소모량 (실사 기준)",
    Icon: BarChart3,
  },
  {
    href: "/harang/inventory",
    label: "재고 현황",
    description: "레거시 원장·LOT 이력 (간편 재고 정본 아님)",
    Icon: Scale,
  },
  {
    href: "/harang/defect-disposal",
    label: "폐기 등록",
    description: "재고 감소 — 불량·폐기 처리",
    Icon: Scale,
  },
] as const;

export default function HarangSimpleInventoryHubPage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <Link href="/harang" className="text-sm text-slate-600 hover:text-slate-900">
            ← 하랑 운영
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">간편 재고</h1>
          <p className="mt-1 text-sm text-slate-600">
            입고로 재고를 늘리고, 재고조사로 실제 잔량을 기록합니다. 생산소모는 BOM이 아니라{" "}
            <strong className="font-medium text-slate-800">전 조사 + 기간 입고 − 현 조사</strong>로 계산합니다.
          </p>
        </div>

        <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950">
          <p className="font-semibold">현재고의 정본</p>
          <ul className="mt-1 list-disc list-inside space-y-0.5 text-cyan-900">
            <li>조사 전: 입고 누적(inbound만) 참고</li>
            <li>첫 조사 후: 최신 확정 조사 snapshot + 이후 입고</li>
            <li>레거시 current_quantity·usage 원장은 간편 재고 정본이 아닙니다</li>
          </ul>
        </div>

        <ul className="grid grid-cols-1 gap-3">
          {ITEMS.map(({ href, label, description, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50"
              >
                <Icon className="h-5 w-5 shrink-0 text-cyan-700" />
                <div>
                  <p className="font-medium text-slate-900">{label}</p>
                  <p className="text-xs text-slate-600">{description}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
