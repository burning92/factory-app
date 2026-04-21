"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useMasterStore } from "@/store/useMasterStore";
import DateWheelPicker from "@/components/DateWheelPicker";
import { getAppRecentValue, setAppRecentValue } from "@/lib/appRecentValues";
import { createSafeId } from "@/lib/createSafeId";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

/** 출고 입력 전용 최근 작성자명 (1차 마감과 분리). Supabase 우선, localStorage는 보조 fallback */
const OUTBOUND_LAST_AUTHOR_KEY = "outbound-last-author-name";
const OUTBOUND_LAST_AUTHOR_STORAGE_KEY = "production:outbound-last-author-name";

function getLastAuthorNameFromStorage(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(OUTBOUND_LAST_AUTHOR_STORAGE_KEY) ?? "";
}

function setLastAuthorNameToStorage(name: string): void {
  const trimmed = (name ?? "").trim();
  if (!trimmed || typeof window === "undefined") return;
  localStorage.setItem(OUTBOUND_LAST_AUTHOR_STORAGE_KEY, trimmed);
}

function ensureNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Supabase/PostgrestError 및 일반 Error에서 사용자에게 보여줄 에러 문구 추출 */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err != null && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const msg = [o.message, o.details, o.hint].filter(Boolean).map(String).join(" / ");
    if (msg.trim()) return msg;
    return JSON.stringify(err, null, 2);
  }
  return String(err);
}

interface OutboundRow {
  materialName: string;
  basis: string;
  totalG: number;
  boxQty: number;
  bagQty: number;
  quantityType: "g_only" | "ea_only" | "box_ea";
}

interface OutboundStandardPreviewRow {
  materialName: string;
  basis: "완제품" | "도우";
  standardGPerEa: number;
  totalG: number;
  boxQty: number;
  bagQty: number;
  quantityType: "g_only" | "ea_only" | "box_ea";
}

function splitProductName(value: string): { baseName: string; option: string } {
  const raw = String(value ?? "").trim();
  const idx = raw.indexOf("-");
  if (idx < 0) return { baseName: raw, option: "" };
  return {
    baseName: raw.slice(0, idx).trim(),
    option: raw.slice(idx + 1).trim(),
  };
}

function calcOutbound(
  productName: string,
  doughQty: number,
  finishedQty: number,
  bomList: { productName: string; materialName: string; bomGPerEa: number; basis: "완제품" | "도우" }[],
  materials: { materialName: string; boxWeightG: number; unitWeightG: number }[]
): OutboundRow[] {
  const productBom = bomList.filter((b) => b.productName === productName);
  const materialMap = new Map(materials.map((m) => [m.materialName, m]));
  const result: OutboundRow[] = [];

  for (const row of productBom) {
    const perDough = row.basis === "도우" ? row.bomGPerEa : 0;
    const perFinished = row.basis === "완제품" ? row.bomGPerEa : 0;
    const totalG = perDough * doughQty + perFinished * finishedQty;
    const mat = materialMap.get(row.materialName);
    if (!mat) continue;

    const boxWeight = mat.boxWeightG ?? 0;
    const eaWeight = mat.unitWeightG ?? 0;
    const isGOnly = boxWeight === 0 && eaWeight === 0;
    const isEaOnly = boxWeight === 0 && eaWeight > 0;
    if (isGOnly) {
      result.push({
        materialName: row.materialName,
        basis: row.basis,
        totalG,
        boxQty: 0,
        bagQty: 0,
        quantityType: "g_only",
      });
      continue;
    }
    if (isEaOnly) {
      result.push({
        materialName: row.materialName,
        basis: row.basis,
        totalG,
        boxQty: 0,
        bagQty: eaWeight > 0 ? Math.ceil(totalG / eaWeight) : 0,
        quantityType: "ea_only",
      });
      continue;
    }

    const bagG = eaWeight > 0 ? eaWeight : boxWeight;
    const bagsPerBox = boxWeight > 0 && bagG > 0 ? Math.floor(boxWeight / bagG) : 1;
    const totalBagsNeeded = Math.ceil(totalG / bagG);
    const boxQty = Math.floor(totalBagsNeeded / bagsPerBox);
    const bagQty = totalBagsNeeded - boxQty * bagsPerBox;

    result.push({
      materialName: row.materialName,
      basis: row.basis,
      totalG,
      boxQty,
      bagQty,
      quantityType: "box_ea",
    });
  }

  return result;
}

function calcQuantityFromTotalG(
  totalG: number,
  material: { boxWeightG: number; unitWeightG: number } | undefined
): Pick<OutboundStandardPreviewRow, "boxQty" | "bagQty" | "quantityType"> {
  if (!material) return { boxQty: 0, bagQty: 0, quantityType: "g_only" };
  const boxWeight = material.boxWeightG ?? 0;
  const eaWeight = material.unitWeightG ?? 0;
  const isGOnly = boxWeight === 0 && eaWeight === 0;
  const isEaOnly = boxWeight === 0 && eaWeight > 0;
  if (isGOnly) return { boxQty: 0, bagQty: 0, quantityType: "g_only" };
  if (isEaOnly) return { boxQty: 0, bagQty: eaWeight > 0 ? Math.ceil(totalG / eaWeight) : 0, quantityType: "ea_only" };

  const bagG = eaWeight > 0 ? eaWeight : boxWeight;
  const bagsPerBox = boxWeight > 0 && bagG > 0 ? Math.floor(boxWeight / bagG) : 1;
  const totalBagsNeeded = Math.ceil(totalG / bagG);
  const boxQty = Math.floor(totalBagsNeeded / bagsPerBox);
  const bagQty = totalBagsNeeded - boxQty * bagsPerBox;
  return { boxQty, bagQty, quantityType: "box_ea" };
}

