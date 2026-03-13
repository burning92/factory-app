"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useMasterStore, type ProductionLog, type OutboundLine } from "@/store/useMasterStore";
import DateWheelPicker from "@/components/DateWheelPicker";

/** 박스/낱개/g → 총중량(g). g전용이면 boxG=0, unitG=0 → g만 */
function totalGFromQty(
  box: number,
  bag: number,
  g: number,
  material: { boxWeightG: number; unitWeightG: number } | undefined
): number {
  if (!material) return g;
  if (material.boxWeightG === 0 && material.unitWeightG === 0) return g;
  const unitG = material.unitWeightG > 0 ? material.unitWeightG : material.boxWeightG;
  return box * material.boxWeightG + bag * unitG + g;
}

function formatQty(box: number, bag: number, g: number): string {
  const parts: string[] = [];
  if (box > 0) parts.push(`${box}박스`);
  if (bag > 0) parts.push(`${bag}개`);
  if (g > 0) parts.push(`${g}g`);
  return parts.length ? parts.join(" ") : "0";
}

/** 마감 입력 한 줄: 당일 출고분(고정) + 전일 재고/당일 잔량 입력, 또는 추가 줄(당일 출고 0) */
interface CloseModalRow {
  id: string;
  소비기한: string;
  당일출고_박스: number;
  당일출고_낱개: number;
  당일출고_g: number;
  전일재고_박스: string;
  전일재고_낱개: string;
  전일재고_g: string;
  당일잔량_박스: string;
  당일잔량_낱개: string;
  당일잔량_g: string;
  isExtra: boolean; // true면 [+ 다른 소비기한 전일 재고 추가]로 만든 줄 (당일 출고 0)
}

const todayStr = () => new Date().toISOString().slice(0, 10);

