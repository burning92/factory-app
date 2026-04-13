"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMasterStore } from "@/store/useMasterStore";
import {
  flattenProductionLogsToLotRows,
  type LotConsumptionFlatRow,
} from "@/features/production/lotConsumption/flattenLotConsumptionRows";

type ViewKind = "출고" | "소모" | "입고";

const LOT_ALL = "__ALL__";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatCell(n: number, showZero: boolean): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0 && !showZero) return "—";
  return n.toLocaleString("ko-KR");
}

function formatConsume(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ko-KR");
}

function uniqueSorted(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "ko")
  );
}

function rowMatchesLot(row: LotConsumptionFlatRow, lotKey: string): boolean {
  if (lotKey === LOT_ALL) return true;
  return row.lotLabel === lotKey || row.lotIso === lotKey;
}

export default function LotConsumptionPage() {
  const {
    productionLogs,
    productionLogsLoading,
    fetchProductionLogs,
    materials,
    fetchMaterials,
    usageCalculations,
    fetchUsageCalculations,
    productionHistoryDateStates,
    fetchProductionHistoryDateStates,
    error,
  } = useMasterStore();

  const [fromDate, setFromDate] = useState(() => daysAgoIso(90));
  const [toDate, setToDate] = useState(todayIso);
  const [material, setMaterial] = useState("");
  const [lot, setLot] = useState(LOT_ALL);
  const [kind, setKind] = useState<ViewKind>("출고");
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    void fetchProductionLogs();
    void fetchMaterials();
    void fetchUsageCalculations();
    void fetchProductionHistoryDateStates();
  }, [fetchProductionLogs, fetchMaterials, fetchUsageCalculations, fetchProductionHistoryDateStates]);

  const flatAll = useMemo(
    () =>
      flattenProductionLogsToLotRows(productionLogs, materials, {
        usageCalculations,
        productionHistoryDateStates,
        productionLogs,
      }),
    [productionLogs, materials, usageCalculations, productionHistoryDateStates]
  );

  const materialOptions = useMemo(() => uniqueSorted(flatAll.map((r) => r.materialName)), [flatAll]);

  const lotOptionsForMaterial = useMemo(() => {
    if (!material.trim()) return [];
    const rows = flatAll.filter((r) => r.materialName === material);
    const labels = uniqueSorted(rows.map((r) => r.lotLabel));
    return labels;
  }, [flatAll, material]);

  const runSearch = useCallback(() => {
    if (kind === "입고") {
      setSearched(true);
      return;
    }
    if (!material.trim()) return;
    setSearched(true);
  }, [material, kind]);

  useEffect(() => {
    setSearched(false);
  }, [kind]);

  const filtered = useMemo(() => {
    if (!searched || !material.trim()) return [];
    return flatAll.filter((r) => {
      if (r.productionDate < fromDate || r.productionDate > toDate) return false;
      if (r.materialName !== material) return false;
      return rowMatchesLot(r, lot === LOT_ALL ? LOT_ALL : lot);
    });
  }, [flatAll, fromDate, toDate, material, lot, searched]);

  const sumOutbound = useMemo(
    () => filtered.reduce((s, r) => s + (Number.isFinite(r.outboundTotalG) ? r.outboundTotalG : 0), 0),
    [filtered]
  );

  const sumConsume = useMemo(() => {
    let s = 0;
    let any = false;
    for (const r of filtered) {
      if (r.consumeG != null && Number.isFinite(r.consumeG)) {
        s += r.consumeG;
        any = true;
      }
    }
    return { sum: s, any };
  }, [filtered]);

  useEffect(() => {
    setLot(LOT_ALL);
  }, [material]);

  return (
    <div className="min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-0 p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link href="/production" className="text-sm text-cyan-400 hover:underline">
          ← 생산
        </Link>
      </div>

      <header className="mb-5">
        <h1 className="text-lg font-semibold text-slate-100">LOT별 생산 소모</h1>
        <p className="mt-1 text-sm text-slate-500">
          원료 → LOT → 유형을 고른 뒤 조회하세요. 출고는 일지 출고 라인입니다. 소모는 실사용·1차 사용량을 LOT 비율로 나눈 값이 있으면 우선하고, 없으면 사용량 계산(원료 재고)·마감 스냅샷의 LOT별 전일재고+출고-당일재고를 반영합니다.
        </p>
      </header>

      <div className="rounded-xl border border-slate-700 bg-space-800/60 p-4 mb-6 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            시작일
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            종료일
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-200"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            1. 원료
            <select
              value={material}
              onChange={(e) => {
                setMaterial(e.target.value);
                setSearched(false);
              }}
              className="rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-2 text-sm text-slate-200"
            >
              <option value="">원료 선택</option>
              {materialOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            2. LOT
            <select
              value={lot}
              onChange={(e) => setLot(e.target.value)}
              disabled={!material.trim()}
              className="rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-2 text-sm text-slate-200 disabled:opacity-50"
            >
              <option value={LOT_ALL}>전체 LOT</option>
              {lotOptionsForMaterial.map((lb) => (
                <option key={lb} value={lb}>
                  {lb}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            3. 유형
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ViewKind)}
              className="rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-2 text-sm text-slate-200"
            >
              <option value="출고">출고</option>
              <option value="소모">소모</option>
              <option value="입고">입고</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={runSearch}
          disabled={kind !== "입고" && !material.trim()}
          className="w-full sm:w-auto rounded-lg px-4 py-2 text-sm font-medium bg-cyan-600/80 text-white hover:bg-cyan-500/90 disabled:opacity-40 disabled:pointer-events-none"
        >
          조회
        </button>
        {kind === "입고" ? (
          <p className="text-xs text-slate-500">입고는 이 앱에 데이터가 없어 조회 시 안내만 표시됩니다.</p>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-red-400 mb-4">{error}</p>
      ) : null}

      {productionLogsLoading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : kind === "입고" && searched ? (
        <div className="rounded-xl border border-slate-700 bg-space-800/40 p-6 text-sm text-slate-400 leading-relaxed">
          <p className="font-medium text-slate-200 mb-2">입고(구매) 내역</p>
          <p>
            생산일지·출고 시스템에는 <strong className="text-slate-300">입고 전표가 없습니다</strong>. 이카운트
            「시리얼/로트 내역」 또는 구매/입고 메뉴에서 확인해 주세요.
          </p>
        </div>
      ) : !searched || (kind !== "입고" && !material.trim()) ? (
        <div className="rounded-xl border border-dashed border-slate-600 p-8 text-center text-sm text-slate-500">
          {kind === "입고"
            ? "위에서 유형을 입고로 두고 조회를 누르면 안내가 표시됩니다."
            : "원료를 선택한 뒤 조회를 누르면 출고 또는 소모 내역만 표시됩니다."}
        </div>
      ) : (
        <>
          {kind === "출고" ? (
            <>
              <p className="text-xs text-slate-500 mb-2">
                행 {filtered.length} · 출고 환산 합{" "}
                <span className="text-cyan-200/90 tabular-nums">{sumOutbound.toLocaleString("ko-KR")} g</span>
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-space-900/50 text-xs text-slate-400">
                      <th className="px-3 py-2 font-medium whitespace-nowrap">생산일자</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">제품명</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">LOT</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">박스</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">낱개</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">출고 g</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">출고 환산(g)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.key} className="border-b border-slate-800/80 hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap tabular-nums">{r.productionDate}</td>
                        <td className="px-3 py-2 text-slate-200 max-w-[200px]">{r.productName}</td>
                        <td className="px-3 py-2 text-amber-200/95 whitespace-nowrap font-medium">{r.lotLabel}</td>
                        <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{formatCell(r.box, false)}</td>
                        <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{formatCell(r.bag, false)}</td>
                        <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{formatCell(r.g, false)}</td>
                        <td className="px-3 py-2 text-right text-cyan-200/90 tabular-nums font-medium">
                          {formatCell(r.outboundTotalG, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">조건에 맞는 출고 라인이 없습니다.</p>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-2">
                행 {filtered.length}
                {sumConsume.any ? (
                  <>
                    {" "}
                    · 소모 합{" "}
                    <span className="text-amber-200/90 tabular-nums">{sumConsume.sum.toLocaleString("ko-KR")} g</span>
                  </>
                ) : (
                  <span className="text-slate-600">
                    {" "}
                    · 소모 합 — (해당 기간에 일지 실사용·1차 사용량과 사용량 계산·마감 재고가 모두 없으면 LOT별 값이 비어 있습니다)
                  </span>
                )}
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-space-900/50 text-xs text-slate-400">
                      <th className="px-3 py-2 font-medium whitespace-nowrap">생산일자</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">제품명</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">LOT</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">소모(g)</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">일지 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.key} className="border-b border-slate-800/80 hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap tabular-nums">{r.productionDate}</td>
                        <td className="px-3 py-2 text-slate-200 max-w-[220px]">{r.productName}</td>
                        <td className="px-3 py-2 text-amber-200/95 whitespace-nowrap font-medium">{r.lotLabel}</td>
                        <td className="px-3 py-2 text-right text-amber-200/90 tabular-nums font-medium">
                          {formatConsume(r.consumeG)}
                        </td>
                        <td className="px-3 py-2 text-slate-500 text-xs">{r.logStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">조건에 맞는 라인이 없습니다.</p>
                ) : null}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
