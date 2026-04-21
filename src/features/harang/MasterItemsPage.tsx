"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
  /** 원재료만: 단위 고정(예: EA) 시 기본단위 수정 불가 */
  lockedUnit: string | null;
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
  lockedUnit: null,
  box_weight_g: "0",
  unit_weight_g: "0",
  note: "",
  is_active: true,
};

function itemToForm(item: HarangMasterItem, tableName: Props["tableName"]): FormState {
  return {
    id: item.id,
    item_code: item.item_code,
    item_name: item.item_name,
    default_unit: item.default_unit,
    lockedUnit: tableName === "harang_raw_materials" ? (item.locked_unit ?? null) : null,
    box_weight_g: String(item.box_weight_g ?? 0),
    unit_weight_g: String(item.unit_weight_g ?? 0),
    note: item.note ?? "",
    is_active: item.is_active,
  };
}

type FormBodyProps = {
  form: FormState;
  onPatch: (patch: Partial<FormState>) => void;
  showWeightFields: boolean;
  weightColumnsAvailable: boolean;
  tableName: Props["tableName"];
};

function MasterItemFormBody({
  form,
  onPatch,
  showWeightFields,
  weightColumnsAvailable,
  tableName,
}: FormBodyProps) {
  return (
    <div className={`grid grid-cols-1 ${showWeightFields && weightColumnsAvailable ? "md:grid-cols-6" : "md:grid-cols-4"} gap-3`}>
      <input
        value={form.item_code}
        onChange={(e) => onPatch({ item_code: e.target.value })}
        placeholder="품목코드"
        className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
      />
      <input
        value={form.item_name}
        onChange={(e) => onPatch({ item_name: e.target.value })}
        placeholder="품목명"
        className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
      />
      <input
        value={form.default_unit}
        readOnly={Boolean(form.lockedUnit)}
        title={form.lockedUnit ? "단위 고정 품목은 EA 등 고정 단위만 사용합니다." : undefined}
        onChange={(e) => onPatch({ default_unit: e.target.value })}
        placeholder="기본단위 (예: g, EA)"
        className={`px-3 py-2 rounded-lg border text-slate-900 text-sm ${
          form.lockedUnit ? "bg-slate-100 border-slate-200" : "bg-white border-slate-300"
        }`}
      />
      {showWeightFields && weightColumnsAvailable && (
        <input
          type="number"
          min="0"
          step="0.01"
          value={form.box_weight_g}
          onChange={(e) => onPatch({ box_weight_g: e.target.value })}
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
          onChange={(e) => onPatch({ unit_weight_g: e.target.value })}
          placeholder="1개(낱개) 중량(g)"
          className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
        />
      )}
      <input
        value={form.note}
        onChange={(e) => onPatch({ note: e.target.value })}
        placeholder="비고"
        className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
      />
    </div>
  );
}

type ItemsTableProps = {
  items: HarangMasterItem[];
  fetching: boolean;
  emptyMessage: string;
  showWeightFields: boolean;
  weightColumnsAvailable: boolean;
  tableName: Props["tableName"];
  onToggleActive: (item: HarangMasterItem) => void;
  onEdit: (item: HarangMasterItem) => void;
};

const colSpan = (showWeightFields: boolean, weightColumnsAvailable: boolean) =>
  showWeightFields && weightColumnsAvailable ? 8 : 6;

