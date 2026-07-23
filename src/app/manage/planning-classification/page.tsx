"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { isAdminLikeRole } from "@/lib/roles";
import {
  fetchPlanningClassificationOverrides,
  type PlanningClassificationRow,
} from "@/features/production/planning/fetchPlanningClassifications";
import type { MajorCategory, PizzaSubtype } from "@/features/production/planning/productClassification";

const MAJOR_OPTIONS: { value: MajorCategory; label: string }[] = [
  { value: "pizza", label: "피자" },
  { value: "bread", label: "브레드" },
  { value: "parbake_storage", label: "파베이크(보관)" },
  { value: "parbake_sale", label: "파베이크(판매)" },
  { value: "unclassified", label: "미분류(제외)" },
];

const SUBTYPE_OPTIONS: { value: PizzaSubtype; label: string }[] = [
  { value: "light", label: "라이트" },
  { value: "heavy", label: "헤비" },
  { value: "mini", label: "미니" },
];

function majorLabel(major: string): string {
  return MAJOR_OPTIONS.find((o) => o.value === major)?.label ?? major;
}

function subtypeLabel(subtype: string | null, major: string): string {
  if (major !== "pizza") return "—";
  return SUBTYPE_OPTIONS.find((o) => o.value === subtype)?.label ?? subtype ?? "—";
}

export default function ManagePlanningClassificationPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<PlanningClassificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [baseName, setBaseName] = useState("");
  const [major, setMajor] = useState<MajorCategory>("pizza");
  const [pizzaSubtype, setPizzaSubtype] = useState<PizzaSubtype>("heavy");
  const [note, setNote] = useState("");
  const [editingBase, setEditingBase] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetchPlanningClassificationOverrides();
    if (res.error) {
      setError(res.error);
      setRows([]);
    } else {
      setRows(res.rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAdminLikeRole(profile?.role)) return;
    void load();
  }, [profile?.role, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.base_name.toLowerCase().includes(q));
  }, [rows, search]);

  function resetForm() {
    setBaseName("");
    setMajor("pizza");
    setPizzaSubtype("heavy");
    setNote("");
    setEditingBase(null);
  }

  function startEdit(row: PlanningClassificationRow) {
    setEditingBase(row.base_name);
    setBaseName(row.base_name);
    setMajor(row.major as MajorCategory);
    setPizzaSubtype(
      row.pizza_subtype === "light" || row.pizza_subtype === "heavy" || row.pizza_subtype === "mini"
        ? row.pizza_subtype
        : "heavy"
    );
    setNote(row.note ?? "");
    setOkMsg(null);
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    const name = baseName.normalize("NFC").trim();
    if (!name) {
      setError("베이스 제품명을 입력하세요. (예: 풀드포크 타코피자)");
      return;
    }
    const payload = {
      base_name: name,
      major,
      pizza_subtype: major === "pizza" ? pizzaSubtype : null,
      note: note.trim() || null,
      updated_at: new Date().toISOString(),
    };
    setSaving(true);
    if (editingBase && editingBase !== name) {
      const { error: delErr } = await supabase
        .from("planning_product_classifications")
        .delete()
        .eq("base_name", editingBase);
      if (delErr) {
        setSaving(false);
        setError(delErr.message);
        return;
      }
    }
    const { error: upsertErr } = await supabase.from("planning_product_classifications").upsert(payload, {
      onConflict: "base_name",
    });
    setSaving(false);
    if (upsertErr) {
      setError(upsertErr.message);
      return;
    }
    setOkMsg(`「${name}」 분류를 저장했습니다.`);
    resetForm();
    await load();
  }

  async function handleDelete(name: string) {
    if (!window.confirm(`「${name}」 분류를 삭제할까요?\n삭제하면 코드 기본 규칙·자동 추론으로 돌아갑니다.`)) return;
    setError(null);
    setOkMsg(null);
    const { error: delErr } = await supabase.from("planning_product_classifications").delete().eq("base_name", name);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    if (editingBase === name) resetForm();
    setOkMsg(`「${name}」을(를) 삭제했습니다.`);
    await load();
  }

  if (!isAdminLikeRole(profile?.role)) {
    return (
      <div className="p-6">
        <p className="text-slate-500">권한이 없습니다.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-slate-500">로딩 중…</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <p className="text-sm text-slate-400 mb-1">
          <Link href="/manage" className="text-cyan-400 hover:text-cyan-300">
            관리
          </Link>
          <span className="text-slate-600 mx-2">/</span>
          플래닝 제품 분류
        </p>
        <h1 className="text-2xl font-bold text-slate-100">플래닝 제품 분류</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          월간 생산계획 보드의 피자·브레드·파베이크 집계에 쓰입니다. 여기에 등록한 값이 코드 기본값보다 우선합니다.
          미분류로 남는 제품만 등록하면 됩니다.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {okMsg ? <p className="text-sm text-emerald-400">{okMsg}</p> : null}

      <section className="rounded-xl border border-slate-700 bg-space-800/80 p-5 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100">{editingBase ? "분류 수정" : "분류 추가"}</h2>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">베이스 제품명 (조건 제외)</label>
            <input
              type="text"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              placeholder="예: 풀드포크 타코피자"
              className="w-full rounded-md border border-slate-600 bg-space-900 px-3 py-2 text-sm text-slate-100"
              disabled={saving}
            />
            <p className="mt-1 text-[11px] text-slate-500">「제품명 - 일반」에서 앞부분만 입력하세요.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">대분류</label>
              <select
                value={major}
                onChange={(e) => setMajor(e.target.value as MajorCategory)}
                className="w-full rounded-md border border-slate-600 bg-space-900 px-3 py-2 text-sm text-slate-100"
                disabled={saving}
              >
                {MAJOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">피자 세부</label>
              <select
                value={pizzaSubtype}
                onChange={(e) => setPizzaSubtype(e.target.value as PizzaSubtype)}
                className="w-full rounded-md border border-slate-600 bg-space-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-40"
                disabled={saving || major !== "pizza"}
              >
                {SUBTYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">메모 (선택)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-space-900 px-3 py-2 text-sm text-slate-100"
              disabled={saving}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "저장 중…" : editingBase ? "수정 저장" : "추가"}
            </button>
            {editingBase ? (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                취소
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-700 bg-space-800/80 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-100">등록된 분류 ({rows.length})</h2>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="검색"
            className="rounded-md border border-slate-600 bg-space-900 px-3 py-1.5 text-sm text-slate-100 w-40"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">등록된 분류가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-700/80">
            {filtered.map((row) => (
              <li key={row.base_name} className="py-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-100 break-words">{row.base_name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {majorLabel(row.major)}
                    {row.major === "pizza" ? ` · ${subtypeLabel(row.pizza_subtype, row.major)}` : null}
                    {row.note ? ` · ${row.note}` : null}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(row.base_name)}
                    className="text-xs text-rose-400 hover:text-rose-300"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
