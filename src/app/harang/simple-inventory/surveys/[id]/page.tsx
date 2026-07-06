"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HarangInventoryLot } from "@/features/harang/types";
import type { InventorySurveyLineRow, InventorySurveyRow } from "@/features/harang/simpleInventorySurvey";
import {
  formatYmdDot,
  loadSimpleInventoryLotReferences,
} from "@/features/harang/simpleInventorySurvey";

type LotRow = HarangInventoryLot & { physicalStr: string; referenceQty: number | null; referenceLabel: string };

type CategoryFilter = "all" | "raw_material" | "packaging_material";

function parseQty(v: string): number {
  const n = Number(String(v).replaceAll(",", "").trim());
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function isLotInputFilled(physicalStr: string): boolean {
  const trimmed = physicalStr.trim();
  if (trimmed === "") return false;
  return Number.isFinite(parseQty(physicalStr));
}

function isZeroStockEstimateLot(lot: LotRow): boolean {
  const hasCurrent = Number(lot.current_quantity) > 0.0005;
  const hasRef = lot.referenceQty != null && lot.referenceQty > 0.0005;
  return hasCurrent || hasRef;
}

function computeLotInputStats(rows: LotRow[]) {
  let filled = 0;
  let unfilled = 0;
  let zeroFilled = 0;
  for (const lot of rows) {
    if (!isLotInputFilled(lot.physicalStr)) {
      unfilled += 1;
      continue;
    }
    filled += 1;
    if (parseQty(lot.physicalStr) === 0) zeroFilled += 1;
  }
  return { total: rows.length, filled, unfilled, zeroFilled };
}

export default function HarangInventorySurveyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [survey, setSurvey] = useState<InventorySurveyRow | null>(null);
  const [lines, setLines] = useState<InventorySurveyLineRow[]>([]);
  const [lotRows, setLotRows] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [hideZeroEstimate, setHideZeroEstimate] = useState(true);
  const [baselineHint, setBaselineHint] = useState<string | null>(null);

  const isDraft = survey?.status === "draft";

  const loadSurvey = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [headRes, lineRes] = await Promise.all([
      supabase
        .from("harang_inventory_surveys")
        .select("id, survey_date, title, status, note, created_at, confirmed_at")
        .eq("id", id)
        .single(),
      supabase.from("harang_inventory_survey_lines").select("*").eq("survey_id", id),
    ]);
    setLoading(false);
    if (headRes.error) {
      alert(headRes.error.message);
      return;
    }
    setSurvey(headRes.data as InventorySurveyRow);
    setLines((lineRes.data ?? []) as InventorySurveyLineRow[]);
  }, [id]);

  const loadLotsForDraft = useCallback(async () => {
    const { data, error } = await supabase
      .from("harang_inventory_lots")
      .select(
        "id, category, item_id, item_code, item_name, lot_date, inbound_date, current_quantity, unit, note",
      )
      .order("item_name", { ascending: true })
      .order("lot_date", { ascending: true });
    if (error) {
      alert(error.message);
      return;
    }

    let refs = new Map<string, { referenceQty: number; hasBaselineSurvey: boolean; baselineSurveyDate: string | null }>();
    try {
      refs = await loadSimpleInventoryLotReferences();
      const first = refs.values().next().value;
      if (first?.hasBaselineSurvey && first.baselineSurveyDate) {
        setBaselineHint(
          `최신 확정 조사: ${formatYmdDot(first.baselineSurveyDate)} — 참고값 = 해당 조사 snapshot + 이후 입고만`,
        );
      } else {
        setBaselineHint("아직 확정 조사 없음 — 참고값 = 입고 누적(inbound만, usage 미반영)");
      }
    } catch {
      setBaselineHint(null);
    }

    const existing = new Map(lines.map((l) => [l.lot_id, l.physical_qty]));
    setLotRows(
      ((data ?? []) as HarangInventoryLot[]).map((lot) => {
        const ref = refs.get(lot.id);
        const refQty = ref?.referenceQty ?? null;
        return {
          ...lot,
          referenceQty: refQty,
          referenceLabel: ref
            ? ref.hasBaselineSurvey
              ? "조사+입고"
              : "입고누적"
            : "—",
          physicalStr: existing.has(lot.id) ? String(existing.get(lot.id)) : "",
        };
      }),
    );
  }, [lines]);

  useEffect(() => {
    void loadSurvey();
  }, [loadSurvey]);

  useEffect(() => {
    if (survey?.status === "draft") void loadLotsForDraft();
  }, [survey?.status, loadLotsForDraft]);

  const filteredLots = useMemo(() => {
    let rows = lotRows;
    if (categoryFilter !== "all") {
      rows = rows.filter((l) => l.category === categoryFilter);
    }
    if (hideZeroEstimate) {
      rows = rows.filter(isZeroStockEstimateLot);
    }
    const q = filter.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (l) =>
          l.item_name.toLowerCase().includes(q) ||
          l.item_code.toLowerCase().includes(q) ||
          l.lot_date.includes(q),
      );
    }
    return rows;
  }, [lotRows, categoryFilter, hideZeroEstimate, filter]);

  const lotStats = useMemo(() => {
    const base = computeLotInputStats(lotRows);
    return { ...base, visible: filteredLots.length };
  }, [lotRows, filteredLots.length]);

  const fillAllEmptyWithZero = () => {
    setLotRows((prev) =>
      prev.map((lot) => (lot.physicalStr.trim() === "" ? { ...lot, physicalStr: "0" } : lot)),
    );
  };

  const fillVisibleEmptyWithZero = () => {
    const visibleIds = new Set(filteredLots.map((l) => l.id));
    setLotRows((prev) =>
      prev.map((lot) =>
        visibleIds.has(lot.id) && lot.physicalStr.trim() === "" ? { ...lot, physicalStr: "0" } : lot,
      ),
    );
  };

  const handleSave = async (): Promise<boolean> => {
    if (!id || !isDraft) return false;

    const missing: string[] = [];
    const payload = lotRows.map((lot) => {
      const trimmed = lot.physicalStr.trim();
      if (trimmed === "") {
        missing.push(`${lot.item_name} (${formatYmdDot(lot.lot_date)})`);
        return null;
      }
      const qty = parseQty(lot.physicalStr);
      if (!Number.isFinite(qty)) {
        missing.push(`${lot.item_name} (${formatYmdDot(lot.lot_date)})`);
        return null;
      }
      return {
        survey_id: id,
        lot_id: lot.id,
        category: lot.category,
        item_id: lot.item_id,
        item_code: lot.item_code,
        item_name: lot.item_name,
        lot_date: lot.lot_date,
        unit: lot.unit,
        physical_qty: qty,
      };
    });

    if (missing.length > 0) {
      alert(
        `모든 LOT에 실사 수량을 입력하세요 (0 가능). 누락 ${missing.length}건\n예: ${missing.slice(0, 3).join(", ")}`,
      );
      return false;
    }

    if (payload.length !== lotRows.length) {
      alert("저장할 실사 데이터가 올바르지 않습니다.");
      return false;
    }

    setSaving(true);
    const { error: delErr } = await supabase.from("harang_inventory_survey_lines").delete().eq("survey_id", id);
    if (delErr) {
      setSaving(false);
      alert(delErr.message);
      return false;
    }
    const { error: insErr } = await supabase.from("harang_inventory_survey_lines").insert(payload);
    setSaving(false);
    if (insErr) {
      alert(insErr.message);
      return false;
    }
    void loadSurvey();
    return true;
  };

  const handleSaveWithAlert = async () => {
    const ok = await handleSave();
    if (ok) alert("저장되었습니다.");
  };

  const handleConfirm = async () => {
    if (!id || !isDraft) return;
    if (lotStats.unfilled > 0) {
      alert(
        `미입력 LOT가 있습니다. 실재고가 없는 LOT는 0으로 입력해야 합니다. 「미입력 전체 0 입력」 버튼을 사용해 처리할 수 있습니다. (미입력 ${lotStats.unfilled}건)`,
      );
      return;
    }
    if (!confirm("확정하면 수정할 수 없습니다. 모든 LOT 실사 스냅샷을 확정할까요?")) return;
    const saved = await handleSave();
    if (!saved) return;
    setConfirming(true);
    const { error } = await supabase.rpc("confirm_harang_inventory_survey", { p_survey_id: id });
    setConfirming(false);
    if (error) {
      alert(error.message);
      return;
    }
    alert("재고조사가 확정되었습니다.");
    void loadSurvey();
  };

  const handleDelete = async () => {
    if (!id || !isDraft) return;
    if (!confirm("작성 중인 재고조사를 삭제할까요?")) return;
    await supabase.from("harang_inventory_survey_lines").delete().eq("survey_id", id);
    const { error } = await supabase.from("harang_inventory_surveys").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    router.replace("/harang/simple-inventory/surveys");
  };

  if (loading || !survey) {
    return <div className="px-6 py-10 text-slate-600">불러오는 중…</div>;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/harang/simple-inventory/surveys" className="text-sm text-slate-600 hover:text-slate-900">
              ← 재고조사 목록
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              재고조사 {formatYmdDot(survey.survey_date)}
              {survey.title ? ` · ${survey.title}` : ""}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              상태: {survey.status === "confirmed" ? "확정" : "작성중"}
              {survey.note ? ` · ${survey.note}` : ""}
            </p>
          </div>
          {isDraft && (
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="px-3 py-2 rounded-lg border border-red-200 text-red-700 text-sm hover:bg-red-50"
                >
                  삭제
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveWithAlert()}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-60"
                >
                  {saving ? "저장 중…" : "임시 저장"}
                </button>
                <button
                  type="button"
                  disabled={confirming || saving || lotStats.unfilled > 0}
                  onClick={() => void handleConfirm()}
                  className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-60"
                  title={
                    lotStats.unfilled > 0
                      ? "미입력 LOT가 있습니다. 실재고가 없으면 0으로 입력하세요."
                      : undefined
                  }
                >
                  {confirming ? "확정 중…" : "확정"}
                </button>
              </div>
              {lotStats.unfilled > 0 ? (
                <p className="text-xs text-amber-700">
                  미입력 LOT {lotStats.unfilled}건 — 실재고가 없으면 0으로 입력하세요.
                </p>
              ) : (
                <p className="text-xs text-emerald-700">전체 LOT 입력 완료 — 확정 가능</p>
              )}
            </div>
          )}
        </div>

        {isDraft ? (
          <>
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950">
              <p className="font-semibold">실사 스냅샷만 저장합니다</p>
              <p className="mt-1 text-red-900">
                이 재고조사는 기존 생산입력이나 원장 사용량을 수정하지 않습니다. 입력한 실재고는 조사 기준 재고로
                저장되며, 다음 조사와 비교해 계산 소모량을 산출합니다.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
              <p>
                이 화면은 해당 조사일의 <strong>전체 LOT</strong> 재고 스냅샷을 만드는 화면입니다. 실물 재고가 없는
                LOT도 <strong>0</strong>으로 입력해야 합니다. 첫 번째 확정 조사는 기준선이며, 소모량 리포트는 두 번째
                조사부터 생성됩니다.
              </p>
              <p className="mt-2">
                <strong>전체 LOT 필수 입력</strong> — 필터로 숨긴 LOT도 포함해 모든 LOT에 실사 수량이 있어야
                확정할 수 있습니다. 빈칸은 저장·확정되지 않습니다.
              </p>
              {baselineHint ? <p className="mt-1 text-slate-600">{baselineHint}</p> : null}
            </div>

            <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950 tabular-nums">
              전체 LOT {lotStats.total}건 / 표시 {lotStats.visible}건 / 입력 완료 {lotStats.filled}건 / 미입력{" "}
              {lotStats.unfilled}건 / 0 입력 {lotStats.zeroFilled}건
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-xs text-slate-600">
                분류
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
                  className="mt-1 block px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="all">전체</option>
                  <option value="raw_material">원재료</option>
                  <option value="packaging_material">부자재</option>
                </select>
              </label>
              <label className="block text-xs text-slate-600 flex-1 min-w-[200px] max-w-md">
                검색
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="품목명·코드·소비기한"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideZeroEstimate}
                  onChange={(e) => setHideZeroEstimate(e.target.checked)}
                  className="rounded border-slate-300"
                />
                재고 0 추정 LOT 숨기기
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={fillAllEmptyWithZero}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm hover:bg-slate-50"
              >
                미입력 전체 0 입력
              </button>
              <button
                type="button"
                onClick={fillVisibleEmptyWithZero}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm hover:bg-slate-50"
              >
                표시 중 빈칸 0 입력
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">품목</th>
                    <th className="px-3 py-2 text-left">소비기한</th>
                    <th className="px-3 py-2 text-left">분류</th>
                    <th className="px-3 py-2 text-right">참고 (간편재고)</th>
                    <th className="px-3 py-2 text-right">실사 수량</th>
                    <th className="px-3 py-2 text-left">단위</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLots.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                        필터 조건에 맞는 LOT가 없습니다. 분류·검색·숨김 설정을 확인하세요.
                      </td>
                    </tr>
                  )}
                  {filteredLots.map((lot) => (
                    <tr key={lot.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">{lot.item_name}</td>
                      <td className="px-3 py-2 tabular-nums">{formatYmdDot(lot.lot_date)}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {lot.category === "raw_material" ? "원재료" : "부자재"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {lot.referenceQty != null ? (
                          <>
                            {Number(lot.referenceQty).toLocaleString()}
                            <span className="ml-1 text-[10px] text-slate-400">{lot.referenceLabel}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={lot.physicalStr}
                          onChange={(e) =>
                            setLotRows((prev) =>
                              prev.map((r) => (r.id === lot.id ? { ...r, physicalStr: e.target.value } : r)),
                            )
                          }
                          className={`w-28 px-2 py-1 rounded border text-right tabular-nums text-sm ${
                            lot.physicalStr.trim() === ""
                              ? "border-amber-300 bg-amber-50"
                              : !isLotInputFilled(lot.physicalStr)
                                ? "border-red-300 bg-red-50"
                                : "border-slate-300"
                          }`}
                        />
                      </td>
                      <td className="px-3 py-2">{lot.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">품목</th>
                  <th className="px-3 py-2 text-left">소비기한</th>
                  <th className="px-3 py-2 text-right">실사 수량</th>
                  <th className="px-3 py-2 text-left">단위</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                      라인 없음
                    </td>
                  </tr>
                )}
                {lines
                  .slice()
                  .sort((a, b) => a.item_name.localeCompare(b.item_name) || a.lot_date.localeCompare(b.lot_date))
                  .map((line) => (
                    <tr key={line.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">{line.item_name}</td>
                      <td className="px-3 py-2 tabular-nums">{formatYmdDot(line.lot_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {Number(line.physical_qty).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{line.unit}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {!isDraft && lines.length > 0 && (
          <p className="text-sm text-slate-600">
            소모량은{" "}
            <Link href="/harang/simple-inventory/report" className="text-cyan-700 underline">
              소모량 리포트
            </Link>
            에서 이전 확정 조사와 비교해 확인할 수 있습니다.
          </p>
        )}
      </div>
    </div>
  );
}
