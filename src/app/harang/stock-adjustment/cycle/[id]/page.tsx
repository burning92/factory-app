"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { displayHarangProductName } from "@/features/harang/displayProductName";
import {
  type ConfirmedProductionDeltaRow,
  type ConfirmedSerialResultRow,
  type MaterialConsumptionSummary,
  type StockAdjustmentSessionRow,
  aggregateMaterialConsumption,
  formatConsumptionRatioPct,
  formatLotDate,
  isParbakeMaterialName,
  loadConfirmedCycleDetail,
  materialRowKey,
  revertCycleAdjustment,
} from "@/features/harang/stockAdjustment";

function fmtNum(n: number): string {
  return Number(n || 0).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
}

function ratioColorClass(pct: number | null): string {
  if (pct === null) return "text-slate-400";
  if (pct > 100) return "text-amber-700";
  if (pct < 100) return "text-cyan-700";
  return "text-emerald-700";
}

export default function HarangStockAdjustmentCycleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sessionId = params.id;

  const [session, setSession] = useState<StockAdjustmentSessionRow | null>(null);
  const [serialResults, setSerialResults] = useState<ConfirmedSerialResultRow[]>([]);
  const [productionDeltas, setProductionDeltas] = useState<ConfirmedProductionDeltaRow[]>([]);
  const [materialBomQty, setMaterialBomQty] = useState<Map<string, number>>(new Map());
  const [targetCount, setTargetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const data = await loadConfirmedCycleDetail(sessionId);
      setSession(data.session);
      setSerialResults(data.serial_results);
      setProductionDeltas(data.production_deltas);
      setMaterialBomQty(data.material_bom_qty);
      setTargetCount(data.production_header_ids.length);
    } catch (e) {
      alert(e instanceof Error ? e.message : "조정 상세 로드 실패");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevert = async () => {
    if (!sessionId || !session) return;
    const ok = window.confirm(
      `이 조정을 되돌릴까요?\n\n` +
        `· 생산입고 ${targetCount}건에 적용된 사용량 조정이 취소됩니다.\n` +
        `· LOT 재고·조정 입출고 이력이 확정 전 상태로 복구됩니다.\n` +
        `· 세션은 작성중(draft)으로 돌아가 다시 수정·확정할 수 있습니다.\n\n` +
        `조정일: ${session.adjustment_date} · ${displayHarangProductName(session.product_name)}`,
    );
    if (!ok) return;
    setReverting(true);
    try {
      await revertCycleAdjustment(sessionId);
      router.push(`/harang/stock-adjustment/cycle/new?draft_id=${sessionId}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "조정 되돌리기 실패");
    } finally {
      setReverting(false);
    }
  };

  const deltasBySerial = useMemo(() => {
    const map = new Map<string, ConfirmedProductionDeltaRow[]>();
    for (const d of productionDeltas) {
      const list = map.get(d.serial_result_id) ?? [];
      list.push(d);
      map.set(d.serial_result_id, list);
    }
    for (const list of Array.from(map.values())) {
      list.sort(
        (a: ConfirmedProductionDeltaRow, b: ConfirmedProductionDeltaRow) =>
          a.production_date.localeCompare(b.production_date) || a.production_no.localeCompare(b.production_no),
      );
    }
    return map;
  }, [productionDeltas]);

  const materialConsumption = useMemo((): MaterialConsumptionSummary[] => {
    const actualByKey = new Map<
      string,
      {
        material_name: string;
        unit: string;
        view_category: "parbake" | "raw_material";
        actual: number;
      }
    >();
    for (const r of serialResults) {
      const key = materialRowKey(r.material_category, r.material_id);
      const prev = actualByKey.get(key) ?? {
        material_name: r.material_name,
        unit: r.unit,
        view_category: isParbakeMaterialName(r.material_name) ? "parbake" : "raw_material",
        actual: 0,
      };
      prev.actual += r.actual_usage_qty;
      actualByKey.set(key, prev);
    }
    return aggregateMaterialConsumption(
      Array.from(actualByKey.entries()).map(([materialKey, row]) => ({
        materialKey,
        material_name: row.material_name,
        unit: row.unit,
        view_category: row.view_category,
        bom: materialBomQty.get(materialKey) ?? 0,
        actual: Math.round(row.actual * 1000) / 1000,
      })),
    );
  }, [serialResults, materialBomQty]);

  const groupedResults = useMemo(() => {
    const parbake: ConfirmedSerialResultRow[] = [];
    const raw: ConfirmedSerialResultRow[] = [];
    for (const row of serialResults) {
      if (isParbakeMaterialName(row.material_name)) parbake.push(row);
      else raw.push(row);
    }
    return { parbake, raw };
  }, [serialResults]);

  const renderConsumptionSection = (title: string, rows: MaterialConsumptionSummary[]) => {
    if (rows.length === 0) return null;
    return (
      <div className="overflow-x-auto">
        {title && (
          <p className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-50/80 border-b border-slate-100">
            {title}
          </p>
        )}
        <table className="min-w-full text-sm text-slate-900">
          <thead className="text-left text-xs uppercase text-slate-600 bg-slate-50/60">
            <tr>
              <th className="px-4 py-2">원료</th>
              <th className="px-4 py-2 text-right">BOM</th>
              <th className="px-4 py-2 text-right">실사용</th>
              <th className="px-4 py-2 text-right">소모비율</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.materialKey} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">{row.material_name}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtNum(row.bom_usage_qty)}
                  <span className="ml-1 text-xs text-slate-500">{row.unit}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">
                  {fmtNum(row.actual_usage_qty)}
                  <span className="ml-1 text-xs text-slate-500">{row.unit}</span>
                </td>
                <td
                  className={`px-4 py-2 text-right tabular-nums font-semibold ${ratioColorClass(row.consumption_ratio_pct)}`}
                >
                  {formatConsumptionRatioPct(row.consumption_ratio_pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderLotSection = (title: string, rows: ConfirmedSerialResultRow[]) => {
    if (rows.length === 0) return null;
    return (
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-slate-900">
            <thead className="text-left text-xs uppercase text-slate-600 bg-slate-50/60">
              <tr>
                <th className="px-4 py-2">원료</th>
                <th className="px-4 py-2">소비기한</th>
                <th className="px-4 py-2 text-right">입고</th>
                <th className="px-4 py-2 text-right">실재고</th>
                <th className="px-4 py-2 text-right">BOM</th>
                <th className="px-4 py-2 text-right">실사용</th>
                <th className="px-4 py-2 text-right">조정(±)</th>
                <th className="px-4 py-2 w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const deltas = deltasBySerial.get(row.id) ?? [];
                const isOpen = expandedIds.has(row.id);
                return (
                  <Fragment key={row.id}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="px-4 py-2 font-medium">{row.material_name}</td>
                      <td className="px-4 py-2 font-mono text-xs">{formatLotDate(row.lot_date)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtNum(row.inbound_qty)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtNum(row.physical_qty)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fmtNum(row.bom_usage_qty)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtNum(row.actual_usage_qty)}</td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${
                          row.usage_delta_qty === 0
                            ? "text-slate-400"
                            : row.usage_delta_qty > 0
                              ? "text-amber-700"
                              : "text-rose-700"
                        }`}
                      >
                        {row.usage_delta_qty === 0
                          ? "—"
                          : `${row.usage_delta_qty > 0 ? "+" : ""}${fmtNum(row.usage_delta_qty)}`}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {deltas.length > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(row.id)) next.delete(row.id);
                                else next.add(row.id);
                                return next;
                              })
                            }
                            className="text-xs text-cyan-700 hover:text-cyan-900 underline"
                          >
                            {isOpen ? "접기" : `분배 ${deltas.length}건`}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && deltas.length > 0 && (
                      <tr className="border-t border-slate-100 bg-slate-50/40">
                        <td colSpan={8} className="px-4 py-3">
                          <table className="min-w-full text-xs text-slate-800 rounded-lg border border-slate-200 bg-white overflow-hidden">
                            <thead className="bg-slate-50 text-slate-600">
                              <tr>
                                <th className="px-3 py-2 text-left">생산입고</th>
                                <th className="px-3 py-2 text-right">수량</th>
                                <th className="px-3 py-2 text-right">분배(±)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {deltas.map((d) => (
                                <tr key={d.id} className="border-t border-slate-100">
                                  <td className="px-3 py-1.5 font-mono">{d.production_no || d.production_date}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(d.finished_qty)}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-cyan-700">
                                    {d.usage_delta_qty >= 0 ? "+" : ""}
                                    {fmtNum(d.usage_delta_qty)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  if (loading) {
    return <div className="px-4 py-16 text-center text-slate-500 text-sm">불러오는 중…</div>;
  }

  if (!session) {
    return (
      <div className="px-4 py-8 max-w-3xl mx-auto text-slate-900">
        <Link href="/harang/stock-adjustment" className="text-sm text-slate-600 hover:text-slate-900">
          ← 목록
        </Link>
        <p className="mt-4 text-sm text-slate-600">조정 내역을 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 text-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/harang/stock-adjustment" className="text-sm text-slate-600 hover:text-slate-900">
              ← 재고조정 목록
            </Link>
            <h1 className="text-2xl font-semibold text-slate-900 mt-2">조정 상세</h1>
            <p className="text-sm text-slate-600 mt-1">생산 사이클 재고조정 · 확정 결과</p>
          </div>
          {session.status === "confirmed" && (
            <button
              type="button"
              onClick={() => void handleRevert()}
              disabled={reverting}
              className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-60"
            >
              {reverting ? "되돌리는 중…" : "조정 되돌리기"}
            </button>
          )}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">조정일</p>
            <p className="font-medium mt-0.5">{session.adjustment_date}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">품목</p>
            <p className="font-medium mt-0.5">{displayHarangProductName(session.product_name)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">생산입고</p>
            <p className="font-medium mt-0.5">{targetCount}건</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">확정일시</p>
            <p className="font-medium mt-0.5">
              {session.confirmed_at ? new Date(session.confirmed_at).toLocaleString("ko-KR") : "—"}
            </p>
          </div>
          {session.memo && (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">메모</p>
              <p className="mt-0.5 text-slate-700 whitespace-pre-wrap">{session.memo}</p>
            </div>
          )}
        </section>

        {materialConsumption.length > 0 && (
          <section className="rounded-xl border border-violet-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-violet-100 bg-violet-50">
              <h2 className="text-sm font-semibold text-violet-900">BOM 대비 소모비율</h2>
              <p className="text-xs text-violet-700/80 mt-0.5">원료별 합산 · 선택 생산입고 BOM 기준</p>
            </div>
            {renderConsumptionSection("", materialConsumption)}
          </section>
        )}

        {serialResults.length === 0 ? (
          <p className="text-sm text-slate-500">저장된 LOT 실사 결과가 없습니다.</p>
        ) : (
          <>
            <p className="text-xs text-slate-500">아래는 소비기한 LOT별 실사·분배 상세입니다.</p>
            {renderLotSection("파베이크", groupedResults.parbake)}
            {renderLotSection("원재료", groupedResults.raw)}
          </>
        )}
      </div>
    </div>
  );
}
