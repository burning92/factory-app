"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { createSafeId } from "@/lib/createSafeId";
import DateWheelPicker from "@/components/DateWheelPicker";
import {
  RECEIVING_STORAGE_OPTIONS,
  buildEcountMaterialPickerOptions,
  buildReceivingAutoDeviationText,
  calcTotalWeightG,
  filterEcountOptionsByReceivingCategory,
  hasReceivingConformityIssue,
  parseOptionalNum,
  type EcountMaterialPickerOption,
  type ReceivingStorageCategory,
} from "@/features/daily/materialReceivingInspection";

type LogStatus = "draft" | "submitted" | "approved" | "rejected";

type LineState = {
  clientId: string;
  storage_category: ReceivingStorageCategory;
  item_name: string;
  /** ecount_inventory_current.item_code, 직접 입력 시 빈 문자열 */
  materialPicker: string;
  box_qty: string;
  unit_qty: string;
  remainder_g: string;
  box_weight_g: string;
  unit_weight_g: string;
  expiry_input_mode: "date" | "text";
  expiry_date_value: string;
  expiry_text_value: string;
  label_photo_url: string;
  conformity: "O" | "X" | "";
  remarks: string;
};

type CorrectiveState = {
  datetime: string;
  deviation: string;
  detail: string;
  remarks: string;
  actor: string;
};

type Props = { mode: "new" | "edit"; editLogId?: string };

