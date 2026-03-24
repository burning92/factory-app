"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  buildRawThawingAutoDeviationText,
  calcTotalWeightG,
  hasRawThawingIssue,
  parseOptionalNum,
  type ThawingResult,
} from "@/features/daily/rawThawing";

type LogStatus = "draft" | "submitted" | "approved" | "rejected";
type Props = { mode: "new" | "edit"; editLogId?: string };

type EcountFrozenRow = {
  item_code: string;
  display_item_name: string | null;
  lot_no: string;
  qty: number | null;
  category: string | null;
  box_weight_g: number | null;
  unit_weight_g: number | null;
};

type MaterialOption = {
  itemCode: string;
  materialName: string;
  boxWeightG: number;
  unitWeightG: number;
};

type CorrectiveState = {
  datetime: string;
  deviation: string;
  detail: string;
  remarks: string;
  actor: string;
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function syncDateToDatetimeLocal(existing: string, date: string): string {
  if (!date) return existing;
  const timePart = existing.includes("T") ? existing.slice(11, 16) : "00:00";
  const safeTime = timePart.length === 5 ? timePart : "00:00";
  return `${date}T${safeTime}`;
}

export function RawThawingForm({ mode, editLogId }: Props) {
  const router = useRouter();
  const { user, profile, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const authorName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();
  const isManager = profile?.role === "manager" || profile?.role === "admin";

  const [thawingDate, setThawingDate] = useState(todayStr);
  const [plannedUseDate, setPlannedUseDate] = useState(todayStr);

  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([]);
  const [inventoryRows, setInventoryRows] = useState<EcountFrozenRow[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryHint, setInventoryHint] = useState<string | null>(null);

  const [selectedItemCode, setSelectedItemCode] = useState("");
  const [selectedLot, setSelectedLot] = useState("");
  const [manualLot, setManualLot] = useState("");

  const [boxQty, setBoxQty] = useState("");
  const [unitQty, setUnitQty] = useState("");
  const [remainderG, setRemainderG] = useState("");

  const [thawingStartAt, setThawingStartAt] = useState("");
  const [thawingEndAt, setThawingEndAt] = useState("");
  const [thawingRoomTempC, setThawingRoomTempC] = useState("");
  const [odorResult, setOdorResult] = useState<ThawingResult | "">("");
  const [colorResult, setColorResult] = useState<ThawingResult | "">("");
  const [foreignMatterResult, setForeignMatterResult] = useState<ThawingResult | "">("");

  const [corrective, setCorrective] = useState<CorrectiveState>({
    datetime: "",
    deviation: "",
    detail: "",
    remarks: "",
    actor: "",
  });

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [currentLogId, setCurrentLogId] = useState<string | null>(null);
  const [currentLogStatus, setCurrentLogStatus] = useState<LogStatus | null>(null);
  const [loadDone, setLoadDone] = useState(mode === "new");
  const [deviationManuallyEdited, setDeviationManuallyEdited] = useState(false);
  const [correctiveDatetimeManuallyEdited, setCorrectiveDatetimeManuallyEdited] = useState(false);

  const selectedMaterial = useMemo(
    () => materialOptions.find((m) => m.itemCode === selectedItemCode) ?? null,
    [materialOptions, selectedItemCode]
  );
  const lotOptions = useMemo(
    () =>
      inventoryRows
        .filter((r) => r.item_code === selectedItemCode)
        .map((r) => ({ lotNo: r.lot_no, qty: Number(r.qty) || 0 })),
    [inventoryRows, selectedItemCode]
  );

  const totalWeightG = useMemo(
    () =>
      calcTotalWeightG(
        boxQty,
        unitQty,
        remainderG,
        selectedMaterial?.boxWeightG ?? 0,
        selectedMaterial?.unitWeightG ?? 0
      ),
    [boxQty, unitQty, remainderG, selectedMaterial]
  );

  const issueInput = useMemo(
    () => ({
      tempC: thawingRoomTempC,
      odor: odorResult,
      color: colorResult,
      foreign: foreignMatterResult,
    }),
    [thawingRoomTempC, odorResult, colorResult, foreignMatterResult]
  );
  const hasAnyIssue = useMemo(() => hasRawThawingIssue(issueInput), [issueInput]);
  const autoDeviationText = useMemo(() => buildRawThawingAutoDeviationText(issueInput), [issueInput]);

  useEffect(() => {
    if (mode === "new" && authorName) {
      setCorrective((c) => ({ ...c, actor: c.actor || authorName }));
    }
  }, [mode, authorName]);

  useEffect(() => {
    if (hasAnyIssue && !deviationManuallyEdited) {
      setCorrective((c) => ({ ...c, deviation: autoDeviationText }));
    }
    if (!hasAnyIssue) {
      setCorrective((c) => ({ ...c, deviation: "" }));
      setDeviationManuallyEdited(false);
      setCorrectiveDatetimeManuallyEdited(false);
    }
  }, [hasAnyIssue, deviationManuallyEdited, autoDeviationText]);

  useEffect(() => {
    if (!hasAnyIssue || !thawingDate || correctiveDatetimeManuallyEdited) return;
    setCorrective((c) => {
      const next = syncDateToDatetimeLocal(c.datetime, thawingDate);
      if (next === c.datetime) return c;
      return { ...c, datetime: next };
    });
  }, [hasAnyIssue, thawingDate, correctiveDatetimeManuallyEdited]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setInventoryLoading(true);
      setInventoryHint(null);
      const { data, error } = await supabase
        .from("ecount_inventory_current")
        .select("item_code, display_item_name, lot_no, qty, category, box_weight_g, unit_weight_g")
        .eq("inventory_type", "원재료")
        .eq("category", "냉동")
        .order("display_item_name", { ascending: true })
        .order("lot_no", { ascending: true });
      if (cancelled) return;
      if (error) {
        setInventoryRows([]);
        setMaterialOptions([]);
        setInventoryHint("냉동 원료 재고 목록을 불러오지 못했습니다.");
      } else {
        const rows = (data ?? []) as EcountFrozenRow[];
        setInventoryRows(rows);
        const seen = new Set<string>();
        const opts: MaterialOption[] = [];
        rows.forEach((r) => {
          if (!r.item_code) return;
          const name = (r.display_item_name ?? "").trim();
          if (!name) return;
          if (seen.has(r.item_code)) return;
          seen.add(r.item_code);
          opts.push({
            itemCode: r.item_code,
            materialName: name,
            boxWeightG: Number(r.box_weight_g) || 0,
            unitWeightG: Number(r.unit_weight_g) || 0,
          });
        });
        setMaterialOptions(opts);
        if (opts.length === 0) setInventoryHint("카테고리 '냉동' 원료 재고가 없습니다.");
      }
      setInventoryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedItemCode) {
      setSelectedLot("");
      return;
    }
    const lots = lotOptions.map((x) => x.lotNo);
    if (lots.length === 0) {
      setSelectedLot("");
      return;
    }
    if (!lots.includes(selectedLot)) setSelectedLot(lots[0]);
  }, [selectedItemCode, lotOptions, selectedLot]);

  const isApproved = currentLogStatus === "approved";
  const isLockedForWorker = isApproved && !isManager;
  const canEdit = !isLockedForWorker && currentLogStatus !== "submitted";
  const canSubmit =
    !isLockedForWorker &&
    (currentLogStatus === "draft" || currentLogStatus === "rejected" || currentLogStatus === null);

  useEffect(() => {
    if (mode !== "edit" || !editLogId) {
      setLoadDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: logData, error } = await supabase
        .from("daily_raw_thawing_logs")
        .select("*")
        .eq("id", editLogId)
        .maybeSingle();
      if (cancelled || error) {
        if (!cancelled) setToast({ message: error?.message ?? "일지를 불러올 수 없습니다.", error: true });
        setLoadDone(true);
        return;
      }
      if (!logData) {
        setToast({ message: "일지를 찾을 수 없습니다.", error: true });
        setLoadDone(true);
        return;
      }
      const log = logData as Record<string, unknown>;
      if (log.status === "submitted" || (log.status === "approved" && !isManager)) {
        router.replace(`/daily/raw-thawing/${editLogId}`);
        return;
      }
      setCurrentLogId(String(log.id));
      setCurrentLogStatus(log.status as LogStatus);
      setThawingDate(String(log.thawing_date ?? todayStr()));
      setPlannedUseDate(String(log.planned_use_date ?? todayStr()));
      setSelectedItemCode(String(log.item_code ?? ""));
      setSelectedLot(String(log.lot_selected ?? ""));
      setManualLot(String(log.lot_manual ?? ""));
      setBoxQty(log.box_qty != null ? String(log.box_qty) : "");
      setUnitQty(log.unit_qty != null ? String(log.unit_qty) : "");
      setRemainderG(log.remainder_g != null ? String(log.remainder_g) : "");
      setThawingStartAt(log.thawing_start_at ? String(log.thawing_start_at).slice(0, 16) : "");
      setThawingEndAt(log.thawing_end_at ? String(log.thawing_end_at).slice(0, 16) : "");
      setThawingRoomTempC(log.thawing_room_temp_c != null ? String(log.thawing_room_temp_c) : "");
      setOdorResult((log.sensory_odor_result as ThawingResult | null) ?? "");
      setColorResult((log.sensory_color_result as ThawingResult | null) ?? "");
      setForeignMatterResult((log.foreign_matter_result as ThawingResult | null) ?? "");
      setCorrective({
        datetime: log.corrective_datetime ? String(log.corrective_datetime).slice(0, 16) : "",
        deviation: String(log.corrective_deviation ?? ""),
        detail: String(log.corrective_detail ?? ""),
        remarks: String(log.corrective_remarks ?? ""),
        actor: String(log.corrective_actor ?? authorName),
      });
      setLoadDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editLogId, router, isManager, authorName]);

  const correctivePayload = useMemo(() => {
    if (!hasAnyIssue) {
      return {
        corrective_datetime: null as string | null,
        corrective_deviation: null as string | null,
        corrective_detail: null as string | null,
        corrective_remarks: null as string | null,
        corrective_actor: null as string | null,
      };
    }
    return {
      corrective_datetime: corrective.datetime || null,
      corrective_deviation: corrective.deviation || null,
      corrective_detail: corrective.detail || null,
      corrective_remarks: corrective.remarks || null,
      corrective_actor: corrective.actor || null,
    };
  }, [hasAnyIssue, corrective]);

  const baseHeaderFields = useCallback(() => {
    const chosenLot = manualLot.trim() || selectedLot.trim();
    return {
      organization_code: orgCode,
      thawing_date: thawingDate.trim(),
      planned_use_date: plannedUseDate.trim() || null,
      author_name: authorName || null,
      item_code: selectedMaterial?.itemCode ?? null,
      material_name: selectedMaterial?.materialName ?? null,
      lot_no: chosenLot || null,
      lot_selected: selectedLot.trim() || null,
      lot_manual: manualLot.trim() || null,
      box_weight_g: selectedMaterial?.boxWeightG ?? null,
      unit_weight_g: selectedMaterial?.unitWeightG ?? null,
      box_qty: parseOptionalNum(boxQty),
      unit_qty: parseOptionalNum(unitQty),
      remainder_g: parseOptionalNum(remainderG),
      total_weight_g: totalWeightG,
      thawing_start_at: thawingStartAt || null,
      thawing_end_at: thawingEndAt || null,
      thawing_room_temp_c: parseOptionalNum(thawingRoomTempC),
      sensory_odor_result: odorResult || null,
      sensory_color_result: colorResult || null,
      foreign_matter_result: foreignMatterResult || null,
      ...correctivePayload,
      updated_at: new Date().toISOString(),
    };
  }, [
    orgCode,
    thawingDate,
    plannedUseDate,
    authorName,
    selectedMaterial,
    selectedLot,
    manualLot,
    boxQty,
    unitQty,
    remainderG,
    totalWeightG,
    thawingStartAt,
    thawingEndAt,
    thawingRoomTempC,
    odorResult,
    colorResult,
    foreignMatterResult,
    correctivePayload,
  ]);

  const handleSave = useCallback(async () => {
    const date = thawingDate.trim();
    if (!date) {
      setToast({ message: "해동일자를 선택해 주세요.", error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const payload = baseHeaderFields();
      let logId: string;
      if (mode === "edit" && currentLogId) {
        const { error: updateErr } = await supabase.from("daily_raw_thawing_logs").update(payload).eq("id", currentLogId);
        if (updateErr) throw updateErr;
        logId = currentLogId;
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from("daily_raw_thawing_logs")
          .insert({
            ...payload,
            status: "draft",
            author_user_id: user?.id ?? null,
          })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        logId = String((inserted as { id: string }).id);
      }
      setCurrentLogId(logId);
      setCurrentLogStatus(mode === "edit" ? currentLogStatus : "draft");
      setToast({ message: "저장되었습니다." });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [thawingDate, baseHeaderFields, mode, currentLogId, currentLogStatus, user?.id]);

  const handleSubmit = useCallback(async () => {
    const date = thawingDate.trim();
    if (!date) {
      setToast({ message: "해동일자를 선택해 주세요.", error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      let logId = currentLogId;
      if (!logId) {
        const { data: inserted, error: insertErr } = await supabase
          .from("daily_raw_thawing_logs")
          .insert({
            ...baseHeaderFields(),
            status: "draft",
            author_user_id: user?.id ?? null,
          })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        logId = String((inserted as { id: string }).id);
      }
      const { error: patchErr } = await supabase.from("daily_raw_thawing_logs").update(baseHeaderFields()).eq("id", logId);
      if (patchErr) throw patchErr;
      const { error: submitErr } = await supabase
        .from("daily_raw_thawing_logs")
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          submitted_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", logId);
      if (submitErr) throw submitErr;
      setCurrentLogId(logId);
      setCurrentLogStatus("submitted");
      setToast({ message: "제출되었습니다." });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [thawingDate, currentLogId, baseHeaderFields, user?.id]);

  if (!loadDone) {
    return <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto"><p className="text-slate-500 text-sm">불러오는 중…</p></div>;
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-2xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">데일리</Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/raw-thawing" className="text-slate-400 hover:text-slate-200 text-sm">원료 해동 일지</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{mode === "new" ? "새 작성" : "수정"}</span>
      </div>

      <h1 className="text-lg font-semibold text-slate-100 mb-1">{mode === "new" ? "새 해동일지 작성" : "해동일지 수정"}</h1>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"}`}>
          {toast.message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">해동일자</label>
          <input type="date" value={thawingDate} onChange={(e) => setThawingDate(e.target.value)} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">사용예정일자</label>
          <input type="date" value={plannedUseDate} onChange={(e) => setPlannedUseDate(e.target.value)} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60" />
        </div>
      </div>

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 mb-6">
        <h2 className="text-sm font-semibold text-cyan-300 mb-3">원료 / LOT</h2>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">원료명 (냉동 카테고리)</label>
            <select value={selectedItemCode} onChange={(e) => setSelectedItemCode(e.target.value)} disabled={!canEdit || inventoryLoading} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60">
              <option value="">{inventoryLoading ? "불러오는 중..." : "원료 선택"}</option>
              {materialOptions.map((m) => (
                <option key={m.itemCode} value={m.itemCode}>{m.materialName}</option>
              ))}
            </select>
            {inventoryHint && <p className="mt-1 text-xs text-slate-500">{inventoryHint}</p>}
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">LOT 선택 (재고 연동)</label>
            <select value={selectedLot} onChange={(e) => setSelectedLot(e.target.value)} disabled={!canEdit || !selectedItemCode} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60">
              <option value="">{selectedItemCode ? "LOT 선택" : "원료를 먼저 선택하세요"}</option>
              {lotOptions.map((l) => (
                <option key={l.lotNo} value={l.lotNo}>{l.lotNo} (재고 {l.qty})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">LOT 직접입력</label>
            <input type="text" value={manualLot} onChange={(e) => setManualLot(e.target.value)} disabled={!canEdit} placeholder="목록에 없으면 직접 입력" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60" />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 mb-6">
        <h2 className="text-sm font-semibold text-cyan-300 mb-3">수량 / 중량</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">박스수량</label>
            <div className="flex">
              <button type="button" onClick={() => setBoxQty(String(Math.max(0, (parseOptionalNum(boxQty) ?? 0) - 1)))} disabled={!canEdit} className="px-3 rounded-l-lg border border-slate-600 bg-slate-700 text-slate-100 disabled:opacity-60">-</button>
              <input type="number" step="1" min={0} value={boxQty} onChange={(e) => setBoxQty(e.target.value)} disabled={!canEdit} className="w-full px-3 py-2 border-y border-slate-600 bg-slate-800 text-slate-100" />
              <button type="button" onClick={() => setBoxQty(String((parseOptionalNum(boxQty) ?? 0) + 1))} disabled={!canEdit} className="px-3 rounded-r-lg border border-slate-600 bg-slate-700 text-slate-100 disabled:opacity-60">+</button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">낱개수량</label>
            <div className="flex">
              <button type="button" onClick={() => setUnitQty(String(Math.max(0, (parseOptionalNum(unitQty) ?? 0) - 1)))} disabled={!canEdit} className="px-3 rounded-l-lg border border-slate-600 bg-slate-700 text-slate-100 disabled:opacity-60">-</button>
              <input type="number" step="1" min={0} value={unitQty} onChange={(e) => setUnitQty(e.target.value)} disabled={!canEdit} className="w-full px-3 py-2 border-y border-slate-600 bg-slate-800 text-slate-100" />
              <button type="button" onClick={() => setUnitQty(String((parseOptionalNum(unitQty) ?? 0) + 1))} disabled={!canEdit} className="px-3 rounded-r-lg border border-slate-600 bg-slate-700 text-slate-100 disabled:opacity-60">+</button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">잔량(g)</label>
            <input type="number" inputMode="decimal" step="0.1" min={0} value={remainderG} onChange={(e) => setRemainderG(e.target.value)} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 disabled:opacity-60" />
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          1박스: {selectedMaterial?.boxWeightG ?? 0}g · 1개: {selectedMaterial?.unitWeightG ?? 0}g
        </p>
        <div className="mt-2 px-3 py-2 rounded-lg border border-cyan-700/40 bg-cyan-900/20 text-cyan-200 text-sm">
          총중량(g): {totalWeightG.toFixed(1)}
        </div>
      </section>

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 mb-6">
        <h2 className="text-sm font-semibold text-cyan-300 mb-3">해동 정보</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">해동 시작일시</label>
            <input type="datetime-local" value={thawingStartAt} onChange={(e) => setThawingStartAt(e.target.value)} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 disabled:opacity-60" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">해동 종료일시</label>
            <input type="datetime-local" value={thawingEndAt} onChange={(e) => setThawingEndAt(e.target.value)} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 disabled:opacity-60" />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-xs text-slate-500 mb-1">해동 창고 온도 (℃, 기준 10 이하)</label>
          <input type="number" inputMode="decimal" step="0.1" value={thawingRoomTempC} onChange={(e) => setThawingRoomTempC(e.target.value)} disabled={!canEdit} className="w-full max-w-[220px] px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 disabled:opacity-60" />
        </div>
        <div className="grid grid-cols-1 gap-3">
          <ResultButtons label="관능검사(이취)" value={odorResult} onChange={setOdorResult} disabled={!canEdit} />
          <ResultButtons label="관능검사(색깔)" value={colorResult} onChange={setColorResult} disabled={!canEdit} />
          <ResultButtons label="이물오염 여부 확인" value={foreignMatterResult} onChange={setForeignMatterResult} disabled={!canEdit} />
        </div>
      </section>

      {hasAnyIssue && (
        <section className={`rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8 ${!canEdit ? "opacity-80 pointer-events-none" : ""}`}>
          <h2 className="text-sm font-semibold text-amber-300 mb-1">개선조치</h2>
          <div className="grid gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">일시</label>
              <input type="datetime-local" value={corrective.datetime} onChange={(e) => { setCorrectiveDatetimeManuallyEdited(true); setCorrective((c) => ({ ...c, datetime: e.target.value })); }} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">이탈내용 (자동 생성, 필요 시 수정)</label>
              <textarea value={corrective.deviation} onChange={(e) => { setDeviationManuallyEdited(true); setCorrective((c) => ({ ...c, deviation: e.target.value })); }} rows={4} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 text-sm resize-none disabled:opacity-70" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선조치내용</label>
              <textarea value={corrective.detail} onChange={(e) => setCorrective((c) => ({ ...c, detail: e.target.value }))} rows={2} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 text-sm resize-none disabled:opacity-70" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">비고</label>
              <textarea value={corrective.remarks} onChange={(e) => setCorrective((c) => ({ ...c, remarks: e.target.value }))} rows={2} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 text-sm resize-none disabled:opacity-70" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선조치자</label>
              <input type="text" value={corrective.actor} onChange={(e) => setCorrective((c) => ({ ...c, actor: e.target.value }))} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 text-sm disabled:opacity-70" />
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-10">
        {!isLockedForWorker && (
          <button type="button" onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white font-medium text-sm">{saving ? "저장 중..." : "저장"}</button>
        )}
        {canSubmit && (
          <button type="button" onClick={handleSubmit} disabled={saving} className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-sm">{saving ? "처리 중..." : "제출"}</button>
        )}
      </div>

      <div className="flex justify-end">
        <Link href="/daily/raw-thawing" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">목록으로</Link>
      </div>
    </div>
  );
}

function ResultButtons({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: ThawingResult | "";
  onChange: (v: ThawingResult) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <p className="flex-1 text-sm text-slate-300">{label}</p>
      <div className="flex gap-2 shrink-0">
        <button type="button" disabled={disabled} onClick={() => onChange("O")} className={`px-4 py-2 rounded-lg text-sm font-medium border ${value === "O" ? "bg-emerald-600 border-emerald-500 text-white" : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"} disabled:opacity-50`}>적합</button>
        <button type="button" disabled={disabled} onClick={() => onChange("X")} className={`px-4 py-2 rounded-lg text-sm font-medium border ${value === "X" ? "bg-amber-700 border-amber-500 text-white" : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"} disabled:opacity-50`}>부적합</button>
      </div>
    </div>
  );
}
