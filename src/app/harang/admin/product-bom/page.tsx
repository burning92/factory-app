"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { HarangBomRow, HarangMasterItem } from "@/features/harang/types";

type MaterialCategory = "raw_material" | "packaging_material";

type NewProductForm = {
  product_name: string;
  material_category: MaterialCategory;
  material_id: string;
  bom_qty: string;
  unit: string;
  is_active: boolean;
};

type ProductDraftLine = {
  key: string;
  id: string | null;
  material_category: MaterialCategory;
  material_id: string;
  material_code: string;
  material_name: string;
  bom_qty: string;
  unit: string;
  is_active: boolean;
};

const INITIAL_NEW_PRODUCT_FORM: NewProductForm = {
  product_name: "",
  material_category: "raw_material",
  material_id: "",
  bom_qty: "",
  unit: "g",
  is_active: true,
};

export default function HarangProductBomPage() {
  const { profile, loading } = useAuth();
  const [rows, setRows] = useState<HarangBomRow[]>([]);
  const [materials, setMaterials] = useState<HarangMasterItem[]>([]);
  const [packagingMaterials, setPackagingMaterials] = useState<HarangMasterItem[]>([]);
  const [query, setQuery] = useState("");
  const [newProductForm, setNewProductForm] = useState<NewProductForm>(INITIAL_NEW_PRODUCT_FORM);
  const [editingProductName, setEditingProductName] = useState<string | null>(null);
  const [draftLines, setDraftLines] = useState<ProductDraftLine[]>([]);
  const [newLine, setNewLine] = useState({
    material_category: "raw_material" as MaterialCategory,
    material_id: "",
    bom_qty: "",
    unit: "g",
    is_active: true,
  });
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const isAdmin = profile?.role === "admin";

  const loadAll = useCallback(async () => {
    setFetching(true);
    const [materialsRes, packagingRes, rowsRes] = await Promise.all([
      supabase
        .from("harang_raw_materials")
        .select("id, item_code, item_name, default_unit, is_active, note, created_at, updated_at")
        .order("item_name", { ascending: true }),
      supabase
        .from("harang_packaging_materials")
        .select("id, item_code, item_name, default_unit, is_active, note, created_at, updated_at")
        .order("item_name", { ascending: true }),
      supabase
        .from("harang_product_bom")
        .select("id, product_name, material_category, material_id, material_code, material_name, bom_qty, unit, is_active, created_at, updated_at")
        .order("product_name", { ascending: true })
        .order("material_name", { ascending: true }),
    ]);
    setFetching(false);

    if (materialsRes.error) return alert(materialsRes.error.message);
    if (packagingRes.error) return alert(packagingRes.error.message);
    if (rowsRes.error) return alert(rowsRes.error.message);
    setMaterials((materialsRes.data ?? []) as HarangMasterItem[]);
    setPackagingMaterials((packagingRes.data ?? []) as HarangMasterItem[]);
    setRows((rowsRes.data ?? []) as HarangBomRow[]);
  }, []);

  useEffect(() => {
    if (!loading) void loadAll();
  }, [loading, loadAll]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.product_name, row.material_code, row.material_name, row.unit].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [rows, query]);

  const groupedProducts = useMemo(() => {
    const map = new Map<string, HarangBomRow[]>();
    for (const row of filteredRows) {
      const list = map.get(row.product_name) ?? [];
      list.push(row);
      map.set(row.product_name, list);
    }
    return Array.from(map.entries())
      .map(([product_name, lines]) => ({
        product_name,
        lines: lines.sort((a, b) => a.material_name.localeCompare(b.material_name, "ko-KR")),
        material_count: lines.length,
      }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name, "ko-KR"));
  }, [filteredRows]);

  const activeRawMaterials = useMemo(
    () => materials.filter((item) => item.is_active),
    [materials],
  );
  const activePackagingMaterials = useMemo(
    () => packagingMaterials.filter((item) => item.is_active),
    [packagingMaterials],
  );

  const getMaterialsByCategory = useCallback(
    (category: MaterialCategory) => (category === "raw_material" ? activeRawMaterials : activePackagingMaterials),
    [activeRawMaterials, activePackagingMaterials],
  );

  const selectedNewProductMaterial = useMemo(
    () => getMaterialsByCategory(newProductForm.material_category).find((item) => item.id === newProductForm.material_id) ?? null,
    [getMaterialsByCategory, newProductForm.material_category, newProductForm.material_id],
  );

  useEffect(() => {
    const fixedUnit = newProductForm.material_category === "raw_material" ? "g" : "EA";
    if (newProductForm.unit !== fixedUnit) {
      setNewProductForm((prev) => ({ ...prev, unit: fixedUnit }));
    }
  }, [newProductForm.material_category, newProductForm.unit]);

  const selectedNewLineMaterial = useMemo(
    () => getMaterialsByCategory(newLine.material_category).find((item) => item.id === newLine.material_id) ?? null,
    [getMaterialsByCategory, newLine.material_category, newLine.material_id],
  );

  useEffect(() => {
    const fixedUnit = newLine.material_category === "raw_material" ? "g" : "EA";
    if (newLine.unit !== fixedUnit) {
      setNewLine((prev) => ({ ...prev, unit: fixedUnit }));
    }
  }, [newLine.material_category, newLine.unit]);

  const quickAddMaterialOptions = useMemo(
    () => getMaterialsByCategory(newProductForm.material_category),
    [getMaterialsByCategory, newProductForm.material_category],
  );

  const handleAddSingleLine = async () => {
    const productName = newProductForm.product_name.trim();
    const qty = Number(newProductForm.bom_qty);
    if (!productName || !newProductForm.material_id || !Number.isFinite(qty) || qty < 0 || !newProductForm.unit.trim()) {
      alert("제품명, 원료, BOM 수량, 단위를 확인해 주세요.");
      return;
    }
    const material = quickAddMaterialOptions.find((item) => item.id === newProductForm.material_id);
    if (!material) return alert("원부자재 정보를 찾을 수 없습니다.");
    setSaving(true);
    const { error } = await supabase.from("harang_product_bom").insert({
      product_name: productName,
      material_category: newProductForm.material_category,
      material_id: material.id,
      material_code: material.item_code,
      material_name: material.item_name,
      bom_qty: qty,
      unit: newProductForm.material_category === "raw_material" ? "g" : "EA",
      is_active: newProductForm.is_active,
    });
    setSaving(false);
    if (error) return alert(error.message);
    await loadAll();
    setNewProductForm(INITIAL_NEW_PRODUCT_FORM);
  };

  const handleDeleteProduct = async (productName: string) => {
    if (!confirm(`'${productName}' 제품 BOM 전체를 삭제할까요?`)) return;
    const { error } = await supabase.from("harang_product_bom").delete().eq("product_name", productName);
    if (error) return alert(error.message);
    if (editingProductName === productName) {
      setEditingProductName(null);
      setDraftLines([]);
    }
    await loadAll();
  };

  const openProductEditor = (productName: string) => {
    const lines = rows
      .filter((row) => row.product_name === productName)
      .sort((a, b) => a.material_name.localeCompare(b.material_name, "ko-KR"))
      .map((row) => ({
        key: row.id,
        id: row.id,
        material_category: (row.material_category ?? "raw_material") as MaterialCategory,
        material_id: row.material_id,
        material_code: row.material_code,
        material_name: row.material_name,
        bom_qty: String(row.bom_qty),
        unit: row.unit,
        is_active: row.is_active,
      }));
    setEditingProductName(productName);
    setDraftLines(lines);
    setNewLine({ material_category: "raw_material", material_id: "", bom_qty: "", unit: "g", is_active: true });
  };

  const updateDraftLine = (key: string, patch: Partial<ProductDraftLine>) => {
    setDraftLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeDraftLine = (key: string) => {
    setDraftLines((prev) => prev.filter((line) => line.key !== key));
  };

  const handleAddNewDraftLine = () => {
    if (!editingProductName) return;
    const qty = Number(newLine.bom_qty);
    if (!newLine.material_id || !Number.isFinite(qty) || qty < 0 || !newLine.unit.trim()) {
      alert("추가할 원부자재의 분류/원부자재/수량/단위를 확인해 주세요.");
      return;
    }
    const source = getMaterialsByCategory(newLine.material_category);
    const material = source.find((item) => item.id === newLine.material_id);
    if (!material) return alert("원부자재 정보를 찾을 수 없습니다.");
    if (draftLines.some((line) => line.material_id === material.id && line.material_category === newLine.material_category)) {
      alert("같은 원부자재가 이미 등록되어 있습니다.");
      return;
    }
    setDraftLines((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        id: null,
        material_category: newLine.material_category,
        material_id: material.id,
        material_code: material.item_code,
        material_name: material.item_name,
        bom_qty: String(qty),
        unit: newLine.material_category === "raw_material" ? "g" : "EA",
        is_active: newLine.is_active,
      },
    ]);
    setNewLine({ material_category: newLine.material_category, material_id: "", bom_qty: "", unit: newLine.material_category === "raw_material" ? "g" : "EA", is_active: true });
  };

  const selectableMaterialsForNewLine = useMemo(
    () =>
      getMaterialsByCategory(newLine.material_category)
        .filter(
          (material) =>
            !draftLines.some(
              (line) => line.material_id === material.id && line.material_category === newLine.material_category,
            ),
        )
        .sort((a, b) => a.item_name.localeCompare(b.item_name, "ko-KR")),
    [getMaterialsByCategory, newLine.material_category, draftLines],
  );

  const handleSaveProductEditor = async () => {
    if (!editingProductName) return;
    if (draftLines.length === 0) {
      alert("원재료 라인이 최소 1개 이상 필요합니다.");
      return;
    }
    for (const line of draftLines) {
      const qty = Number(line.bom_qty);
      if (!line.material_id || !Number.isFinite(qty) || qty < 0 || !line.unit.trim()) {
        alert("라인의 원료/수량/단위를 확인해 주세요.");
        return;
      }
    }

    setSaving(true);
    try {
      const existingRows = rows.filter((row) => row.product_name === editingProductName);
      const existingIds = new Set(existingRows.map((row) => row.id));
      const keptIds = new Set(draftLines.filter((line) => line.id).map((line) => line.id as string));
      const deleteIds = Array.from(existingIds).filter((id) => !keptIds.has(id));
      if (deleteIds.length > 0) {
        const { error } = await supabase.from("harang_product_bom").delete().in("id", deleteIds);
        if (error) throw error;
      }

      for (const line of draftLines) {
        const payload = {
          product_name: editingProductName,
          material_category: line.material_category,
          material_id: line.material_id,
          material_code: line.material_code,
          material_name: line.material_name,
          bom_qty: Number(line.bom_qty),
          unit: line.material_category === "raw_material" ? "g" : "EA",
          is_active: line.is_active,
        };
        if (line.id) {
          const { error } = await supabase.from("harang_product_bom").update(payload).eq("id", line.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("harang_product_bom").insert(payload);
          if (error) throw error;
        }
      }

      await loadAll();
      setEditingProductName(null);
      setDraftLines([]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="px-6 py-10 text-slate-500">로딩 중...</div>;
  if (!isAdmin) return <div className="px-6 py-10 text-slate-600">관리자만 접근할 수 있습니다.</div>;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">하랑 제품 BOM 마스터</h1>
          <p className="mt-1 text-sm text-slate-600">제품 1개 기준으로 하랑 원부자재 BOM 라인을 관리합니다.</p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">BOM 라인 빠른 추가</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              value={newProductForm.product_name}
              onChange={(e) => setNewProductForm((prev) => ({ ...prev, product_name: e.target.value }))}
              placeholder="제품명"
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
            <select
              value={newProductForm.material_category}
              onChange={(e) =>
                setNewProductForm((prev) => ({
                  ...prev,
                  material_category: e.target.value as MaterialCategory,
                  material_id: "",
                  unit: e.target.value === "raw_material" ? "g" : "EA",
                }))
              }
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            >
              <option value="raw_material">원재료</option>
              <option value="packaging_material">부자재</option>
            </select>
            <select
              value={newProductForm.material_id}
              onChange={(e) => {
                const material = quickAddMaterialOptions.find((item) => item.id === e.target.value);
                setNewProductForm((prev) => ({
                  ...prev,
                  material_id: e.target.value,
                  unit: prev.material_category === "raw_material" ? "g" : "EA",
                }));
              }}
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            >
              <option value="">{newProductForm.material_category === "raw_material" ? "원재료 선택" : "부자재 선택"}</option>
              {quickAddMaterialOptions.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.item_name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.001"
              min="0"
              value={newProductForm.bom_qty}
              onChange={(e) => setNewProductForm((prev) => ({ ...prev, bom_qty: e.target.value }))}
              placeholder="BOM 수량"
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
            <input
              value={newProductForm.unit}
              readOnly
              placeholder="단위"
              className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-700 text-sm"
            />
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={newProductForm.is_active}
                onChange={(e) => setNewProductForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              사용중
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleAddSingleLine}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm disabled:opacity-60"
            >
              라인 추가
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-slate-800">제품별 BOM 목록</h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="제품명/원료명 검색"
              className="w-full sm:w-72 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left">제품명</th>
                  <th className="px-3 py-2 text-right">원재료개수</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {fetching && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                      불러오는 중...
                    </td>
                  </tr>
                )}
                {!fetching && groupedProducts.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                      등록된 BOM이 없습니다.
                    </td>
                  </tr>
                )}
                {!fetching &&
                  groupedProducts.map((product) => (
                    <tr key={product.product_name} className="border-b border-slate-100 text-slate-900">
                      <td className="px-3 py-2">{product.product_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{product.material_count}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openProductEditor(product.product_name)}
                            className="px-3 py-1.5 rounded border border-cyan-600/60 text-cyan-300 text-xs"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProduct(product.product_name)}
                            className="px-3 py-1.5 rounded border border-red-700/60 text-red-300 text-xs"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        {editingProductName && (
          <section className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{editingProductName}</h2>
                <p className="text-xs text-slate-600">원재료 라인을 수정하고, 새 원재료를 추가할 수 있습니다.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingProductName(null);
                  setDraftLines([]);
                }}
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 text-xs bg-white"
              >
                닫기
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-2 py-2 text-left">분류</th>
                  <th className="px-2 py-2 text-left">원부자재명</th>
                    <th className="px-2 py-2 text-right">BOM 수량</th>
                    <th className="px-2 py-2 text-left">단위</th>
                    <th className="px-2 py-2 text-left">사용여부</th>
                    <th className="px-2 py-2 text-right">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {draftLines.map((line) => (
                    <tr key={line.key} className="border-b border-slate-100 text-slate-900">
                      <td className="px-2 py-2">{line.material_category === "raw_material" ? "원재료" : "부자재"}</td>
                      <td className="px-2 py-2">{line.material_name}</td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={line.bom_qty}
                          onChange={(e) => updateDraftLine(line.key, { bom_qty: e.target.value })}
                          className="w-28 px-2 py-1.5 rounded border border-slate-300 bg-white text-right"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={line.unit}
                          readOnly
                          className="w-20 px-2 py-1.5 rounded border border-slate-300 bg-slate-50 text-slate-700"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={line.is_active}
                            onChange={(e) => updateDraftLine(line.key, { is_active: e.target.checked })}
                          />
                          사용
                        </label>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeDraftLine(line.key)}
                          className="px-2 py-1 rounded border border-red-300 text-red-500 text-xs bg-white"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold text-slate-700 mb-2">원부자재 라인 추가</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <select
                  value={newLine.material_category}
                  onChange={(e) => {
                    setNewLine((prev) => ({
                      ...prev,
                      material_category: e.target.value as MaterialCategory,
                      material_id: "",
                      unit: e.target.value === "raw_material" ? "g" : "EA",
                    }));
                  }}
                  className="harang-bom-select px-2 py-1.5 rounded border border-slate-300 bg-white text-slate-900"
                >
                  <option value="raw_material">원재료</option>
                  <option value="packaging_material">부자재</option>
                </select>
                <select
                  value={newLine.material_id}
                  onChange={(e) => {
                    setNewLine((prev) => ({
                      ...prev,
                      material_id: e.target.value,
                    }));
                  }}
                  className="harang-bom-select px-2 py-1.5 rounded border border-slate-300 bg-white text-slate-900"
                >
                  <option value="">{newLine.material_category === "raw_material" ? "원재료 선택" : "부자재 선택"}</option>
                  {selectableMaterialsForNewLine.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.item_name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={newLine.bom_qty}
                  onChange={(e) => setNewLine((prev) => ({ ...prev, bom_qty: e.target.value }))}
                  placeholder="BOM 수량"
                  className="px-2 py-1.5 rounded border border-slate-300 bg-white"
                />
                <input
                  value={newLine.unit}
                  readOnly
                  placeholder="단위"
                  className="px-2 py-1.5 rounded border border-slate-300 bg-slate-50 text-slate-700"
                />
                <button
                  type="button"
                  onClick={handleAddNewDraftLine}
                  className="px-3 py-1.5 rounded bg-cyan-500 text-white text-sm"
                >
                  원부자재 추가
                </button>
              </div>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingProductName(null);
                  setDraftLines([]);
                }}
                className="px-3 py-2 rounded border border-slate-300 text-slate-700 text-sm bg-white"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveProductEditor}
                disabled={saving}
                className="px-4 py-2 rounded bg-cyan-600 text-white text-sm font-medium disabled:opacity-60"
              >
                수정 저장
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