function localDatetimeDefault(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatForDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return localDatetimeDefault();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return localDatetimeDefault();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDatetimeToIso(localStr: string): string {
  const t = localStr.trim();
  if (!t) return new Date().toISOString();
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function emptyLine(): LineState {
  return {
    clientId: createSafeId(),
    storage_category: "cold",
    item_name: "",
    materialPicker: "",
    box_qty: "",
    unit_qty: "",
    remainder_g: "",
    box_weight_g: "",
    unit_weight_g: "",
    expiry_input_mode: "date",
    expiry_date_value: "",
    expiry_text_value: "",
    label_photo_url: "",
    conformity: "",
    remarks: "",
  };
}

const PHOTO_FILE_MAX_BYTES = 750_000;

function parseExpiryValue(raw: string | null): {
  mode: "date" | "text";
  dateValue: string;
  textValue: string;
} {
  const v = (raw ?? "").trim();
  if (!v) return { mode: "date", dateValue: "", textValue: "" };
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { mode: "date", dateValue: v, textValue: "" };
  const dot = v.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (dot) {
    const mm = dot[2].padStart(2, "0");
    const dd = dot[3].padStart(2, "0");
    return { mode: "date", dateValue: `${dot[1]}-${mm}-${dd}`, textValue: "" };
  }
  return { mode: "text", dateValue: "", textValue: v };
}

export function MaterialReceivingInspectionForm({ mode, editLogId }: Props) {
  const { user, profile, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const authorName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const [receivedAtLocal, setReceivedAtLocal] = useState(localDatetimeDefault);
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);
  /** 이카운트 원재료 품목(카테고리 포함). 원료 해동 일지와 동일 소스 */
  const [ecountMaterialOptionsAll, setEcountMaterialOptionsAll] = useState<EcountMaterialPickerOption[]>([]);
  const [ecountMaterialsLoading, setEcountMaterialsLoading] = useState(true);
  const [ecountMaterialsHint, setEcountMaterialsHint] = useState<string | null>(null);
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

  const hasAnyIssue = useMemo(() => hasReceivingConformityIssue(lines), [lines]);
  const autoDeviationText = useMemo(() => buildReceivingAutoDeviationText(lines), [lines]);

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
    if (!hasAnyIssue || !receivedAtLocal || correctiveDatetimeManuallyEdited) return;
    setCorrective((c) => {
      const next = receivedAtLocal.slice(0, 16);
      if (next === c.datetime) return c;
      return { ...c, datetime: next };
    });
  }, [hasAnyIssue, receivedAtLocal, correctiveDatetimeManuallyEdited]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEcountMaterialsLoading(true);
      setEcountMaterialsHint(null);
      const { data, error } = await supabase
        .from("ecount_inventory_current")
        .select("item_code, display_item_name, category, box_weight_g, unit_weight_g")
        .eq("inventory_type", "원재료")
        .order("display_item_name", { ascending: true })
        .order("lot_no", { ascending: true });
      if (cancelled) return;
      if (error) {
        setEcountMaterialOptionsAll([]);
        setEcountMaterialsHint("이카운트 원재료 목록을 불러오지 못했습니다. 직접 입력만 사용할 수 있습니다.");
      } else {
        const opts = buildEcountMaterialPickerOptions(
          (data ?? []) as Array<{
            item_code: string | null;
            display_item_name: string | null;
            category: string | null;
            box_weight_g: number | null;
            unit_weight_g: number | null;
          }>
        );
        setEcountMaterialOptionsAll(opts);
        if (opts.length === 0) {
          setEcountMaterialsHint("원재료(이카운트) 품목이 없습니다. 직접 입력만 사용할 수 있습니다.");
        }
      }
      setEcountMaterialsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode === "new" && authorName) {
      setCorrective((c) => ({ ...c, actor: c.actor || authorName }));
    }
  }, [mode, authorName]);

  const canEdit = true;
  const canSubmit =
    currentLogStatus === "draft" || currentLogStatus === "rejected" || currentLogStatus === null;

  useEffect(() => {
    if (mode !== "edit" || !editLogId) {
      setLoadDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: logData, error } = await supabase
        .from("daily_material_receiving_inspection_logs")
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
      const log = logData as {
        id: string;
        received_at: string;
        status: LogStatus;
        corrective_datetime: string | null;
        corrective_deviation: string | null;
        corrective_detail: string | null;
        corrective_remarks: string | null;
        corrective_actor: string | null;
      };
      setCurrentLogId(log.id);
      setCurrentLogStatus(log.status);
      setReceivedAtLocal(formatForDatetimeLocal(log.received_at));
      setCorrective({
        datetime: log.corrective_datetime ? formatForDatetimeLocal(String(log.corrective_datetime)) : "",
        deviation: log.corrective_deviation ?? "",
        detail: log.corrective_detail ?? "",
        remarks: log.corrective_remarks ?? "",
        actor: log.corrective_actor ?? authorName,
      });

      const { data: itemsData } = await supabase
        .from("daily_material_receiving_inspection_log_items")
        .select("*")
        .eq("log_id", log.id)
        .order("line_index", { ascending: true });
      if (cancelled) return;
      const rows = (itemsData ?? []) as Array<{
        storage_category: string;
        item_name: string;
        box_qty: number | null;
        unit_qty: number | null;
        remainder_g: number | null;
        box_weight_g: number | null;
        unit_weight_g: number | null;
        expiry_or_lot: string | null;
        label_photo_url: string | null;
        conformity: string;
        remarks: string | null;
      }>;
      if (rows.length > 0) {
        setLines(
          rows.map((r) => ({
            clientId: createSafeId(),
            storage_category:
              r.storage_category === "frozen" || r.storage_category === "room"
                ? r.storage_category
                : "cold",
            item_name: r.item_name ?? "",
            materialPicker: "",
            box_qty: r.box_qty != null ? String(r.box_qty) : "",
            unit_qty: r.unit_qty != null ? String(r.unit_qty) : "",
            remainder_g: r.remainder_g != null ? String(r.remainder_g) : "",
            box_weight_g: r.box_weight_g != null ? String(r.box_weight_g) : "",
            unit_weight_g: r.unit_weight_g != null ? String(r.unit_weight_g) : "",
            expiry_input_mode: parseExpiryValue(r.expiry_or_lot ?? null).mode,
            expiry_date_value: parseExpiryValue(r.expiry_or_lot ?? null).dateValue,
            expiry_text_value: parseExpiryValue(r.expiry_or_lot ?? null).textValue,
            label_photo_url: r.label_photo_url ?? "",
            conformity: r.conformity === "O" || r.conformity === "X" ? r.conformity : "",
            remarks: r.remarks ?? "",
          }))
        );
      } else {
        setLines([emptyLine()]);
      }
      setLoadDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editLogId, authorName]);

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
    const dt = corrective.datetime.trim();
    return {
      corrective_datetime: dt ? localDatetimeToIso(dt) : null,
      corrective_deviation: corrective.deviation || null,
      corrective_detail: corrective.detail || null,
      corrective_remarks: corrective.remarks || null,
      corrective_actor: corrective.actor || null,
    };
  }, [hasAnyIssue, corrective]);

  const effectiveLines = useMemo(() => lines.filter((l) => l.item_name.trim()), [lines]);

  const persistItems = useCallback(
    async (logId: string, toSave: LineState[]) => {
      const { error: delErr } = await supabase
        .from("daily_material_receiving_inspection_log_items")
        .delete()
        .eq("log_id", logId);
      if (delErr) throw delErr;
      const rows: Array<{
        log_id: string;
        line_index: number;
        storage_category: ReceivingStorageCategory;
        item_name: string;
        box_qty: number | null;
        unit_qty: number | null;
        remainder_g: number | null;
        box_weight_g: number;
        unit_weight_g: number;
        total_weight_g: number;
        expiry_or_lot: string | null;
        label_photo_url: string | null;
        conformity: "O" | "X";
        remarks: string | null;
      }> = [];
      toSave.forEach((line, i) => {
        const bw = parseOptionalNum(line.box_weight_g) ?? 0;
        const uw = parseOptionalNum(line.unit_weight_g) ?? 0;
        const hasBoxWeight = bw > 0;
        const hasUnitWeight = uw > 0;
        const total = calcTotalWeightG(
          hasBoxWeight ? line.box_qty : "",
          hasUnitWeight ? line.unit_qty : "",
          line.remainder_g,
          bw,
          uw
        );
        const expiryOrLot =
          line.expiry_input_mode === "date"
            ? line.expiry_date_value.trim()
            : line.expiry_text_value.trim();
        if (line.conformity !== "O" && line.conformity !== "X") return;
        rows.push({
          log_id: logId,
          line_index: i + 1,
          storage_category: line.storage_category,
          item_name: line.item_name.trim(),
          box_qty: hasBoxWeight ? parseOptionalNum(line.box_qty) : null,
          unit_qty: hasUnitWeight ? parseOptionalNum(line.unit_qty) : null,
          remainder_g: parseOptionalNum(line.remainder_g),
          box_weight_g: bw,
          unit_weight_g: uw,
          total_weight_g: total,
          expiry_or_lot: expiryOrLot || null,
          label_photo_url: line.label_photo_url.trim() || null,
          conformity: line.conformity,
          remarks: line.remarks.trim() || null,
        });
      });
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("daily_material_receiving_inspection_log_items").insert(rows);
        if (insErr) throw insErr;
      }
    },
    []
  );

  const baseHeaderFields = useCallback(() => {
    return {
      organization_code: orgCode,
      author_name: authorName || null,
      received_at: localDatetimeToIso(receivedAtLocal),
      ...correctivePayload,
      updated_at: new Date().toISOString(),
    };
  }, [orgCode, authorName, receivedAtLocal, correctivePayload]);

  const validateLinesForSave = useCallback(() => {
    if (effectiveLines.length === 0) {
      return "품목을 1개 이상 입력해 주세요. (품목명 필수)";
    }
    for (const l of effectiveLines) {
      if (l.conformity !== "O" && l.conformity !== "X") {
        return `품목 "${l.item_name.trim()}"의 적합/부적합을 선택해 주세요.`;
      }
    }
    return null;
  }, [effectiveLines]);

  const handleSave = useCallback(async () => {
    const msg = validateLinesForSave();
    if (msg) {
      setToast({ message: msg, error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const payload = baseHeaderFields();
      let logId: string;
      if (mode === "edit" && currentLogId) {
        const { error: updateErr } = await supabase
          .from("daily_material_receiving_inspection_logs")
          .update(payload)
          .eq("id", currentLogId);
        if (updateErr) throw updateErr;
        logId = currentLogId;
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from("daily_material_receiving_inspection_logs")
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
      await persistItems(logId, effectiveLines);
      setToast({ message: "저장되었습니다." });
      setCurrentLogId(logId);
      setCurrentLogStatus(mode === "edit" ? currentLogStatus : "draft");
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [
    validateLinesForSave,
    baseHeaderFields,
    mode,
    currentLogId,
    user?.id,
    persistItems,
    effectiveLines,
    currentLogStatus,
  ]);

  const handleSubmit = useCallback(async () => {
    const msg = validateLinesForSave();
    if (msg) {
      setToast({ message: msg, error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      let logId = currentLogId;
      if (!logId) {
        const { data: inserted, error: insertErr } = await supabase
          .from("daily_material_receiving_inspection_logs")
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
      const { error: patchErr } = await supabase
        .from("daily_material_receiving_inspection_logs")
        .update(baseHeaderFields())
        .eq("id", logId);
      if (patchErr) throw patchErr;
      await persistItems(logId, effectiveLines);

      const { error: submitErr } = await supabase
        .from("daily_material_receiving_inspection_logs")
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          submitted_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", logId);
      if (submitErr) throw submitErr;
      setToast({ message: "제출되었습니다." });
      setCurrentLogId(logId);
      setCurrentLogStatus("submitted");
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [validateLinesForSave, currentLogId, baseHeaderFields, user?.id, persistItems, effectiveLines]);

  const updateLine = useCallback((clientId: string, patch: Partial<LineState>) => {
    setLines((prev) => prev.map((l) => (l.clientId === clientId ? { ...l, ...patch } : l)));
  }, []);

  const onMaterialPick = useCallback(
    (clientId: string, itemCode: string, storageCategory: ReceivingStorageCategory) => {
      if (!itemCode) {
        updateLine(clientId, { materialPicker: "", box_weight_g: "", unit_weight_g: "" });
        return;
      }
      const allowed = filterEcountOptionsByReceivingCategory(ecountMaterialOptionsAll, storageCategory);
      const m = allowed.find((x) => x.itemCode === itemCode);
      if (!m) return;
      updateLine(clientId, {
        materialPicker: itemCode,
        item_name: m.materialName,
        box_weight_g: String(m.boxWeightG),
        unit_weight_g: String(m.unitWeightG),
      });
    },
    [ecountMaterialOptionsAll, updateLine]
  );

  const onStorageCategoryChange = useCallback(
    (clientId: string, next: ReceivingStorageCategory) => {
      setLines((prev) =>
        prev.map((l) => {
          if (l.clientId !== clientId) return l;
          if (next === l.storage_category) return l;
          const allowed = filterEcountOptionsByReceivingCategory(ecountMaterialOptionsAll, next);
          const stillOk =
            l.materialPicker !== "" && allowed.some((o) => o.itemCode === l.materialPicker);
          if (stillOk) return { ...l, storage_category: next };
          return {
            ...l,
            storage_category: next,
            materialPicker: "",
            ...(l.materialPicker ? { box_weight_g: "", unit_weight_g: "" } : {}),
          };
        })
      );
    },
    [ecountMaterialOptionsAll]
  );

  const onPhotoFile = useCallback(
    (clientId: string, file: File | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setToast({ message: "이미지 파일만 선택할 수 있습니다.", error: true });
        return;
      }

      const compressImageIfNeeded = async (input: File): Promise<Blob> => {
        if (input.size <= PHOTO_FILE_MAX_BYTES) return input;

        const maxDim = 1280; // 기본 리사이즈 상한(가로/세로)
        const outputMime = "image/jpeg";
        const qualitySteps = [0.92, 0.82, 0.72, 0.62, 0.52, 0.42, 0.32, 0.22];

        const objectUrl = URL.createObjectURL(input);
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = objectUrl;
          });

          const srcW = img.naturalWidth || img.width;
          const srcH = img.naturalHeight || img.height;
          const scale = srcW > srcH ? Math.min(1, maxDim / srcW) : Math.min(1, maxDim / srcH);
          const targetW = Math.max(1, Math.round(srcW * scale));
          const targetH = Math.max(1, Math.round(srcH * scale));

          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            // 컨텍스트가 없으면 원본 그대로(이후 size 체크에서 실패 처리)
            return input;
          }
          ctx.drawImage(img, 0, 0, targetW, targetH);

          let lastBlob: Blob | null = null;
          for (const q of qualitySteps) {
            const blob = await new Promise<Blob | null>((resolve) => {
              canvas.toBlob((b) => resolve(b), outputMime, q);
            });
            if (!blob) continue;
            lastBlob = blob;
            if (blob.size <= PHOTO_FILE_MAX_BYTES) return blob;
          }
          if (lastBlob) return lastBlob;
          return input;
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };

      (async () => {
        try {
          const blob = await compressImageIfNeeded(file);
          if (blob.size > PHOTO_FILE_MAX_BYTES) {
            setToast({
              message: `사진 용량은 ${PHOTO_FILE_MAX_BYTES / 1000}KB 이하로 유지해야 합니다. (압축 후에도 초과)`,
              error: true,
            });
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const url = typeof reader.result === "string" ? reader.result : "";
            updateLine(clientId, { label_photo_url: url });
          };
          reader.readAsDataURL(blob);
        } catch {
          setToast({
            message: `사진 압축에 실패했습니다. 더 작은 사진을 선택해 주세요.`,
            error: true,
          });
        }
      })();
    },
    [updateLine]
  );

  if (!loadDone) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-3xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">
          데일리
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/material-receiving-inspection" className="text-slate-400 hover:text-slate-200 text-sm">
          원료 입고 검수일지
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{mode === "new" ? "새 작성" : "수정"}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">
        {mode === "new" ? "원료 입고 검수일지 — 새 작성" : "원료 입고 검수일지 — 수정"}
      </h1>
      <p className="text-slate-500 text-sm mb-4">부자재는 제외하고 원료만 기록합니다.</p>
      {ecountMaterialsHint && (
        <p className="text-amber-200/90 text-xs mb-4">{ecountMaterialsHint}</p>
      )}

      {toast && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"}`}
        >
          {toast.message}
        </div>
      )}

      {currentLogStatus === "approved" && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-emerald-900/20 border border-emerald-700/50 text-emerald-200">
          승인 완료된 일지입니다. 필요 시 수정 후 저장할 수 있습니다.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">반입자명</label>
          <input
            type="text"
            value={authorName}
            readOnly
            className="w-full px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-600 text-slate-300 text-sm cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">반입일시</label>
          <input
            type="datetime-local"
            value={receivedAtLocal}
            onChange={(e) => setReceivedAtLocal(e.target.value)}
            disabled={!canEdit}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-60"
          />
        </div>
      </div>

      <div className="space-y-6 mb-8">
        {lines.map((line, idx) => {
          const pickerOptions = filterEcountOptionsByReceivingCategory(
            ecountMaterialOptionsAll,
            line.storage_category
          );
          const isMasterSelected = line.materialPicker !== "";
          const bw = parseOptionalNum(line.box_weight_g) ?? 0;
          const uw = parseOptionalNum(line.unit_weight_g) ?? 0;
          const hasBoxWeight = bw > 0;
          const hasUnitWeight = uw > 0;
          const totalG = calcTotalWeightG(
            hasBoxWeight ? line.box_qty : "",
            hasUnitWeight ? line.unit_qty : "",
            line.remainder_g,
            bw,
            uw
          );
          return (
            <section
              key={line.clientId}
              className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-cyan-300">품목 {idx + 1}</h2>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((l) => l.clientId !== line.clientId))}
                    className="text-xs text-red-300 hover:text-red-200"
                  >
                    줄 삭제
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">카테고리</span>
                  <select
                    value={line.storage_category}
                    onChange={(e) =>
                      onStorageCategoryChange(line.clientId, e.target.value as ReceivingStorageCategory)
                    }
                    disabled={!canEdit}
                    className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                  >
                    {RECEIVING_STORAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs text-slate-500">이카운트 원재료에서 채우기 (선택)</span>
                  <select
                    value={line.materialPicker}
                    onChange={(e) => onMaterialPick(line.clientId, e.target.value, line.storage_category)}
                    disabled={!canEdit || ecountMaterialsLoading}
                    className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                  >
                    <option value="">
                      {ecountMaterialsLoading ? "목록 불러오는 중…" : "직접 입력만 사용"}
                    </option>
                    {pickerOptions.map((m) => (
                      <option key={m.itemCode} value={m.itemCode}>
                        {m.materialName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs text-slate-500">품목명</span>
                  <input
                    type="text"
                    value={line.item_name}
                    onChange={(e) => updateLine(line.clientId, { item_name: e.target.value, materialPicker: "" })}
                    disabled={!canEdit}
                    placeholder="원료명"
                    className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                  />
                </label>
                {hasBoxWeight && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">박스(포대)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={line.box_qty}
                      onChange={(e) => updateLine(line.clientId, { box_qty: e.target.value })}
                      disabled={!canEdit}
                      className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                    />
                  </label>
                )}
                {hasUnitWeight && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">낱개</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={line.unit_qty}
                      onChange={(e) => updateLine(line.clientId, { unit_qty: e.target.value })}
                      disabled={!canEdit}
                      className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">잔량 (g)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={line.remainder_g}
                    onChange={(e) => updateLine(line.clientId, { remainder_g: e.target.value })}
                    disabled={!canEdit}
                    className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                  />
                </label>
                {hasBoxWeight && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">1박스 중량 (g)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={line.box_weight_g}
                      onChange={(e) => updateLine(line.clientId, { box_weight_g: e.target.value })}
                      disabled={!canEdit || isMasterSelected}
                      className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                    />
                  </label>
                )}
                {hasUnitWeight && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">1낱개 중량 (g)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={line.unit_weight_g}
                      onChange={(e) => updateLine(line.clientId, { unit_weight_g: e.target.value })}
                      disabled={!canEdit || isMasterSelected}
                      className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                    />
                  </label>
                )}
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs text-slate-500">총중량 (g) 자동</span>
                  <p className="px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-700 text-cyan-200 text-sm font-medium">
                    {totalG.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} g
                  </p>
                </div>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs text-slate-500">소비기한 / LOT / 제조일자</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateLine(line.clientId, { expiry_input_mode: "date" })}
                      disabled={!canEdit}
                      className={`px-3 py-1.5 rounded-lg text-xs border ${
                        line.expiry_input_mode === "date"
                          ? "bg-cyan-900/40 border-cyan-600 text-cyan-200"
                          : "bg-slate-800/80 border-slate-600 text-slate-300"
                      }`}
                    >
                      날짜 입력
                    </button>
                    <button
                      type="button"
                      onClick={() => updateLine(line.clientId, { expiry_input_mode: "text" })}
                      disabled={!canEdit}
                      className={`px-3 py-1.5 rounded-lg text-xs border ${
                        line.expiry_input_mode === "text"
                          ? "bg-cyan-900/40 border-cyan-600 text-cyan-200"
                          : "bg-slate-800/80 border-slate-600 text-slate-300"
                      }`}
                    >
                      직접 입력
                    </button>
                  </div>
                  {line.expiry_input_mode === "date" ? (
                    <DateWheelPicker
                      value={line.expiry_date_value}
                      onChange={(v) => updateLine(line.clientId, { expiry_date_value: v })}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 rounded-lg"
                    />
                  ) : (
                    <input
                      type="text"
                      value={line.expiry_text_value}
                      onChange={(e) => updateLine(line.clientId, { expiry_text_value: e.target.value })}
                      disabled={!canEdit}
                      placeholder="LOT/제조일자 직접 입력"
                      className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                    />
                  )}
                </label>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs text-slate-500">표시사항 사진</span>
                  {line.label_photo_url && (
                    <p className="text-xs text-cyan-200">
                      {line.label_photo_url.startsWith("data:") ? "촬영/선택 완료" : "이미지 URL 반영 완료"}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-slate-600 bg-slate-800/80 text-slate-200 text-sm cursor-pointer">
                      {line.label_photo_url ? "다시 촬영" : "사진 촬영"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={!canEdit}
                        onChange={(e) => {
                          onPhotoFile(line.clientId, e.target.files?.[0] ?? null);
                          e.target.value = "";
                        }}
                        className="hidden"
                      />
                    </label>
                    <label className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-slate-600 bg-slate-800/80 text-slate-200 text-sm cursor-pointer">
                      {line.label_photo_url ? "다시 선택" : "갤러리 선택"}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={!canEdit}
                        onChange={(e) => {
                          onPhotoFile(line.clientId, e.target.files?.[0] ?? null);
                          e.target.value = "";
                        }}
                        className="hidden"
                      />
                    </label>
                    {line.label_photo_url && (
                      <button
                        type="button"
                        onClick={() => updateLine(line.clientId, { label_photo_url: "" })}
                        disabled={!canEdit}
                        className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-red-700/50 bg-red-900/20 text-red-200 text-sm"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                  <input
                    type="url"
                    value={line.label_photo_url.startsWith("data:") ? "" : line.label_photo_url}
                    onChange={(e) => updateLine(line.clientId, { label_photo_url: e.target.value })}
                    disabled={!canEdit}
                    placeholder="또는 이미지 URL"
                    className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                  />
                  {line.label_photo_url && (
                    // data URL / 외부 URL 모두 허용 — Storage 업로드 패턴 없음
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={line.label_photo_url}
                      alt="표시사항 미리보기"
                      className="max-h-32 w-auto rounded border border-slate-600 mt-1"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span className="text-xs text-slate-500">적합 / 부적합</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => updateLine(line.clientId, { conformity: "O" })}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                        line.conformity === "O"
                          ? "bg-emerald-600 border-emerald-500 text-white"
                          : "bg-slate-800/80 border-slate-600 text-slate-300"
                      }`}
                    >
                      적합
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => updateLine(line.clientId, { conformity: "X" })}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                        line.conformity === "X"
                          ? "bg-amber-700 border-amber-500 text-white"
                          : "bg-slate-800/80 border-slate-600 text-slate-300"
                      }`}
                    >
                      부적합
                    </button>
                  </div>
                </div>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-xs text-slate-500">비고</span>
                  <textarea
                    value={line.remarks}
                    onChange={(e) => updateLine(line.clientId, { remarks: e.target.value })}
                    disabled={!canEdit}
                    rows={2}
                    className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
                  />
                </label>
              </div>
            </section>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setLines((prev) => [...prev, emptyLine()])}
        disabled={!canEdit}
        className="mb-8 px-4 py-2 rounded-lg border border-cyan-600/50 text-cyan-200 text-sm hover:bg-cyan-900/20"
      >
        품목 줄 추가
      </button>

      {hasAnyIssue && (
        <section
          className={`rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8 ${!canEdit ? "opacity-80 pointer-events-none" : ""}`}
        >
          <h2 className="text-sm font-semibold text-amber-300 mb-1">개선조치</h2>
          <div className="grid gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">일시</label>
              <input
                type="datetime-local"
                value={corrective.datetime}
                onChange={(e) => {
                  setCorrectiveDatetimeManuallyEdited(true);
                  setCorrective((c) => ({ ...c, datetime: e.target.value }));
                }}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">이탈내용 (자동 생성, 필요 시 수정)</label>
              <textarea
                value={corrective.deviation}
                onChange={(e) => {
                  setDeviationManuallyEdited(true);
                  setCorrective((c) => ({ ...c, deviation: e.target.value }));
                }}
                rows={4}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선조치내용</label>
              <textarea
                value={corrective.detail}
                onChange={(e) => setCorrective((c) => ({ ...c, detail: e.target.value }))}
                rows={2}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">비고</label>
              <textarea
                value={corrective.remarks}
                onChange={(e) => setCorrective((c) => ({ ...c, remarks: e.target.value }))}
                rows={2}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선조치자</label>
              <input
                type="text"
                value={corrective.actor}
                onChange={(e) => setCorrective((c) => ({ ...c, actor: e.target.value }))}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
              />
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-10">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white font-medium text-sm"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        {canSubmit && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-sm"
          >
            {saving ? "처리 중…" : "제출"}
          </button>
        )}
      </div>

      <div className="flex justify-end">
        <Link
          href="/daily/material-receiving-inspection"
          className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          목록으로
        </Link>
      </div>
    </div>
  );
}
