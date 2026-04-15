"use client";

import { Factory } from "lucide-react";

/**
 * 하랑 생산입력 — 후속 단계에서 사용량·LOT 차감 등을 연결할 예정인 자리입니다.
 */
export default function HarangProductionInputPage() {
  return (
    <div className="min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-0 p-4 md:p-6 max-w-3xl mx-auto">
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <Factory className="w-6 h-6 text-cyan-700" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">생산입력</h1>
          <p className="mt-1 text-sm text-slate-600">
            생산 사용량 입력·LOT 차감 등은 다음 단계에서 연결할 예정입니다.
          </p>
        </div>
      </header>
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center text-sm text-slate-600">
        준비 중입니다.
      </div>
    </div>
  );
}