function ItemsTable({
  items,
  fetching,
  emptyMessage,
  showWeightFields,
  weightColumnsAvailable,
  tableName,
  onToggleActive,
  onEdit,
}: ItemsTableProps) {
  const cs = colSpan(showWeightFields, weightColumnsAvailable);
  return (
    <div className="overflow-x-auto">
      <table
        className={`w-full ${showWeightFields && weightColumnsAvailable ? "min-w-[1080px]" : "min-w-[840px]"} text-sm`}
      >
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
              <td className="px-3 py-6 text-center text-slate-500" colSpan={cs}>
                불러오는 중...
              </td>
            </tr>
          )}
          {!fetching && items.length === 0 && (
            <tr>
              <td className="px-3 py-6 text-center text-slate-500" colSpan={cs}>
                {emptyMessage}
              </td>
            </tr>
          )}
          {!fetching &&
            items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100 text-slate-900">
                <td className="px-3 py-2">{item.item_code}</td>
                <td className="px-3 py-2">{item.item_name}</td>
                <td className="px-3 py-2">
                  {item.default_unit}
                  {tableName === "harang_raw_materials" && item.locked_unit?.trim() ? (
                    <span className="ml-1 text-[10px] text-cyan-800 font-medium whitespace-nowrap">
                      ({item.locked_unit} 고정)
                    </span>
                  ) : null}
                </td>
                {showWeightFields && weightColumnsAvailable && (
                  <td className="px-3 py-2 text-right tabular-nums">{Number(item.box_weight_g ?? 0).toLocaleString()}</td>
                )}
                {showWeightFields && weightColumnsAvailable && (
                  <td className="px-3 py-2 text-right tabular-nums">{Number(item.unit_weight_g ?? 0).toLocaleString()}</td>
                )}
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onToggleActive(item)}
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
                    onClick={() => onEdit(item)}
                    className="px-3 py-1.5 rounded border border-cyan-600 text-cyan-700 text-xs bg-white hover:bg-cyan-50"
                  >
                    수정
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MasterItemsPage({ title, tableName, description, showWeightFields = false }: Props) {
  const { profile, loading } = useAuth();
  const [items, setItems] = useState<HarangMasterItem[]>([]);
  const [query, setQuery] = useState("");
  const [createForm, setCreateForm] = useState<FormState>(INITIAL_FORM);
  const [editModal, setEditModal] = useState<FormState | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [weightColumnsAvailable, setWeightColumnsAvailable] = useState(showWeightFields);
  const isAdmin = profile?.role === "admin";
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const loadItems = useCallback(async () => {
    setFetching(true);
    let data: unknown[] | null = null;
    let error: { message?: string } | null = null;
    const rawLocked = tableName === "harang_raw_materials" ? ", locked_unit" : "";

    if (showWeightFields) {
      const res = await supabase
        .from(tableName)
        .select(`id, item_code, item_name, default_unit${rawLocked}, box_weight_g, unit_weight_g, is_active, note, created_at, updated_at`)
        .order("item_code", { ascending: true });
      data = res.data as unknown[] | null;
      error = res.error as { message?: string } | null;
      if (error?.message?.includes("box_weight_g")) {
        // 마이그레이션 전 환경 폴백: 중량 컬럼 없이도 기본 마스터 조회 가능하게 처리
        setWeightColumnsAvailable(false);
        const fallback = await supabase
          .from(tableName)
          .select(`id, item_code, item_name, default_unit${rawLocked}, is_active, note, created_at, updated_at`)
          .order("item_code", { ascending: true });
        data = fallback.data as unknown[] | null;
        error = fallback.error as { message?: string } | null;
      } else {
        setWeightColumnsAvailable(true);
      }
    } else {
      const res = await supabase
        .from(tableName)
        .select(`id, item_code, item_name, default_unit${rawLocked}, is_active, note, created_at, updated_at`)
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
      [item.item_code, item.item_name, item.default_unit, item.note ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const activeRows = useMemo(() => filtered.filter((i) => i.is_active), [filtered]);
  const inactiveRows = useMemo(() => filtered.filter((i) => !i.is_active), [filtered]);

  const buildPayload = useCallback(
    (form: FormState): Record<string, unknown> => {
      const defaultUnit = form.lockedUnit?.trim() || form.default_unit.trim();
      const payload: Record<string, unknown> = {
        item_code: form.item_code.trim(),
        item_name: form.item_name.trim(),
        default_unit: defaultUnit,
        ...(showWeightFields && weightColumnsAvailable
          ? {
              box_weight_g: Math.max(0, Number(form.box_weight_g) || 0),
              unit_weight_g: Math.max(0, Number(form.unit_weight_g) || 0),
            }
          : {}),
        note: form.note.trim() || null,
        is_active: form.is_active,
      };
      if (tableName === "harang_raw_materials") {
        payload.locked_unit = form.lockedUnit ?? null;
      }
      return payload;
    },
    [showWeightFields, weightColumnsAvailable, tableName],
  );

  const validateForm = (form: FormState): boolean => {
    const defaultUnit = form.lockedUnit?.trim() || form.default_unit.trim();
    if (!form.item_code.trim() || !form.item_name.trim() || !defaultUnit) {
      alert("코드/품목명/기본단위는 필수입니다.");
      return false;
    }
    return true;
  };

  const handleSaveCreate = async () => {
    if (!validateForm(createForm)) return;
    setSaving(true);
    const payload = buildPayload(createForm);
    const { error } = await supabase.from(tableName).insert(payload as never);
    setSaving(false);
    if (error) return alert(error.message);
    await loadItems();
    setCreateForm(INITIAL_FORM);
  };

  const handleSaveEditModal = async () => {
    if (!editModal?.id || !validateForm(editModal)) return;
    setSaving(true);
    const payload = buildPayload(editModal);
    const { error } = await supabase.from(tableName).update(payload as never).eq("id", editModal.id);
    setSaving(false);
    if (error) return alert(error.message);
    await loadItems();
    setEditModal(null);
  };

  const handleEdit = (item: HarangMasterItem) => {
    setEditModal(itemToForm(item, tableName));
  };

  const handleToggleActive = async (item: HarangMasterItem) => {
    const { error } = await supabase.from(tableName).update({ is_active: !item.is_active }).eq("id", item.id);
    if (error) return alert(error.message);
    await loadItems();
    if (editModal?.id === item.id) {
      setEditModal((prev) => (prev ? { ...prev, is_active: !item.is_active } : null));
    }
  };

  const editModalNode =
    mounted &&
    editModal &&
    createPortal(
      <div
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="harang-master-edit-title"
      >
        <button
          type="button"
          className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
          aria-label="닫기"
          onClick={() => setEditModal(null)}
        />
        <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3 sm:px-5">
            <h2 id="harang-master-edit-title" className="text-base font-semibold text-slate-900">
              마스터 수정
            </h2>
            <button
              type="button"
              onClick={() => setEditModal(null)}
              className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              닫기
            </button>
          </div>
          <div className="p-4 sm:p-5 space-y-3">
            <MasterItemFormBody
              form={editModal}
              onPatch={(patch) => setEditModal((prev) => (prev ? { ...prev, ...patch } : null))}
              showWeightFields={showWeightFields}
              weightColumnsAvailable={weightColumnsAvailable}
              tableName={tableName}
            />
            <label className="text-sm text-slate-700 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={editModal.is_active}
                onChange={(e) => setEditModal((prev) => (prev ? { ...prev, is_active: e.target.checked } : null))}
              />
              사용중
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveEditModal}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm disabled:opacity-60"
              >
                수정 저장
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );

  if (loading) {
    return <div className="px-6 py-10 text-slate-500">로딩 중...</div>;
  }
  if (!isAdmin) {
    return <div className="px-6 py-10 text-slate-600">관리자만 접근할 수 있습니다.</div>;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      {editModalNode}
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
          <h2 className="text-sm font-semibold text-slate-800 mb-3">신규 등록</h2>
          <MasterItemFormBody
            form={createForm}
            onPatch={(patch) => setCreateForm((prev) => ({ ...prev, ...patch }))}
            showWeightFields={showWeightFields}
            weightColumnsAvailable={weightColumnsAvailable}
            tableName={tableName}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="text-sm text-slate-700 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={createForm.is_active}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              사용중
            </label>
            <button
              type="button"
              onClick={handleSaveCreate}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm disabled:opacity-60"
            >
              등록
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-slate-800">목록</h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="코드/품목명/단위/비고 검색"
              className="w-full sm:w-80 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
          </div>

          {fetching ? (
            <p className="py-10 text-center text-slate-500 text-sm">불러오는 중...</p>
          ) : (
            <div className="space-y-8">
              <div>
                <h3 className="text-xs font-semibold text-emerald-800 uppercase tracking-wide mb-2 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                  사용 ({activeRows.length})
                </h3>
                <ItemsTable
                  items={activeRows}
                  fetching={false}
                  emptyMessage="사용 중인 품목이 없습니다."
                  showWeightFields={showWeightFields}
                  weightColumnsAvailable={weightColumnsAvailable}
                  tableName={tableName}
                  onToggleActive={handleToggleActive}
                  onEdit={handleEdit}
                />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-slate-400" aria-hidden />
                  미사용 ({inactiveRows.length})
                </h3>
                <ItemsTable
                  items={inactiveRows}
                  fetching={false}
                  emptyMessage="미사용 품목이 없습니다."
                  showWeightFields={showWeightFields}
                  weightColumnsAvailable={weightColumnsAvailable}
                  tableName={tableName}
                  onToggleActive={handleToggleActive}
                  onEdit={handleEdit}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
