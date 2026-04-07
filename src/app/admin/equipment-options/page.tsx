"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type OptionRow = {
  id: string;
  organization_code: string;
  code: string;
  label: string;
  is_active: boolean;
  sort_order: number;
};

const inputClass =
  "w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500";

function sortOptions(list: OptionRow[]): OptionRow[] {
  return [...list].sort((a, b) => {
    const so = (a.sort_order ?? 100) - (b.sort_order ?? 100);
    if (so !== 0) return so;
    return String(a.label ?? "").localeCompare(String(b.label ?? ""), "ko");
  });
}

async function loadOptions(table: "equipment_type_options" | "equipment_dashboard_group_options", orgCode: string) {
  const { data, error } = await supabase
    .from(table)
    .select("id, organization_code, code, label, is_active, sort_order")
    .eq("organization_code", orgCode);
  if (error) throw new Error(error.message);
  return (data ?? []) as OptionRow[];
}

async function insertOption(
  table: "equipment_type_options" | "equipment_dashboard_group_options",
  orgCode: string,
  payload: { code: string; label: string; sort_order: number }
) {
  const { error } = await supabase.from(table).insert({
    organization_code: orgCode,
    code: payload.code,
    label: payload.label,
    sort_order: payload.sort_order,
    is_active: true,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

async function updateOption(
  table: "equipment_type_options" | "equipment_dashboard_group_options",
  id: string,
  patch: Partial<Pick<OptionRow, "label" | "is_active" | "sort_order">>
) {
  const { error } = await supabase
    .from(table)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

function OptionTable({
  title,
  table,
  orgCode,
  canEdit,
  options,
  onReload,
}: {
  title: string;
  table: "equipment_type_options" | "equipment_dashboard_group_options";
  orgCode: string;
  canEdit: boolean;
  options: OptionRow[];
  onReload: () => void;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [err, setErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => `${o.code} ${o.label}`.toLowerCase().includes(t));
  }, [options, q]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setErr(null);
    const c = code.trim();
    const l = label.trim();
    const so = Number.parseInt(sortOrder, 10);
    if (!c || !l) {
      setErr("코드와 표시명은 필수입니다.");
      return;
    }
    if (!Number.isFinite(so)) {
      setErr("정렬값은 숫자여야 합니다.");
      return;
    }
    setCreating(true);
    try {
      await insertOption(table, orgCode, { code: c, label: l, sort_order: so });
      setCode("");
      setLabel("");
      setSortOrder("100");
      onReload();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(o: OptionRow) {
    if (!canEdit) return;
    setErr(null);
    try {
      await updateOption(table, o.id, { is_active: !o.is_active });
      onReload();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  async function changeSort(o: OptionRow, next: string) {
    if (!canEdit) return;
    setErr(null);
    const so = Number.parseInt(next, 10);
    if (!Number.isFinite(so)) return;
    try {
      await updateOption(table, o.id, { sort_order: so });
      onReload();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  return (
    <section className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          <p className="text-xs text-slate-500 mt-1">조직 {orgCode} 기준. 비활성은 기존 데이터 호환을 위해 삭제 대신 숨김 처리합니다.</p>
        </div>
        <div className="w-full sm:w-64">
          <label className="block text-xs text-slate-400 mb-1">검색</label>
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="부분 검색" />
        </div>
      </div>

      {err && (
        <p className="text-sm text-red-400" role="alert">
          {err}
        </p>
      )}

      {canEdit && (
        <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">code (내부값)</label>
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} placeholder="예: 화덕, 공조기" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">label (표시명)</label>
            <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 화덕" />
          </div>
          <div className="flex gap-2 items-end">
            <div className="min-w-0 flex-1">
              <label className="block text-xs text-slate-400 mb-1">정렬</label>
              <input className={inputClass} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="shrink-0 px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 disabled:opacity-50"
            >
              추가
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-800/30">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-slate-400">
              <th className="px-3 py-2.5 font-medium">code</th>
              <th className="px-3 py-2.5 font-medium">label</th>
              <th className="px-3 py-2.5 font-medium">정렬</th>
              <th className="px-3 py-2.5 font-medium">상태</th>
              <th className="px-3 py-2.5 font-medium w-28">관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                <td className="px-3 py-2.5 font-mono text-slate-200">{o.code}</td>
                <td className="px-3 py-2.5 text-slate-200">{o.label}</td>
                <td className="px-3 py-2.5">
                  {canEdit ? (
                    <input
                      className="w-24 px-2 py-1 text-xs bg-space-900 border border-slate-600 rounded text-slate-100"
                      defaultValue={String(o.sort_order ?? 100)}
                      onBlur={(e) => void changeSort(o, e.target.value)}
                    />
                  ) : (
                    <span className="text-slate-400">{o.sort_order ?? 100}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className={o.is_active ? "text-emerald-400" : "text-slate-500"}>{o.is_active ? "활성" : "비활성"}</span>
                </td>
                <td className="px-3 py-2.5">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => void toggleActive(o)}
                      className="text-xs rounded border border-slate-600 px-2 py-1 text-slate-200 hover:bg-slate-800"
                    >
                      {o.is_active ? "비활성" : "활성"}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-slate-500 text-sm" colSpan={5}>
                  옵션이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AdminEquipmentOptionsPage() {
  const { profile, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canEdit = profile?.role === "admin";

  const [typeOptions, setTypeOptions] = useState<OptionRow[]>([]);
  const [groupOptions, setGroupOptions] = useState<OptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [t, g] = await Promise.all([
        loadOptions("equipment_type_options", orgCode),
        loadOptions("equipment_dashboard_group_options", orgCode),
      ]);
      setTypeOptions(sortOptions(t));
      setGroupOptions(sortOptions(g));
    } catch (e) {
      setErr((e as Error).message);
      setTypeOptions([]);
      setGroupOptions([]);
    } finally {
      setLoading(false);
    }
  }, [orgCode]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-5xl mx-auto pb-24 md:pb-8 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">설비옵션관리</h1>
          <p className="text-slate-500 text-sm mt-0.5">설비유형 / 대시보드 그룹 옵션을 관리자(admin)가 추가·비활성화할 수 있습니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/equipment" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            제조설비등록
          </Link>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-space-900 hover:bg-cyan-400"
          >
            새로고침
          </button>
        </div>
      </div>

      {!canEdit && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
          이 화면은 관리자만 수정할 수 있습니다. (현재: 읽기 전용)
        </p>
      )}
      {err && (
        <p className="text-sm text-red-400" role="alert">
          {err}
        </p>
      )}
      {loading ? (
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      ) : (
        <div className="space-y-5">
          <OptionTable
            title="설비유형관리"
            table="equipment_type_options"
            orgCode={orgCode}
            canEdit={canEdit}
            options={typeOptions}
            onReload={reload}
          />
          <OptionTable
            title="대시보드그룹관리"
            table="equipment_dashboard_group_options"
            orgCode={orgCode}
            canEdit={canEdit}
            options={groupOptions}
            onReload={reload}
          />
        </div>
      )}
    </div>
  );
}

