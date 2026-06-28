"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  DEFECT_PROCESSING_METHODS,
  type DisposalEligibleLotGroup,
  type DisposalLineInput,
  createDefectDisposal,
  fetchDisposalEligibleLotGroups,
  formatLotDateDot,
  itemKey,
  previewDisposalNo,
} from "@/features/harang/defectDisposal";

type LineForm = {
  line_id: string;
  item_key: string;
  lot_date: string;
  quantity: string;
  defect_type: string;
};

function makeEmptyLine(): LineForm {
  return {
    line_id: crypto.randomUUID(),
    item_key: "",
    lot_date: "",
    quantity: "",
    defect_type: "",
  };
}

function parseQty(raw: string): number {
  const n = Number(String(raw).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : 0;
}

export default function HarangDefectDisposalNewPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [disposalDate, setDisposalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [handlerName, setHandlerName] = useState("");
  const [processingMethod, setProcessingMethod] = useState<string>(DEFECT_PROCESSING_METHODS[0]);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineForm[]>([makeEmptyLine()]);
  const [eligibleGroups, setEligibleGroups] = useState<DisposalEligibleLotGroup[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [previewNo, setPreviewNo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (handlerName.trim()) return;
    const name = profile?.display_name?.trim() || profile?.login_id?.trim() || "";
    if (name) setHandlerName(name);
  }, [profile, handlerName]);

  const loadStock = useCallback(async () => {
    setLoadingStock(true);
    try {
      const groups = await fetchDisposalEligibleLotGroups(disposalDate);
      setEligibleGroups(groups);
    } catch (e) {
      alert(e instanceof Error ? e.message : "재고 조회 실패");
      setEligibleGroups([]);
    } finally {
      setLoadingStock(false);
    }
  }, [disposalDate]);

  useEffect(() => {
    void loadStock();
  }, [loadStock]);

  useEffect(() => {
    void previewDisposalNo(disposalDate)
      .then(setPreviewNo)
      .catch(() => setPreviewNo(""));
  }, [disposalDate]);

  const itemOptions = useMemo(() => {
    const map = new Map<string, DisposalEligibleLotGroup>();
    for (const g of eligibleGroups) {
      const key = itemKey(g.category, g.item_id);
      if (!map.has(key)) map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => a.item_name.localeCompare(b.item_name, "ko"));
  }, [eligibleGroups]);

  const lotDatesForItem = useCallback(
    (itemKeyVal: string) => {
      if (!itemKeyVal) return [];
      return eligibleGroups
        .filter((g) => itemKey(g.category, g.item_id) === itemKeyVal)
        .sort((a, b) => a.lot_date.localeCompare(b.lot_date));
    },
    [eligibleGroups],
  );

  const maxQtyForLine = useCallback(
    (itemKeyVal: string, lotDate: string) => {
      const g = eligibleGroups.find(
        (x) => itemKey(x.category, x.item_id) === itemKeyVal && x.lot_date === lotDate,
      );
      return g?.stock_qty ?? 0;
    },
    [eligibleGroups],
  );

  const updateLine = (lineId: string, patch: Partial<LineForm>) => {
    setLines((prev) =>
      prev.map((row) => {
        if (row.line_id !== lineId) return row;
        const next = { ...row, ...patch };
        if ("item_key" in patch && patch.item_key !== row.item_key) {
          next.lot_date = "";
          next.quantity = "";
        }
        if ("lot_date" in patch && patch.lot_date !== row.lot_date) {
          next.quantity = "";
        }
        return next;
      }),
    );
  };

  const addLine = () => setLines((prev) => [...prev, makeEmptyLine()]);

  const removeLine = (lineId: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.line_id !== lineId)));
  };

  const handleSave = async () => {
    const payload: DisposalLineInput[] = [];
    for (const row of lines) {
      if (!row.item_key && !row.lot_date && !row.quantity.trim() && !row.defect_type.trim()) {
        continue;
      }
      const qty = parseQty(row.quantity);
      const defect = row.defect_type.trim();
      if (!row.item_key || !row.lot_date) {
        alert("품목과 소비기한을 선택하세요.");
        return;
      }
      if (qty <= 0) {
        alert("수량을 입력하세요.");
        return;
      }
      if (!defect) {
        alert("불량유형/사유를 입력하세요.");
        return;
      }
      const max = maxQtyForLine(row.item_key, row.lot_date);
      if (qty > max + 0.0005) {
        alert(`재고를 초과했습니다: ${row.lot_date} (최대 ${max.toLocaleString()})`);
        return;
      }
      const [category, itemId] = row.item_key.split(":") as ["raw_material" | "packaging_material", string];
      payload.push({
        category,
        item_id: itemId,
        lot_date: row.lot_date,
        quantity: qty,
        defect_type: defect,
      });
    }

    if (payload.length === 0) {
      alert("저장할 불량 품목이 없습니다.");
      return;
    }

    setSaving(true);
    try {
      const id = await createDefectDisposal({
        disposal_date: disposalDate,
        handler_name: handlerName,
        processing_method: processingMethod,
        note,
        lines: payload,
      });
      router.push(`/harang/defect-disposal/${id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/harang/defect-disposal"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              ← 불량처리조회
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">불량처리입력</h1>
            <p className="mt-1 text-sm text-slate-600">
              선택 일자 기준 재고에서만 품목·소비기한을 고를 수 있습니다.
            </p>
          </div>
          {previewNo ? (
            <p className="text-sm text-slate-600">
              전표번호(예상): <span className="font-mono font-medium text-slate-900">{previewNo}</span>
            </p>
          ) : null}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <label className="block text-sm">
              <span className="text-slate-700 font-medium">일자</span>
              <input
                type="date"
                value={disposalDate}
                onChange={(e) => setDisposalDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700 font-medium">담당자</span>
              <input
                type="text"
                value={handlerName}
                onChange={(e) => setHandlerName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="담당자명"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700 font-medium">처리방법</span>
              <select
                value={processingMethod}
                onChange={(e) => setProcessingMethod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 bg-white"
              >
                {DEFECT_PROCESSING_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm sm:col-span-2 lg:col-span-1">
              <span className="text-slate-700 font-medium">비고</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">불량 품목</h2>
            <p className="text-xs text-slate-600">
              {loadingStock
                ? "기준일 재고 불러오는 중…"
                : `선택 가능 LOT ${eligibleGroups.length}건 (${disposalDate} 포함)`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 border-b border-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left w-10">#</th>
                  <th className="px-3 py-2 text-left min-w-[180px]">품목명</th>
                  <th className="px-3 py-2 text-left min-w-[140px]">소비기한(LOT)</th>
                  <th className="px-3 py-2 text-right min-w-[120px]">수량</th>
                  <th className="px-3 py-2 text-left min-w-[160px]">불량유형/사유</th>
                  <th className="px-3 py-2 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {lines.map((row, index) => {
                  const lotOptions = lotDatesForItem(row.item_key);
                  const selectedGroup = itemOptions.find(
                    (o) => itemKey(o.category, o.item_id) === row.item_key,
                  );
                  const maxQty = maxQtyForLine(row.item_key, row.lot_date);
                  const unit = selectedGroup?.unit ?? (lotOptions[0]?.unit ?? "");
                  return (
                    <tr key={row.line_id}>
                      <td className="px-3 py-2 tabular-nums text-slate-500">{index + 1}</td>
                      <td className="px-3 py-2">
                        <select
                          value={row.item_key}
                          onChange={(e) => updateLine(row.line_id, { item_key: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 bg-white"
                        >
                          <option value="">품목 선택</option>
                          {itemOptions.map((opt) => {
                            const key = itemKey(opt.category, opt.item_id);
                            return (
                              <option key={key} value={key}>
                                {opt.item_name}
                              </option>
                            );
                          })}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.lot_date}
                          disabled={!row.item_key}
                          onChange={(e) => updateLine(row.line_id, { lot_date: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 bg-white disabled:bg-slate-100"
                        >
                          <option value="">소비기한 선택</option>
                          {lotOptions.map((opt) => (
                            <option key={opt.lot_date} value={opt.lot_date}>
                              {formatLotDateDot(opt.lot_date)} (잔량 {opt.stock_qty.toLocaleString()}{" "}
                              {opt.unit})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.quantity}
                            disabled={!row.lot_date}
                            onChange={(e) => updateLine(row.line_id, { quantity: e.target.value })}
                            className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right disabled:bg-slate-100"
                            placeholder="0"
                          />
                          <span className="text-xs text-slate-500 w-6 shrink-0">{unit}</span>
                        </div>
                        {row.lot_date && maxQty > 0 ? (
                          <p className="text-xs text-slate-500 text-right mt-0.5">
                            최대 {maxQty.toLocaleString()}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.defect_type}
                          onChange={(e) => updateLine(row.line_id, { defect_type: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
                          placeholder="직접 입력"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(row.line_id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-200">
            <button
              type="button"
              onClick={addLine}
              className="text-sm text-cyan-700 hover:underline"
            >
              + 행 추가
            </button>
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-60"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
          <Link
            href="/harang/defect-disposal"
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            취소
          </Link>
        </div>
      </div>
    </div>
  );
}
