"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { HarangBomRow, HarangCategory } from "@/features/harang/types";
import LotPickerModal, { type LotAllocation } from "@/features/harang/LotPickerModal";
import { STATUS_LABEL } from "@/features/harang/productionRequests";
import { displayHarangProductName } from "@/features/harang/displayProductName";
import {
  formatYmdDot,
  harangProductExpiryFromProductionDate,
} from "@/features/harang/finishedProductExpiry";

type DraftLine = {
  key: string;
  product_name: string;
  material_category: HarangCategory;
  material_id: string;
  material_code: string;
  material_name: string;
  bom_qty_per_unit: number;
  unit: string;
  /** 이번 생산분 기준 레시피 소요량 (BOM × 생산수량) */
  requiredQty: number;
  usageQty: string;
  allocations: LotAllocation[];
  lotDatesSummary: string;
};

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function sumAllocations(allocs: LotAllocation[]): number {
  return roundQty(allocs.reduce((s, a) => s + a.quantity_used, 0));
}

/** 원재료 마스터 시드: 파베이크도우 토마토·베샤멜 — 상단 '파베이크' 블록 전용 */
const PARBAKE_RAW_MATERIAL_CODES = new Set(["HR-PARBAKE-DOUGH-TOMATO", "HR-PARBAKE-DOUGH-BECHAMEL"]);
const PARBAKE_MATERIAL_NAMES = new Set(["파베이크도우 - 토마토", "파베이크도우 - 베샤멜"]);
const DRAFT_STORAGE_KEY = "harang-production-input-draft-v1";

/** 직접입력 `DraftLine`·작업지시 `ExecDraftLine` 공통 — 파베이크 판별에 필요한 필드만 */
type ParbakeDoughLineLike = Pick<DraftLine, "material_category" | "material_code" | "material_name">;

function isParbakeDoughLine(line: ParbakeDoughLineLike): boolean {
  if (line.material_category !== "raw_material") return false;
  if (PARBAKE_RAW_MATERIAL_CODES.has(line.material_code)) return true;
  if (PARBAKE_MATERIAL_NAMES.has(line.material_name.trim())) return true;
  return line.material_name.replace(/\s/g, "").includes("파베이크도우");
}

