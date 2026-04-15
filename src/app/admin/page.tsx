"use client";

import { useState, useMemo, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMasterStore, type DoughBom } from "@/store/useMasterStore";
import type { Material, BomRow, PlanningSubmaterialRow, PlanningSubmaterialItem } from "@/lib/mockData";
import { supabase } from "@/lib/supabase";

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

type TabId = "materials" | "submaterials" | "bom" | "planningSubmaterial" | "doughBom";

const DEFAULT_BOM_VARIANTS = ["일반", "미니", "파베이크사용", "브레드"] as const;

function splitBomProductName(value: string): { baseName: string; variant: string } {
  const raw = String(value ?? "").trim();
  const i = raw.indexOf("-");
  if (i < 0) return { baseName: raw, variant: "" };
  return {
    baseName: raw.slice(0, i).trim(),
    variant: raw.slice(i + 1).trim(),
  };
}

function composeBomProductName(baseName: string, variant: string): string {
  const base = String(baseName ?? "").trim();
  const v = String(variant ?? "").trim();
  if (!base) return "";
  if (!v) return base;
  return `${base} - ${v}`;
}

/** 레시피(제품) 단위 통합 관리 모달: 원료 추가·수정·삭제 */
function RecipeManageModal({
  productName,
  rows,
  materialNameOptions,
  isSaving,
  onClose,
  onAddBomRows,
  onUpdateBomRow,
  onDeleteBomRow,
}: {
  productName: string;
  rows: BomRow[];
  materialNameOptions: string[];
  isSaving: boolean;
  onClose: () => void;
  onAddBomRows: (rows: Omit<BomRow, "id">[]) => Promise<void>;
  onUpdateBomRow: (id: string, patch: Partial<Omit<BomRow, "id">>) => Promise<void>;
  onDeleteBomRow: (id: string) => Promise<void>;
}) {
  const [newMaterial, setNewMaterial] = useState("");
  const [newBomG, setNewBomG] = useState("");
  const [newBasis, setNewBasis] = useState<"완제품" | "도우">("완제품");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBomG, setEditBomG] = useState("");
  const [editBasis, setEditBasis] = useState<"완제품" | "도우">("완제품");

  const handleAddOne = async (e: React.FormEvent) => {
    e.preventDefault();
    const materialName = newMaterial.trim();
    const bomGPerEa = parseFloat(newBomG);
    if (!materialName || !Number.isFinite(bomGPerEa) || bomGPerEa < 0) {
      alert("원료를 선택하고 BOM(g)을 입력해 주세요.");
      return;
    }
    if (rows.some((r) => r.materialName === materialName && r.basis === newBasis)) {
      alert("이미 같은 원료·기준 조합이 있습니다.");
      return;
    }
    try {
      await onAddBomRows([{ productName, materialName, bomGPerEa, basis: newBasis }]);
      setNewMaterial("");
      setNewBomG("");
      setNewBasis("완제품");
    } catch {
      alert("추가에 실패했습니다.");
    }
  };

  const startEdit = (row: BomRow) => {
    setEditingId(row.id);
    setEditBomG(String(row.bomGPerEa));
    setEditBasis(row.basis);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const bomGPerEa = parseFloat(editBomG);
    if (!Number.isFinite(bomGPerEa) || bomGPerEa < 0) {
      alert("올바른 BOM(g)을 입력해 주세요.");
      return;
    }
    try {
      await onUpdateBomRow(editingId, { bomGPerEa, basis: editBasis });
      setEditingId(null);
    } catch {
      alert("수정에 실패했습니다.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 원료를 레시피에서 삭제하시겠습니까?")) return;
    try {
      await onDeleteBomRow(id);
      if (editingId === id) setEditingId(null);
    } catch {
      alert("삭제에 실패했습니다.");
    }
  };

  const sortedRows = [...rows].sort((a, b) =>
    (a.materialName ?? "").localeCompare(b.materialName ?? "", "ko")
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-space-800 rounded-2xl border border-cyan-500/30 shadow-glow max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-space-700 to-space-800 border-b border-cyan-500/30 text-slate-100 px-4 py-3 flex items-center justify-between gap-2 shrink-0 rounded-t-2xl">
          <span className="font-bold text-base">{productName}</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 bg-space-800">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">기존 원료</h3>
          {sortedRows.length === 0 ? (
            <p className="text-slate-500 text-sm py-2">등록된 원료가 없습니다. 아래에서 추가하세요.</p>
          ) : (
            <ul className="space-y-2 mb-6">
              {sortedRows.map((row) => (
                <li key={row.id} className="flex items-center gap-2 p-3 rounded-xl border border-slate-600 bg-space-900/80">
                  {editingId === row.id ? (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate">{row.materialName}</p>
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          <input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            step="0.01"
                            value={editBomG}
                            onChange={(e) => setEditBomG(e.target.value)}
                            className="w-20 px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                          />
                          <select
                            value={editBasis}
                            onChange={(e) => setEditBasis(e.target.value as "완제품" | "도우")}
                            className="px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                          >
                            <option value="완제품">완제품</option>
                            <option value="도우">도우</option>
                          </select>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={isSaving}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 disabled:opacity-50"
                      >
                        저장
                      </button>
                      <button type="button" onClick={cancelEdit} className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-sm font-medium hover:bg-slate-700/50">
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-100">{row.materialName}</p>
                        <p className="text-sm text-slate-500">기준: {row.basis} · {row.bomGPerEa}g/ea</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          disabled={isSaving}
                          className="p-1.5 rounded text-slate-400 hover:bg-slate-700 hover:text-cyan-400 disabled:opacity-50"
                          title="수정"
                          aria-label="수정"
                        >
                          <PencilIcon className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row.id)}
                          disabled={isSaving}
                          className="p-1.5 rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400 disabled:opacity-50"
                          title="삭제"
                          aria-label="삭제"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 className="text-sm font-semibold text-slate-300 mb-2">원료 추가</h3>
          <form onSubmit={handleAddOne} className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-medium text-slate-400 mb-0.5">원료</label>
                <select
                  value={newMaterial}
                  onChange={(e) => setNewMaterial(e.target.value)}
                  className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 text-sm"
                >
                  <option value="">선택</option>
                  {materialNameOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="w-24">
                <label className="block text-xs font-medium text-slate-400 mb-0.5">BOM(g)</label>
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  step="0.01"
                  value={newBomG}
                  onChange={(e) => setNewBomG(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 text-sm tabular-nums"
                />
              </div>
              <div className="w-28">
                <label className="block text-xs font-medium text-slate-400 mb-0.5">기준</label>
                <select
                  value={newBasis}
                  onChange={(e) => setNewBasis(e.target.value as "완제품" | "도우")}
                  className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 text-sm"
                >
                  <option value="완제품">완제품</option>
                  <option value="도우">도우</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

interface RecipeRow {
  id: string;
  materialName: string;
  bomGPerEa: string;
  basis: "완제품" | "도우";
}

type EditingMaterialState = {
  id: string;
  materialName: string;
  boxWeightG: string;
  unitWeightG: string;
  inventoryItemCode: string;
};

export default function AdminPage() {
  const {
    materials,
    planningSubmaterialItems,
    bomList,
    planningSubmaterials,
    doughBoms,
    materialsLoading,
    planningSubmaterialItemsLoading,
    bomLoading,
    planningSubmaterialsLoading,
    doughBomsLoading,
    saving,
    error,
    fetchMaterials,
    fetchPlanningSubmaterialItems,
    fetchBom,
    fetchPlanningSubmaterials,
    fetchDoughBoms,
    addMaterial,
    updateMaterial,
    deleteMaterial,
    addPlanningSubmaterialItem,
    updatePlanningSubmaterialItem,
    deletePlanningSubmaterialItem,
    addBomRows,
    updateBomRow,
    deleteBomRow,
    addPlanningSubmaterialRows,
    updatePlanningSubmaterialRow,
    deletePlanningSubmaterialRow,
    addDoughBom,
    updateDoughBom,
    deleteDoughBom,
  } = useMasterStore();
  const [activeTab, setActiveTab] = useState<TabId>("materials");

  useEffect(() => {
    fetchMaterials();
    fetchPlanningSubmaterialItems();
    fetchBom();
    fetchPlanningSubmaterials();
    fetchDoughBoms();
  }, [fetchMaterials, fetchPlanningSubmaterialItems, fetchBom, fetchPlanningSubmaterials, fetchDoughBoms]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("ecount_item_master")
        .select("item_code, item_name")
        .eq("inventory_type", "원재료")
        .eq("is_active", true)
        .order("item_code", { ascending: true });
      if (cancelled || error) return;
      const rows = (data ?? []) as { item_code: string | null; item_name: string | null }[];
      setEcountItemCodeOptions(
        rows
          .map((r) => ({
            itemCode: String(r.item_code ?? "").trim(),
            itemName: String(r.item_name ?? "").trim(),
          }))
          .filter((r) => r.itemCode !== "")
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [materialForm, setMaterialForm] = useState({
    materialName: "",
    boxWeightG: "",
    unitWeightG: "",
    inventoryItemCode: "",
  });
  const [submaterialItemForm, setSubmaterialItemForm] = useState({
    submaterialName: "",
    inventoryItemCode: "",
  });
  const [editingMaterial, setEditingMaterial] = useState<EditingMaterialState | null>(null);
  const [editingSubmaterialItem, setEditingSubmaterialItem] = useState<{
    id: string;
    submaterialName: string;
    inventoryItemCode: string;
  } | null>(null);
  const [ecountItemCodeOptions, setEcountItemCodeOptions] = useState<{ itemCode: string; itemName: string }[]>([]);

  const [bomBaseName, setBomBaseName] = useState("");
  const [bomVariant, setBomVariant] = useState("");
  const [isAddingCustomVariant, setIsAddingCustomVariant] = useState(false);
  const [customVariant, setCustomVariant] = useState("");
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([{ id: "r0", materialName: "", bomGPerEa: "", basis: "완제품" }]);
  const [editingBomId, setEditingBomId] = useState<string | null>(null);
  /** 레시피 통합 관리 모달: 열린 제품명 (null이면 닫힘) */
  const [recipeModalProductName, setRecipeModalProductName] = useState<string | null>(null);
  /** 등록된 BOM 목록 아코디언: 제품별 펼침/접힘 (기본 모두 접힘) */
  const [expandedBoms, setExpandedBoms] = useState<Record<string, boolean>>({});
  const [planningSubmaterialForm, setPlanningSubmaterialForm] = useState({
    productNameSnapshot: "",
    materialName: "",
    qtyGPerEa: "",
    active: true,
  });
  const [editingPlanningSubmaterialId, setEditingPlanningSubmaterialId] = useState<string | null>(null);

  const [doughBomForm, setDoughBomForm] = useState({
    name: "",
    qtyPerBag: "",
    salt: "",
    yeast: "",
    oil: "",
    sugar: "",
    improver: "",
  });
  const [editingDoughBomId, setEditingDoughBomId] = useState<string | null>(null);

  const materialNameOptions = useMemo(() => materials.map((m) => m.materialName), [materials]);
  const submaterialNameOptions = useMemo(
    () => planningSubmaterialItems.filter((x) => x.active).map((x) => x.submaterialName).sort((a, b) => a.localeCompare(b, "ko")),
    [planningSubmaterialItems]
  );
  const bomBaseNameOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of bomList) {
      const { baseName } = splitBomProductName(row.productName);
      if (baseName) set.add(baseName);
    }
    return Array.from(set).sort();
  }, [bomList]);

  const bomVariantOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_BOM_VARIANTS);
    const base = bomBaseName.trim();
    if (base) {
      for (const row of bomList) {
        const parsed = splitBomProductName(row.productName);
        if (parsed.baseName === base && parsed.variant) {
          set.add(parsed.variant);
        }
      }
    } else {
      for (const row of bomList) {
        const parsed = splitBomProductName(row.productName);
        if (parsed.variant) set.add(parsed.variant);
      }
    }
    return Array.from(set).sort();
  }, [bomList, bomBaseName]);
  const planningProductSnapshotOptions = useMemo(
    () => Array.from(new Set(bomList.map((x) => x.productName).filter((x) => x.trim().length > 0))).sort((a, b) => a.localeCompare(b, "ko")),
    [bomList]
  );

  const addRecipeRow = () => {
    setRecipeRows((prev) => [...prev, { id: `r-${Date.now()}`, materialName: "", bomGPerEa: "", basis: "완제품" }]);
  };

  const removeRecipeRow = (id: string) => {
    setRecipeRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length === 0 ? [{ id: `r-${Date.now()}`, materialName: "", bomGPerEa: "", basis: "완제품" }] : next;
    });
  };

  const updateRecipeRow = (id: string, field: keyof RecipeRow, value: string) => {
    setRecipeRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: field === "basis" ? (value as "완제품" | "도우") : value } : r))
    );
  };

  const clearMaterialForm = () => {
    setMaterialForm({ materialName: "", boxWeightG: "", unitWeightG: "", inventoryItemCode: "" });
  };
  const clearSubmaterialItemForm = () => {
    setSubmaterialItemForm({ submaterialName: "", inventoryItemCode: "" });
  };

  const handleAddMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = materialForm.materialName.trim();
    const box = parseInt(materialForm.boxWeightG, 10) || 0;
    const unit = parseInt(materialForm.unitWeightG, 10) || 0;
    if (!name) {
      alert("원료명을 입력해 주세요.");
      return;
    }
    try {
      await addMaterial({
        materialName: name,
        boxWeightG: box,
        unitWeightG: unit,
        inventoryItemCode: materialForm.inventoryItemCode.trim() || undefined,
      });
      setMaterialForm({ materialName: "", boxWeightG: "", unitWeightG: "", inventoryItemCode: "" });
    } catch {
      alert("저장에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const handleEditMaterial = (m: Material) => {
    setEditingMaterial({
      id: m.id,
      materialName: m.materialName,
      boxWeightG: m.boxWeightG > 0 ? String(m.boxWeightG) : "",
      unitWeightG: m.unitWeightG > 0 ? String(m.unitWeightG) : "",
      inventoryItemCode: m.inventoryItemCode ?? "",
    });
  };

  const handleSaveEditingMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMaterial) return;
    const name = editingMaterial.materialName.trim();
    const box = parseInt(editingMaterial.boxWeightG, 10) || 0;
    const unit = parseInt(editingMaterial.unitWeightG, 10) || 0;
    if (!name) {
      alert("원료명을 입력해 주세요.");
      return;
    }
    try {
      await updateMaterial(editingMaterial.id, {
        materialName: name,
        boxWeightG: box,
        unitWeightG: unit,
        inventoryItemCode: editingMaterial.inventoryItemCode.trim() || undefined,
      });
      setEditingMaterial(null);
    } catch {
      alert("수정에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await deleteMaterial(id);
      if (editingMaterial?.id === id) setEditingMaterial(null);
    } catch {
      alert("삭제에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const handleAddSubmaterialItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = submaterialItemForm.submaterialName.trim();
    if (!name) {
      alert("부자재명을 입력해 주세요.");
      return;
    }
    try {
      await addPlanningSubmaterialItem({
        submaterialName: name,
        boxWeightG: 0,
        unitWeightG: 0,
        inventoryItemCode: submaterialItemForm.inventoryItemCode.trim() || undefined,
        active: true,
      });
      clearSubmaterialItemForm();
    } catch {
      alert("저장에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const handleEditSubmaterialItem = (item: PlanningSubmaterialItem) => {
    setEditingSubmaterialItem({
      id: item.id,
      submaterialName: item.submaterialName,
      inventoryItemCode: item.inventoryItemCode ?? "",
    });
  };

  const handleSaveEditingSubmaterialItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubmaterialItem) return;
    const name = editingSubmaterialItem.submaterialName.trim();
    if (!name) {
      alert("부자재명을 입력해 주세요.");
      return;
    }
    try {
      await updatePlanningSubmaterialItem(editingSubmaterialItem.id, {
        submaterialName: name,
        boxWeightG: 0,
        unitWeightG: 0,
        inventoryItemCode: editingSubmaterialItem.inventoryItemCode.trim() || undefined,
      });
      setEditingSubmaterialItem(null);
    } catch {
      alert("수정에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const handleDeleteSubmaterialItem = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await deletePlanningSubmaterialItem(id);
      if (editingSubmaterialItem?.id === id) setEditingSubmaterialItem(null);
    } catch {
      alert("삭제에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const clearBomForm = () => {
    setBomBaseName("");
    setBomVariant("");
    setIsAddingCustomVariant(false);
    setCustomVariant("");
    setRecipeRows([{ id: `r-${Date.now()}`, materialName: "", bomGPerEa: "", basis: "완제품" }]);
    setEditingBomId(null);
  };

  const clearPlanningSubmaterialForm = () => {
    setPlanningSubmaterialForm({ productNameSnapshot: "", materialName: "", qtyGPerEa: "", active: true });
    setEditingPlanningSubmaterialId(null);
  };

  const handleSubmitPlanningSubmaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    const productNameSnapshot = planningSubmaterialForm.productNameSnapshot.trim();
    const materialName = planningSubmaterialForm.materialName.trim();
    const qty = parseFloat(planningSubmaterialForm.qtyGPerEa);
    if (!productNameSnapshot || !materialName || !Number.isFinite(qty) || qty < 0) {
      alert("제품 스냅샷·부자재·소요(낱개)를 올바르게 입력해 주세요.");
      return;
    }
    try {
      if (editingPlanningSubmaterialId) {
        await updatePlanningSubmaterialRow(editingPlanningSubmaterialId, {
          productNameSnapshot,
          materialName,
          qtyGPerEa: qty,
          active: planningSubmaterialForm.active,
        });
      } else {
        await addPlanningSubmaterialRows([
          {
            productNameSnapshot,
            materialName,
            qtyGPerEa: qty,
            active: planningSubmaterialForm.active,
          },
        ]);
      }
      clearPlanningSubmaterialForm();
    } catch {
      alert("플래닝 부자재 저장에 실패했습니다.");
    }
  };

  const handleEditPlanningSubmaterial = (row: PlanningSubmaterialRow) => {
    setEditingPlanningSubmaterialId(row.id);
    setPlanningSubmaterialForm({
      productNameSnapshot: row.productNameSnapshot,
      materialName: row.materialName,
      qtyGPerEa: String(row.qtyGPerEa),
      active: row.active,
    });
  };

  const handleDeletePlanningSubmaterial = async (id: string) => {
    if (!confirm("플래닝 부자재를 삭제하시겠습니까?")) return;
    try {
      await deletePlanningSubmaterialRow(id);
      if (editingPlanningSubmaterialId === id) clearPlanningSubmaterialForm();
    } catch {
      alert("플래닝 부자재 삭제에 실패했습니다.");
    }
  };

  const handleSubmitRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    const base = bomBaseName.trim();
    const variant = (isAddingCustomVariant ? customVariant : bomVariant).trim();
    if (!base || !variant) {
      alert("제품명과 기준(규격)을 모두 입력해 주세요.");
      return;
    }
    const product = composeBomProductName(base, variant);
    const validRows = recipeRows.filter(
      (r) => r.materialName.trim() !== "" && r.bomGPerEa.trim() !== "" && Number.isFinite(parseFloat(r.bomGPerEa))
    );
    if (validRows.length === 0) {
      alert("원료를 1개 이상 입력해 주세요.");
      return;
    }
    try {
      if (editingBomId) {
        const single = validRows[0];
        await updateBomRow(editingBomId, {
          productName: product,
          materialName: single.materialName,
          bomGPerEa: parseFloat(single.bomGPerEa),
          basis: single.basis,
        });
        clearBomForm();
      } else {
        await addBomRows(
          validRows.map((r) => ({
            productName: product,
            materialName: r.materialName,
            bomGPerEa: parseFloat(r.bomGPerEa),
            basis: r.basis,
          }))
        );
        setBomBaseName("");
        setBomVariant("");
        setIsAddingCustomVariant(false);
        setCustomVariant("");
        setRecipeRows([{ id: `r-${Date.now()}`, materialName: "", bomGPerEa: "", basis: "완제품" }]);
      }
    } catch {
      alert("저장에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const handleEditBom = (row: BomRow) => {
    const parsed = splitBomProductName(row.productName);
    const knownVariant = bomVariantOptions.includes(parsed.variant);
    setEditingBomId(row.id);
    setBomBaseName(parsed.baseName);
    setBomVariant(knownVariant ? parsed.variant : "");
    setIsAddingCustomVariant(Boolean(parsed.variant) && !knownVariant);
    setCustomVariant(!knownVariant ? parsed.variant : "");
    setRecipeRows([
      { id: "r-edit", materialName: row.materialName, bomGPerEa: String(row.bomGPerEa), basis: row.basis },
    ]);
  };

  const handleDeleteBom = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await deleteBomRow(id);
      if (editingBomId === id) clearBomForm();
    } catch {
      alert("삭제에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const clearDoughBomForm = () => {
    setDoughBomForm({ name: "", qtyPerBag: "", salt: "", yeast: "", oil: "", sugar: "", improver: "" });
    setEditingDoughBomId(null);
  };

  const handleSubmitDoughBom = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = doughBomForm.name.trim();
    const qtyPerBag = parseInt(doughBomForm.qtyPerBag, 10);
    const salt = parseFloat(doughBomForm.salt);
    const yeast = parseFloat(doughBomForm.yeast);
    const oil = parseFloat(doughBomForm.oil);
    const sugar = parseFloat(doughBomForm.sugar);
    const improver = parseFloat(doughBomForm.improver);
    const saltNum = Number.isNaN(salt) ? 0 : salt;
    const yeastNum = Number.isNaN(yeast) ? 0 : yeast;
    const oilNum = Number.isNaN(oil) ? 0 : oil;
    const sugarNum = Number.isNaN(sugar) ? 0 : sugar;
    const improverNum = Number.isNaN(improver) ? 0 : improver;
    if (!name) {
      alert("도우 명칭을 입력해 주세요.");
      return;
    }
    if (Number.isNaN(qtyPerBag) || qtyPerBag <= 0) {
      alert("1포대당 생산 수량(개)을 1 이상의 숫자로 입력해 주세요.");
      return;
    }
    try {
      if (editingDoughBomId) {
        await updateDoughBom(editingDoughBomId, { name, qtyPerBag, salt: saltNum, yeast: yeastNum, oil: oilNum, sugar: sugarNum, improver: improverNum });
        clearDoughBomForm();
      } else {
        await addDoughBom({ name, qtyPerBag, salt: saltNum, yeast: yeastNum, oil: oilNum, sugar: sugarNum, improver: improverNum });
        setDoughBomForm({ name: "", qtyPerBag: "", salt: "", yeast: "", oil: "", sugar: "", improver: "" });
      }
    } catch (err) {
      const detail =
        err instanceof Error
          ? err.message
          : err != null && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
      const hint =
        /qty_per_bag|does not exist|column.*not exist/i.test(detail)
          ? "\n\n→ Supabase에 add_dough_boms_qty_per_bag.sql 마이그레이션을 적용했는지 확인해 주세요."
          : "";
      console.error("[도우 BOM 등록 실패]", {
        name,
        qtyPerBag,
        salt: saltNum,
        yeast: yeastNum,
        oil: oilNum,
        sugar: sugarNum,
        improver: improverNum,
        error: detail,
        raw: err,
      });
      alert(`저장에 실패했습니다.\n\n상세: ${detail}${hint}\n\n(개발자 도구 콘솔에 자세한 로그가 출력되었습니다.)`);
    }
  };

  const handleEditDoughBom = (row: DoughBom) => {
    setEditingDoughBomId(row.id);
    setDoughBomForm({
      name: row.name,
      qtyPerBag: String(row.qtyPerBag),
      salt: String(row.salt),
      yeast: String(row.yeast),
      oil: String(row.oil),
      sugar: String(row.sugar),
      improver: String(row.improver),
    });
  };

  const handleDeleteDoughBom = async (id: string) => {
    if (!confirm("이 도우 BOM을 삭제하시겠습니까? 반죽사용량 입력 드롭다운에서 사라집니다.")) return;
    try {
      await deleteDoughBom(id);
      if (editingDoughBomId === id) clearDoughBomForm();
    } catch {
      alert("삭제에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  const bomByProduct = useMemo(() => {
    const map = new Map<string, BomRow[]>();
    for (const row of bomList) {
      const list = map.get(row.productName) ?? [];
      list.push(row);
      map.set(row.productName, list);
    }
    return Array.from(map.entries());
  }, [bomList]);

  const isGOnly = (box: number, unit: number) => box === 0 && unit === 0;

  const isLoading = materialsLoading || planningSubmaterialItemsLoading || bomLoading || planningSubmaterialsLoading || doughBomsLoading;
  const isSaving = saving !== "";

  return (
    <main className="min-h-screen py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-100 mb-6">기준 정보 (원료 및 BOM) 관리</h1>

        {error && (
          <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-sm">
            {error}
          </div>
        )}
        {isLoading && (
          <p className="mb-4 text-slate-400 flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            로딩 중...
          </p>
        )}
        {isSaving && (
          <p className="mb-4 text-cyan-400 flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            저장 중...
          </p>
        )}

        <div className="flex border-b border-slate-600 mb-6">
          <button
            type="button"
            onClick={() => setActiveTab("materials")}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "materials" ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            원료 정보 관리
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("submaterials")}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "submaterials" ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            부자재 정보 관리
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("bom")}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "bom" ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            제품 BOM 관리
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("doughBom")}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "doughBom" ? "border-cyan-500 text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            도우 BOM 관리
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("planningSubmaterial")}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "planningSubmaterial"
                ? "border-cyan-500 text-cyan-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            플래닝 부자재
          </button>
        </div>

        {activeTab === "materials" && (
          <div className="space-y-6">
            <div className="bg-space-800/80 rounded-2xl border border-slate-700 shadow-glow p-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">새 원료 등록</h2>
              <form onSubmit={handleAddMaterial} className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-sm font-medium text-slate-300 mb-1">원료명</label>
                  <input
                    type="text"
                    value={materialForm.materialName}
                    onChange={(e) => setMaterialForm((p) => ({ ...p, materialName: e.target.value }))}
                    placeholder="예: AG-91"
                    className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
                  />
                </div>
                <div className="w-32">
                  <label className="block text-sm font-medium text-slate-300 mb-1">1박스 중량(g)</label>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={materialForm.boxWeightG}
                    onChange={(e) => setMaterialForm((p) => ({ ...p, boxWeightG: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
                <div className="w-32">
                  <label className="block text-sm font-medium text-slate-300 mb-1">1개 중량(g)</label>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={materialForm.unitWeightG}
                    onChange={(e) => setMaterialForm((p) => ({ ...p, unitWeightG: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
                <div className="w-48">
                  <label className="block text-sm font-medium text-slate-300 mb-1">재고연동 코드(item_code)</label>
                  <input
                    type="text"
                    list="ecount-item-code-options"
                    value={materialForm.inventoryItemCode}
                    onChange={(e) => setMaterialForm((p) => ({ ...p, inventoryItemCode: e.target.value }))}
                    placeholder="예: yy2001"
                    className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <datalist id="ecount-item-code-options">
                    {ecountItemCodeOptions.map((o) => (
                      <option key={o.itemCode} value={o.itemCode}>
                        {o.itemName}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-2.5 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    등록
                  </button>
                  <button
                    type="button"
                    onClick={clearMaterialForm}
                    className="px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50"
                  >
                    초기화
                  </button>
                </div>
              </form>
              <p className="text-xs text-slate-500 mt-2">박스·낱개 중량이 모두 0이면 g 전용으로 취급됩니다.</p>
            </div>

            <div className="bg-space-800/80 rounded-2xl border border-slate-700 overflow-hidden shadow-glow">
              <h2 className="text-lg font-semibold text-slate-100 p-4 border-b border-slate-600">등록된 원료 목록</h2>
              {materialsLoading ? (
                <p className="p-8 text-center text-slate-500">로딩 중...</p>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[400px]">
                  <thead>
                    <tr className="bg-space-700/80 border-b border-slate-600">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200">원료명</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200">재고연동 코드</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">1박스 중량(g)</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">1개 중량(g)</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200">비고</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200 w-24">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((row) => (
                      <tr key={row.id} className="border-b border-slate-700 hover:bg-space-700/40">
                        <td className="px-4 py-3 font-medium text-slate-100">{row.materialName}</td>
                        <td className="px-4 py-3 text-slate-300 font-mono text-sm">{row.inventoryItemCode ?? "-"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                          {row.boxWeightG === 0 ? "-" : row.boxWeightG.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                          {row.unitWeightG === 0 ? "-" : row.unitWeightG.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-500 text-sm">
                          {isGOnly(row.boxWeightG, row.unitWeightG) ? "g전용" : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleEditMaterial(row)}
                              className="p-1.5 rounded text-slate-400 hover:bg-slate-700 hover:text-cyan-400"
                              title="수정"
                              aria-label="수정"
                            >
                              <PencilIcon className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMaterial(row.id)}
                              className="p-1.5 rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                              title="삭제"
                              aria-label="삭제"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>

            {editingMaterial && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                onClick={() => setEditingMaterial(null)}
              >
                <div
                  className="bg-space-800 rounded-2xl border border-cyan-500/30 shadow-glow max-w-lg w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-5 border-b border-slate-600">
                    <h3 className="text-lg font-bold text-slate-100">원료 수정</h3>
                    <p className="text-sm text-slate-400 mt-1">목록 위치를 유지한 채 바로 수정합니다.</p>
                  </div>
                  <form onSubmit={handleSaveEditingMaterial} className="p-5 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">원료명</label>
                      <input
                        type="text"
                        value={editingMaterial.materialName}
                        onChange={(e) => setEditingMaterial((p) => (p ? { ...p, materialName: e.target.value } : p))}
                        className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">1박스 중량(g)</label>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={editingMaterial.boxWeightG}
                          onChange={(e) => setEditingMaterial((p) => (p ? { ...p, boxWeightG: e.target.value } : p))}
                          className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">1개 중량(g)</label>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={editingMaterial.unitWeightG}
                          onChange={(e) => setEditingMaterial((p) => (p ? { ...p, unitWeightG: e.target.value } : p))}
                          className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">재고연동 코드(item_code)</label>
                      <input
                        type="text"
                        list="ecount-item-code-options"
                        value={editingMaterial.inventoryItemCode}
                        onChange={(e) => setEditingMaterial((p) => (p ? { ...p, inventoryItemCode: e.target.value } : p))}
                        className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingMaterial(null)}
                        className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50"
                      >
                        닫기
                      </button>
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 disabled:opacity-50"
                      >
                        수정 저장
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "submaterials" && (
          <div className="space-y-6">
            <div className="bg-space-800/80 rounded-2xl border border-slate-700 shadow-glow p-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">새 부자재 등록</h2>
              <p className="text-sm text-slate-400 mb-4">
                부자재는 재고·발주를 <span className="text-slate-300">낱개(EA)</span> 기준으로 다룹니다. 이름과 이카운트 품목코드만 맞추면 됩니다.
              </p>
              <form onSubmit={handleAddSubmaterialItem} className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-sm font-medium text-slate-300 mb-1">부자재명</label>
                  <input
                    type="text"
                    value={submaterialItemForm.submaterialName}
                    onChange={(e) => setSubmaterialItemForm((p) => ({ ...p, submaterialName: e.target.value }))}
                    placeholder="예: 우주인피자 배송박스"
                    className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500"
                  />
                </div>
                <div className="w-48">
                  <label className="block text-sm font-medium text-slate-300 mb-1">재고연동 코드(item_code)</label>
                  <input
                    type="text"
                    list="ecount-item-code-options"
                    value={submaterialItemForm.inventoryItemCode}
                    onChange={(e) => setSubmaterialItemForm((p) => ({ ...p, inventoryItemCode: e.target.value }))}
                    placeholder="예: yy5519"
                    className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-2.5 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    등록
                  </button>
                  <button
                    type="button"
                    onClick={clearSubmaterialItemForm}
                    className="px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50"
                  >
                    초기화
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-space-800/80 rounded-2xl border border-slate-700 overflow-hidden shadow-glow">
              <h2 className="text-lg font-semibold text-slate-100 p-4 border-b border-slate-600">등록된 부자재 목록</h2>
              {planningSubmaterialItemsLoading ? (
                <p className="p-8 text-center text-slate-500">로딩 중...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[400px]">
                    <thead>
                      <tr className="bg-space-700/80 border-b border-slate-600">
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200">부자재명</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200">재고연동 코드</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200 w-24">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planningSubmaterialItems.map((row) => (
                        <tr key={row.id} className="border-b border-slate-700 hover:bg-space-700/40">
                          <td className="px-4 py-3 font-medium text-slate-100">{row.submaterialName}</td>
                          <td className="px-4 py-3 text-slate-300 font-mono text-sm">{row.inventoryItemCode ?? "-"}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditSubmaterialItem(row)}
                                className="p-1.5 rounded text-slate-400 hover:bg-slate-700 hover:text-cyan-400"
                                title="수정"
                                aria-label="수정"
                              >
                                <PencilIcon className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSubmaterialItem(row.id)}
                                className="p-1.5 rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                                title="삭제"
                                aria-label="삭제"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {editingSubmaterialItem && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                onClick={() => setEditingSubmaterialItem(null)}
              >
                <div
                  className="bg-space-800 rounded-2xl border border-cyan-500/30 shadow-glow max-w-lg w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-5 border-b border-slate-600">
                    <h3 className="text-lg font-bold text-slate-100">부자재 수정</h3>
                  </div>
                  <form onSubmit={handleSaveEditingSubmaterialItem} className="p-5 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">부자재명</label>
                      <input
                        type="text"
                        value={editingSubmaterialItem.submaterialName}
                        onChange={(e) =>
                          setEditingSubmaterialItem((p) => (p ? { ...p, submaterialName: e.target.value } : p))
                        }
                        className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">재고연동 코드(item_code)</label>
                      <input
                        type="text"
                        list="ecount-item-code-options"
                        value={editingSubmaterialItem.inventoryItemCode}
                        onChange={(e) =>
                          setEditingSubmaterialItem((p) => (p ? { ...p, inventoryItemCode: e.target.value } : p))
                        }
                        className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingSubmaterialItem(null)}
                        className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50"
                      >
                        닫기
                      </button>
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 disabled:opacity-50"
                      >
                        수정 저장
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "bom" && (
          <div className="space-y-6">
            <div className="bg-space-800/80 rounded-2xl border border-slate-700 shadow-glow p-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">
                {editingBomId ? "BOM 수정" : "새 BOM(레시피) 등록"}
              </h2>
              <form onSubmit={handleSubmitRecipe} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">제품명</label>
                    <input
                      type="text"
                      list="bom-base-name-options"
                      value={bomBaseName}
                      onChange={(e) => setBomBaseName(e.target.value)}
                      placeholder="예: 마르게리따"
                      className="w-full px-4 py-3 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 text-base"
                    />
                    <datalist id="bom-base-name-options">
                      {bomBaseNameOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">기준(규격)</label>
                    {!isAddingCustomVariant ? (
                      <>
                        <select
                          value={bomVariant}
                          onChange={(e) => setBomVariant(e.target.value)}
                          className="w-full px-4 py-3 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 text-base"
                        >
                          <option value="">기준 선택</option>
                          {bomVariantOptions.map((variant) => (
                            <option key={variant} value={variant}>{variant}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingCustomVariant(true);
                            setCustomVariant(bomVariant);
                          }}
                          className="mt-2 text-xs text-cyan-400 hover:text-cyan-300"
                        >
                          + 새 기준 추가
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={customVariant}
                          onChange={(e) => setCustomVariant(e.target.value)}
                          placeholder="새 기준 입력 (예: 파티팩)"
                          className="w-full px-4 py-3 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 text-base"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingCustomVariant(false);
                            setBomVariant(customVariant.trim());
                          }}
                          className="mt-2 text-xs text-slate-400 hover:text-slate-300"
                        >
                          기준 목록으로 돌아가기
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <span className="block text-sm font-medium text-slate-300 mb-2">하위 원료</span>
                  <div className="space-y-3">
                    {recipeRows.map((row) => (
                      <div key={row.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-600 bg-space-900/80">
                        <select
                          value={row.materialName}
                          onChange={(e) => updateRecipeRow(row.id, "materialName", e.target.value)}
                          className="flex-1 min-w-[140px] px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 text-sm"
                        >
                          <option value="">원료 선택</option>
                          {materialNameOptions.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          inputMode="decimal"
                          step="0.01"
                          value={row.bomGPerEa}
                          onChange={(e) => updateRecipeRow(row.id, "bomGPerEa", e.target.value)}
                          placeholder="BOM(g)"
                          className="w-24 px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 text-sm tabular-nums"
                        />
                        <select
                          value={row.basis}
                          onChange={(e) => updateRecipeRow(row.id, "basis", e.target.value)}
                          className="w-28 px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 text-sm"
                        >
                          <option value="완제품">완제품</option>
                          <option value="도우">도우</option>
                        </select>
                        {!editingBomId && (
                          <button
                            type="button"
                            onClick={() => removeRecipeRow(row.id)}
                            className="p-2 rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                            title="삭제"
                            aria-label="이 줄 삭제"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {!editingBomId && (
                    <button
                      type="button"
                      onClick={addRecipeRow}
                      className="mt-3 w-full py-2.5 rounded-xl border-2 border-dashed border-slate-600 text-slate-400 text-sm font-medium hover:border-cyan-500/50 hover:text-cyan-400 transition-colors"
                    >
                      + 하위 원료 추가
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {editingBomId && (
                    <button type="button" onClick={clearBomForm} className="px-4 py-3 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50">
                      취소
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 py-3 rounded-xl bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {editingBomId ? "수정 완료" : "레시피 최종 등록"}
                  </button>
                </div>
              </form>
            </div>

            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-slate-100">등록된 BOM 목록</h2>
              {bomLoading ? (
                <p className="text-slate-500 py-8 text-center">로딩 중...</p>
              ) : bomByProduct.length === 0 ? (
                <p className="text-slate-500 py-8 text-center">등록된 레시피가 없습니다.</p>
              ) : (
                bomByProduct.map(([productName, rows]) => {
                  const isExpanded = expandedBoms[productName] ?? false;
                  const toggle = () => setExpandedBoms((prev) => ({ ...prev, [productName]: !prev[productName] }));
                  const sortedRows = [...rows].sort((a, b) =>
                    (a.materialName ?? "").localeCompare(b.materialName ?? "", "ko")
                  );
                  return (
                    <section key={productName} className="rounded-2xl overflow-hidden border border-cyan-500/20 bg-space-800/80 shadow-glow">
                      <button
                        type="button"
                        onClick={toggle}
                        className={`w-full bg-gradient-to-r from-space-700 via-space-700 to-cyan-900/30 border-cyan-500/30 px-4 py-3 flex items-center justify-between gap-2 flex-wrap shadow-glow text-left hover:from-space-600 hover:to-cyan-900/40 transition-colors rounded-t-2xl ${isExpanded ? "border-b" : "rounded-b-2xl"}`}
                        aria-expanded={isExpanded}
                      >
                        <span className="font-bold text-base text-slate-100">{productName}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRecipeModalProductName(productName);
                            }}
                            disabled={isSaving}
                            className="px-3 py-1.5 rounded-lg bg-cyan-500/30 border border-cyan-400/50 text-cyan-300 text-sm font-medium hover:bg-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            레시피 수정
                          </button>
                          <span className="text-slate-400" aria-hidden>
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </span>
                        </div>
                      </button>
                      <div
                        className={`overflow-hidden transition-all duration-200 ease-out ${isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}
                        aria-hidden={!isExpanded}
                      >
                        <ul className="divide-y divide-slate-700">
                          {sortedRows.map((row) => (
                            <li key={row.id} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-space-700/40">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-slate-100">{row.materialName}</p>
                                <p className="text-sm text-slate-500 mt-0.5">기준: {row.basis}</p>
                              </div>
                              <p className="text-slate-300 tabular-nums font-medium shrink-0">{row.bomGPerEa}g/ea</p>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleEditBom(row)}
                                  className="p-1.5 rounded text-slate-400 hover:bg-slate-700 hover:text-cyan-400"
                                  title="수정"
                                  aria-label="수정"
                                >
                                  <PencilIcon className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteBom(row.id)}
                                  className="p-1.5 rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                                  title="삭제"
                                  aria-label="삭제"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === "planningSubmaterial" && (
          <div className="space-y-6">
            <div className="bg-space-800/80 rounded-2xl border border-slate-700 shadow-glow p-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-1">
                {editingPlanningSubmaterialId ? "플래닝 부자재 수정" : "플래닝 부자재 등록"}
              </h2>
              <p className="text-slate-400 text-sm mb-4">이 섹션은 생산플래닝 원료/발주 계산에서만 사용됩니다.</p>
              <form onSubmit={handleSubmitPlanningSubmaterial} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-1">제품 스냅샷(제품명 - 기준)</label>
                  <input
                    type="text"
                    list="planning-product-snapshot-options"
                    value={planningSubmaterialForm.productNameSnapshot}
                    onChange={(e) => setPlanningSubmaterialForm((p) => ({ ...p, productNameSnapshot: e.target.value }))}
                    placeholder="예: 마르게리따 - 일반"
                    className="w-full px-4 py-3 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <datalist id="planning-product-snapshot-options">
                    {planningProductSnapshotOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">부자재명</label>
                  <select
                    value={planningSubmaterialForm.materialName}
                    onChange={(e) => setPlanningSubmaterialForm((p) => ({ ...p, materialName: e.target.value }))}
                    className="w-full px-4 py-3 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                  >
                    <option value="">부자재 선택</option>
                    {submaterialNameOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">소요 (낱개 / 제품 1EA)</label>
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    step="0.01"
                    value={planningSubmaterialForm.qtyGPerEa}
                    onChange={(e) => setPlanningSubmaterialForm((p) => ({ ...p, qtyGPerEa: e.target.value }))}
                    className="w-full px-4 py-3 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 tabular-nums"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">예: 피자 1개에 박스 1개면 1. (필름 등 g 단위가 필요하면 숫자만 그대로 넣으면 됩니다.)</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={planningSubmaterialForm.active}
                      onChange={(e) => setPlanningSubmaterialForm((p) => ({ ...p, active: e.target.checked }))}
                    />
                    활성(계산 반영)
                  </label>
                </div>
                <div className="sm:col-span-2 flex gap-2">
                  {editingPlanningSubmaterialId ? (
                    <button
                      type="button"
                      onClick={clearPlanningSubmaterialForm}
                      className="px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50"
                    >
                      취소
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-2.5 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 disabled:opacity-50"
                  >
                    {editingPlanningSubmaterialId ? "수정 저장" : "등록"}
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-space-800/80 rounded-2xl border border-slate-700 overflow-hidden shadow-glow">
              <h2 className="text-lg font-semibold text-slate-100 p-4 border-b border-slate-600">등록된 플래닝 부자재</h2>
              {planningSubmaterialsLoading ? (
                <p className="p-8 text-center text-slate-500">로딩 중...</p>
              ) : planningSubmaterials.length === 0 ? (
                <p className="p-8 text-center text-slate-500">등록된 플래닝 부자재가 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr className="bg-space-700/80 border-b border-slate-600">
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200">제품 스냅샷</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200">부자재명</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">소요(낱개 등)</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200">상태</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200 w-24">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planningSubmaterials.map((row) => (
                        <tr key={row.id} className="border-b border-slate-700 hover:bg-space-700/40">
                          <td className="px-4 py-3 text-slate-100">{row.productNameSnapshot}</td>
                          <td className="px-4 py-3 text-slate-300">{row.materialName}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.qtyGPerEa.toLocaleString("ko-KR")}</td>
                          <td className="px-4 py-3 text-center text-sm">
                            <span className={row.active ? "text-emerald-300" : "text-slate-500"}>{row.active ? "활성" : "비활성"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditPlanningSubmaterial(row)}
                                className="p-1.5 rounded text-slate-400 hover:bg-slate-700 hover:text-cyan-400"
                                title="수정"
                                aria-label="수정"
                              >
                                <PencilIcon className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePlanningSubmaterial(row.id)}
                                className="p-1.5 rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                                title="삭제"
                                aria-label="삭제"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "doughBom" && (
          <div className="space-y-6">
            <div className="bg-space-800/80 rounded-2xl border border-slate-700 shadow-glow p-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-1">도우 BOM 등록</h2>
              <p className="text-slate-400 text-sm mb-4">부재료는 무조건 밀가루 1kg(1,000g) 투입 기준의 배합량(g)으로 입력하세요. (수분율과 무관)</p>
              <form onSubmit={handleSubmitDoughBom} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">도우 명칭</label>
                    <input
                      type="text"
                      value={doughBomForm.name}
                      onChange={(e) => setDoughBomForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="예: 일반 130g"
                      className="w-full px-4 py-3 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">1포대당 생산 수량(개)</label>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={doughBomForm.qtyPerBag}
                      onChange={(e) => setDoughBomForm((p) => ({ ...p, qtyPerBag: e.target.value }))}
                      placeholder="예: 300"
                      className="w-full px-4 py-3 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 text-base tabular-nums"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  {[
                    { key: "salt" as const, label: "소금(g/1kg)" },
                    { key: "yeast" as const, label: "이스트(g/1kg)" },
                    { key: "oil" as const, label: "올리브오일(g/1kg)" },
                    { key: "sugar" as const, label: "설탕(g/1kg)" },
                    { key: "improver" as const, label: "개량제(g/1kg)" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
                      <input
                        type="number"
                        min={0}
                        inputMode="decimal"
                        step={0.1}
                        value={doughBomForm[key]}
                        onChange={(e) => setDoughBomForm((p) => ({ ...p, [key]: e.target.value }))}
                        placeholder="0"
                        className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 text-sm tabular-nums"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  {editingDoughBomId && (
                    <button type="button" onClick={clearDoughBomForm} className="px-4 py-3 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50">
                      취소
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-3 rounded-xl bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {editingDoughBomId ? "수정 완료" : "등록"}
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-space-800/80 rounded-2xl border border-slate-700 overflow-hidden shadow-glow">
              <h2 className="text-lg font-semibold text-slate-100 p-4 border-b border-slate-600">등록된 도우 BOM 목록</h2>
              {doughBomsLoading ? (
                <p className="p-8 text-center text-slate-500">로딩 중...</p>
              ) : doughBoms.length === 0 ? (
                <p className="p-8 text-center text-slate-500">등록된 도우 BOM이 없습니다. 반죽사용량 입력 페이지에서 사용할 도우를 등록해 주세요.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[500px]">
                    <thead>
                      <tr className="bg-space-700/80 border-b border-slate-600">
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200">도우 명칭</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">1포대(개)</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">소금</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">이스트</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">오일</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">설탕</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">개량제</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200 w-24">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doughBoms.map((row) => (
                        <tr key={row.id} className="border-b border-slate-700 hover:bg-space-700/40">
                          <td className="px-4 py-3 font-medium text-slate-100">{row.name}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.qtyPerBag}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.salt}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.yeast}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.oil}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.sugar}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.improver}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditDoughBom(row)}
                                className="p-1.5 rounded text-slate-400 hover:bg-slate-700 hover:text-cyan-400"
                                title="수정"
                                aria-label="수정"
                              >
                                <PencilIcon className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteDoughBom(row.id)}
                                className="p-1.5 rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                                title="삭제"
                                aria-label="삭제"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {recipeModalProductName && (
          <RecipeManageModal
            productName={recipeModalProductName}
            rows={bomList.filter((r) => r.productName === recipeModalProductName)}
            materialNameOptions={materialNameOptions}
            isSaving={isSaving}
            onClose={() => setRecipeModalProductName(null)}
            onAddBomRows={addBomRows}
            onUpdateBomRow={updateBomRow}
            onDeleteBomRow={deleteBomRow}
          />
        )}
      </div>
    </main>
  );
}
