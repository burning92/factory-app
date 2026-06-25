"use client";

import Link from "next/link";

export default function HarangStockAdjustmentPackagingNewPage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 text-slate-900">
      <div className="max-w-3xl mx-auto space-y-5">
        <Link href="/harang/stock-adjustment" className="text-sm text-slate-600 hover:text-slate-900">
          ← 재고조정 목록
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">부자재 재고조정 (전체)</h1>
        <p className="text-sm text-slate-600">
          부자재 전 품목 실사 → 차이 일괄 반영. 생산입고 분배 없음.
        </p>
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600 text-sm">
          다음 단계에서 구현 예정입니다.
        </div>
      </div>
    </div>
  );
}