function LegacyHarangProductionInputNewPage() {
  const router = useRouter();
  const [productionDate, setProductionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [previewNo, setPreviewNo] = useState("");
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [productName, setProductName] = useState("");
  const [finishedQtyStr, setFinishedQtyStr] = useState("1");
  const [note, setNote] = useState("");
  const [bomRows, setBomRows] = useState<HarangBomRow[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [pickerKey, setPickerKey] = useState<string | null>(null);

  const saveDraft = async () => {
    const payload = {
      productionDate,
      productName,
      finishedQtyStr,
      note,
      lines,
      savedAt: new Date().toISOString(),
    };
    try {
      setDraftBusy(true);
      const { error } = await supabase.rpc("upsert_harang_production_draft", {
        p_draft_data: payload,
      });
      setDraftBusy(false);
      if (error) throw error;
      alert("서버 임시저장되었습니다.");
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
      return;
    } catch {
      setDraftBusy(false);
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
        alert("서버 저장 실패로 로컬 임시저장으로 대체했습니다.");
      } catch {
        alert("임시저장에 실패했습니다.");
      }
    }
  };

  const loadDraft = async () => {
    try {
      setDraftBusy(true);
      const { data, error } = await supabase.rpc("get_harang_production_draft");
      setDraftBusy(false);
      if (!error && data && typeof data === "object") {
        const parsed = data as Partial<{
          productionDate: string;
          productName: string;
          finishedQtyStr: string;
          note: string;
          lines: DraftLine[];
        }>;
        if (!Array.isArray(parsed.lines)) throw new Error("invalid server draft");
        setProductionDate(parsed.productionDate || new Date().toISOString().slice(0, 10));
        setProductName(parsed.productName || "");
        setFinishedQtyStr(parsed.finishedQtyStr || "1");
        setNote(parsed.note || "");
        setLines(parsed.lines);
        alert("서버 임시저장 데이터를 불러왔습니다.");
        return;
      }
    } catch {
      setDraftBusy(false);
      // fallback to local draft
    }
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        alert("임시저장 데이터가 없습니다.");
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{
        productionDate: string;
        productName: string;
        finishedQtyStr: string;
        note: string;
        lines: DraftLine[];
      }>;
      if (!parsed || !Array.isArray(parsed.lines)) {
        alert("임시저장 데이터 형식이 올바르지 않습니다.");
        return;
      }
      setProductionDate(parsed.productionDate || new Date().toISOString().slice(0, 10));
      setProductName(parsed.productName || "");
      setFinishedQtyStr(parsed.finishedQtyStr || "1");
      setNote(parsed.note || "");
      setLines(parsed.lines);
      alert("로컬 임시저장 데이터를 불러왔습니다.");
    } catch {
      alert("임시저장 데이터를 불러오지 못했습니다.");
    }
  };

  const loadProductNames = useCallback(async () => {
    const { data, error } = await supabase
      .from("harang_product_bom")
      .select("product_name")
      .eq("is_active", true);
    if (error) {
      alert(error.message);
      return;
    }
    const names = Array.from(new Set((data ?? []).map((r: { product_name: string }) => r.product_name))).sort(
      (a, b) => a.localeCompare(b, "ko"),
    );
    setProductOptions(names);
  }, []);

  const loadBom = useCallback(async (name: string) => {
    if (!name) {
      setBomRows([]);
      return;
    }
    const { data, error } = await supabase
      .from("harang_product_bom")
      .select("id, product_name, material_category, material_id, material_code, material_name, bom_qty, unit, is_active, created_at, updated_at")
      .eq("product_name", name)
      .eq("is_active", true)
      .order("material_name", { ascending: true });
    if (error) {
      alert(error.message);
      setBomRows([]);
      return;
    }
    setBomRows((data ?? []) as HarangBomRow[]);
  }, []);

  const loadPreviewNo = useCallback(async (date: string) => {
    const { count, error } = await supabase
      .from("harang_production_headers")
      .select("id", { count: "exact", head: true })
      .eq("production_date", date);
    if (error) return;
    setPreviewNo(`${date.replaceAll("-", "/")}-${(count ?? 0) + 1}`);
  }, []);

  useEffect(() => {
    void loadProductNames();
  }, [loadProductNames]);

  useEffect(() => {
    void loadPreviewNo(productionDate);
  }, [productionDate, loadPreviewNo]);

  useEffect(() => {
    void loadBom(productName);
  }, [productName, loadBom]);

  const finishedQty = useMemo(() => {
    const n = Number(finishedQtyStr);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [finishedQtyStr]);
  useEffect(() => {
    if (!productName || bomRows.length === 0 || finishedQty <= 0) {
      setLines([]);
      return;
    }
    setLines(
      bomRows.map((row) => {
        const mc: HarangCategory = row.material_category ?? "raw_material";
        const req = roundQty(row.bom_qty * finishedQty);
        return {
          key: row.id,
          product_name: row.product_name,
          material_category: mc,
          material_id: row.material_id,
          material_code: row.material_code,
          material_name: row.material_name,
          bom_qty_per_unit: row.bom_qty,
          unit: row.unit,
          requiredQty: req,
          usageQty: String(req),
          allocations: [],
          lotDatesSummary: "",
        };
      }),
    );
  }, [bomRows, productName, finishedQty]);

  const pickerLine = useMemo(() => lines.find((l) => l.key === pickerKey) ?? null, [lines, pickerKey]);

  const parbakeLines = useMemo(() => lines.filter(isParbakeDoughLine), [lines]);
  const rawOnlyLines = useMemo(
    () => lines.filter((l) => l.material_category === "raw_material" && !isParbakeDoughLine(l)),
    [lines],
  );
  const packagingLines = useMemo(
    () => lines.filter((l) => l.material_category === "packaging_material"),
    [lines],
  );

  const patchLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const openPicker = (key: string) => setPickerKey(key);

  const handleSave = async () => {
    if (!productName.trim()) {
      alert("제품명을 선택하세요.");
      return;
    }
    if (finishedQty <= 0) {
      alert("생산수량을 입력하세요.");
      return;
    }
    if (lines.length === 0) {
      alert("BOM 라인이 없습니다. 제품 BOM 마스터를 확인하세요.");
      return;
    }
    for (const line of lines) {
      const u = Number(line.usageQty);
      if (!Number.isFinite(u) || u < 0) {
        alert(`사용량이 올바르지 않습니다: ${line.material_name}`);
        return;
      }
      if (line.requiredQty > 0 && u <= 0) {
        alert(`사용량을 입력하세요: ${line.material_name}`);
        return;
      }
      if (u > 0) {
        if (line.allocations.length === 0) {
          alert(`LOT를 지정하세요 (돋보기): ${line.material_name}`);
          return;
        }
        const s = sumAllocations(line.allocations);
        if (Math.abs(s - u) > 0.001) {
          alert(`LOT 합계와 사용량이 일치하지 않습니다: ${line.material_name}`);
          return;
        }
      }
    }

    const payload = lines.map((line) => ({
      material_category: line.material_category,
      material_id: line.material_id,
      material_code: line.material_code,
      material_name: line.material_name,
      bom_qty: line.requiredQty,
      unit: line.unit,
      usage_qty: Number(line.usageQty),
      allocations: line.allocations,
    }));

    setSaving(true);
    const { error } = await supabase.rpc("create_harang_production_with_usage", {
      p_production_date: productionDate,
      p_product_name: productName.trim(),
      p_finished_qty: finishedQty,
      p_note: note.trim() || null,
      p_lines: payload,
    });
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore localStorage cleanup failure
    }
    try {
      await supabase.rpc("delete_harang_production_draft");
    } catch {
      // ignore server draft cleanup failure
    }
    router.replace("/harang/production-input");
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">하랑 생산입고</h1>
            <p className="text-sm text-slate-600 mt-1">
              제품·생산수량을 입력하면 BOM 기준으로 소모품목이 채워지며, 사용량은 LOT별로 나누어 차감됩니다.
            </p>
          </div>
          <Link
            href="/harang/production-input"
            className="px-3 py-2 rounded-lg border border-slate-300 text-slate-800 text-sm bg-white hover:bg-slate-50"
          >
            목록으로
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">헤더 정보</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block text-xs text-slate-600">
              일자
              <input
                type="date"
                value={productionDate}
                onChange={(e) => setProductionDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-600">
              일자-No.
              <input
                readOnly
                value={previewNo}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-600 sm:col-span-2">
              제품명
              <select
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
              >
                <option value="">제품 선택</option>
                {productOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              생산수량
              <input
                type="text"
                inputMode="decimal"
                value={finishedQtyStr}
                onChange={(e) => setFinishedQtyStr(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-600 lg:col-span-3">
              비고
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
                placeholder="선택"
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-slate-800">상세 (BOM · 사용 · LOT)</h2>
          </div>

          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">제품을 선택하면 BOM 라인이 표시됩니다.</p>
          ) : (
            <div className="space-y-5 -mx-4 px-4 sm:mx-0 sm:px-0">
              {[
                {
                  title: "파베이크",
                  rows: parbakeLines,
                  empty: "이 제품 BOM에 파베이크도우(토마토/베샤멜)가 없습니다.",
                  headerClass: "bg-cyan-50 border-b border-cyan-200",
                  bomUnit: "default" as const,
                },
                {
                  title: "원재료",
                  rows: rawOnlyLines,
                  empty: "이 제품에는 원재료 BOM이 없습니다.",
                  headerClass: "bg-slate-100 border-b border-slate-200",
                  bomUnit: "force_g" as const,
                },
                {
                  title: "부자재",
                  rows: packagingLines,
                  empty: "이 제품에는 부자재 BOM이 없습니다.",
                  headerClass: "bg-slate-100 border-b border-slate-200",
                  bomUnit: "default" as const,
                },
              ].map(({ title, rows: sectionLines, empty, headerClass, bomUnit }) => (
                <div key={title} className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className={`px-3 py-2 ${headerClass}`}>
                    <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-600 bg-white">
                          <th className="px-3 py-2 text-left font-medium">생산품목명</th>
                          <th className="px-3 py-2 text-left font-medium">소모품목명</th>
                          <th className="px-3 py-2 text-right font-medium">BOM(소요)</th>
                          <th className="px-3 py-2 text-right font-medium w-[200px]">사용량</th>
                          <th className="px-3 py-2 text-left font-medium min-w-[180px]">소비기한·제조일자</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectionLines.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-slate-500 text-sm">
                              {empty}
                            </td>
                          </tr>
                        ) : (
                          sectionLines.map((line) => (
                            <tr key={line.key} className="border-b border-slate-100 align-top">
                              <td className="px-3 py-2 text-slate-900">{displayHarangProductName(line.product_name)}</td>
                              <td className="px-3 py-2 text-slate-900">{line.material_name}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                                {bomUnit === "force_g"
                                  ? `${line.requiredQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} g`
                                  : `${line.requiredQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${line.unit}`}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={Number(line.usageQty || 0).toLocaleString("ko-KR", { maximumFractionDigits: 3 })}
                                    readOnly
                                    onDoubleClick={() => openPicker(line.key)}
                                    className="w-full min-w-[96px] max-w-[140px] cursor-pointer rounded border border-slate-300 px-2 py-1.5 text-right text-slate-900 bg-slate-50"
                                    title="직접입력 불가. 더블클릭 또는 돋보기로 LOT에서 입력"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => openPicker(line.key)}
                                    className="shrink-0 rounded border border-slate-300 bg-slate-50 p-1.5 text-slate-700 hover:bg-slate-100"
                                    title="LOT 선택"
                                    aria-label="LOT 선택"
                                  >
                                    <Search className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-slate-700 text-sm whitespace-pre-wrap">
                                {line.lotDatesSummary || (line.allocations.length === 0 ? "—" : "")}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void loadDraft()}
            disabled={draftBusy}
            className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white hover:bg-slate-50"
          >
            임시불러오기
          </button>
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={draftBusy}
            className="px-4 py-2.5 rounded-lg border border-amber-400/70 text-amber-700 text-sm bg-amber-50 hover:bg-amber-100"
          >
            임시저장
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="px-5 py-2.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-60"
          >
            {saving ? "저장 중…" : "생산입고 저장"}
          </button>
        </div>
      </div>

      {pickerLine && (
        <LotPickerModal
          open={!!pickerKey}
          onClose={() => setPickerKey(null)}
          materialName={pickerLine.material_name}
          category={pickerLine.material_category}
          materialId={pickerLine.material_id}
          initialAllocations={pickerLine.allocations}
          bomRequiredQty={pickerLine.requiredQty}
          bomUnit={pickerLine.unit}
          onApply={(allocations, lotDatesSummary) => {
            const sum = sumAllocations(allocations);
            const key = pickerKey;
            if (!key) return;
            patchLine(key, {
              allocations,
              lotDatesSummary,
              usageQty: String(sum),
            });
          }}
        />
      )}
    </div>
  );
}

type RequestLinePick = {
  line_id: string;
  header_id: string;
  request_no: string;
  request_date: string;
  due_date: string;
  status: string;
  product_name: string;
  requested_qty: number;
  produced_qty: number;
  closed_qty: number;
  remaining_qty: number;
};

type RequestMaterialRow = {
  id: string;
  request_line_id: string;
  material_category: HarangCategory;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  bom_qty_per_unit: number;
};

type ExecDraftLine = {
  key: string;
  material_category: HarangCategory;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  bom_qty_per_unit: number;
  requiredQty: number;
  usageQty: string;
  allocations: LotAllocation[];
  lotDatesSummary: string;
};

function pickStatusLabel(status: string): string {
  return STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status;
}

function buildExecLines(materials: RequestMaterialRow[], qty: number): ExecDraftLine[] {
  return materials.map((m) => ({
    key: m.id,
    material_category: m.material_category,
    material_id: m.material_id,
    material_code: m.material_code,
    material_name: m.material_name,
    unit: m.unit,
    bom_qty_per_unit: Number(m.bom_qty_per_unit),
    requiredQty: roundQty(Number(m.bom_qty_per_unit) * qty),
    usageQty: String(roundQty(Number(m.bom_qty_per_unit) * qty)),
    allocations: [],
    lotDatesSummary: "",
  }));
}

export default function HarangProductionInputNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestIdParam = searchParams.get("request_id");
  const requestLineIdParam = searchParams.get("request_line_id");
  const editIdParam = searchParams.get("edit_id");

  const [productionDate, setProductionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [requestCandidates, setRequestCandidates] = useState<RequestLinePick[]>([]);
  const [selectedLine, setSelectedLine] = useState<RequestLinePick | null>(null);
  const [materials, setMaterials] = useState<RequestMaterialRow[]>([]);
  const [finishedQtyStr, setFinishedQtyStr] = useState("");
  const [lines, setLines] = useState<ExecDraftLine[]>([]);
  const [lotPickerKey, setLotPickerKey] = useState<string | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [editingHeaderId, setEditingHeaderId] = useState<string | null>(null);

  const finishedQty = useMemo(() => {
    const n = Number(finishedQtyStr);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [finishedQtyStr]);
  const appliedToRequestQty = useMemo(
    () => (selectedLine ? Math.min(finishedQty, selectedLine.remaining_qty) : 0),
    [finishedQty, selectedLine],
  );
  const overrunQty = useMemo(
    () => (selectedLine ? Math.max(0, finishedQty - selectedLine.remaining_qty) : 0),
    [finishedQty, selectedLine],
  );

  const loadCandidates = useCallback(async () => {
    setLoadingCandidates(true);
    const [headRes, lineRes] = await Promise.all([
      supabase.from("harang_production_requests").select("id, request_no, request_date, due_date, status"),
      supabase
        .from("harang_production_request_lines")
        .select("id, header_id, product_name, requested_qty, produced_qty, remaining_qty, closed_qty")
        .gt("remaining_qty", 0),
    ]);
    setLoadingCandidates(false);
    if (headRes.error || lineRes.error) {
      alert(headRes.error?.message ?? lineRes.error?.message ?? "작업지시 라인을 불러오지 못했습니다.");
      return;
    }
    const headMap = new Map<string, { request_no: string; request_date: string; due_date: string; status: string }>();
    for (const h of headRes.data ?? []) {
      headMap.set(h.id as string, {
        request_no: String(h.request_no),
        request_date: String(h.request_date),
        due_date: String(h.due_date),
        status: String(h.status),
      });
    }
    const out: RequestLinePick[] = [];
    for (const l of lineRes.data ?? []) {
      const head = headMap.get(String(l.header_id));
      if (!head) continue;
      if (["completed", "settled", "cancelled"].includes(head.status)) continue;
      out.push({
        line_id: String(l.id),
        header_id: String(l.header_id),
        request_no: head.request_no,
        request_date: head.request_date,
        due_date: head.due_date,
        status: head.status,
        product_name: String(l.product_name),
        requested_qty: Number(l.requested_qty),
        produced_qty: Number(l.produced_qty),
        closed_qty: Number((l as { closed_qty?: number }).closed_qty ?? 0),
        remaining_qty: Number(l.remaining_qty),
      });
    }
    out.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.request_no.localeCompare(b.request_no));
    setRequestCandidates(out);
  }, []);

  const loadLineMaterials = useCallback(async (lineId: string) => {
    const res = await supabase
      .from("harang_production_request_line_materials")
      .select("id, request_line_id, material_category, material_id, material_code, material_name, unit, bom_qty_per_unit")
      .eq("request_line_id", lineId)
      .order("sort_order", { ascending: true });
    if (res.error) {
      alert(res.error.message);
      return [];
    }
    return (res.data ?? []) as RequestMaterialRow[];
  }, []);

  const loadLinePick = useCallback(async (lineId: string) => {
    const lineRes = await supabase
      .from("harang_production_request_lines")
      .select("id, header_id, product_name, requested_qty, produced_qty, remaining_qty, closed_qty")
      .eq("id", lineId)
      .single();
    if (lineRes.error) return null;
    const headRes = await supabase
      .from("harang_production_requests")
      .select("id, request_no, request_date, due_date, status")
      .eq("id", lineRes.data.header_id)
      .single();
    if (headRes.error) return null;
    return {
      line_id: String(lineRes.data.id),
      header_id: String(lineRes.data.header_id),
      request_no: String(headRes.data.request_no),
      request_date: String(headRes.data.request_date),
      due_date: String(headRes.data.due_date),
      status: String(headRes.data.status),
      product_name: String(lineRes.data.product_name),
      requested_qty: Number(lineRes.data.requested_qty),
      produced_qty: Number(lineRes.data.produced_qty),
      closed_qty: Number((lineRes.data as { closed_qty?: number }).closed_qty ?? 0),
      remaining_qty: Number(lineRes.data.remaining_qty),
    } as RequestLinePick;
  }, []);

  const applySelectedLine = useCallback(async (picked: RequestLinePick) => {
    const mats = await loadLineMaterials(picked.line_id);
    if (mats.length === 0) {
      alert("작업지시 BOM 스냅샷이 없어 선택할 수 없습니다.");
      return;
    }
    setSelectedLine(picked);
    setMaterials(mats);
    setFinishedQtyStr(String(picked.remaining_qty));
    setLines(buildExecLines(mats, picked.remaining_qty));
  }, [loadLineMaterials]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  useEffect(() => {
    if (!requestLineIdParam) return;
    if (requestCandidates.length === 0) return;
    const found = requestCandidates.find((x) => x.line_id === requestLineIdParam && x.header_id === requestIdParam);
    if (!found) return;
    void applySelectedLine(found);
  }, [requestLineIdParam, requestIdParam, requestCandidates, applySelectedLine]);

  useEffect(() => {
    if (!editIdParam) return;
    void (async () => {
      const headRes = await supabase
        .from("harang_production_headers")
        .select("id, production_date, note, finished_qty, request_line_id, finished_product_lot_date")
        .eq("id", editIdParam)
        .single();
      if (headRes.error) return;
      const requestLineId = String(headRes.data.request_line_id ?? "");
      if (!requestLineId) return;
      const picked = await loadLinePick(requestLineId);
      if (!picked) return;
      const mats = await loadLineMaterials(requestLineId);
      if (mats.length === 0) return;

      const plRes = await supabase
        .from("harang_production_lines")
        .select("id, material_category, material_id, usage_qty, lot_dates_summary")
        .eq("header_id", editIdParam);
      const lineIds = (plRes.data ?? []).map((x) => x.id as string);
      const lotsRes =
        lineIds.length > 0
          ? await supabase
              .from("harang_production_line_lots")
              .select("line_id, lot_id, quantity_used")
              .in("line_id", lineIds)
          : { data: [] as Array<{ line_id: string; lot_id: string; quantity_used: number }> };

      const usageByMat = new Map<string, { usage_qty: number; lot_dates_summary: string; allocations: LotAllocation[] }>();
      for (const row of plRes.data ?? []) {
        const key = `${row.material_category}:${row.material_id}`;
        usageByMat.set(key, {
          usage_qty: Number(row.usage_qty ?? 0),
          lot_dates_summary: String(row.lot_dates_summary ?? ""),
          allocations: (lotsRes.data ?? [])
            .filter((x) => x.line_id === row.id)
            .map((x) => ({ lot_id: String(x.lot_id), quantity_used: Number(x.quantity_used) })),
        });
      }

      setEditingHeaderId(String(headRes.data.id));
      setProductionDate(String(headRes.data.production_date).slice(0, 10));
      setNote(String(headRes.data.note ?? ""));
      setSelectedLine(picked);
      setMaterials(mats);
      setFinishedQtyStr(String(Number(headRes.data.finished_qty)));
      const base = buildExecLines(mats, Number(headRes.data.finished_qty));
      setLines(
        base.map((l) => {
          const key = `${l.material_category}:${l.material_id}`;
          const hit = usageByMat.get(key);
          if (!hit) return l;
          return {
            ...l,
            usageQty: String(hit.usage_qty),
            allocations: hit.allocations,
            lotDatesSummary: hit.lot_dates_summary,
          };
        }),
      );
    })();
  }, [editIdParam, loadLineMaterials, loadLinePick]);

  const pickerLine = useMemo(() => lines.find((l) => l.key === lotPickerKey) ?? null, [lines, lotPickerKey]);

  const patchLine = (key: string, patch: Partial<ExecDraftLine>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const handleQtyChange = (nextRaw: string) => {
    const next = Number(nextRaw);
    const hasAlloc = lines.some((l) => l.allocations.length > 0);
    if (hasAlloc) {
      const ok = confirm("생산수량을 변경하면 사용량과 LOT 선택을 다시 계산합니다. 계속할까요?");
      if (!ok) return;
    }
    setFinishedQtyStr(nextRaw);
    if (!selectedLine || !materials.length) {
      setLines([]);
      return;
    }
    const qty = Number.isFinite(next) && next > 0 ? next : 0;
    setLines(buildExecLines(materials, qty));
  };

  const handleSave = async () => {
    if (!selectedLine) {
      alert("작업지시 라인을 먼저 선택하세요.");
      return;
    }
    if (finishedQty <= 0) {
      alert("이번 생산수량을 입력하세요.");
      return;
    }
    if (lines.length === 0) {
      alert("BOM 라인이 없습니다.");
      return;
    }
    for (const line of lines) {
      const u = Number(line.usageQty);
      if (!Number.isFinite(u) || u < 0) {
        alert(`사용량이 올바르지 않습니다: ${line.material_name}`);
        return;
      }
      if (line.requiredQty > 0 && u <= 0) {
        alert(`사용량을 입력하세요: ${line.material_name}`);
        return;
      }
      if (u > 0) {
        if (line.allocations.length === 0) {
          alert(`LOT를 지정하세요: ${line.material_name}`);
          return;
        }
        const s = sumAllocations(line.allocations);
        if (Math.abs(s - u) > 0.001) {
          alert(`LOT 합계와 사용량이 일치하지 않습니다: ${line.material_name}`);
          return;
        }
      }
    }

    const payload = lines.map((line) => ({
      material_category: line.material_category,
      material_id: line.material_id,
      material_code: line.material_code,
      material_name: line.material_name,
      bom_qty: line.requiredQty,
      unit: line.unit,
      usage_qty: Number(line.usageQty),
      allocations: line.allocations,
    }));

    const lotYmd = harangProductExpiryFromProductionDate(productionDate) || productionDate.slice(0, 10);

    setSaving(true);
    const { error } = editingHeaderId
      ? await supabase.rpc("update_harang_production_from_request_line", {
          p_header_id: editingHeaderId,
          p_production_date: productionDate,
          p_request_line_id: selectedLine.line_id,
          p_finished_qty: finishedQty,
          p_note: note.trim() || null,
          p_lines: payload,
          p_finished_product_lot_date: lotYmd,
        })
      : await supabase.rpc("create_harang_production_from_request_line", {
          p_production_date: productionDate,
          p_request_line_id: selectedLine.line_id,
          p_finished_qty: finishedQty,
          p_note: note.trim() || null,
          p_lines: payload,
          p_finished_product_lot_date: lotYmd,
        });
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.replace("/harang/production-input");
  };

  const parbakeLines = useMemo(() => lines.filter(isParbakeDoughLine), [lines]);
  const rawOnlyLines = useMemo(
    () => lines.filter((l) => l.material_category === "raw_material" && !isParbakeDoughLine(l)),
    [lines],
  );
  const packagingLines = useMemo(() => lines.filter((l) => l.material_category === "packaging_material"), [lines]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">하랑 생산입고</h1>
            <p className="text-sm text-slate-600 mt-1">작업지시(생산요청 라인) 기반 생산실적 입력</p>
          </div>
          <Link href="/harang/production-input" className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white">
            목록으로
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">헤더 정보</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block text-xs text-slate-600">
              생산일자
              <input
                type="date"
                value={productionDate}
                onChange={(e) => setProductionDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
              />
            </label>
            <div className="block text-xs text-slate-600 sm:col-span-2">
              작업지시 라인 선택
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-cyan-300 bg-cyan-50 text-cyan-800 text-sm text-left"
              >
                {selectedLine
                  ? `${selectedLine.request_no} · ${displayHarangProductName(selectedLine.product_name)} · 잔여 ${selectedLine.remaining_qty.toLocaleString("ko-KR")}`
                  : "작업지시 라인 선택"}
              </button>
            </div>

            <label className="block text-xs text-slate-600">
              품목명
              <input
                readOnly
                value={selectedLine ? displayHarangProductName(selectedLine.product_name) : ""}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-600">
              납기일
              <input readOnly value={selectedLine?.due_date ?? ""} className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-sm" />
            </label>
            <label className="block text-xs text-slate-600">
              제품 소비기한 / LOT
              <input
                readOnly
                value={
                  selectedLine && productionDate
                    ? formatYmdDot(harangProductExpiryFromProductionDate(productionDate))
                    : ""
                }
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-sm tabular-nums"
                title="생산일자 + 364일"
              />
            </label>
            <label className="block text-xs text-slate-600">
              요청수량 / 누적생산 / 잔여
              <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                {selectedLine ? (
                  <>
                    <div className="text-xl font-bold tabular-nums text-slate-900">
                      요청 {selectedLine.requested_qty.toLocaleString("ko-KR")}
                    </div>
                    <div className="mt-1 text-sm text-slate-600 tabular-nums">
                      누적생산 {selectedLine.produced_qty.toLocaleString("ko-KR")} · 잔여{" "}
                      {selectedLine.remaining_qty.toLocaleString("ko-KR")}
                    </div>
                  </>
                ) : (
                  <span className="text-sm text-slate-400">—</span>
                )}
              </div>
            </label>
            <label className="block text-xs text-slate-600">
              요청 반영수량 / 초과생산수량
              <input
                readOnly
                value={selectedLine ? `${appliedToRequestQty.toLocaleString("ko-KR")} / ${overrunQty.toLocaleString("ko-KR")}` : ""}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-sm"
              />
            </label>
            <label className="block text-xs text-slate-600">
              이번 생산수량
              <input
                type="text"
                inputMode="decimal"
                value={finishedQtyStr}
                onChange={(e) => handleQtyChange(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
                placeholder="0"
              />
            </label>
            <label className="block text-xs text-slate-600 lg:col-span-4">
              비고
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
                placeholder="선택"
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-slate-800">상세 (이번 생산수량 기준 BOM · 사용 · LOT)</h2>
          </div>
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">작업지시 라인 선택 후 생산수량을 입력하세요.</p>
          ) : (
            <div className="space-y-5 -mx-4 px-4 sm:mx-0 sm:px-0">
              {(
                [
                  { title: "파베이크", rows: parbakeLines, headerClass: "bg-cyan-50 border-b border-cyan-200" },
                  { title: "원재료", rows: rawOnlyLines, headerClass: "bg-slate-100 border-b border-slate-200" },
                  { title: "부자재", rows: packagingLines, headerClass: "bg-slate-100 border-b border-slate-200" },
                ] as const
              ).map((section) => (
                <div key={section.title} className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className={`px-3 py-2 ${section.headerClass}`}>
                    <h3 className="text-sm font-semibold text-slate-800">{section.title}</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-600 bg-white">
                          <th className="px-3 py-2 text-left font-medium">소모품목명</th>
                          <th className="px-3 py-2 text-right font-medium">BOM(이번 생산 기준)</th>
                          <th className="px-3 py-2 text-right font-medium">사용량</th>
                          <th className="px-3 py-2 text-left font-medium">소비기한·제조일자</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-8 text-center text-slate-500">해당 없음</td>
                          </tr>
                        ) : (
                          section.rows.map((line) => (
                            <tr key={line.key} className="border-b border-slate-100 align-top">
                              <td className="px-3 py-2 text-slate-900">{line.material_name}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                                {line.requiredQty.toLocaleString("ko-KR", { maximumFractionDigits: 3 })} {line.unit}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={Number(line.usageQty || 0).toLocaleString("ko-KR", { maximumFractionDigits: 3 })}
                                    readOnly
                                    onDoubleClick={() => setLotPickerKey(line.key)}
                                    className="w-full min-w-[96px] max-w-[140px] cursor-pointer rounded border border-slate-300 px-2 py-1.5 text-right text-slate-900 bg-slate-50"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setLotPickerKey(line.key)}
                                    className="shrink-0 rounded border border-slate-300 bg-slate-50 p-1.5 text-slate-700 hover:bg-slate-100"
                                    title="LOT 선택"
                                  >
                                    <Search className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-slate-700 text-sm whitespace-pre-wrap">
                                {line.lotDatesSummary || (line.allocations.length === 0 ? "—" : "")}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="px-5 py-2.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-60"
          >
            {saving ? "저장 중…" : editingHeaderId ? "생산입고 수정 저장" : "생산입고 저장"}
          </button>
        </div>
      </div>

      {pickerLine && (
        <LotPickerModal
          open={!!lotPickerKey}
          onClose={() => setLotPickerKey(null)}
          materialName={pickerLine.material_name}
          category={pickerLine.material_category}
          materialId={pickerLine.material_id}
          initialAllocations={pickerLine.allocations}
          bomRequiredQty={pickerLine.requiredQty}
          bomUnit={pickerLine.unit}
          onApply={(allocations, lotDatesSummary) => {
            const sum = sumAllocations(allocations);
            const key = lotPickerKey;
            if (!key) return;
            patchLine(key, {
              allocations,
              lotDatesSummary,
              usageQty: String(sum),
            });
          }}
        />
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setPickerOpen(false)} />
          <div className="relative w-full max-w-6xl max-h-[85vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">작업지시 라인 선택</h3>
              <button type="button" className="text-sm text-slate-600" onClick={() => setPickerOpen(false)}>
                닫기
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(85vh-3.5rem)]">
              <table className="w-full min-w-[960px] text-sm text-slate-800">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="px-3 py-2 text-left">요청번호</th>
                    <th className="px-3 py-2 text-left">요청일</th>
                    <th className="px-3 py-2 text-left">납기일</th>
                    <th className="px-3 py-2 text-left">품목명</th>
                    <th className="px-3 py-2 text-right">요청</th>
                    <th className="px-3 py-2 text-right">완료</th>
                    <th className="px-3 py-2 text-right">잔여</th>
                    <th className="px-3 py-2 text-left">상태</th>
                    <th className="px-3 py-2 text-left">선택</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingCandidates && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-slate-500">불러오는 중...</td>
                    </tr>
                  )}
                  {!loadingCandidates && requestCandidates.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-slate-500">선택 가능한 작업지시 라인이 없습니다.</td>
                    </tr>
                  )}
                  {!loadingCandidates &&
                    requestCandidates.map((r) => (
                      <tr key={r.line_id} className="border-b border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs">{r.request_no}</td>
                        <td className="px-3 py-2">{r.request_date}</td>
                        <td className="px-3 py-2">{r.due_date}</td>
                        <td className="px-3 py-2">{displayHarangProductName(r.product_name)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                          {r.requested_qty.toLocaleString("ko-KR")}
                        </td>
                        <td className="px-3 py-2 text-right">{r.produced_qty.toLocaleString("ko-KR")}</td>
                        <td className="px-3 py-2 text-right">{r.remaining_qty.toLocaleString("ko-KR")}</td>
                        <td className="px-3 py-2">{pickStatusLabel(r.status)}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="px-2 py-1 rounded border border-cyan-300 text-cyan-800 bg-cyan-50 text-xs"
                            onClick={() => {
                              void applySelectedLine(r);
                              setPickerOpen(false);
                            }}
                          >
                            선택
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
