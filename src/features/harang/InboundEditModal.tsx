"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HarangCategory, HarangInboundHeader, HarangMasterItem } from "@/features/harang/types";
import { effectiveRawMaterialUnit, isRawMaterialUnitLocked } from "@/features/harang/rawMaterialUnit";

type LineForm = {
  line_id: string;
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  lot_date: string;
  quantity: string;
  unit: string;
  note: string;
};

const ROUTES = ["AF발송", "하랑직입고"] as const;

function makeEmptyLine(): LineForm {
  return {
    line_id: crypto.randomUUID(),
    category: "raw_material",
    item_id: "",
    item_code: "",
    item_name: "",
    lot_date: "",
    quantity: "",
    unit: "",
    note: "",
  };
}

type Props = {
  open: boolean;
  headerId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export function InboundEditModal({ open, headerId, onClose, onSaved }: Props) {
  const [inboundDate, setInboundDate] = useState("");
  const [inboundNo, setInboundNo] = useState("");
  const [inboundRoute, setInboundRoute] = useState<(typeof ROUTES)[number]>("AF발송");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineForm[]>([makeEmptyLine()]);
  const [rawMaterials, setRawMaterials] = useState<HarangMasterItem[]>([]);
  const [packagingMaterials, setPackagingMaterials] = useState<HarangMasterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadMasters = useCallback(async () => {
    const [rawRes, packRes] = await Promise.all([
      supabase
        .from("harang_raw_materials")
        .select("id, item_code, item_name, default_unit, locked_unit, is_active, note, created_at, updated_at")
        .eq("is_active", true)
        .order("item_name", { ascending: true }),
      supabase
        .from("harang_packaging_materials")
        .select("id, item_code, item_name, default_unit, is_active, note, created_at, updated_at")
        .eq("is_active", true)
        .order("item_name", { ascending: true }),
    ]);
    if (rawRes.error) return alert(rawRes.error.message);
    if (packRes.error) return alert(packRes.error.message);
    setRawMaterials((rawRes.data ?? []) as HarangMasterItem[]);
    setPackagingMaterials((packRes.data ?? []) as HarangMasterItem[]);
  }, []);

  const loadHeader = useCallback(async (id: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("harang_inbound_headers")
      .select(
        `
        id,
        inbound_date,
        inbound_no,
        inbound_route,
        note,
        items:harang_inbound_items(
          id, category, item_id, item_code, item_name, lot_date, quantity, unit, note
        )
      `,
      )
      .eq("id", id)
      .single();
    setLoading(false);
    if (error) {
      alert(error.message);
      onClose();
      return;
    }
    const header = data as HarangInboundHeader;
    setInboundDate(header.inbound_date.slice(0, 10));
    setInboundNo(header.inbound_no);
    setInboundRoute(header.inbound_route);
    setNote(header.note ?? "");
    const itemRows = header.items ?? [];
    if (itemRows.length === 0) {
      setLines([makeEmptyLine()]);
    } else {
      setLines(
        itemRows.map((it) => ({
          line_id: it.id,
          category: it.category,
          item_id: it.item_id,
          item_code: it.item_code,
          item_name: it.item_name,
          lot_date: (it.lot_date ?? "").slice(0, 10),
          quantity: String(it.quantity ?? ""),
          unit: it.unit ?? "",
          note: it.note ?? "",
        })),
      );
    }
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    void loadMasters();
  }, [open, loadMasters]);

  useEffect(() => {
    if (!open || !headerId) return;
    void loadHeader(headerId);
  }, [open, headerId, loadHeader]);

  const optionsByCategory = useMemo(
    () => ({
      raw_material: rawMaterials,
      packaging_material: packagingMaterials,
    }),
    [rawMaterials, packagingMaterials],
  );

  const handleChangeLine = (lineId: string, patch: Partial<LineForm>) => {
    setLines((prev) => prev.map((line) => (line.line_id === lineId ? { ...line, ...patch } : line)));
  };

  const handleSelectItem = (lineId: string, itemId: string) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.line_id !== lineId) return line;
        const options = optionsByCategory[line.category];
        const item = options.find((candidate) => candidate.id === itemId);
        if (!item) {
          return { ...line, item_id: "", item_code: "", item_name: "", unit: "" };
        }
        return {
          ...line,
          item_id: item.id,
          item_code: item.item_code,
          item_name: item.item_name,
          unit:
            line.category === "raw_material"
              ? effectiveRawMaterialUnit(item as HarangMasterItem)
              : item.default_unit,
        };
      }),
    );
  };

  const addLine = () => setLines((prev) => [...prev, makeEmptyLine()]);

  const removeLine = (lineId: string) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.line_id !== lineId)));
  };

  const handleSave = async () => {
    if (!headerId) return;
    if (!inboundDate) return alert("일자를 입력해 주세요.");
    let payloadItems: {
      category: HarangCategory;
      item_id: string;
      item_code: string;
      item_name: string;
      lot_date: string;
      quantity: number;
      unit: string;
      note: string | null;
    }[] = [];
    try {
      payloadItems = lines.map((line, idx) => {
        const quantity = Number(line.quantity);
        if (!line.item_id || !line.item_code || !line.item_name) {
          throw new Error(`${idx + 1}행 품목을 선택해 주세요.`);
        }
        if (!line.lot_date) {
          throw new Error(`${idx + 1}행 LOT(제조일자/소비기한)을 입력해 주세요.`);
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(`${idx + 1}행 수량은 0보다 커야 합니다.`);
        }
        if (!line.unit.trim()) {
          throw new Error(`${idx + 1}행 단위를 입력해 주세요.`);
        }
        return {
          category: line.category,
          item_id: line.item_id,
          item_code: line.item_code,
          item_name: line.item_name,
          lot_date: line.lot_date,
          quantity,
          unit: line.unit.trim(),
          note: line.note.trim() || null,
        };
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "입력값을 확인해 주세요.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("replace_harang_inbound_with_items", {
      p_header_id: headerId,
      p_inbound_date: inboundDate,
      p_inbound_route: inboundRoute,
      p_note: note.trim() || null,
      p_items: payloadItems,
    });
    setSaving(false);
    if (error) return alert(error.message);
    onSaved();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbound-edit-title"
        className="my-auto w-full max-w-7xl rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div>
            <h2 id="inbound-edit-title" className="text-lg font-semibold text-slate-900">
              하랑 입고 수정
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">입고 헤더와 상세라인을 수정하면 LOT·입고 트랜잭션이 다시 생성됩니다.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 bg-white hover:bg-slate-50"
          >
            닫기
          </button>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {loading && <p className="text-sm text-slate-500">불러오는 중...</p>}

          {!loading && (
            <>
              <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">헤더 정보</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">일자</label>
                    <input
                      type="date"
                      value={inboundDate}
                      onChange={(e) => setInboundDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">일자-No.</label>
                    <input
                      value={inboundNo}
                      readOnly
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 border border-slate-300 text-slate-700 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">입고경로</label>
                    <select
                      value={inboundRoute}
                      onChange={(e) => setInboundRoute(e.target.value as (typeof ROUTES)[number])}
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
                    >
                      {ROUTES.map((route) => (
                        <option key={route} value={route}>
                          {route}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">비고</label>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-800">상세라인</h3>
                  <button
                    type="button"
                    onClick={addLine}
                    className="px-3 py-2 rounded-lg border border-cyan-500/60 text-cyan-700 bg-cyan-50 text-sm"
                  >
                    + 라인 추가
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1200px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600">
                        <th className="px-2 py-2 text-left">분류</th>
                        <th className="px-2 py-2 text-left">품목명</th>
                        <th className="px-2 py-2 text-left">LOT(제조일자/소비기한)</th>
                        <th className="px-2 py-2 text-right">입고수량</th>
                        <th className="px-2 py-2 text-left">단위</th>
                        <th className="px-2 py-2 text-left">비고</th>
                        <th className="px-2 py-2 text-right">삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const options = optionsByCategory[line.category];
                        const selectedItem = options.find((o) => o.id === line.item_id) as HarangMasterItem | undefined;
                        const unitLocked =
                          line.category === "raw_material" && selectedItem && isRawMaterialUnitLocked(selectedItem);
                        return (
                          <tr key={line.line_id} className="border-b border-slate-100 text-slate-900">
                            <td className="px-2 py-2">
                              <select
                                value={line.category}
                                onChange={(e) =>
                                  handleChangeLine(line.line_id, {
                                    category: e.target.value as HarangCategory,
                                    item_id: "",
                                    item_code: "",
                                    item_name: "",
                                    unit: "",
                                  })
                                }
                                className="w-[120px] px-2 py-1.5 rounded bg-white border border-slate-300"
                              >
                                <option value="raw_material">원재료</option>
                                <option value="packaging_material">부자재</option>
                              </select>
                            </td>
                            <td className="px-2 py-2">
                              <select
                                value={line.item_id}
                                onChange={(e) => handleSelectItem(line.line_id, e.target.value)}
                                className="w-[260px] px-2 py-1.5 rounded bg-white border border-slate-300"
                              >
                                <option value="">품목 선택</option>
                                {options.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.item_name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2">
                              <input
                                type="date"
                                value={line.lot_date}
                                onChange={(e) => handleChangeLine(line.line_id, { lot_date: e.target.value })}
                                className="w-[170px] px-2 py-1.5 rounded bg-white border border-slate-300"
                              />
                            </td>
                            <td className="px-2 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={line.quantity}
                                onChange={(e) => handleChangeLine(line.line_id, { quantity: e.target.value })}
                                className="w-[120px] px-2 py-1.5 rounded bg-white border border-slate-300 text-right"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <input
                                value={line.unit}
                                readOnly={!!unitLocked}
                                title={unitLocked ? "단위 고정 품목은 EA 등 지정 단위만 사용합니다." : undefined}
                                onChange={(e) => handleChangeLine(line.line_id, { unit: e.target.value })}
                                className={`w-[90px] px-2 py-1.5 rounded border border-slate-300 ${
                                  unitLocked ? "bg-slate-100 text-slate-800" : "bg-white"
                                }`}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <input
                                value={line.note}
                                onChange={(e) => handleChangeLine(line.line_id, { note: e.target.value })}
                                className="w-[220px] px-2 py-1.5 rounded bg-white border border-slate-300"
                              />
                            </td>
                            <td className="px-2 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => removeLine(line.line_id)}
                                className="px-2 py-1 rounded border border-red-700/70 text-red-600 text-xs"
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
              </section>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || loading}
                  className="px-5 py-2.5 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm disabled:opacity-60"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
