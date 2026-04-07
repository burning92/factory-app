"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_DASHBOARD_GROUPS,
  DEFAULT_EQUIPMENT_TYPES,
  LIFECYCLE_STATUSES,
  type DashboardGroup,
  type EquipmentType,
  type LifecycleStatus,
  lifecycleToIsActive,
  suggestDisplayName,
} from "@/features/equipment/equipmentConstants";
import type { EquipmentMasterRow } from "@/features/equipment/equipmentTypes";

const fieldClass =
  "w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500";
const labelClass = "block text-xs font-medium text-slate-400 mb-1";

const MANAGEMENT_NO_PREFIX = "FP-812-1-" as const;

function normalizeSuffix(raw: string): { ok: true; suffix: string } | { ok: false; reason: "empty" | "pattern" } {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  // 숫자/하이픈만 허용 → 나머지 제거하지 않고 에러 처리
  if (!/^[0-9-]+$/.test(trimmed)) return { ok: false, reason: "pattern" };

  // 연속 하이픈, 앞/뒤 하이픈 정리
  const compact = trimmed.replace(/-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  if (!compact) return { ok: false, reason: "empty" };

  // "1-2" 같은 형태만 허용 (숫자 묶음 + - + 숫자 묶음…)
  if (!/^[0-9]+(-[0-9]+)*$/.test(compact)) return { ok: false, reason: "pattern" };

  return { ok: true, suffix: compact };
}

function splitManagementNo(full: string): { prefix: string; suffix: string } {
  const s = String(full ?? "").trim();
  if (!s) return { prefix: MANAGEMENT_NO_PREFIX, suffix: "" };
  if (s.startsWith(MANAGEMENT_NO_PREFIX)) {
    return { prefix: MANAGEMENT_NO_PREFIX, suffix: s.slice(MANAGEMENT_NO_PREFIX.length) };
  }
  // 기존 데이터가 다른 포맷이면 suffix에 전체를 보여주고 저장 시에만 prefix 결합을 적용(사용자가 수정하면 정상화됨)
  return { prefix: MANAGEMENT_NO_PREFIX, suffix: s };
}

function joinManagementNo(prefix: string, suffix: string): string {
  const p = String(prefix ?? MANAGEMENT_NO_PREFIX);
  return `${p}${suffix}`;
}

function normType(t: unknown): EquipmentType {
  const s = String(t ?? "").trim();
  return s || "기타";
}

function normLifecycle(s: unknown): LifecycleStatus {
  const x = String(s ?? "");
  return (LIFECYCLE_STATUSES as readonly string[]).includes(x) ? (x as LifecycleStatus) : "운영중";
}

function normDashboardGroup(s: unknown): DashboardGroup | null {
  if (s == null || s === "") return null;
  const x = String(s).trim();
  return x || null;
}

export type EquipmentMasterFormValues = {
  management_no_suffix: string;
  equipment_type: EquipmentType;
  equipment_name: string;
  unit_no: string;
  display_name: string;
  floor_label: string;
  install_location: string;
  purpose: string;
  purchased_at: string;
  installed_at: string;
  removed_at: string;
  lifecycle_status: LifecycleStatus;
  dashboard_group: "" | DashboardGroup;
  dashboard_visible: boolean;
  replaced_from_equipment_id: string;
  replaced_by_equipment_id: string;
  supplier_name: string;
  supplier_contact: string;
  manufacturer_name: string;
  manufacturer_contact: string;
  specification: string;
  voltage: string;
  photo_url: string;
  notes: string;
};

export function emptyEquipmentMasterFormValues(): EquipmentMasterFormValues {
  return {
    management_no_suffix: "",
    equipment_type: "기타",
    equipment_name: "",
    unit_no: "",
    display_name: "",
    floor_label: "",
    install_location: "",
    purpose: "",
    purchased_at: "",
    installed_at: "",
    removed_at: "",
    lifecycle_status: "운영중",
    dashboard_group: "",
    dashboard_visible: true,
    replaced_from_equipment_id: "",
    replaced_by_equipment_id: "",
    supplier_name: "",
    supplier_contact: "",
    manufacturer_name: "",
    manufacturer_contact: "",
    specification: "",
    voltage: "",
    photo_url: "",
    notes: "",
  };
}

export function equipmentMasterToFormValues(row: EquipmentMasterRow): EquipmentMasterFormValues {
  const lc = normLifecycle(row.lifecycle_status ?? (row.is_active ? "운영중" : "사용중지"));
  const dg = normDashboardGroup(row.dashboard_group);
  const mn = splitManagementNo(row.management_no);
  return {
    management_no_suffix: mn.suffix,
    equipment_type: normType(row.equipment_type),
    equipment_name: row.equipment_name,
    unit_no: row.unit_no != null ? String(row.unit_no) : "",
    display_name: (row.display_name ?? row.equipment_name ?? "").trim() || row.equipment_name,
    floor_label: row.floor_label ?? "",
    install_location: row.install_location,
    purpose: row.purpose,
    purchased_at: row.purchased_at ?? "",
    installed_at: row.installed_at ?? "",
    removed_at: row.removed_at ?? "",
    lifecycle_status: lc,
    dashboard_group: dg ?? "",
    dashboard_visible: row.dashboard_visible !== false,
    replaced_from_equipment_id: row.replaced_from_equipment_id ?? "",
    replaced_by_equipment_id: row.replaced_by_equipment_id ?? "",
    supplier_name: row.supplier_name ?? "",
    supplier_contact: row.supplier_contact ?? "",
    manufacturer_name: row.manufacturer_name ?? "",
    manufacturer_contact: row.manufacturer_contact ?? "",
    specification: row.specification ?? "",
    voltage: row.voltage ?? "",
    photo_url: row.photo_url ?? "",
    notes: row.notes ?? "",
  };
}

export function formValuesToEquipmentPayload(values: EquipmentMasterFormValues, opts: { syncIsActive: boolean }) {
  const suffixNorm = normalizeSuffix(values.management_no_suffix);
  const suffix = suffixNorm.ok ? suffixNorm.suffix : String(values.management_no_suffix ?? "").trim();
  const unitParsed = values.unit_no.trim() === "" ? null : Number.parseInt(values.unit_no, 10);
  const unit_no = unitParsed != null && Number.isFinite(unitParsed) && unitParsed > 0 ? unitParsed : null;
  const dg = values.dashboard_group === "" ? null : values.dashboard_group;
  const is_active = opts.syncIsActive ? lifecycleToIsActive(values.lifecycle_status) : undefined;
  const payload: Record<string, unknown> = {
    management_no: joinManagementNo(MANAGEMENT_NO_PREFIX, suffix),
    equipment_type: values.equipment_type,
    equipment_name: values.equipment_name.trim(),
    unit_no,
    display_name: values.display_name.trim() || values.equipment_name.trim(),
    floor_label: values.floor_label.trim() || null,
    install_location: values.install_location.trim(),
    purpose: values.purpose.trim(),
    purchased_at: values.purchased_at.trim() || null,
    installed_at: values.installed_at.trim() || null,
    removed_at: values.removed_at.trim() || null,
    lifecycle_status: values.lifecycle_status,
    dashboard_group: dg,
    dashboard_visible: values.dashboard_visible,
    replaced_from_equipment_id: values.replaced_from_equipment_id.trim() || null,
    replaced_by_equipment_id: values.replaced_by_equipment_id.trim() || null,
    supplier_name: values.supplier_name.trim() || null,
    supplier_contact: values.supplier_contact.trim() || null,
    manufacturer_name: values.manufacturer_name.trim() || null,
    manufacturer_contact: values.manufacturer_contact.trim() || null,
    specification: values.specification.trim() || null,
    voltage: values.voltage.trim() || null,
    photo_url: values.photo_url.trim() || null,
    notes: values.notes.trim() || null,
  };
  if (opts.syncIsActive && is_active !== undefined) {
    payload.is_active = is_active;
  }
  return payload;
}

export function EquipmentMasterForm({
  values,
  onChange,
  excludeEquipmentId,
}: {
  values: EquipmentMasterFormValues;
  onChange: (v: EquipmentMasterFormValues) => void;
  /** 대체 설비 드롭다운에서 제외할 자기 자신 id */
  excludeEquipmentId?: string | null;
}) {
  const { viewOrganizationCode, profile } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const set = (patch: Partial<EquipmentMasterFormValues>) => onChange({ ...values, ...patch });

  const [peers, setPeers] = useState<{ id: string; label: string }[]>([]);
  const [typeOptions, setTypeOptions] = useState<{ code: string; label: string }[]>([]);
  const [groupOptions, setGroupOptions] = useState<{ code: string; label: string }[]>([]);
  const [optErr, setOptErr] = useState<string | null>(null);
  const isAdmin = profile?.role === "admin";

  const loadPeers = useCallback(async () => {
    const { data, error } = await supabase
      .from("equipment_master")
      .select("id, management_no, display_name, equipment_name, floor_label, install_location")
      .eq("organization_code", orgCode)
      .order("management_no");
    if (error || !data) {
      setPeers([]);
      return;
    }
    setPeers(
      (data as EquipmentMasterRow[]).map((r) => ({
        id: r.id,
        label: `${r.management_no} · ${(r.display_name || r.equipment_name).trim()}`,
      }))
    );
  }, [orgCode]);

  useEffect(() => {
    loadPeers();
  }, [loadPeers]);

  const loadOptionMasters = useCallback(async () => {
    setOptErr(null);
    const [{ data: t, error: te }, { data: g, error: ge }] = await Promise.all([
      supabase
        .from("equipment_type_options")
        .select("code, label, is_active, sort_order")
        .eq("organization_code", orgCode)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true }),
      supabase
        .from("equipment_dashboard_group_options")
        .select("code, label, is_active, sort_order")
        .eq("organization_code", orgCode)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true }),
    ]);
    if (te || ge) {
      setOptErr((te ?? ge)!.message);
      setTypeOptions(DEFAULT_EQUIPMENT_TYPES.map((x) => ({ code: x, label: x })));
      setGroupOptions(DEFAULT_DASHBOARD_GROUPS.map((x) => ({ code: x, label: x })));
      return;
    }
    const tList = (t ?? []) as { code: string; label: string }[];
    const gList = (g ?? []) as { code: string; label: string }[];
    setTypeOptions(tList.length ? tList : DEFAULT_EQUIPMENT_TYPES.map((x) => ({ code: x, label: x })));
    setGroupOptions(gList.length ? gList : DEFAULT_DASHBOARD_GROUPS.map((x) => ({ code: x, label: x })));
  }, [orgCode]);

  useEffect(() => {
    loadOptionMasters();
  }, [loadOptionMasters]);

  const peerOptions = useMemo(
    () => peers.filter((p) => !excludeEquipmentId || p.id !== excludeEquipmentId),
    [peers, excludeEquipmentId]
  );

  const applySuggestedDisplayName = () => {
    const s = suggestDisplayName(values.equipment_type, values.unit_no.trim() === "" ? null : Number(values.unit_no));
    if (s) set({ display_name: s });
  };

  const lifecycleHint =
    values.lifecycle_status === "철거" && !values.removed_at.trim() ? "철거일을 입력하는 것을 권장합니다." : null;

  const mnCheck = normalizeSuffix(values.management_no_suffix);
  const managementNoError =
    mnCheck.ok ? null : mnCheck.reason === "empty" ? "관리번호 뒤 번호를 입력하세요." : "관리번호 뒤 번호는 숫자와 하이픈만 입력할 수 있습니다. 예: 12, 1-2";

  return (
    <div className="space-y-4">
      {optErr && <p className="text-xs text-amber-200/90">옵션을 불러오지 못했습니다. 임시 기본값으로 표시합니다. ({optErr})</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>관리번호 (뒤 번호 입력)</label>
          <div className="flex rounded-lg border border-slate-600 bg-space-900 overflow-hidden">
            <div className="shrink-0 px-3 py-2 text-sm text-slate-400 border-r border-slate-700/60 font-mono">
              {MANAGEMENT_NO_PREFIX}
            </div>
            <input
              className="min-w-0 flex-1 px-3 py-2 text-sm bg-transparent text-slate-100 placeholder-slate-500 outline-none"
              value={values.management_no_suffix}
              onChange={(e) => set({ management_no_suffix: e.target.value })}
              placeholder="예: 12 또는 1-2"
              inputMode="numeric"
              required
              aria-invalid={!!managementNoError}
            />
          </div>
          {managementNoError ? (
            <p className="mt-1 text-[11px] text-red-400">{managementNoError}</p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-500">
              저장 시: <span className="font-mono text-slate-300">{joinManagementNo(MANAGEMENT_NO_PREFIX, mnCheck.ok ? mnCheck.suffix : values.management_no_suffix.trim())}</span>
            </p>
          )}
        </div>
        <div>
          <div className="flex items-end justify-between gap-2">
            <label className={labelClass}>설비유형 (관리자 설정값)</label>
            {isAdmin && (
              <Link href="/admin/equipment-options" className="text-[11px] text-cyan-400 hover:text-cyan-300">
                옵션 관리
              </Link>
            )}
          </div>
          <select
            className={fieldClass}
            value={values.equipment_type}
            onChange={(e) => set({ equipment_type: e.target.value as EquipmentType })}
          >
            {typeOptions.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>기본 설비명 (필수)</label>
          <input
            className={fieldClass}
            value={values.equipment_name}
            onChange={(e) => set({ equipment_name: e.target.value })}
            required
            placeholder="예: 터널오븐, 반죽기"
          />
        </div>
        <div>
          <label className={labelClass}>호기 번호 (선택)</label>
          <input
            className={fieldClass}
            type="number"
            min={1}
            step={1}
            value={values.unit_no}
            onChange={(e) => set({ unit_no: e.target.value })}
            placeholder="1, 2, 3…"
          />
        </div>
        <div className="sm:col-span-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className={labelClass}>표시명 (화면)</label>
              <input
                className={fieldClass}
                value={values.display_name}
                onChange={(e) => set({ display_name: e.target.value })}
                placeholder="예: 화덕 2호기"
              />
            </div>
            <button
              type="button"
              onClick={applySuggestedDisplayName}
              className="shrink-0 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
            >
              표시명 제안
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>층 (선택)</label>
          <input className={fieldClass} value={values.floor_label} onChange={(e) => set({ floor_label: e.target.value })} placeholder="2층, 3층…" />
        </div>
        <div>
          <label className={labelClass}>설치장소 (필수)</label>
          <input
            className={fieldClass}
            value={values.install_location}
            onChange={(e) => set({ install_location: e.target.value })}
            required
            placeholder="가열실, 반죽실…"
          />
        </div>
        <div>
          <label className={labelClass}>운영 상태</label>
          <select
            className={fieldClass}
            value={values.lifecycle_status}
            onChange={(e) => {
              const next = e.target.value as LifecycleStatus;
              const patch: Partial<EquipmentMasterFormValues> = { lifecycle_status: next };
              if (next === "운영중" || next === "예비") {
                patch.dashboard_visible = true;
              }
              set(patch);
            }}
          >
            {LIFECYCLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {lifecycleHint && <p className="mt-1 text-[11px] text-amber-400/90">{lifecycleHint}</p>}
        </div>
        <div>
          <div className="flex items-end justify-between gap-2">
            <label className={labelClass}>대시보드 그룹 (관리자 설정값)</label>
            {isAdmin && (
              <Link href="/admin/equipment-options" className="text-[11px] text-cyan-400 hover:text-cyan-300">
                옵션 관리
              </Link>
            )}
          </div>
          <select
            className={fieldClass}
            value={values.dashboard_group}
            onChange={(e) => set({ dashboard_group: e.target.value as "" | DashboardGroup })}
          >
            <option value="">없음</option>
            {groupOptions.map((g) => (
              <option key={g.code} value={g.code}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2 pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={values.dashboard_visible}
              onChange={(e) => set({ dashboard_visible: e.target.checked })}
              className="rounded border-slate-600 bg-space-900"
            />
            임원 대시보드에 노출
          </label>
        </div>
        <div>
          <label className={labelClass}>구입일 (선택)</label>
          <input
            type="date"
            className={fieldClass}
            value={values.purchased_at}
            onChange={(e) => set({ purchased_at: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>설치일 (선택)</label>
          <input
            type="date"
            className={fieldClass}
            value={values.installed_at}
            onChange={(e) => set({ installed_at: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>철거일 (선택)</label>
          <input
            type="date"
            className={fieldClass}
            value={values.removed_at}
            onChange={(e) => set({ removed_at: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>이전 설비 (교체 연결)</label>
          <select
            className={fieldClass}
            value={values.replaced_from_equipment_id}
            onChange={(e) => set({ replaced_from_equipment_id: e.target.value })}
          >
            <option value="">없음</option>
            {peerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>후속 설비 (교체 연결)</label>
          <select
            className={fieldClass}
            value={values.replaced_by_equipment_id}
            onChange={(e) => set({ replaced_by_equipment_id: e.target.value })}
          >
            <option value="">없음</option>
            {peerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>용도 (필수)</label>
          <input className={fieldClass} value={values.purpose} onChange={(e) => set({ purpose: e.target.value })} required />
        </div>
        <div>
          <label className={labelClass}>공급사명 (선택)</label>
          <input className={fieldClass} value={values.supplier_name} onChange={(e) => set({ supplier_name: e.target.value })} />
        </div>
        <div>
          <label className={labelClass}>공급사 연락처 (선택)</label>
          <input
            className={fieldClass}
            value={values.supplier_contact}
            onChange={(e) => set({ supplier_contact: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>제조사명 (선택)</label>
          <input
            className={fieldClass}
            value={values.manufacturer_name}
            onChange={(e) => set({ manufacturer_name: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>제조사 연락처 (선택)</label>
          <input
            className={fieldClass}
            value={values.manufacturer_contact}
            onChange={(e) => set({ manufacturer_contact: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>규격 (선택)</label>
          <input className={fieldClass} value={values.specification} onChange={(e) => set({ specification: e.target.value })} />
        </div>
        <div>
          <label className={labelClass}>사용전압 (선택)</label>
          <input className={fieldClass} value={values.voltage} onChange={(e) => set({ voltage: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>설비사진 URL (선택)</label>
          <input
            className={fieldClass}
            value={values.photo_url}
            onChange={(e) => set({ photo_url: e.target.value })}
            placeholder="https://…"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>비고 (선택)</label>
          <textarea
            className={`${fieldClass} min-h-[80px]`}
            value={values.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={3}
          />
        </div>
      </div>
    </div>
  );
}
