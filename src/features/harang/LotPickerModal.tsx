"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { HarangCategory, HarangInventoryLot } from "@/features/harang/types";

export type LotAllocation = { lot_id: string; quantity_used: number };

function formatLotNo(isoDate: string): string {
  if (!isoDate) return "";
  return isoDate.replaceAll("-", ".");
}

function roundTo3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type Props = {
  open: boolean;
  onClose: () => void;
  materialName: string;
  category: HarangCategory;
  materialId: string;
  initialAllocations: LotAllocation[];
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
  onApply,
}: Props) {
  const [lots, setLots] = useState<HarangInventoryLot[]>([]);
  const [loading, setLoading] = useState(false);
  /** 수량(차감 수량) — LOT 단위 */
  const [inputs, setInputs] = useState<Record<string, string>>({});
  /** 박스 수 — 원재료이고 1박스 중량이 있을 때만 사용 */
  const [boxInputs, setBoxInputs] = useState<Record<string, string>>({});
  const [boxWeightG, setBoxWeightG] = useState<number | null>(null);

  const loadBoxWeight = useCallback(async () => {
    if (!materialId || category !== "raw_material") {
      setBoxWeightG(null);
      return;
    }
    const { data, error } = await supabase
      .from("harang_raw_materials")
      .select("box_weight_g")
      .eq("id", materialId)
      .maybeSingle();
    if (error || !data) {
      setBoxWeightG(null);
      return;
    }
    const w = Number((data as { box_weight_g?: number }).box_weight_g);
    setBoxWeightG(Number.isFinite(w) && w > 0 ? w : null);
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
    for (const lot of lots) {
      const found = initialAllocations.find((a) => a.lot_id === lot.id);
      const qty = found ? found.quantity_used : 0;
      next[lot.id] = found ? String(found.quantity_used) : "";
      if (boxWeightG && boxWeightG > 0 && qty > 0) {
        nextBoxes[lot.id] = String(roundTo3(qty / boxWeightG));
      } else {
        nextBoxes[lot.id] = "";
      }
    }
    setInputs(next);
    setBoxInputs(nextBoxes);
  }, [open, lots, initialAllocations, boxWeightG]);

  const showBoxColumn = category === "raw_material" && boxWeightG != null && boxWeightG > 0;

  const rows = useMemo(() => {
    return lots.map((lot) => {
      const raw = inputs[lot.id] ?? "";
      const qty = raw.trim() === "" ? 0 : Number(raw);
      const safeQty = Number.isFinite(qty) && qty >= 0 ? qty : 0;
      const after = Math.max(0, Number(lot.current_quantity) - safeQty);
      const boxRaw = boxInputs[lot.id] ?? "";
      return { lot, inputRaw: raw, boxRaw, qty: safeQty, after };
    });
  }, [lots, inputs, boxInputs]);

  const setQtyForLot = (lotId: string, value: string) => {
    setInputs((prev) => ({ ...prev, [lotId]: value }));
    if (!value.trim()) {
      setBoxInputs((prev) => ({ ...prev, [lotId]: "" }));
      return;
    }
    const q = Number(value);
    if (showBoxColumn && Number.isFinite(q) && q >= 0 && boxWeightG) {
      setBoxInputs((prev) => ({
        ...prev,
        [lotId]: q > 0 ? String(roundTo3(q / boxWeightG)) : "",
      }));
    }
  };

  const setBoxForLot = (lotId: string, value: string) => {
    setBoxInputs((prev) => ({ ...prev, [lotId]: value }));
    if (!value.trim()) {
      setInputs((prev) => ({ ...prev, [lotId]: "" }));
      return;
    }
    const b = Number(value);
    if (showBoxColumn && boxWeightG && Number.isFinite(b) && b >= 0) {
      setInputs((prev) => ({
        ...prev,
        [lotId]: b > 0 ? String(roundTo3(b * boxWeightG)) : "",
      }));
    }
  };

  const sumInput = useMemo(() => rows.reduce((s, r) => s + r.qty, 0), [rows]);

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

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="relative z-[301] w-full max-w-3xl max-h-[90dvh] overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-xl flex flex-col">
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

        <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2 text-xs text-slate-600">
          <Search className="w-4 h-4 shrink-0" />
          <span>목록은 유통기한·제조일자(LOT) 순입니다.</span>
        </div>

        <div className="overflow-auto flex-1 min-h-0">
          {loading && <p className="p-6 text-center text-sm text-slate-500">불러오는 중…</p>}
          {!loading && lots.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-600">사용 가능한 재고 LOT가 없습니다.</p>
          )}
          {!loading && lots.length > 0 && (
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-medium">시리얼/로트 No.</th>
                  <th className="px-3 py-2 text-right font-medium">재고</th>
                  <th className="px-3 py-2 text-right font-medium">박스</th>
                  <th className="px-3 py-2 text-right font-medium">수량</th>
                  <th className="px-3 py-2 text-right font-medium">잔량</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ lot, inputRaw, boxRaw, qty, after }) => (
                  <tr key={lot.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-900">{formatLotNo(lot.lot_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                      {Number(lot.current_quantity).toLocaleString()}
                      <span className="text-slate-500 ml-0.5">{lot.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {showBoxColumn ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={boxRaw}
                          onChange={(e) => setBoxForLot(lot.id, e.target.value)}
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-slate-900 bg-white"
                          title={boxWeightG ? `1박스 = ${boxWeightG}g` : undefined}
                        />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={inputRaw}
                        onChange={(e) => setQtyForLot(lot.id, e.target.value)}
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-slate-900 bg-white"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {after.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                      <span className="text-slate-500 ml-0.5">{lot.unit}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold text-slate-900">
                  <td colSpan={3} className="px-3 py-2 text-right">
                    합계(수량)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{sumInput.toLocaleString()}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
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