function formatRequiredQty(row: OutboundRow | null | undefined): string {
  if (!row || typeof row !== "object") return "—";
  const qty = row.quantityType;
  const totalG = Number(row.totalG) || 0;
  const boxQty = Number(row.boxQty) || 0;
  const bagQty = Number(row.bagQty) || 0;
  if (qty === "g_only") return `${totalG.toLocaleString()}g`;
  if (qty === "ea_only") return `${bagQty.toLocaleString()}개`;
  const parts: string[] = [];
  if (boxQty > 0) parts.push(`${boxQty}박스`);
  if (bagQty > 0) parts.push(`${bagQty}개`);
  return parts.length ? parts.join(" ") : "0박스";
}

function formatStandardRequiredQty(row: OutboundStandardPreviewRow | null | undefined): string {
  if (!row) return "";
  if (row.quantityType === "g_only") {
    return `${row.totalG.toLocaleString()}g`;
  }
  if (row.quantityType === "ea_only") {
    return `${row.bagQty.toLocaleString()}개`;
  }
  return `${row.boxQty.toLocaleString()}박스 ${row.bagQty.toLocaleString()}개`;
}

/** 실제 총 출고량(g) = (출고 박스 * 박스용량) + (출고 낱개 * 낱개용량) + 출고 잔량(g) */
function calcActualOutboundG(
  entries: { boxQty: number; bagQty: number; remainderG: number }[],
  material: { boxWeightG: number; unitWeightG: number } | undefined
): number {
  if (!material) return 0;
  const boxG = material.boxWeightG ?? 0;
  const unitG = material.unitWeightG ?? 0;
  const isGOnly = boxG === 0 && unitG === 0;
  let total = 0;
  for (const e of entries) {
    if (isGOnly) {
      total += e.remainderG ?? 0;
    } else {
      const unitW = unitG > 0 ? unitG : boxG;
      total += (e.boxQty ?? 0) * boxG + (e.bagQty ?? 0) * unitW + (e.remainderG ?? 0);
    }
  }
  return total;
}

function sumPendingBoxBagG(
  entries: { boxQty: number; bagQty: number; remainderG: number }[]
): { totalBox: number; totalBag: number; totalG: number } {
  let totalBox = 0;
  let totalBag = 0;
  let totalG = 0;
  for (const e of entries) {
    totalBox += e.boxQty ?? 0;
    totalBag += e.bagQty ?? 0;
    totalG += e.remainderG ?? 0;
  }
  return { totalBox, totalBag, totalG };
}

