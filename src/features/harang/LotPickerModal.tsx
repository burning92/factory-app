"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { HarangCategory, HarangInventoryLot } from "@/features/harang/types";

export type LotAllocation = { lot_id: string; quantity_used: number };
const PARBAKE_BOX_EA = 40;

function formatLotNo(isoDate: string): string {
  if (!isoDate) return "";
  return isoDate.replaceAll("-", ".");
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isParbakeDoughName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

type Props = {
  open: boolean;
  onClose: () => void;
  materialName: string;
  category: HarangCategory;
  materialId: string;
  initialAllocations: LotAllocation[];
  /** 이번 생산수량 기준 BOM 소요량(상세 표의 BOM 열과 동일). LOT 입력 시 참고용. */
  bomRequiredQty?: number | null;
  /** 표시 단위(예: g, EA). 없으면 재고 LOT의 unit을 쓸 수 있음 */
  bomUnit?: string | null;
  /** 적용 시 LOT 입력 합계가 사용량이 되며, 표시용 날짜 요약 문자열이 함께 전달됩니다. */
  onApply: (allocations: LotAllocation[], lotDatesSummary: string) => void;
};

export default function LotPickerModal({
  open,
  onClose,
  materialName,
  category,
  materialId,
  initialAllocations,
  bomRequiredQty,
  bomUnit,
  onApply,
}: Props) {
  const [lots, setLots] = useState<HarangInventoryLot[]>([]);
  const [loading, setLoading] = useState(false);
  /** 수량(차감 수량) — LOT 단위 */
  const [inputs, setInputs] = useState<Record<string, string>>({});
  /** 박스 수 — 원재료이고 1박스 중량이 있을 때만 사용 */
  const [boxInputs, setBoxInputs] = useState<Record<string, string>>({});
  /** 낱개 수 */
  const [unitInputs, setUnitInputs] = useState<Record<string, string>>({});
  /** 잔량(g) */
  const [remainderInputs, setRemainderInputs] = useState<Record<string, string>>({});
  const [boxWeightG, setBoxWeightG] = useState<number | null>(null);
  const [unitWeightG, setUnitWeightG] = useState<number | null>(null);

  const loadBoxWeight = useCallback(async () => {
    if (!materialId || category !== "raw_material") {
      setBoxWeightG(null);
      setUnitWeightG(null);
      return;
    }
    const { data, error } = await supabase
      .from("harang_raw_materials")
      .select("box_weight_g, unit_weight_g")
      .eq("id", materialId)
      .maybeSingle();
    if (error || !data) {
      setBoxWeightG(null);
      setUnitWeightG(null);
      return;
    }
    const boxW = Number((data as { box_weight_g?: number; unit_weight_g?: number }).box_weight_g);
    const unitW = Number((data as { box_weight_g?: number; unit_weight_g?: number }).unit_weight_g);
    setBoxWeightG(Number.isFinite(boxW) && boxW > 0 ? boxW : null);
    setUnitWeightG(Number.isFinite(unitW) && unitW > 0 ? unitW : null);
  }, [category, materialId]);

  const loadLots = useCallback(async () => {
    if (!materialId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("harang_inventory_lots")
      .select(
        "id, category, item_id, item_code, item_name, lot_date, inbound_date, inbound_route, current_quantity, unit, note",
      )
      .eq("category", category)
      .eq("item_id", materialId)
      .gt("current_quantity", 0)
      .order("lot_date", { ascending: true });
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    setLots((data ?? []) as HarangInventoryLot[]);
  }, [category, materialId]);

  useEffect(() => {
    if (!open) return;
    void loadLots();
    void loadBoxWeight();
  }, [open, loadLots, loadBoxWeight]);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    const nextBoxes: Record<string, string> = {};
    const nextUnits: Record<string, string> = {};
    const nextRemainders: Record<string, string> = {};
    for (const lot of lots) {
      const found = initialAllocations.find((a) => a.lot_id === lot.id);
      const qty = found ? found.quantity_used : 0;
      const isParbake = isParbakeDoughName(materialName);
      const isRaw = category === "raw_material" && !isParbake;
      if (isParbake) {
        const box = Math.floor(Math.max(0, qty) / PARBAKE_BOX_EA);
        const unit = Math.max(0, qty) - box * PARBAKE_BOX_EA;
        next[lot.id] = "";
        nextBoxes[lot.id] = box > 0 ? String(box) : "";
        nextUnits[lot.id] = unit > 0 ? String(unit) : "";
        nextRemainders[lot.id] = "";
        continue;
      }
      if (isRaw) {
        const bw = boxWeightG && boxWeightG > 0 ? boxWeightG : 0;
        const uw = unitWeightG && unitWeightG > 0 ? unitWeightG : 0;
        const box = bw > 0 ? Math.floor(Math.max(0, qty) / bw) : 0;
        const afterBox = Math.max(0, qty) - box * bw;
        const unit = uw > 0 ? Math.floor(afterBox / uw) : 0;
        const remainder = afterBox - unit * uw;
        next[lot.id] = "";
        nextBoxes[lot.id] = box > 0 ? String(box) : "";
        nextUnits[lot.id] = unit > 0 ? String(unit) : "";
        nextRemainders[lot.id] = remainder > 0 ? String(roundTo3(remainder)) : "";
        continue;
      }
      next[lot.id] = found ? String(found.quantity_used) : "";
      if (boxWeightG && boxWeightG > 0 && qty > 0) {
        nextBoxes[lot.id] = String(roundTo3(qty / boxWeightG));
      } else {
        nextBoxes[lot.id] = "";
      }
      nextUnits[lot.id] = "";
      nextRemainders[lot.id] = "";
    }
    setInputs(next);
    setBoxInputs(nextBoxes);
    setUnitInputs(nextUnits);
    setRemainderInputs(nextRemainders);
  }, [open, lots, initialAllocations, boxWeightG, unitWeightG, materialName, category]);

  const isParbake = category === "raw_material" && isParbakeDoughName(materialName);
  const isRawWeightMode = category === "raw_material" && !isParbake;
  const canUseBoxInput = isParbake || (isRawWeightMode && boxWeightG != null && boxWeightG > 0);
  const canUseUnitInput = isParbake || (isRawWeightMode && unitWeightG != null && unitWeightG > 0);

  const rows = useMemo(() => {
    return lots.map((lot) => {
      const raw = inputs[lot.id] ?? "";
      const boxRaw = boxInputs[lot.id] ?? "";
      const unitRaw = unitInputs[lot.id] ?? "";
      const remainderRaw = remainderInputs[lot.id] ?? "";
      const boxN = Number(boxRaw);
      const unitN = Number(unitRaw);
      const remN = Number(remainderRaw);
      const qtyN = Number(raw);
      const safeQty = isParbake
        ? (Number.isFinite(boxN) && boxN >= 0 ? boxN : 0) * PARBAKE_BOX_EA +
          (Number.isFinite(unitN) && unitN >= 0 ? unitN : 0)
        : isRawWeightMode
          ? (Number.isFinite(boxN) && boxN >= 0 ? boxN : 0) * (boxWeightG ?? 0) +
            (Number.isFinite(unitN) && unitN >= 0 ? unitN : 0) * (unitWeightG ?? 0) +
            (Number.isFinite(remN) && remN >= 0 ? remN : 0)
        : raw.trim() === ""
          ? 0
          : Number.isFinite(qtyN) && qtyN >= 0
            ? qtyN
            : 0;
      const after = Math.max(0, Number(lot.current_quantity) - safeQty);
      return { lot, inputRaw: raw, boxRaw, unitRaw, remainderRaw, qty: safeQty, after };
    });
  }, [lots, inputs, boxInputs, unitInputs, remainderInputs, isParbake, isRawWeightMode, boxWeightG, unitWeightG]);

  const setQtyForLot = (lotId: string, value: string) => {
    setInputs((prev) => ({ ...prev, [lotId]: value }));
    if (!value.trim()) {
      setBoxInputs((prev) => ({ ...prev, [lotId]: "" }));
      return;
    }
    const q = Number(value);
    if (isRawWeightMode && Number.isFinite(q) && q >= 0 && boxWeightG) {
      setBoxInputs((prev) => ({
        ...prev,
        [lotId]: q > 0 ? String(roundTo3(q / boxWeightG)) : "",
      }));
    }
  };

  const setBoxForLot = (lotId: string, value: string) => {
    setBoxInputs((prev) => ({ ...prev, [lotId]: value }));
    if (isParbake || isRawWeightMode) return;
    if (!value.trim()) {
      setInputs((prev) => ({ ...prev, [lotId]: "" }));
      return;
    }
    const b = Number(value);
    if (isRawWeightMode && boxWeightG && Number.isFinite(b) && b >= 0) {
      setInputs((prev) => ({
        ...prev,
        [lotId]: b > 0 ? String(roundTo3(b * boxWeightG)) : "",
      }));
    }
  };

  const setUnitForLot = (lotId: string, value: string) => {
    setUnitInputs((prev) => ({ ...prev, [lotId]: value }));
  };

  const setRemainderForLot = (lotId: string, value: string) => {
    setRemainderInputs((prev) => ({ ...prev, [lotId]: value }));
  };

  const sumInput = useMemo(() => rows.reduce((s, r) => s + r.qty, 0), [rows]);
  const bomUnitDisplay = useMemo(() => {
    const u = (bomUnit ?? "").trim();
    if (u) return u;
    const fromLot = lots[0]?.unit;
    return fromLot ? String(fromLot) : "";
  }, [bomUnit, lots]);

  const totalCurrentStock = useMemo(
    () => rows.reduce((s, r) => s + Number(r.lot.current_quantity || 0), 0),
    [rows],
  );
  const reflectedStock = useMemo(() => Math.max(0, totalCurrentStock - sumInput), [totalCurrentStock, sumInput]);

  const handleApply = () => {
    const allocations: LotAllocation[] = [];
    for (const r of rows) {
      if (r.qty > 0) {
        if (r.qty > Number(r.lot.current_quantity)) {
          alert(`재고를 초과했습니다: ${formatLotNo(r.lot.lot_date)}`);
          return;
        }
        allocations.push({ lot_id: r.lot.id, quantity_used: r.qty });
      }
    }
    const dateKeys = new Set<string>();
    for (const a of allocations) {
      const lot = lots.find((l) => l.id === a.lot_id);
      if (lot?.lot_date) dateKeys.add(formatLotNo(lot.lot_date));
    }
    const lotDatesSummary = Array.from(dateKeys).sort().join(" · ");
    onApply(allocations, lotDatesSummary);
    onClose();
  };

  if (!open) return null;

  const wideInput =
    "mt-0.5 w-full min-w-0 rounded border border-slate-300 px-2 py-1.5 text-right text-slate-900 bg-white";
  const wideInputDisabled =
    "mt-0.5 w-full min-w-0 rounded border border-slate-300 px-2 py-1.5 text-right text-slate-400 bg-slate-100";

  const desktopColCount = isParbake ? 6 : 7;

  const renderLotCardBody = (p: {
    lot: HarangInventoryLot;
    inputRaw: string;
    boxRaw: string;
    unitRaw: string;
    remainderRaw: string;
    qty: number;
    after: number;
  }) => {
    const { lot, inputRaw, boxRaw, unitRaw, remainderRaw, qty, after } = p;
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {isRawWeightMode || isParbake ? (
          <label className="text-xs text-slate-600">
            박스
            <input
              type="text"
              inputMode="decimal"
              value={boxRaw}
              onChange={(e) => setBoxForLot(lot.id, e.target.value)}
              disabled={!canUseBoxInput}
              className={canUseBoxInput ? wideInput : wideInputDisabled}
              title={
                isParbake
                  ? `1박스 = ${PARBAKE_BOX_EA}EA`
                  : boxWeightG
                    ? `1박스 = ${boxWeightG}g`
                    : undefined
              }
            />
          </label>
        ) : (
          <div className="text-xs text-slate-500 sm:col-span-2">박스: —</div>
        )}

        {isParbake || isRawWeightMode ? (
          <label className="text-xs text-slate-600">
            낱개
            <input
              type="text"
              inputMode="decimal"
              value={unitRaw}
              onChange={(e) => setUnitForLot(lot.id, e.target.value)}
              disabled={!canUseUnitInput}
              className={canUseUnitInput ? wideInput : wideInputDisabled}
            />
          </label>
        ) : (
          <label className="text-xs text-slate-600">
            수량
            <input
              type="text"
              inputMode="decimal"
              value={inputRaw}
              onChange={(e) => setQtyForLot(lot.id, e.target.value)}
              className={wideInput}
            />
          </label>
        )}

        {isRawWeightMode ? (
          <label className="text-xs text-slate-600 sm:col-span-2">
            잔량(g)
            <input
              type="text"
              inputMode="decimal"
              value={remainderRaw}
              onChange={(e) => setRemainderForLot(lot.id, e.target.value)}
              className={wideInput}
            />
          </label>
        ) : !isParbake ? (
          <div className="text-xs text-slate-700 sm:col-span-2">
            <span className="text-slate-500">잔량</span>{" "}
            <span className="tabular-nums font-medium text-slate-800">
              {after.toLocaleString(undefined, { maximumFractionDigits: 3 })}
              <span className="text-slate-500 ml-0.5">{lot.unit}</span>
            </span>
          </div>
        ) : null}

        <div className="text-xs text-slate-700 sm:col-span-2">
          <span className="text-slate-500">총사용량</span>{" "}
          <span className="tabular-nums font-semibold text-cyan-900">
            {qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
            <span className="ml-0.5 text-slate-600">{lot.unit}</span>
          </span>
        </div>
        <div className="text-xs text-slate-700 sm:col-span-2">
          <span className="text-slate-500">반영재고</span>{" "}
          <span className="tabular-nums font-medium text-slate-900">
            {after.toLocaleString(undefined, { maximumFractionDigits: 3 })}
            <span className="ml-0.5 text-slate-600">{lot.unit}</span>
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="relative z-[301] flex w-full max-w-5xl max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white text-slate-900 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{materialName}</p>
            <p className="text-xs text-slate-500">
              LOT별로 박스·수량·잔량을 입력합니다. 1박스 중량이 등록된 원재료는 박스 입력 시 수량(g)이 자동 계산됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {bomRequiredQty != null && Number.isFinite(bomRequiredQty) && bomRequiredQty >= 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-200/90 bg-cyan-50 px-4 py-2.5 text-slate-900">
            <span className="text-xs font-semibold tracking-tight text-slate-800">이번 생산 BOM 필요량</span>
            <span className="text-sm font-bold tabular-nums text-cyan-900">
              {bomRequiredQty.toLocaleString("ko-KR", { maximumFractionDigits: 3 })}
              {bomUnitDisplay ? (
                <span className="ml-1 font-semibold text-slate-700">{bomUnitDisplay}</span>
              ) : null}
            </span>
          </div>
        )}

        <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2 text-xs text-slate-600">
          <Search className="w-4 h-4 shrink-0" />
          <span>목록은 유통기한·제조일자(LOT) 순입니다.</span>
        </div>

        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
          {loading && <p className="p-6 text-center text-sm text-slate-500">불러오는 중…</p>}
          {!loading && lots.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-600">사용 가능한 재고 LOT가 없습니다.</p>
          )}

          {!loading && lots.length > 0 && (
            <>
              {/* narrow view: 카드·세로 배치 — 가로 스크롤 없이 전부 노출 */}
              <div className="space-y-3 p-3 lg:hidden">
                {rows.map(({ lot, inputRaw, boxRaw, unitRaw, remainderRaw, qty, after }) => (
                  <div
                    key={lot.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 shadow-sm"
                  >
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200/80 pb-2">
                      <span className="text-xs font-medium text-slate-500">시리얼/로트</span>
                      <span className="text-sm font-semibold text-slate-900">{formatLotNo(lot.lot_date)}</span>
                    </div>
                    <div className="mb-3 text-xs text-slate-600">
                      <span className="text-slate-500">현재고</span>{" "}
                      <span className="tabular-nums font-medium text-slate-800">
                        {Number(lot.current_quantity).toLocaleString()}
                        {lot.unit}
                      </span>
                    </div>
                    {renderLotCardBody({ lot, inputRaw, boxRaw, unitRaw, remainderRaw, qty, after })}
                  </div>
                ))}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>합계(수량/재고)</span>
                    <span className="tabular-nums">
                      {sumInput.toLocaleString()} / {reflectedStock.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* wide view: 모달 너비에 맞춘 고정 테이블 — 가로 스크롤 없이 한 화면에 맞춤 */}
              <div className="hidden p-2 lg:block">
                <table className="w-full table-fixed text-[11px] leading-tight sm:text-xs">
                  <colgroup>
                    {Array.from({ length: desktopColCount }).map((_, i) => (
                      <col
                        key={i}
                        style={{ width: `${100 / desktopColCount}%` }}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                      <th className="min-w-0 px-1 py-1.5 text-left font-medium">시리얼/로트</th>
                      <th className="min-w-0 px-1 py-1.5 text-right font-medium">현재고</th>
                      <th className="min-w-0 px-1 py-1.5 text-right font-medium">박스</th>
                      {isParbake || isRawWeightMode ? (
                        <th className="min-w-0 px-1 py-1.5 text-right font-medium">낱개</th>
                      ) : (
                        <th className="min-w-0 px-1 py-1.5 text-right font-medium">수량</th>
                      )}
                      {isRawWeightMode ? (
                        <th className="min-w-0 px-1 py-1.5 text-right font-medium">잔량(g)</th>
                      ) : !isParbake ? (
                        <th className="min-w-0 px-1 py-1.5 text-right font-medium">잔량</th>
                      ) : null}
                      <th className="min-w-0 px-1 py-1.5 text-right font-medium">총사용량</th>
                      <th className="min-w-0 px-1 py-1.5 text-right font-medium">반영재고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ lot, inputRaw, boxRaw, unitRaw, remainderRaw, qty, after }) => (
                      <tr key={lot.id} className="border-b border-slate-100">
                        <td className="min-w-0 px-1 py-1.5 break-words text-slate-900">
                          {formatLotNo(lot.lot_date)}
                        </td>
                        <td className="min-w-0 px-1 py-1.5 text-right text-[10px] tabular-nums text-slate-800 sm:text-xs">
                          {Number(lot.current_quantity).toLocaleString()}
                          <span className="ml-0.5 text-slate-500">{lot.unit}</span>
                        </td>
                        <td className="min-w-0 px-0.5 py-1 text-right">
                          {isRawWeightMode || isParbake ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={boxRaw}
                              onChange={(e) => setBoxForLot(lot.id, e.target.value)}
                              disabled={!canUseBoxInput}
                              className={`w-full min-w-0 max-w-full rounded border border-slate-300 px-0.5 py-0.5 text-right text-[10px] sm:px-1 sm:text-xs ${
                                canUseBoxInput ? "text-slate-900 bg-white" : "text-slate-400 bg-slate-100"
                              }`}
                              title={
                                isParbake
                                  ? `1박스 = ${PARBAKE_BOX_EA}EA`
                                  : boxWeightG
                                    ? `1박스 = ${boxWeightG}g`
                                    : undefined
                              }
                            />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="min-w-0 px-0.5 py-1 text-right">
                          {isParbake || isRawWeightMode ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={unitRaw}
                              onChange={(e) => setUnitForLot(lot.id, e.target.value)}
                              disabled={!canUseUnitInput}
                              className={`w-full min-w-0 max-w-full rounded border border-slate-300 px-0.5 py-0.5 text-right text-[10px] sm:px-1 sm:text-xs ${
                                canUseUnitInput ? "text-slate-900 bg-white" : "text-slate-400 bg-slate-100"
                              }`}
                            />
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={inputRaw}
                              onChange={(e) => setQtyForLot(lot.id, e.target.value)}
                              className="w-full min-w-0 max-w-full rounded border border-slate-300 bg-white px-0.5 py-0.5 text-right text-[10px] text-slate-900 sm:px-1 sm:text-xs"
                            />
                          )}
                        </td>
                        {isRawWeightMode ? (
                          <td className="min-w-0 px-0.5 py-1 text-right">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={remainderRaw}
                              onChange={(e) => setRemainderForLot(lot.id, e.target.value)}
                              className="w-full min-w-0 max-w-full rounded border border-slate-300 bg-white px-0.5 py-0.5 text-right text-[10px] text-slate-900 sm:px-1 sm:text-xs"
                            />
                          </td>
                        ) : !isParbake ? (
                          <td className="min-w-0 px-0.5 py-1.5 text-right text-[10px] tabular-nums text-slate-700 sm:text-xs">
                            {after.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                            <span className="ml-0.5 text-slate-500">{lot.unit}</span>
                          </td>
                        ) : null}
                        <td className="min-w-0 px-0.5 py-1.5 text-right text-[10px] tabular-nums text-slate-700 sm:text-xs">
                          {qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                          <span className="ml-0.5 text-slate-500">{lot.unit}</span>
                        </td>
                        <td className="min-w-0 px-0.5 py-1.5 text-right text-[10px] tabular-nums text-slate-900 sm:text-xs">
                          {after.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                          <span className="ml-0.5 text-slate-500">{lot.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold text-slate-900">
                      <td
                        colSpan={isParbake ? 4 : isRawWeightMode ? 5 : 5}
                        className="px-1 py-2 text-right text-xs"
                      >
                        합계(수량/재고)
                      </td>
                      <td className="px-1 py-2 text-right text-xs tabular-nums">{sumInput.toLocaleString()}</td>
                      <td className="px-1 py-2 text-right text-xs tabular-nums">
                        {reflectedStock.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-slate-200 px-4 py-3 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white hover:bg-slate-50"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={loading || lots.length === 0}
            className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-50"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
