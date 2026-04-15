"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { HarangMasterItem } from "./types";

type Props = {
  title: string;
  tableName: "harang_raw_materials" | "harang_packaging_materials";
  description: string;
  showWeightFields?: boolean;
};

type FormState = {
  id: string | null;
  item_code: string;
  item_name: string;
  default_unit: string;
  box_weight_g: string;
  unit_weight_g: string;
  note: string;
  is_active: boolean;
};

const INITIAL_FORM: FormState = {
  id: null,
  item_code: "",
  item_name: "",
  default_unit: "",
  box_weight_g: "0",
  unit_weight_g: "0",
  note: "",
  is_active: true,
};

export default function MasterItemsPage({ title, tableName, description, showWeightFields = false }: Props) {
  const { profile, loading } = useAuth();
  const [items, setItems] = useState<HarangMasterItem[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [weightColumnsAvailable, setWeightColumnsAvailable] = useState(showWeightFields);
  const isAdmin = profile?.role === "admin";

  const loadItems = useCallback(async () => {
    setFetching(true);
    let data: unknown[] | null = null;
    let error: { message?: string } | null = null;

    if (showWeightFields) {
      const res = await supabase
        .from(tableName)
        .select("id, item_code, item_name, default_unit, box_weight_g, unit_weight_g, is_active, note, created_at, updated_at")
        .order("item_code", { ascending: true });
      data = res.data as unknown[] | null;
      error = res.error as { message?: string } | null;
      if (error?.message?.includes("box_weight_g")) {
        // 마이그레이션 전 환경 폴백: 중량 컬럼 없이도 기본 마스터 조회 가능하게 처리
        setWeightColumnsAvailable(false);
        const fallback = await supabase
          .from(tableName)
          .select("id, item_code, item_name, default_unit, is_active, note, created_at, updated_at")
          .order("item_code", { ascending: true });
        data = fallback.data as unknown[] | null;
        error = fallback.error as { message?: string } | null;
      } else {
        setWeightColumnsAvailable(true);
      }
    } else {
      const res = await supabase
        .from(tableName)
        .select("id, item_code, item_name, default_unit, is_active, note, created_at, updated_at")
        .order("item_code", { ascending: true });
      data = res.data as unknown[] | null;
      error = res.error as { message?: string } | null;
    }
    setFetching(false);
    if (error) {
      alert(error.message);
      return;
    }
    setItems((data ?? []) as HarangMasterItem[]);
  }, [tableName, showWeightFields]);

  useEffect(() => {
    if (!loading) void loadItems();
  }, [loading, loadItems]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.item_code, item.item_name, item.default_unit, item.note ?? ""].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [items, query]);

  const resetForm = () => setForm(INITIAL_FORM);

  const handleSave = async () => {
    const payload = {
      item_code: form.item_code.trim(),
      item_name: form.item_name.trim(),
      default_unit: form.default_unit.trim(),
      ...(showWeightFields && weightColumnsAvailable
        ? {
            box_weight_g: Math.max(0, Number(form.box_weight_g) || 0),
            unit_weight_g: Math.max(0, Number(form.unit_weight_g) || 0),
          }
        : {}),
      note: form.note.trim() || null,
      is_active: form.is_active,
    };
    if (!payload.item_code || !payload.item_name || !payload.default_unit) {
      alert("코드/품목명/기본단위는 필수입니다.");
      return;
    }
    setSaving(true);
    if (form.id) {
      const { error } = await supabase.from(tableName).update(payload).eq("id", form.id);
      setSaving(false);
      if (error) return alert(error.message);
      await loadItems();
      resetForm();
      return;
    }
    const { error } = await supabase.from(tableName).insert(payload);
    setSaving(false);
    if (error) return alert(error.message);
    await loadItems();
    resetForm();
  };

  const handleEdit = (item: HarangMasterItem) => {
    setForm({
      id: item.id,
      item_code: item.item_code,
      item_name: item.item_name,
      default_unit: item.default_unit,
      box_weight_g: String(item.box_weight_g ?? 0),
      unit_weight_g: String(item.unit_weight_g ?? 0),
      note: item.note ?? "",
      is_active: item.is_active,
    });
  };

  const handleToggleActive = async (item: HarangMasterItem) => {
    const { error } = await supabase
      .from(tableName)
      .update({ is_active: !item.is_active })
      .eq("id", item.id);
    if (error) return alert(error.message);
    await loadItems();
  };

  if (loading) {
    return <div className="px-6 py-10 text-slate-500">로딩 중...</div>;
  }
  if (!isAdmin) {
    return <div className="px-6 py-10 text-slate-600">관리자만 접근할 수 있습니다.</div>;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
          {showWeightFields && !weightColumnsAvailable && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
              중량 컬럼이 DB에 아직 없어 중량 입력은 숨김 상태입니다. 하랑 원재료 중량 migration 적용 후 자동으로 활성화됩니다.
            </p>
          )}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">{form.id ? "마스터 수정" : "신규 등록"}</h2>
          <div className={`grid grid-cols-1 ${showWeightFields && weightColumnsAvailable ? "md:grid-cols-6" : "md:grid-cols-4"} gap-3`}>
            <input
              value={form.item_code}
              onChange={(e) => setForm((prev) => ({ ...prev, item_code: e.target.value }))}
              placeholder="품목코드"
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
            <input
              value={form.item_name}
              onChange={(e) => setForm((prev) => ({ ...prev, item_name: e.target.value }))}
              placeholder="품목명"
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
            <input
              value={form.default_unit}
              onChange={(e) => setForm((prev) => ({ ...prev, default_unit: e.target.value }))}
              placeholder="기본단위 (예: g, EA)"
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
            {showWeightFields && weightColumnsAvailable && (
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.box_weight_g}
                onChange={(e) => setForm((prev) => ({ ...prev, box_weight_g: e.target.value }))}
                placeholder="1박스 중량(g)"
                className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
              />
            )}
            {showWeightFields && weightColumnsAvailable && (
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.unit_weight_g}
                onChange={(e) => setForm((prev) => ({ ...prev, unit_weight_g: e.target.value }))}
                placeholder="1개(낱개) 중량(g)"
                className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
              />
            )}
            <input
              value={form.note}
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="비고"
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="text-sm text-slate-700 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              사용중
            </label>
            <div className="flex items-center gap-2">
              {form.id && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm"
                >
                  취소
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm disabled:opacity-60"
              >
                {form.id ? "수정 저장" : "등록"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-slate-800">목록</h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="코드/품목명/단위/비고 검색"
              className="w-full sm:w-80 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
          </div>
          <div className="overflow-x-auto">
            <table className={`w-full ${showWeightFields && weightColumnsAvailable ? "min-w-[1080px]" : "min-w-[840px]"} text-sm`}>
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left">코드</th>
                  <th className="px-3 py-2 text-left">품목명</th>
                  <th className="px-3 py-2 text-left">기본단위</th>
                  {showWeightFields && weightColumnsAvailable && <th className="px-3 py-2 text-right">1박스중량(g)</th>}
                  {showWeightFields && weightColumnsAvailable && <th className="px-3 py-2 text-right">1개중량(g)</th>}
                  <th className="px-3 py-2 text-left">사용여부</th>
                  <th className="px-3 py-2 text-left">비고</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {fetching && (
                  <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={showWeightFields && weightColumnsAvailable ? 8 : 6}>
                      불러오는 중...
                    </td>
                  </tr>
                )}
                {!fetching && filtered.length === 0 && (
                  <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={showWeightFields && weightColumnsAvailable ? 8 : 6}>
                      데이터가 없습니다.
                    </td>
                  </tr>
                )}
                {!fetching &&
                  filtered.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100 text-slate-900">
                      <td className="px-3 py-2">{item.item_code}</td>
                      <td className="px-3 py-2">{item.item_name}</td>
                      <td className="px-3 py-2">{item.default_unit}</td>
                      {showWeightFields && weightColumnsAvailable && (
                        <td className="px-3 py-2 text-right tabular-nums">{Number(item.box_weight_g ?? 0).toLocaleString()}</td>
                      )}
                      {showWeightFields && weightColumnsAvailable && (
                        <td className="px-3 py-2 text-right tabular-nums">{Number(item.unit_weight_g ?? 0).toLocaleString()}</td>
                      )}
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(item)}
                          className={`px-2 py-1 rounded text-xs ${
                            item.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {item.is_active ? "사용" : "미사용"}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{item.note ?? "-"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleEdit(item)}
                          className="px-3 py-1.5 rounded border border-cyan-600/60 text-cyan-300 text-xs"
                        >
                          수정
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