/** 마감 팝업: 실사용량 = (전일 재고 + 당일 출고) - 당일 잔량 */
function CloseModal({
  log,
  materials,
  defaultExpiryForExtra,
  onClose,
  onConfirm,
}: {
  log: ProductionLog;
  materials: { materialName: string; boxWeightG: number; unitWeightG: number }[];
  defaultExpiryForExtra: string;
  onClose: () => void;
  onConfirm: (실사용량_g: number, 작업자?: string) => void;
}) {
  const mat = materials.find((m) => m.materialName === log.원료명);
  const [작업자, set작업자] = useState("");

  const defaultRows: CloseModalRow[] = useMemo(() => {
    const lines: OutboundLine[] =
      log.출고_라인?.length
        ? log.출고_라인
        : [
            {
              소비기한: "",
              박스: log.출고_박스 ?? 0,
              낱개: log.출고_낱개 ?? 0,
              g: log.출고_g ?? 0,
            },
          ];
    return lines.map((r, i) => ({
      id: `row-${i}-${r.소비기한}`,
      소비기한: r.소비기한,
      당일출고_박스: r.박스,
      당일출고_낱개: r.낱개,
      당일출고_g: r.g,
      전일재고_박스: "",
      전일재고_낱개: "",
      전일재고_g: "",
      당일잔량_박스: "",
      당일잔량_낱개: "",
      당일잔량_g: "",
      isExtra: false,
    }));
  }, [log]);

  const [rows, setRows] = useState<CloseModalRow[]>(defaultRows);

  const addExtraRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        id: `extra-${Date.now()}`,
        소비기한: defaultExpiryForExtra,
        당일출고_박스: 0,
        당일출고_낱개: 0,
        당일출고_g: 0,
        전일재고_박스: "",
        전일재고_낱개: "",
        전일재고_g: "",
        당일잔량_박스: "",
        당일잔량_낱개: "",
        당일잔량_g: "",
        isExtra: true,
      },
    ]);
  }, [defaultExpiryForExtra]);

  const updateRow = useCallback(
    (id: string, field: keyof CloseModalRow, value: string) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
      );
    },
    []
  );

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault?.();
    let sum전일재고_g = 0;
    let sum당일출고_g = 0;
    let sum당일잔량_g = 0;
    for (const row of rows) {
      const 전일재고_g = totalGFromQty(
        parseInt(row.전일재고_박스, 10) || 0,
        parseInt(row.전일재고_낱개, 10) || 0,
        parseInt(row.전일재고_g, 10) || 0,
        mat
      );
      const 당일출고_g = totalGFromQty(
        row.당일출고_박스,
        row.당일출고_낱개,
        row.당일출고_g,
        mat
      );
      const 당일잔량_g = totalGFromQty(
        parseInt(row.당일잔량_박스, 10) || 0,
        parseInt(row.당일잔량_낱개, 10) || 0,
        parseInt(row.당일잔량_g, 10) || 0,
        mat
      );
      sum전일재고_g += 전일재고_g;
      sum당일출고_g += 당일출고_g;
      sum당일잔량_g += 당일잔량_g;
    }
    const 실사용량_g = Math.max(
      0,
      sum전일재고_g + sum당일출고_g - sum당일잔량_g
    );
    onConfirm(실사용량_g, 작업자?.trim() || undefined);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-space-800 rounded-2xl border border-cyan-500/30 shadow-glow max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-600">
          <h3 className="text-lg font-bold text-slate-100">
            잔량 입력 및 마감 · {log.원료명}
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            실사용량(g) = (전일 재고 + 당일 출고) − 당일 잔량
          </p>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          <div className="space-y-4">
            {rows.map((row) => (
              <div
                key={row.id}
                className="p-4 rounded-xl border border-slate-600 bg-space-900/80"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-400 mb-1">소비기한</label>
                    {row.isExtra ? (
                      <DateWheelPicker
                        value={row.소비기한}
                        onChange={(v) => updateRow(row.id, "소비기한", v)}
                        className="w-full px-2 py-2 text-sm focus:ring-2 focus:ring-cyan-500/50"
                        placeholder="날짜 선택"
                      />
                    ) : (
                      <p className="text-sm font-medium text-slate-200 py-2">
                        {row.소비기한 || "당일 출고"}
                      </p>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-400 mb-1">당일 출고량</label>
                    <p className="text-sm text-slate-300 py-2 tabular-nums">
                      {formatQty(
                        row.당일출고_박스,
                        row.당일출고_낱개,
                        row.당일출고_g
                      )}
                    </p>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-slate-400 mb-1">전일 재고 (박스/개/g)</label>
                    <div className="flex gap-1">
                      <input type="number" min={0} inputMode="numeric" value={row.전일재고_박스} onChange={(e) => updateRow(row.id, "전일재고_박스", e.target.value)} placeholder="박스" className="w-full px-2 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm tabular-nums focus:ring-2 focus:ring-cyan-500/50" />
                      <input type="number" min={0} inputMode="numeric" value={row.전일재고_낱개} onChange={(e) => updateRow(row.id, "전일재고_낱개", e.target.value)} placeholder="개" className="w-full px-2 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm tabular-nums focus:ring-2 focus:ring-cyan-500/50" />
                      <input type="number" min={0} inputMode="numeric" value={row.전일재고_g} onChange={(e) => updateRow(row.id, "전일재고_g", e.target.value)} placeholder="g" className="w-full px-2 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm tabular-nums focus:ring-2 focus:ring-cyan-500/50" />
                    </div>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-slate-400 mb-1">당일 잔량 (박스/개/g)</label>
                    <div className="flex gap-1">
                      <input type="number" min={0} inputMode="numeric" value={row.당일잔량_박스} onChange={(e) => updateRow(row.id, "당일잔량_박스", e.target.value)} placeholder="박스" className="w-full px-2 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm tabular-nums focus:ring-2 focus:ring-cyan-500/50" />
                      <input type="number" min={0} inputMode="numeric" value={row.당일잔량_낱개} onChange={(e) => updateRow(row.id, "당일잔량_낱개", e.target.value)} placeholder="개" className="w-full px-2 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm tabular-nums focus:ring-2 focus:ring-cyan-500/50" />
                      <input type="number" min={0} inputMode="numeric" value={row.당일잔량_g} onChange={(e) => updateRow(row.id, "당일잔량_g", e.target.value)} placeholder="g" className="w-full px-2 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm tabular-nums focus:ring-2 focus:ring-cyan-500/50" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addExtraRow}
            className="mt-4 w-full py-2.5 rounded-xl border-2 border-dashed border-slate-600 text-slate-400 text-sm font-medium hover:border-cyan-500/50 hover:text-cyan-400 transition-colors"
          >
            + 다른 소비기한 전일 재고 추가
          </button>

          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-300 mb-1">작업자 (잔량 입력자)</label>
            <input
              type="text"
              value={작업자}
              onChange={(e) => set작업자(e.target.value)}
              placeholder="이름"
              className="w-full max-w-xs px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
            />
          </div>
        </div>

        <div className="p-5 border-t border-slate-600 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50">
            취소
          </button>
          <button type="button" onClick={() => handleSubmit()} className="px-5 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400">
            마감 처리 및 사용량 계산
          </button>
        </div>
      </div>
    </div>
  );
}

/** 긴급 추가 출고 팝업: 해당 날짜/제품에 원료 출고 1건 즉시 추가 */
function EmergencyOutboundModal({
  생산일자,
  제품명,
  materials,
  lastUsedDates,
  onClose,
  onSave,
}: {
  생산일자: string;
  제품명: string;
  materials: { materialName: string }[];
  lastUsedDates: Record<string, string>;
  onClose: () => void;
  onSave: (원료명: string, 소비기한: string, 박스: number, 낱개: number, g: number) => void;
}) {
  const [원료명, set원료명] = useState("");
  const [소비기한, set소비기한] = useState("");
  const [박스, set박스] = useState("");
  const [낱개, set낱개] = useState("");
  const [g, setG] = useState("");

  useEffect(() => {
    if (원료명) set소비기한(lastUsedDates[원료명] || todayStr());
  }, [원료명, lastUsedDates]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!원료명.trim()) {
      alert("원료를 선택해 주세요.");
      return;
    }
    const expiry = 소비기한 || todayStr();
    onSave(원료명.trim(), expiry, parseInt(박스, 10) || 0, parseInt(낱개, 10) || 0, parseInt(g, 10) || 0);
    onClose();
  };

  const defaultExpiry = 원료명 ? (lastUsedDates[원료명] || todayStr()) : todayStr();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-space-800 rounded-2xl border border-cyan-500/30 shadow-glow max-w-md w-full min-w-0 p-6 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-100 mb-2">긴급 추가 출고</h3>
        <p className="text-sm text-slate-400 mb-4">
          {생산일자} / {제품명}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3 w-full min-w-0">
          <div className="w-full min-w-0">
            <label className="block text-sm font-medium text-slate-300 mb-1">원료</label>
            <select
              value={원료명}
              onChange={(e) => set원료명(e.target.value)}
              className="w-full min-w-0 px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 box-border"
              required
            >
              <option value="">원료 선택</option>
              {materials.map((m) => (
                <option key={m.materialName} value={m.materialName}>{m.materialName}</option>
              ))}
            </select>
          </div>
          <div className="w-full min-w-0">
            <label className="block text-sm font-medium text-slate-300 mb-1">소비기한</label>
            <DateWheelPicker
              value={소비기한 || defaultExpiry}
              onChange={(v) => set소비기한(v)}
              className="w-full min-w-0 px-3 py-2 box-border"
              placeholder="날짜 선택"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 w-full min-w-0">
            <input type="number" min={0} inputMode="numeric" value={박스} onChange={(e) => set박스(e.target.value)} placeholder="박스" className="w-full min-w-0 px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:ring-2 focus:ring-cyan-500/50 box-border" />
            <input type="number" min={0} inputMode="numeric" value={낱개} onChange={(e) => set낱개(e.target.value)} placeholder="낱개" className="w-full min-w-0 px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:ring-2 focus:ring-cyan-500/50 box-border" />
            <input type="number" min={0} inputMode="numeric" value={g} onChange={(e) => setG(e.target.value)} placeholder="g" className="w-full min-w-0 px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:ring-2 focus:ring-cyan-500/50 box-border" />
          </div>
          <div className="flex gap-2 pt-2 w-full min-w-0">
            <button type="button" onClick={onClose} className="flex-1 min-w-0 py-2 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50">
              취소
            </button>
            <button type="submit" className="flex-1 min-w-0 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400">
              출고 추가
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function OutboundHistoryPage() {
  const {
    productionLogs,
    materials,
    lastUsedDates,
    productionLogsLoading,
    materialsLoading,
    saving,
    error,
    fetchProductionLogs,
    fetchMaterials,
    fetchLastUsedDates,
    closeProductionLog,
    addProductionLog,
    setLastUsedDate,
  } = useMasterStore();
  const [closeModalLog, setCloseModalLog] = useState<ProductionLog | null>(null);
  const [emergencyGroup, setEmergencyGroup] = useState<{ 생산일자: string; 제품명: string } | null>(null);

  useEffect(() => {
    fetchProductionLogs();
    fetchMaterials();
    fetchLastUsedDates();
  }, [fetchProductionLogs, fetchMaterials, fetchLastUsedDates]);

  const grouped = useMemo(() => {
    const map = new Map<string, ProductionLog[]>();
    for (const log of productionLogs) {
      const key = `${log.생산일자}|${log.제품명}`;
      const list = map.get(key) ?? [];
      list.push(log);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([key, items]) => {
        const [생산일자, 제품명] = key.split("|");
        return { 생산일자, 제품명, items };
      })
      .sort(
        (a, b) =>
          b.생산일자.localeCompare(a.생산일자) ||
          b.제품명.localeCompare(a.제품명)
      );
  }, [productionLogs]);

  const handleCloseConfirm = async (log: ProductionLog, 실사용량_g: number, 작업자?: string) => {
    try {
      await closeProductionLog(log.id, { 실사용량_g, 상태: "마감완료", 작업자 });
      setCloseModalLog(null);
    } catch {
      alert("마감 저장에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const handleEmergencySave = async (
    생산일자: string,
    제품명: string,
    원료명: string,
    소비기한: string,
    박스: number,
    낱개: number,
    g: number
  ) => {
    try {
      await addProductionLog({
        생산일자,
        제품명,
        원료명,
        출고_라인: [{ 소비기한, 박스, 낱개, g }],
        출고_박스: 0,
        출고_낱개: 0,
        출고_g: 0,
      });
      await setLastUsedDate(원료명, 소비기한);
      setEmergencyGroup(null);
    } catch {
      alert("출고 추가에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  return (
    <main className="min-h-screen py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-100 mb-8">
          원료 출고 현황 대시보드
        </h1>

        {error && (
          <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-sm">
            {error}
          </div>
        )}
        {productionLogsLoading && (
          <p className="mb-4 text-slate-400 flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            로딩 중...
          </p>
        )}
        {saving === "logs" && (
          <p className="mb-4 text-cyan-400 flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            저장 중...
          </p>
        )}

        {productionLogsLoading ? (
          <p className="text-slate-500 py-12 text-center">로딩 중...</p>
        ) : grouped.length === 0 ? (
          <p className="text-slate-500 py-12 text-center">
            출고 기록이 없습니다. 출고 계산기에서 출고 입력을 저장하면 여기에
            표시됩니다.
          </p>
        ) : (
          <div className="space-y-6">
            {grouped.map(({ 생산일자, 제품명, items }) => (
              <section
                key={`${생산일자}-${제품명}`}
                className="rounded-2xl overflow-hidden border border-cyan-500/20 bg-space-800/80 shadow-glow"
              >
                <div className="bg-gradient-to-r from-space-700 via-space-700 to-cyan-900/30 border-b border-cyan-500/30 px-4 py-3 font-bold text-base flex items-center justify-between gap-2 flex-wrap rounded-t-2xl shadow-glow">
                  <span className="text-slate-100">{생산일자} / {제품명}</span>
                  <button
                    type="button"
                    onClick={() => setEmergencyGroup({ 생산일자, 제품명 })}
                    disabled={saving === "logs"}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/30 border border-amber-400/50 text-amber-300 text-sm font-medium hover:bg-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    + 긴급 추가 출고
                  </button>
                </div>
                <ul className="divide-y divide-slate-700">
                  {items.map((log) => (
                    <li
                      key={log.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-space-700/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-100">
                          {log.원료명}
                        </p>
                        {log.상태 === "마감완료" ? (
                          <p className="text-sm text-slate-400 mt-1">
                            상태: 마감완료 | 총 실사용량:{" "}
                            <strong className="text-cyan-400">
                              {log.실사용량_g?.toLocaleString()}g
                            </strong>
                          </p>
                        ) : (
                          <p className="text-sm text-slate-500 mt-1">
                            출고: {log.출고_박스}박스 {log.출고_낱개}개 {log.출고_g}g
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            log.상태 === "마감완료"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          }`}
                        >
                          {log.상태 === "마감완료" ? "마감완료" : "출고됨"}
                        </span>
                        {log.상태 === "출고됨" && (
                          <button
                            type="button"
                            onClick={() => setCloseModalLog(log)}
                            disabled={saving === "logs"}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            잔량 입력 및 마감
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {closeModalLog && (
          <CloseModal
            log={closeModalLog}
            materials={materials}
            defaultExpiryForExtra={lastUsedDates[closeModalLog.원료명] || todayStr()}
            onClose={() => setCloseModalLog(null)}
            onConfirm={(실사용량_g, 작업자) =>
              handleCloseConfirm(closeModalLog, 실사용량_g, 작업자)
            }
          />
        )}

        {emergencyGroup && (
          <EmergencyOutboundModal
            생산일자={emergencyGroup.생산일자}
            제품명={emergencyGroup.제품명}
            materials={materials}
            lastUsedDates={lastUsedDates}
            onClose={() => setEmergencyGroup(null)}
            onSave={(원료명, 소비기한, 박스, 낱개, g) =>
              handleEmergencySave(emergencyGroup.생산일자, emergencyGroup.제품명, 원료명, 소비기한, 박스, 낱개, g)
            }
          />
        )}
      </div>
    </main>
  );
}
