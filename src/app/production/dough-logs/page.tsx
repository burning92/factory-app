"use client";

import { useState, useMemo, useEffect, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMasterStore, type DoughLogRecord } from "@/store/useMasterStore";
import { Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";

const KG_PER_BAG = 25;

function flourSummary(record: DoughLogRecord): { totalG: number; bags: number; kg: number } {
  const lines = record.반죽원료?.["밀가루"] ?? [];
  const totalG = lines.reduce((s, l) => s + (l.사용량_g ?? 0), 0);
  const kg = totalG / 1000;
  const bags = Math.round((totalG / 1000) / KG_PER_BAG * 10) / 10;
  return { totalG, bags, kg };
}

export default function DoughLogsPage() {
  const router = useRouter();
  const { fetchDoughLogs, doughLogsMap, doughLogsLoading, deleteDoughLog, saving, error } = useMasterStore();
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    fetchDoughLogs();
  }, [fetchDoughLogs]);

  const sortedLogs = useMemo(() => {
    const entries = Object.entries(doughLogsMap);
    return entries.sort(([a], [b]) => b.localeCompare(a));
  }, [doughLogsMap]);

  const handleDelete = async (usageDate: string) => {
    if (!confirm(`해당 날짜(${usageDate}) 반죽 내역을 삭제하시겠습니까?`)) return;
    try {
      await deleteDoughLog(usageDate);
      setToast({ message: "삭제되었습니다.", type: "success" });
      if (expandedDate === usageDate) setExpandedDate(null);
    } catch {
      setToast({ message: "삭제에 실패했습니다.", type: "error" });
    }
  };

  const goToNewDoughUsage = () => {
    router.push("/production/dough-usage");
  };

  return (
    <div className="py-10 px-4 sm:px-6 lg:px-8">
      {toast && (
        <div
          role="alert"
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${
            toast.type === "success" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-100">반죽 내역 관리</h1>
          <button
            type="button"
            onClick={goToNewDoughUsage}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm hover:bg-cyan-400 transition-colors"
          >
            + 반죽사용량 입력
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-sm">
            {error}
          </div>
        )}
        {doughLogsLoading && (
          <p className="mb-4 text-slate-400 flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            로딩 중…
          </p>
        )}

        {sortedLogs.length === 0 && !doughLogsLoading && (
          <div className="rounded-2xl border border-slate-700 bg-space-800/80 p-12 text-center">
            <p className="text-slate-400 mb-4">저장된 반죽 내역이 없습니다.</p>
            <button
              type="button"
              onClick={goToNewDoughUsage}
              className="inline-block px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400"
            >
              반죽사용량 입력하기
            </button>
          </div>
        )}

        {sortedLogs.length > 0 && (
          <>
            {/* 모바일: 카드 뷰 */}
            <div className="md:hidden space-y-3">
              {sortedLogs.map(([date, record]) => {
                const { totalG, bags, kg } = flourSummary(record);
                const isExpanded = expandedDate === date;
                const 예상수량포맷 =
                  record.예상수량 != null && Number.isFinite(record.예상수량)
                    ? `${Math.round(record.예상수량).toLocaleString()}개`
                    : "—";
                const 밀가루텍스트 = totalG > 0 ? `${totalG.toLocaleString()}g (약 ${bags}포대 / ${kg.toFixed(1)}kg)` : "—";
                return (
                  <div
                    key={date}
                    className="rounded-xl border border-slate-600 bg-space-800/80 overflow-hidden"
                  >
                    <div className="p-4">
                      <p className="text-base font-bold text-slate-100 mb-1">
                        {record.반죽일자 ?? "—"} → {record.사용일자 ?? date}
                      </p>
                      <p className="text-xs text-slate-400 mb-1">
                        예상수량 {예상수량포맷} · 작성자 {record.작성자명 || "—"}
                      </p>
                      <p className="text-sm font-semibold text-cyan-300 tabular-nums mb-3">
                        밀가루 사용량 {밀가루텍스트}
                      </p>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link
                          href={`/production/dough-usage?date=${date}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 text-sm font-medium"
                        >
                          <Pencil className="w-4 h-4" /> 수정
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(date)}
                          disabled={saving !== ""}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" /> 삭제
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedDate(isExpanded ? null : date)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} 상세
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-slate-600 px-4 py-3 bg-space-900/60">
                        <div className="grid grid-cols-1 gap-4 text-sm">
                          <div>
                            <h4 className="text-slate-400 font-medium mb-2">반죽 원료 (사용량 g · LOT)</h4>
                            <ul className="space-y-1.5">
                              {Object.entries(record.반죽원료 ?? {}).map(([name, lines]) =>
                                (lines?.length ?? 0) > 0 ? (
                                  <li key={name} className="text-slate-300 text-xs">
                                    <span className="font-medium text-slate-200">{name}:</span>{" "}
                                    {lines!.map((l) => `${l.사용량_g?.toLocaleString()}g (${l.lot || "—"})`).join(", ")}
                                  </li>
                                ) : null
                              )}
                              {Object.keys(record.반죽원료 ?? {}).length === 0 && <li className="text-slate-500">—</li>}
                            </ul>
                          </div>
                          <div>
                            <h4 className="text-slate-400 font-medium mb-2">덧가루 · 덧기름</h4>
                            <ul className="space-y-1.5">
                              {Object.entries(record.덧가루덧기름 ?? {}).map(([name, lines]) =>
                                (lines?.length ?? 0) > 0 ? (
                                  <li key={name} className="text-slate-300 text-xs">
                                    <span className="font-medium text-slate-200">{name}:</span>{" "}
                                    {lines!.map((l) => `${l.사용량_g?.toLocaleString()}g (${l.lot || "—"})`).join(", ")}
                                  </li>
                                ) : null
                              )}
                              {Object.keys(record.덧가루덧기름 ?? {}).length === 0 && <li className="text-slate-500">—</li>}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* PC: 테이블 뷰 */}
            <div className="hidden md:block rounded-2xl border border-slate-700 bg-space-800/80 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed min-w-[720px]">
                  <colgroup>
                    <col className="w-10" />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col className="w-28" />
                  </colgroup>
                  <thead>
                    <tr className="bg-space-700/80 border-b border-slate-600">
                      <th className="px-3 py-3 text-left font-semibold text-slate-200"></th>
                      <th className="px-3 py-3 text-left font-semibold text-slate-200">반죽일자</th>
                      <th className="px-3 py-3 text-left font-semibold text-slate-200">사용일자</th>
                      <th className="px-3 py-3 text-right font-semibold text-slate-200">예상수량</th>
                      <th className="px-3 py-3 text-left font-semibold text-slate-200">작성자</th>
                      <th className="px-3 py-3 text-right font-semibold text-slate-200">밀가루 사용량</th>
                      <th className="px-3 py-3 text-right font-semibold text-slate-200">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLogs.map(([date, record]) => {
                      const { totalG, bags, kg } = flourSummary(record);
                      const isExpanded = expandedDate === date;
                      const 예상수량포맷 =
                        record.예상수량 != null && Number.isFinite(record.예상수량)
                          ? `${Math.round(record.예상수량).toLocaleString()}개`
                          : "—";
                      return (
                        <Fragment key={date}>
                          <tr
                            key={date}
                            className="border-b border-slate-700 hover:bg-space-700/40"
                          >
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => setExpandedDate(isExpanded ? null : date)}
                                className="text-slate-400 hover:text-slate-200 p-0.5"
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            </td>
                            <td className="px-3 py-3 font-medium text-slate-100">{record.반죽일자 ?? "—"}</td>
                            <td className="px-3 py-3 font-medium text-slate-100">{record.사용일자 ?? date}</td>
                            <td className="px-3 py-3 text-right text-slate-300 tabular-nums">{예상수량포맷}</td>
                            <td className="px-3 py-3 text-slate-300">{record.작성자명 || "—"}</td>
                            <td className="px-3 py-3 text-right text-slate-300 tabular-nums">
                              {totalG > 0 ? `${totalG.toLocaleString()}g (약 ${bags}포대 / ${kg.toFixed(1)}kg)` : "—"}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <Link
                                href={`/production/dough-usage?date=${date}`}
                                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-xs mr-2"
                              >
                                <Pencil className="w-3.5 h-3.5" /> 수정
                              </Link>
                              <button
                                type="button"
                                onClick={() => handleDelete(date)}
                                disabled={saving !== ""}
                                className="inline-flex items-center gap-1 text-slate-400 hover:text-red-400 text-xs disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> 삭제
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${date}-detail`} className="bg-space-900/80 border-b border-slate-700">
                              <td colSpan={7} className="px-4 py-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
                                  <div>
                                    <h4 className="text-slate-400 font-medium mb-2">반죽 원료 (사용량 g · LOT)</h4>
                                    <ul className="space-y-1.5">
                                      {Object.entries(record.반죽원료 ?? {}).map(([name, lines]) =>
                                        (lines?.length ?? 0) > 0 ? (
                                          <li key={name} className="text-slate-300">
                                            <span className="font-medium text-slate-200">{name}:</span>{" "}
                                            {lines!.map((l, i) => `${l.사용량_g?.toLocaleString()}g (${l.lot || "—"})`).join(", ")}
                                          </li>
                                        ) : null
                                      )}
                                      {Object.keys(record.반죽원료 ?? {}).length === 0 && <li className="text-slate-500">—</li>}
                                    </ul>
                                  </div>
                                  <div>
                                    <h4 className="text-slate-400 font-medium mb-2">덧가루 · 덧기름</h4>
                                    <ul className="space-y-1.5">
                                      {Object.entries(record.덧가루덧기름 ?? {}).map(([name, lines]) =>
                                        (lines?.length ?? 0) > 0 ? (
                                          <li key={name} className="text-slate-300">
                                            <span className="font-medium text-slate-200">{name}:</span>{" "}
                                            {lines!.map((l, i) => `${l.사용량_g?.toLocaleString()}g (${l.lot || "—"})`).join(", ")}
                                          </li>
                                        ) : null
                                      )}
                                      {Object.keys(record.덧가루덧기름 ?? {}).length === 0 && <li className="text-slate-500">—</li>}
                                    </ul>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