interface OutboundEntryRow {
  id: string;
  /** LOT 직접입력(DateWheelPicker), YYYY-MM-DD */
  manualLotIso: string;
  /** 재고 드롭다운에서 선택한 LOT → YYYY-MM-DD */
  selectedLotIso: string;
  boxQty: string;
  bagQty: string;
  remainderG: string;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

/** 재고 lot_no → YYYY-MM-DD (FIFO/그룹핑과 동일 형식) */
function parseLotNoToIso(lotNo: string): string {
  const t = lotNo.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4})[\.\-](\d{1,2})[\.\-](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

function normalizeStoredExpiryToIso(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return parseLotNoToIso(t);
}

function resolveOutboundExpiry(input: {
  manualLotIso: string;
  selectedLotIso: string;
  fallbackIso: string;
}): string {
  const m = input.manualLotIso.trim();
  if (m) return m;
  const s = input.selectedLotIso.trim();
  if (s) return s;
  const f = input.fallbackIso.trim();
  return f || todayStr();
}

type EcountLotRow = {
  item_code: string | null;
  lot_no: string;
  qty: number | null;
  display_item_name: string | null;
};

function OutboundModal({
  materialName,
  inventoryItemCode,
  requiredText,
  standardRequiredText,
  defaultExpiryDate,
  initialEntries,
  quantityType,
  onClose,
  onSave,
}: {
  materialName: string;
  inventoryItemCode?: string;
  requiredText: string;
  standardRequiredText?: string;
  defaultExpiryDate: string;
  initialEntries?: { expiryDate: string; boxQty: number; bagQty: number; remainderG: number }[];
  quantityType: "g_only" | "ea_only" | "box_ea";
  onClose: () => void;
  onSave: (entries: { expiryDate: string; boxQty: number; bagQty: number; remainderG: number }[]) => void;
}) {
  const safeExpiry = typeof defaultExpiryDate === "string" && defaultExpiryDate.trim() ? defaultExpiryDate.trim() : todayStr();
  const safeType: "g_only" | "ea_only" | "box_ea" =
    quantityType === "g_only" || quantityType === "ea_only" || quantityType === "box_ea" ? quantityType : "g_only";
  const safeEntries = Array.isArray(initialEntries) ? initialEntries : [];

  const [inventoryRows, setInventoryRows] = useState<EcountLotRow[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryHint, setInventoryHint] = useState<string | null>(null);

  const [rows, setRows] = useState<OutboundEntryRow[]>(() => {
    try {
      if (safeEntries.length > 0) {
        return safeEntries.map((e) => ({
          id: createSafeId(),
          manualLotIso: normalizeStoredExpiryToIso(
            e && typeof e.expiryDate === "string" ? e.expiryDate : ""
          ),
          selectedLotIso: "",
          boxQty: e && typeof e.boxQty === "number" ? String(e.boxQty) : "0",
          bagQty: e && typeof e.bagQty === "number" ? String(e.bagQty) : "0",
          remainderG: e && typeof e.remainderG === "number" ? String(e.remainderG) : "0",
        }));
      }
    } catch (err) {
      console.error("[OutboundModal] initialEntries map error:", err);
    }
    return [
      {
        id: createSafeId(),
        manualLotIso: "",
        selectedLotIso: "",
        boxQty: "",
        bagQty: "",
        remainderG: "",
      },
    ];
  });

  useEffect(() => {
    let cancelled = false;
    const name = String(materialName ?? "").trim();
    const mappedCode = String(inventoryItemCode ?? "").trim();
    if (!name && !mappedCode) {
      setInventoryRows([]);
      setInventoryHint(null);
      return;
    }
    (async () => {
      setInventoryLoading(true);
      setInventoryHint(null);
      const { data, error } = await supabase
        .from("ecount_inventory_current")
        .select("item_code, display_item_name, lot_no, qty")
        .eq("inventory_type", "원재료")
        .order("lot_no", { ascending: true });
      if (cancelled) return;
      if (error) {
        setInventoryRows([]);
        setInventoryHint("재고 LOT 목록을 불러오지 못했습니다.");
      } else {
        const raw = (data ?? []) as EcountLotRow[];
        const filtered = mappedCode
          ? raw.filter((r) => String(r.item_code ?? "").trim() === mappedCode)
          : raw.filter((r) => (r.display_item_name ?? "").trim() === name);
        setInventoryRows(filtered);
        if (filtered.length === 0) {
          setInventoryHint(
            mappedCode
              ? "재고연동 코드와 일치하는 재고 LOT가 없습니다. 직접입력을 사용하세요."
              : "이 원료명과 일치하는 재고 LOT가 없습니다. 직접입력을 사용하세요."
          );
        }
      }
      setInventoryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [materialName, inventoryItemCode]);

  const lotOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { lotNo: string; qty: number; iso: string }[] = [];
    for (const r of inventoryRows) {
      const lotNo = String(r.lot_no ?? "").trim();
      const iso = parseLotNoToIso(lotNo);
      if (!iso || seen.has(iso)) continue;
      seen.add(iso);
      out.push({ lotNo, qty: Number(r.qty) || 0, iso });
    }
    return out.sort((a, b) => a.iso.localeCompare(b.iso));
  }, [inventoryRows]);

  useEffect(() => {
    const valid = new Set(lotOptions.map((o) => o.iso));
    setRows((prev) =>
      prev.map((r) => (r.selectedLotIso && !valid.has(r.selectedLotIso) ? { ...r, selectedLotIso: "" } : r))
    );
  }, [lotOptions]);

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { id: createSafeId(), manualLotIso: "", selectedLotIso: "", boxQty: "", bagQty: "", remainderG: "" },
    ]);
  }, []);

  const updateRow = useCallback((id: string, field: keyof OutboundEntryRow, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }, []);

  const handleSave = useCallback(() => {
    const entries = rows.map((r) => {
      const expiryDate = resolveOutboundExpiry({
        manualLotIso: r.manualLotIso,
        selectedLotIso: r.selectedLotIso,
        fallbackIso: safeExpiry,
      });
      return {
        expiryDate,
        boxQty: safeType === "box_ea" ? (parseInt(String(r.boxQty ?? ""), 10) || 0) : 0,
        bagQty: safeType === "g_only" ? 0 : (parseInt(String(r.bagQty ?? ""), 10) || 0),
        remainderG: parseInt(String(r.remainderG ?? ""), 10) || 0,
      };
    });
    if (entries.length) {
      onSave(entries);
      onClose();
    } else {
      alert("출고 라인이 없습니다.");
    }
  }, [rows, safeType, safeExpiry, onSave, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-space-800 rounded-2xl border border-cyan-500/30 shadow-glow max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-600">
          <h3 className="text-lg font-bold text-slate-100">{materialName || "원료"}</h3>
          <p className="text-sm text-slate-400 mt-1">BOM 필요 수량: {requiredText}</p>
          {standardRequiredText && (
            <p className="text-sm text-amber-300 mt-1">
              출고기준 참고: {standardRequiredText}
              <span className="text-slate-500 ml-1">(저장 미반영)</span>
            </p>
          )}
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {inventoryHint && (
            <p className="mb-3 text-xs text-slate-500">{inventoryHint}</p>
          )}
          <div className="space-y-4">
            {(Array.isArray(rows) ? rows : []).map((row, index) => (
              <div key={row.id} className="p-3 rounded-xl border border-slate-600 bg-space-900/80 space-y-2">
                <span className="text-xs font-medium text-slate-500">소비기한 #{index + 1}</span>
                <div className="grid grid-cols-2 gap-2">
                  {/* 1열: 박스 수량 / 낱개 수량 (수량 먼저 → tab 순서) */}
                  {safeType === "box_ea" && (
                    <>
                      <div>
                        <label className="block text-xs text-slate-400 mb-0.5">박스 수량</label>
                        <input type="number" min={0} inputMode="numeric" value={row.boxQty} onChange={(e) => updateRow(row.id, "boxQty", e.target.value)} placeholder="0" className="w-full px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-0.5">낱개 수량</label>
                        <input type="number" min={0} inputMode="numeric" value={row.bagQty} onChange={(e) => updateRow(row.id, "bagQty", e.target.value)} placeholder="0" className="w-full px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50" />
                      </div>
                    </>
                  )}
                  {safeType === "ea_only" && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-0.5">낱개 수량</label>
                      <input type="number" min={0} inputMode="numeric" value={row.bagQty} onChange={(e) => updateRow(row.id, "bagQty", e.target.value)} placeholder="0" className="w-full px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50" />
                    </div>
                  )}
                  {/* 2열: 잔량(g) / 소비기한(날짜) — g 전용일 때도 수량이 위(먼저) */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">{safeType === "g_only" ? "출고 잔량(g)" : "잔량(g)"}</label>
                    <input type="number" min={0} inputMode="numeric" value={row.remainderG} onChange={(e) => updateRow(row.id, "remainderG", e.target.value)} placeholder={safeType === "g_only" ? "g 입력" : "0"} className="w-full px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50" />
                  </div>
                </div>
                <div className="space-y-2 pt-1 border-t border-slate-700/80">
                  <p className="text-xs text-slate-500">LOT (소비기한)</p>
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">LOT 선택 (재고 연동)</label>
                    <select
                      value={row.selectedLotIso}
                      onChange={(e) => updateRow(row.id, "selectedLotIso", e.target.value)}
                      disabled={inventoryLoading || !String(materialName ?? "").trim()}
                      className="w-full px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-60"
                    >
                      <option value="">
                        {!String(materialName ?? "").trim()
                          ? "원료명 없음"
                          : inventoryLoading
                            ? "불러오는 중…"
                            : "LOT 선택 (선택사항)"}
                      </option>
                      {lotOptions.map((l) => (
                        <option key={l.iso} value={l.iso}>
                          {l.lotNo} (재고 {l.qty.toLocaleString("ko-KR")})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">LOT 직접입력 (소비기한)</label>
                    <DateWheelPicker
                      value={row.manualLotIso}
                      onChange={(v) => updateRow(row.id, "manualLotIso", v)}
                      className="w-full px-2 py-1.5 text-sm focus:ring-2 focus:ring-cyan-500/50"
                      placeholder="목록에 없으면 날짜 선택"
                    />
                    {row.manualLotIso && (
                      <button
                        type="button"
                        onClick={() => updateRow(row.id, "manualLotIso", "")}
                        className="mt-1 text-xs text-slate-500 hover:text-slate-300 underline"
                      >
                        직접입력 지우기
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-cyan-400/90">
                    최종 적용 소비기한:{" "}
                    <span className="font-medium text-cyan-300">
                      {resolveOutboundExpiry({
                        manualLotIso: row.manualLotIso,
                        selectedLotIso: row.selectedLotIso,
                        fallbackIso: safeExpiry,
                      })}
                    </span>
                    <span className="text-slate-500 block mt-0.5">
                      직접입력 → LOT 선택 → 마지막 입력일 순으로 적용됩니다.
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addRow} className="mt-3 w-full py-2 rounded-xl border-2 border-dashed border-slate-600 text-slate-400 text-sm font-medium hover:border-cyan-500/50 hover:text-cyan-400 transition-colors">
            + 소비기한 추가
          </button>
        </div>
        <div className="p-5 border-t border-slate-600 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50">닫기</button>
          <button type="button" onClick={handleSave} className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400">저장</button>
        </div>
      </div>
    </div>
  );
}

interface PendingOutbound {
  productionDate: string;
  productName: string;
  materialName: string;
  entries: { expiryDate: string; boxQty: number; bagQty: number; remainderG: number }[];
}

export default function OutboundPage() {
  const { profile } = useAuth();
  const loginAuthor =
    (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const {
    materials,
    bomList,
    outboundStandards,
    lastUsedDates,
    materialsLoading,
    bomLoading,
    outboundStandardsLoading,
    saving,
    error,
    fetchMaterials,
    fetchBom,
    fetchOutboundStandards,
    fetchLastUsedDates,
    fetchProductionLogs,
    addProductionLog,
    setLastUsedDate,
    getUsageCalculation,
    saveUsageCalculation,
  } = useMasterStore();
  const [productionDate, setProductionDate] = useState(todayStr());
  const [selectedBaseName, setSelectedBaseName] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [doughQty, setDoughQty] = useState("");
  const [finishedQty, setFinishedQty] = useState("");
  const [finishedQtyTouched, setFinishedQtyTouched] = useState(false);
  /** 출고 입력 전용 최근 작성자명. 화면 진입 시 Supabase → localStorage 순으로 채움 */
  const [preparerName, setPreparerName] = useState("");
  const preparerTouchedRef = useRef(false);
  const [rows, setRows] = useState<OutboundRow[] | null>(null);
  const [pendingOutbound, setPendingOutbound] = useState<Record<string, PendingOutbound>>({});
  const [modal, setModal] = useState<{ row: OutboundRow } | null>(null);

  useEffect(() => {
    fetchMaterials();
    fetchBom();
    fetchOutboundStandards();
    fetchLastUsedDates();
  }, [fetchMaterials, fetchBom, fetchOutboundStandards, fetchLastUsedDates]);

  /** 마운트 시 작성자 최초값: 로그인 사용자명 1순위. 없을 때만 Supabase → localStorage fallback */
  useEffect(() => {
    if (loginAuthor && !preparerTouchedRef.current) {
      setPreparerName(loginAuthor);
      return;
    }
    if (!loginAuthor) {
      let cancelled = false;
      getAppRecentValue(OUTBOUND_LAST_AUTHOR_KEY)
        .then((v) => {
          if (cancelled) return;
          const fromSupabase = (v ?? "").trim();
          if (!preparerTouchedRef.current) {
            setPreparerName(fromSupabase || getLastAuthorNameFromStorage());
          }
        })
        .catch(() => {
          if (!cancelled && !preparerTouchedRef.current) {
            setPreparerName(getLastAuthorNameFromStorage());
          }
        });
      return () => {
        cancelled = true;
      };
    }
  }, [loginAuthor]);

  const productOptions = useMemo(() => {
    const set = new Set(bomList.map((b) => b.productName));
    return Array.from(set).sort();
  }, [bomList]);

  const productName = useMemo(() => {
    if (!selectedBaseName.trim()) return "";
    return selectedOption.trim()
      ? `${selectedBaseName.trim()} - ${selectedOption.trim()}`
      : selectedBaseName.trim();
  }, [selectedBaseName, selectedOption]);

  const baseNameOptions = useMemo(() => {
    const set = new Set<string>();
    for (const fullName of productOptions) {
      const { baseName } = splitProductName(fullName);
      if (baseName) set.add(baseName);
    }
    return Array.from(set).sort();
  }, [productOptions]);

  const optionOptions = useMemo(() => {
    if (!selectedBaseName.trim()) return [];
    const set = new Set<string>();
    for (const fullName of productOptions) {
      const parsed = splitProductName(fullName);
      if (parsed.baseName === selectedBaseName.trim()) {
        set.add(parsed.option);
      }
    }
    return Array.from(set).sort((a, b) => {
      if (!a && b) return -1;
      if (a && !b) return 1;
      return a.localeCompare(b);
    });
  }, [productOptions, selectedBaseName]);

  useEffect(() => {
    if (!selectedBaseName.trim()) {
      if (selectedOption !== "") setSelectedOption("");
      return;
    }
    if (!optionOptions.includes(selectedOption)) {
      setSelectedOption(optionOptions.includes("") ? "" : (optionOptions[0] ?? ""));
    }
  }, [selectedBaseName, selectedOption, optionOptions]);

  /** 기준이 "파베이크사용"이면 도우수량은 사용하지 않으므로 입력값 초기화 */
  const isParbakeUse = selectedOption === "파베이크사용";
  useEffect(() => {
    if (isParbakeUse && doughQty.trim() !== "") {
      setDoughQty("");
    }
  }, [isParbakeUse]); // eslint-disable-line react-hooks-exhaustive-deps -- doughQty 초기화는 기준 변경 시에만

  // 기존 usage_calculations에 예상수량이 있으면, 수정 진입 시 finishedQty 입력칸에 복원
  useEffect(() => {
    if (!productName.trim() || finishedQtyTouched) return;
    const existing = getUsageCalculation(productionDate, productName);
    const expected = existing?.finished_qty_expected;
    if (expected != null && Number.isFinite(expected)) {
      setFinishedQty(String(expected));
    }
  }, [productionDate, productName, getUsageCalculation, finishedQtyTouched]);

  const handleCalculate = () => {
    const d = isParbakeUse ? 0 : (parseInt(doughQty, 10) || 0);
    const f = parseInt(finishedQty, 10) || 0;
    if (!productName.trim()) {
      setRows([]);
      return;
    }
    if (isParbakeUse ? f <= 0 : d <= 0 && f <= 0) {
      setRows([]);
      return;
    }
    const result = calcOutbound(productName.trim(), d, f, bomList, materials);
    setRows(result);
  };

  const standardPreviewRows = useMemo<OutboundStandardPreviewRow[]>(() => {
    const name = productName.trim();
    if (!name) return [];
    const d = isParbakeUse ? 0 : (parseInt(doughQty, 10) || 0);
    const f = parseInt(finishedQty, 10) || 0;
    if (isParbakeUse ? f <= 0 : d <= 0 && f <= 0) return [];

    const list = outboundStandards.filter((s) => s.productName === name);
    return list
      .map((s) => {
        const perDough = s.basis === "도우" ? s.standardGPerEa : 0;
        const perFinished = s.basis === "완제품" ? s.standardGPerEa : 0;
        const totalG = perDough * d + perFinished * f;
        const material = materials.find((m) => m.materialName === s.materialName);
        const qty = calcQuantityFromTotalG(totalG, material);
        return {
          materialName: s.materialName,
          basis: s.basis,
          standardGPerEa: s.standardGPerEa,
          totalG,
          boxQty: qty.boxQty,
          bagQty: qty.bagQty,
          quantityType: qty.quantityType,
        };
      })
      .sort((a, b) => a.materialName.localeCompare(b.materialName, "ko"));
  }, [productName, isParbakeUse, doughQty, finishedQty, outboundStandards, materials]);

  const standardPreviewByMaterial = useMemo(() => {
    const map = new Map<string, OutboundStandardPreviewRow>();
    for (const row of standardPreviewRows) {
      if (!map.has(row.materialName)) map.set(row.materialName, row);
    }
    return map;
  }, [standardPreviewRows]);

  const getDefaultExpiry = (materialName: string) =>
    (lastUsedDates ?? {})[String(materialName ?? "")] || todayStr();

  const handleSaveToPending = (
    entries: { expiryDate: string; boxQty: number; bagQty: number; remainderG: number }[],
    ctx: { productionDate: string; productName: string; materialName: string }
  ) => {
    if (!entries.length) return;
    setPendingOutbound((prev) => ({
      ...prev,
      [ctx.materialName]: {
        productionDate: ctx.productionDate,
        productName: ctx.productName,
        materialName: ctx.materialName,
        entries,
      },
    }));
    setModal(null);
  };

  const openOutboundModal = useCallback((row: OutboundRow) => {
    try {
      if (!row || typeof row !== "object") {
        alert("선택한 원료 정보를 불러올 수 없습니다.");
        return;
      }
      if (!row.materialName) {
        alert("원료명이 없어 출고 입력을 열 수 없습니다.");
        return;
      }
      const qty = row.quantityType;
      if (qty !== "g_only" && qty !== "ea_only" && qty !== "box_ea") {
        setModal({ row: { ...row, quantityType: "g_only" } });
        return;
      }
      setModal({ row });
    } catch (err) {
      console.error("[Outbound] openOutboundModal error:", err);
      alert("출고 입력을 열 수 없습니다. 콘솔을 확인해 주세요.");
    }
  }, []);

  const handleFinalSave = async () => {
    const list = Object.values(pendingOutbound);
    if (!list.length) {
      alert("임시 저장된 출고 내역이 없습니다.");
      return;
    }
    try {
      // 기존 usage_calculations에 예상수량이 있으면, 입력이 비어 있을 때 그 값을 유지
      const first = list[0];
      let effectiveExpected: number | undefined;
      if (first) {
        const parsed = parseInt(finishedQty, 10);
        const hasInput = finishedQty.trim() !== "" && Number.isFinite(parsed);
        const existingCalc = getUsageCalculation(first.productionDate, first.productName);
        const existingExpected = existingCalc?.finished_qty_expected;
        if (hasInput) {
          effectiveExpected = parsed;
        } else if (existingExpected != null && Number.isFinite(existingExpected)) {
          effectiveExpected = existingExpected;
        } else {
          effectiveExpected = undefined;
        }
      }

      for (const p of list) {
        const doughQtyNum = parseInt(doughQty, 10);
        const 출고_라인 = p.entries.map((e) => {
          const 박스 = ensureNumber(e.boxQty, 0);
          const 낱개 = ensureNumber(e.bagQty, 0);
          const g = ensureNumber(e.remainderG, 0);
          return {
            소비기한: String(e.expiryDate ?? "").trim() || new Date().toISOString().slice(0, 10),
            박스,
            낱개,
            g,
          };
        });
        const payload = {
          생산일자: p.productionDate,
          제품명: p.productName,
          원료명: p.materialName,
          출고_라인,
          출고자: preparerName.trim() || undefined,
        };
        await addProductionLog({
          생산일자: p.productionDate,
          제품명: p.productName,
          원료명: p.materialName,
          출고_라인,
          출고_박스: 0,
          출고_낱개: 0,
          출고_g: 0,
          출고자: preparerName.trim() || undefined,
          반죽량: isParbakeUse ? undefined : (Number.isFinite(doughQtyNum) ? doughQtyNum : undefined),
          완제품예상수량: effectiveExpected != null && Number.isFinite(effectiveExpected) ? effectiveExpected : undefined,
        });
        if (p.entries[0]?.expiryDate) {
          await setLastUsedDate(p.materialName, p.entries[0].expiryDate);
        }
      }
      if (first) {
        const existing = getUsageCalculation(first.productionDate, first.productName);
        await saveUsageCalculation({
          production_date: first.productionDate,
          product_name: first.productName,
          author_name: existing?.author_name,
          dough_usage_qty: existing?.dough_usage_qty,
          dough_waste_qty: existing?.dough_waste_qty,
          finished_qty_expected: effectiveExpected,
          materials_data: existing?.materials_data ?? {},
        });
      }
      await fetchProductionLogs();
      setPendingOutbound({});
      setRows(null);
      setModal(null);
      if (preparerName.trim()) {
        setAppRecentValue(OUTBOUND_LAST_AUTHOR_KEY, preparerName.trim());
        setLastAuthorNameToStorage(preparerName.trim());
      }
      alert(`전체 출고 내역 ${list.length}건이 저장되었습니다.`);
    } catch (err) {
      const message = getErrorMessage(err);
      alert(`저장에 실패했습니다.\n\n원인: ${message}`);
    }
  };

  return (
    <main className="py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-100 mb-6">
          출고 입력
        </h1>

        {error && (
          <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-sm">
            {error}
          </div>
        )}
        {(materialsLoading || bomLoading || outboundStandardsLoading) && (
          <p className="mb-4 text-slate-400 flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            로딩 중...
          </p>
        )}

        <div className="bg-space-800/80 rounded-2xl border border-slate-700 shadow-glow p-6 mb-8">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">작성자</label>
              <input
                type="text"
                value={preparerName}
                onChange={(e) => {
                  preparerTouchedRef.current = true;
                  setPreparerName(e.target.value);
                }}
                placeholder="이름"
                className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">생산일자</label>
              <DateWheelPicker value={productionDate} onChange={(v) => setProductionDate(v)} className="w-full px-3 py-2 focus:ring-2 focus:ring-cyan-500/50" placeholder="생산일자" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">제품명 선택</label>
                <select
                  value={selectedBaseName}
                  onChange={(e) => setSelectedBaseName(e.target.value)}
                  className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
                >
                  <option value="">제품명을 선택하세요</option>
                  {baseNameOptions.map((base) => (
                    <option key={base} value={base}>{base}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">기준 선택</label>
                <select
                  value={selectedOption}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  disabled={!selectedBaseName.trim()}
                  className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {!selectedBaseName.trim() ? "제품명을 먼저 선택하세요" : "기준을 선택하세요"}
                  </option>
                  {optionOptions.map((opt) => (
                    <option key={opt || "__base__"} value={opt}>
                      {opt || "(기본)"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">도우수량</label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={doughQty}
                  onChange={(e) => setDoughQty(e.target.value)}
                  placeholder={isParbakeUse ? "파베이크사용 제품은 도우수량 입력 없음" : "숫자 입력"}
                  disabled={isParbakeUse}
                  className={`w-full px-3 py-2 border rounded-lg placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 ${
                    isParbakeUse
                      ? "bg-slate-800 border-slate-600 text-slate-500 cursor-not-allowed"
                      : "bg-space-900 border-slate-600 text-slate-100"
                  }`}
                />
                {isParbakeUse && (
                  <p className="mt-1 text-xs text-slate-500">파베이크사용 기준은 도우수량을 입력하지 않습니다.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">완제품 예상수량</label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={finishedQty}
                  onChange={(e) => {
                    setFinishedQty(e.target.value);
                    setFinishedQtyTouched(true);
                  }}
                  placeholder="숫자 입력"
                  className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>
            <button type="button" onClick={handleCalculate} className="w-full py-3 rounded-xl bg-cyan-500 text-space-900 font-semibold shadow-glow hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-space-900 transition-colors">
              계산하기
            </button>
          </div>
        </div>

        {rows !== null && (
          <>
            <>
              <div className="md:hidden space-y-3">
                {rows.length === 0 ? (
                  <div className="rounded-xl border border-slate-700 bg-space-800/80 px-4 py-6 text-center text-slate-500 text-sm">
                    제품을 선택하고 도우/완제품 수량을 입력한 뒤 계산하기를 눌러 주세요.
                  </div>
                ) : (
                  rows.map((row) => {
                    const pending = pendingOutbound[row.materialName];
                    const mat = materials.find((m) => m.materialName === row.materialName);
                    const { totalBox, totalBag, totalG } = sumPendingBoxBagG(pending?.entries ?? []);
                    const actualOutboundG = calcActualOutboundG(pending?.entries ?? [], mat);
                    return (
                      <div key={row.materialName} className="rounded-xl border border-slate-700 bg-space-800/80 shadow-glow p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="text-base font-bold text-slate-100">{row.materialName}</h3>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-700 text-slate-300 text-xs font-medium">
                            {row.basis}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="rounded-md bg-space-900/80 border border-slate-700 px-2 py-1.5">
                            <p className="text-slate-500">총 필요량(g)</p>
                            <p className="text-slate-200 tabular-nums">{row.totalG.toLocaleString()}</p>
                          </div>
                          <div className="rounded-md bg-space-900/80 border border-slate-700 px-2 py-1.5">
                            <p className="text-slate-500">필요 박스</p>
                            <p className="text-slate-200 tabular-nums">{row.quantityType === "box_ea" ? row.boxQty : "-"}</p>
                          </div>
                          <div className="rounded-md bg-space-900/80 border border-slate-700 px-2 py-1.5">
                            <p className="text-slate-500">필요 낱개</p>
                            <p className="text-slate-200 tabular-nums">{row.quantityType === "g_only" ? "-" : row.bagQty}</p>
                          </div>
                          <div className="rounded-md bg-space-900/80 border border-slate-700 px-2 py-1.5">
                            <p className="text-slate-500">출고 박스</p>
                            <p className="text-cyan-300 tabular-nums">{row.quantityType === "box_ea" ? (pending ? totalBox : "-") : "-"}</p>
                          </div>
                          <div className="rounded-md bg-space-900/80 border border-slate-700 px-2 py-1.5">
                            <p className="text-slate-500">출고 낱개</p>
                            <p className="text-cyan-300 tabular-nums">{row.quantityType === "g_only" ? "-" : (pending ? totalBag : "-")}</p>
                          </div>
                          <div className="rounded-md bg-space-900/80 border border-slate-700 px-2 py-1.5">
                            <p className="text-slate-500">출고 잔량(g)</p>
                            <p className="text-cyan-300 tabular-nums">{pending ? totalG.toLocaleString() : "-"}</p>
                          </div>
                        </div>
                        <p className="mt-2 text-right text-sm font-semibold text-cyan-400 tabular-nums">
                          실제 총 출고량: {pending ? actualOutboundG.toLocaleString() : "-"}g
                        </p>
                        {standardPreviewByMaterial.get(row.materialName) && (() => {
                          const s = standardPreviewByMaterial.get(row.materialName)!;
                          return (
                            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                              <p className="text-[11px] text-amber-300 font-medium">출고기준 참고 (저장 미반영)</p>
                              <p className="text-xs text-slate-300 mt-0.5">
                                {s.standardGPerEa}g/ea · 기준 {s.basis} · 필요 {s.totalG.toLocaleString()}g
                              </p>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                환산: {s.quantityType === "g_only" ? "g 전용" : s.quantityType === "ea_only" ? `${s.bagQty.toLocaleString()}개` : `${s.boxQty.toLocaleString()}박스 ${s.bagQty.toLocaleString()}개`}
                              </p>
                            </div>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={() => openOutboundModal(row)}
                          className={pending ? "mt-3 w-full inline-flex items-center justify-center px-4 py-3 rounded-lg bg-emerald-500/80 text-space-900 text-sm font-medium shadow-glow hover:bg-emerald-400 transition-colors" : "mt-3 w-full inline-flex items-center justify-center px-4 py-3 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium shadow-glow hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 transition-colors"}
                        >
                          {pending ? "✅ 입력 완료 (수정)" : "출고 입력"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="hidden md:block bg-space-800/80 rounded-2xl border border-slate-700 overflow-hidden shadow-glow">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px]">
                    <thead>
                      <tr className="bg-space-700/80 border-b border-slate-600">
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200">원료명</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200">계산기준</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">총 필요량(g)</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">필요 박스</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">필요 낱개</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">출고 박스</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">출고 낱개</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">출고 잔량(g)</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">실제 총 출고량(g)</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200">실제 출고 상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-4 py-6 text-center text-slate-500">제품을 선택하고 도우/완제품 수량을 입력한 뒤 계산하기를 눌러 주세요.</td>
                        </tr>
                      ) : (
                        rows.map((row) => {
                          const pending = pendingOutbound[row.materialName];
                          const mat = materials.find((m) => m.materialName === row.materialName);
                          const { totalBox, totalBag, totalG } = sumPendingBoxBagG(pending?.entries ?? []);
                          const actualOutboundG = calcActualOutboundG(pending?.entries ?? [], mat);
                          return (
                            <tr key={row.materialName} className="border-b border-slate-700 hover:bg-space-700/40">
                              <td className="px-4 py-3 font-medium text-slate-100">{row.materialName}</td>
                              <td className="px-4 py-3 text-center text-slate-300">{row.basis}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.totalG.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.quantityType === "box_ea" ? row.boxQty : "-"}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.quantityType === "g_only" ? "-" : row.bagQty}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-cyan-300/90">{row.quantityType === "box_ea" ? (pending ? totalBox : "-") : "-"}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-cyan-300/90">{row.quantityType === "g_only" ? "-" : (pending ? totalBag : "-")}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-cyan-300/90">{pending ? totalG.toLocaleString() : "-"}</td>
                              <td className="px-4 py-3 text-right tabular-nums font-medium text-cyan-400">{pending ? actualOutboundG.toLocaleString() : "-"}</td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => openOutboundModal(row)}
                                  className={pending ? "inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-500/80 text-space-900 text-sm font-medium shadow-glow hover:bg-emerald-400 transition-colors" : "inline-flex items-center justify-center px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium shadow-glow hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 transition-colors"}
                                >
                                  {pending ? "✅ 입력 완료 (수정)" : "출고 입력"}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>

            {standardPreviewRows.length > 0 && (
              <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-amber-200">출고기준 참고 계산</h3>
                  <span className="text-[11px] text-amber-300/90">저장 미반영</span>
                </div>
                <div className="space-y-2">
                  {standardPreviewRows.map((s) => (
                    <div key={`${s.materialName}-${s.basis}`} className="rounded-lg border border-slate-700 bg-space-900/60 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-100">{s.materialName}</p>
                        <p className="text-xs text-slate-400">{s.basis}</p>
                      </div>
                      <p className="text-xs text-slate-300 mt-1">
                        {s.standardGPerEa}g/ea × 수량 = {s.totalG.toLocaleString()}g
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        환산: {s.quantityType === "g_only" ? "g 전용" : s.quantityType === "ea_only" ? `${s.bagQty.toLocaleString()}개` : `${s.boxQty.toLocaleString()}박스 ${s.bagQty.toLocaleString()}개`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              {saving === "logs" && (
                <p className="mb-2 text-cyan-400 flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  저장 중...
                </p>
              )}
              <button
                type="button"
                onClick={handleFinalSave}
                disabled={Object.keys(pendingOutbound).length === 0 || saving === "logs"}
                className="w-full py-4 rounded-xl bg-cyan-500 text-space-900 text-lg font-bold shadow-glow hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-space-900 transition-colors"
              >
                전체 출고 내역 최종 저장
                {Object.keys(pendingOutbound).length > 0 && (
                  <span className="ml-2 text-space-900/80">({Object.keys(pendingOutbound).length}건)</span>
                )}
              </button>
            </div>
          </>
        )}

        {modal?.row && (
          <OutboundModal
            materialName={String(modal.row.materialName ?? "")}
            inventoryItemCode={materials.find((m) => m.materialName === String(modal.row.materialName ?? ""))?.inventoryItemCode}
            requiredText={formatRequiredQty(modal.row)}
            standardRequiredText={formatStandardRequiredQty(standardPreviewByMaterial.get(String(modal.row.materialName ?? "")))}
            defaultExpiryDate={getDefaultExpiry(modal.row.materialName)}
            initialEntries={Array.isArray(pendingOutbound[modal.row.materialName]?.entries) ? pendingOutbound[modal.row.materialName].entries : undefined}
            quantityType={modal.row.quantityType === "g_only" || modal.row.quantityType === "ea_only" || modal.row.quantityType === "box_ea" ? modal.row.quantityType : "g_only"}
            onClose={() => setModal(null)}
            onSave={(entries) => handleSaveToPending(entries, { productionDate, productName: productName.trim(), materialName: String(modal.row.materialName ?? "") })}
          />
        )}
      </div>
    </main>
  );
}
