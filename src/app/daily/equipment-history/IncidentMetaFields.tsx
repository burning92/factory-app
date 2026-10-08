"use client";

import { EQUIPMENT_INCIDENT_KINDS, type EquipmentIncidentKind } from "@/features/equipment/equipmentTypes";

export type IncidentMetaState = {
  incidentType: EquipmentIncidentKind | "";
  productionImpact: "" | "yes" | "no";
  /** datetime-local 값 (YYYY-MM-DDTHH:mm) */
  resumedAt: string;
};

export const EMPTY_INCIDENT_META: IncidentMetaState = { incidentType: "", productionImpact: "", resumedAt: "" };

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function incidentMetaFromRecord(r: {
  incident_type?: EquipmentIncidentKind | null;
  has_production_impact?: boolean | null;
  resumed_at?: string | null;
}): IncidentMetaState {
  return {
    incidentType: r.incident_type ?? "",
    productionImpact: r.has_production_impact == null ? "" : r.has_production_impact ? "yes" : "no",
    resumedAt: isoToLocalInput(r.resumed_at),
  };
}

export function incidentMetaToPayload(s: IncidentMetaState) {
  const resumed = s.resumedAt ? new Date(s.resumedAt) : null;
  return {
    incident_type: s.incidentType || null,
    has_production_impact: s.productionImpact === "" ? null : s.productionImpact === "yes",
    resumed_at: resumed && !Number.isNaN(resumed.getTime()) ? resumed.toISOString() : null,
  };
}

type Props = {
  value: IncidentMetaState;
  onChange: (next: IncidentMetaState) => void;
  fieldClass: string;
};

export function IncidentMetaFields({ value, onChange, fieldClass }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">구분 (선택)</label>
        <select
          className={fieldClass}
          value={value.incidentType}
          onChange={(e) => onChange({ ...value, incidentType: e.target.value as IncidentMetaState["incidentType"] })}
        >
          <option value="">선택 안 함</option>
          {EQUIPMENT_INCIDENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">생산영향 (선택)</label>
        <select
          className={fieldClass}
          value={value.productionImpact}
          onChange={(e) => onChange({ ...value, productionImpact: e.target.value as IncidentMetaState["productionImpact"] })}
        >
          <option value="">선택 안 함</option>
          <option value="yes">있음</option>
          <option value="no">없음</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">재가동일시 (선택)</label>
        <input
          type="datetime-local"
          className={fieldClass}
          value={value.resumedAt}
          onChange={(e) => onChange({ ...value, resumedAt: e.target.value })}
        />
      </div>
    </div>
  );
}

export function IncidentMetaBadges({
  incidentType,
  hasProductionImpact,
}: {
  incidentType?: EquipmentIncidentKind | null;
  hasProductionImpact?: boolean | null;
}) {
  if (!incidentType && !hasProductionImpact) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {incidentType && (
        <span
          className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
            incidentType === "이상" ? "bg-slate-600/40 text-slate-200" : "bg-red-500/20 text-red-200"
          }`}
        >
          {incidentType}
        </span>
      )}
      {hasProductionImpact && (
        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">생산영향</span>
      )}
    </span>
  );
}
