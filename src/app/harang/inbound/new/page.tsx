"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HarangCategory, HarangMasterItem } from "@/features/harang/types";
import { effectiveRawMaterialUnit } from "@/features/harang/rawMaterialUnit";

type LineForm = {
  line_id: string;
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  lot_date: string;
  quantity: string;
  box_qty: string;
  unit_qty: string;
  remainder_g: string;
  unit: string;
  note: string;
};

const ROUTES = ["AF발송", "하랑직입고"] as const;
const PARBAKE_BOX_EA = 40;

function makeEmptyLine(): LineForm {
  return {
    line_id: crypto.randomUUID(),
    category: "raw_material",
    item_id: "",
    item_code: "",
    item_name: "",
    lot_date: "",
    quantity: "",
    box_qty: "",
    unit_qty: "",
    remainder_g: "",
    unit: "",
    note: "",
  };
}

function num(v: string): number {
  const n = Number(String(v).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : 0;
}

function formatNumberInput(v: string, digits = 3): string {
  const n = num(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

function isParbakeDoughName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

export default function HarangInboundCreatePage() {
  const router = useRouter();
  const [inboundDate, setInboundDate] = useState(new Date().toISOString().slice(0, 10));
  const [inboundRoute, setInboundRoute] = useState<(typeof ROUTES)[number]>("AF발송");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineForm[]>([makeEmptyLine()]);
  const [rawMaterials, setRawMaterials] = useState<HarangMasterItem[]>([]);
  const [packagingMaterials, setPackagingMaterials] = useState<HarangMasterItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [previewNo, setPreviewNo] = useState("");

  const loadMasters = useCallback(async () => {
    const [rawRes, packRes] = await Promise.all([
      supabase
        .from("harang_raw_materials")
        .select("id, item_code, item_name, default_unit, locked_unit, box_weight_g, unit_weight_g, is_active, note, created_at, updated_at")
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

  const loadInboundNoPreview = useCallback(async (date: string) => {
    const { count, error } = await supabase
      .from("harang_inbound_headers")
      .select("id", { count: "exact", head: true })
      .eq("inbound_date", date);
    if (error) return;
    setPreviewNo(`${date.replaceAll("-", "/")}-${(count ?? 0) + 1}`);
  }, []);

  useEffect(() => {
    void loadMasters();
  }, [loadMasters]);

  useEffect(() => {
    void loadInboundNoPreview(inboundDate);
  }, [inboundDate, loadInboundNoPreview]);

  const optionsByCategory = useMemo(
    () => ({
      raw_material: rawMaterials,
      packaging_material: packagingMaterials,
    }),
    [rawMaterials, packagingMaterials],
  );

  const totalWeightG = useMemo(() => {
    return lines.reduce((sum, line) => {
      const selectedItem = optionsByCategory[line.category].find((item) => item.id === line.item_id);
      const isParbakeDough = line.category === "raw_material" && isParbakeDoughName(String(selectedItem?.item_name ?? line.item_name ?? ""));
      const boxWeight = Number(selectedItem?.box_weight_g ?? 0);
      const unitWeight = Number(selectedItem?.unit_weight_g ?? 0);
      const hasWeightSpec = line.category === "raw_material" && !isParbakeDough && (boxWeight > 0 || unitWeight > 0);
      const qty = isParbakeDough
        ? Math.max(0, num(line.box_qty)) * PARBAKE_BOX_EA + Math.max(0, num(line.unit_qty))
        : hasWeightSpec
        ? Math.max(0, num(line.box_qty)) * boxWeight +
          Math.max(0, num(line.unit_qty)) * unitWeight +
          Math.max(0, num(line.remainder_g))
        : Math.max(0, num(line.quantity));
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
  }, [lines, optionsByCategory]);

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
          return { ...line, item_id: "", item_code: "", item_name: "", quantity: "", box_qty: "", unit_qty: "", remainder_g: "", unit: "" };
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
    if (!inboundDate) return alert("일자를 입력해 주세요.");
    let payloadItems: {
      category: HarangCategory;
      item_id: string;
      item_code: string;
      item_name: string;
      lot_date: string;
      quantity: number;
      box_qty: number;
      unit_qty: number;
      remainder_g: number;
      unit: string;
      note: string | null;
    }[] = [];
    try {
      payloadItems = lines.map((line, idx) => {
        const selectedItem = optionsByCategory[line.category].find((item) => item.id === line.item_id);
        const isParbakeDough = line.category === "raw_material" && isParbakeDoughName(String(selectedItem?.item_name ?? line.item_name ?? ""));
        const boxQty = Math.max(0, num(line.box_qty));
        const unitQty = Math.max(0, num(line.unit_qty));
        const remainderG = Math.max(0, num(line.remainder_g));
        const boxWeight = Number(selectedItem?.box_weight_g ?? 0);
        const unitWeight = Number(selectedItem?.unit_weight_g ?? 0);
        const hasWeightSpec = line.category === "raw_material" && !isParbakeDough && (boxWeight > 0 || unitWeight > 0);
        const quantity = isParbakeDough
          ? boxQty * PARBAKE_BOX_EA + unitQty
          : hasWeightSpec
          ? boxQty * boxWeight + unitQty * unitWeight + remainderG
          : Number(line.quantity);
        if (!line.item_id || !line.item_code || !line.item_name) {
          throw new Error(`${idx + 1}행 품목을 선택해 주세요.`);
        }
        if (!line.lot_date) {
          throw new Error(`${idx + 1}행 LOT(제조일자/소비기한)을 입력해 주세요.`);
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(`${idx + 1}행 수량은 0보다 커야 합니다.`);
        }
        const fallbackUnit =
          line.category === "raw_material"
            ? selectedItem
              ? effectiveRawMaterialUnit(selectedItem)
              : ""
            : String(selectedItem?.default_unit ?? "");
        const unit = line.unit.trim() || fallbackUnit.trim();
        if (!unit) throw new Error(`${idx + 1}행 단위 마스터값이 없습니다.`);
        return {
          category: line.category,
          item_id: line.item_id,
          item_code: line.item_code,
          item_name: line.item_name,
          lot_date: line.lot_date,
          quantity,
          box_qty: boxQty,
          unit_qty: unitQty,
          remainder_g: remainderG,
          unit,
          note: line.note.trim() || null,
        };
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "입력값을 확인해 주세요.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("create_harang_inbound_with_items", {
      p_inbound_date: inboundDate,
      p_inbound_route: inboundRoute,
      p_note: note.trim() || null,
      p_items: payloadItems,
    });
    setSaving(false);
    if (error) return alert(error.message);
    router.push("/harang/inbound");
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">하랑 입고입력</h1>
            <p className="mt-1 text-sm text-slate-600">입고 헤더 + 상세라인을 등록하면 LOT와 트랜잭션이 자동 생성됩니다.</p>
          </div>
          <Link href="/harang/inbound" className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white">
            목록으로
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">헤더 정보</h2>
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
              <input value={previewNo} readOnly className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-700 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">입고경로</label>
              <select value={inboundRoute} onChange={(e) => setInboundRoute(e.target.value as (typeof ROUTES)[number])} className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm">
                {ROUTES.map((route) => (
                  <option key={route} value={route}>{route}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">비고</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm" />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">상세라인</h2>
            <button type="button" onClick={addLine} className="px-3 py-2 rounded-lg border border-cyan-500/60 text-cyan-700 bg-cyan-50 text-sm">
              + 라인 추가
            </button>
          </div>
          <div className="overflow-x-hidden">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-2 py-2 text-left">분류</th>
                  <th className="px-2 py-2 text-left">품목명</th>
                  <th className="px-2 py-2 text-left">LOT(제조일자/소비기한)</th>
                  <th className="px-2 py-2 text-right">박스</th>
                  <th className="px-2 py-2 text-right">낱개</th>
                  <th className="px-2 py-2 text-right">잔량(g)</th>
                  <th className="px-2 py-2 text-right">입고수량</th>
                  <th className="px-2 py-2 text-left">비고</th>
                  <th className="px-2 py-2 text-right">삭제</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const options = optionsByCategory[line.category];
                  const selectedItem = options.find((o) => o.id === line.item_id) as HarangMasterItem | undefined;
                  const isParbakeDough = line.category === "raw_material" && isParbakeDoughName(String(selectedItem?.item_name ?? line.item_name ?? ""));
                  const boxWeight = Number(selectedItem?.box_weight_g ?? 0);
                  const unitWeight = Number(selectedItem?.unit_weight_g ?? 0);
                  const hasWeightSpec = line.category === "raw_material" && !isParbakeDough && (boxWeight > 0 || unitWeight > 0);
                  const useBoxUnitInput = isParbakeDough || hasWeightSpec;
                  const calcQuantity = isParbakeDough
                    ? num(line.box_qty) * PARBAKE_BOX_EA + num(line.unit_qty)
                    : hasWeightSpec
                    ? num(line.box_qty) * boxWeight + num(line.unit_qty) * unitWeight + num(line.remainder_g)
                    : num(line.quantity);
                  const quantitySuffix = isParbakeDough ? "ea" : hasWeightSpec ? "g" : "";
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
                              quantity: "",
                              box_qty: "",
                              unit_qty: "",
                              remainder_g: "",
                              unit: "",
                            })
                          }
                          className="w-full min-w-0 px-2 py-1.5 rounded bg-white border border-slate-300"
                        >
                          <option value="raw_material">원재료</option>
                          <option value="packaging_material">부자재</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={line.item_id}
                          onChange={(e) => handleSelectItem(line.line_id, e.target.value)}
                          className="w-full min-w-0 px-2 py-1.5 rounded bg-white border border-slate-300"
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
                        <input type="date" value={line.lot_date} onChange={(e) => handleChangeLine(line.line_id, { lot_date: e.target.value })} className="w-full min-w-0 px-2 py-1.5 rounded bg-white border border-slate-300" />
                      </td>
                      <td className="px-2 py-2 text-right align-top">
                        <input
                          type="text"
                          inputMode="numeric"
                          min="0"
                          step="1"
                          value={line.box_qty}
                          onChange={(e) => handleChangeLine(line.line_id, { box_qty: e.target.value })}
                          onBlur={() => handleChangeLine(line.line_id, { box_qty: formatNumberInput(line.box_qty, 0) })}
                          disabled={!useBoxUnitInput}
                          className={`w-full min-w-0 px-2 py-1.5 rounded border border-slate-300 text-right ${useBoxUnitInput ? "bg-white" : "bg-slate-100 text-slate-400"}`}
                        />
                        {isParbakeDough ? (
                          <p className="mt-1 text-[10px] text-slate-500">
                            x {PARBAKE_BOX_EA.toLocaleString("ko-KR")}ea
                          </p>
                        ) : null}
                        {hasWeightSpec && boxWeight > 0 ? (
                          <p className="mt-1 text-[10px] text-slate-500">
                            x {boxWeight.toLocaleString("ko-KR")}g
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right align-top">
                        <input
                          type="text"
                          inputMode="numeric"
                          min="0"
                          step="1"
                          value={line.unit_qty}
                          onChange={(e) => handleChangeLine(line.line_id, { unit_qty: e.target.value })}
                          onBlur={() => handleChangeLine(line.line_id, { unit_qty: formatNumberInput(line.unit_qty, 0) })}
                          disabled={!useBoxUnitInput}
                          className={`w-full min-w-0 px-2 py-1.5 rounded border border-slate-300 text-right ${useBoxUnitInput ? "bg-white" : "bg-slate-100 text-slate-400"}`}
                        />
                        {isParbakeDough ? (
                          <p className="mt-1 text-[10px] text-slate-500">ea</p>
                        ) : null}
                        {hasWeightSpec && unitWeight > 0 ? (
                          <p className="mt-1 text-[10px] text-slate-500">
                            x {unitWeight.toLocaleString("ko-KR")}g
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right align-top">
                        <input
                          type="text"
                          inputMode="decimal"
                          min="0"
                          step="0.001"
                          value={line.remainder_g}
                          onChange={(e) => handleChangeLine(line.line_id, { remainder_g: e.target.value })}
                          onBlur={() => handleChangeLine(line.line_id, { remainder_g: formatNumberInput(line.remainder_g, 3) })}
                          disabled={!hasWeightSpec}
                          className={`w-full min-w-0 px-2 py-1.5 rounded border border-slate-300 text-right ${hasWeightSpec ? "bg-white" : "bg-slate-100 text-slate-400"}`}
                        />
                        {hasWeightSpec ? (
                          <p className="mt-1 text-[10px] text-slate-500">g 직접입력</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right align-top">
                        <input
                          type="text"
                          inputMode="decimal"
                          min="0"
                          step="0.001"
                          value={useBoxUnitInput ? String(calcQuantity || "") : line.quantity}
                          readOnly={useBoxUnitInput}
                          onChange={(e) => handleChangeLine(line.line_id, { quantity: e.target.value })}
                          onBlur={() => {
                            if (!useBoxUnitInput) {
                              handleChangeLine(line.line_id, { quantity: formatNumberInput(line.quantity, 3) });
                            }
                          }}
                          className={`w-full min-w-0 px-2 py-1.5 rounded border border-slate-300 text-right ${
                            useBoxUnitInput ? "bg-slate-100 text-slate-800" : "bg-white"
                          }`}
                        />
                        {useBoxUnitInput ? (
                          <p className="mt-1 text-[10px] text-cyan-700">
                            합계 {calcQuantity.toLocaleString("ko-KR")}{quantitySuffix}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <input value={line.note} onChange={(e) => handleChangeLine(line.line_id, { note: e.target.value })} className="w-full min-w-0 px-2 py-1.5 rounded bg-white border border-slate-300" />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" onClick={() => removeLine(line.line_id)} className="px-2 py-1 rounded border border-red-700/70 text-red-300 text-xs">삭제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end">
            <p className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-sm font-medium text-cyan-800">
              합계: {totalWeightG.toLocaleString("ko-KR")}
            </p>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm disabled:opacity-60"
          >
            {saving ? "저장 중..." : "입고 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
