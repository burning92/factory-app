"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMasterStore, type OutboundStandard } from "@/store/useMasterStore";

type DraftRow = {
  id: string;
  materialName: string;
  standardGPerEa: string;
  basis: "완제품" | "도우";
};

function splitProductName(value: string): { baseName: string; variant: string } {
  const raw = String(value ?? "").trim();
  const i = raw.indexOf("-");
  if (i < 0) return { baseName: raw, variant: "" };
  return {
    baseName: raw.slice(0, i).trim(),
    variant: raw.slice(i + 1).trim(),
  };
}

function composeProductName(baseName: string, variant: string): string {
  const base = String(baseName ?? "").trim();
  const v = String(variant ?? "").trim();
  if (!base) return "";
  if (!v) return base;
  return `${base} - ${v}`;
}

const DEFAULT_VARIANTS = ["일반", "미니", "파베이크사용", "브레드"] as const;

export default function OutboundStandardsPage() {
  const {
    materials,
    bomList,
    outboundStandards,
    materialsLoading,
    bomLoading,
    outboundStandardsLoading,
    saving,
    error,
    fetchMaterials,
    fetchBom,
    fetchOutboundStandards,
    addOutboundStandardRows,
    updateOutboundStandardRow,
    deleteOutboundStandardRow,
  } = useMasterStore();

  const [baseName, setBaseName] = useState("");
  const [variant, setVariant] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([
    { id: "r0", materialName: "", standardGPerEa: "", basis: "완제품" },
  ]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [quickAddByProduct, setQuickAddByProduct] = useState<
    Record<string, { materialName: string; standardGPerEa: string; basis: "완제품" | "도우" }>
  >({});

  useEffect(() => {
    fetchMaterials();
    fetchBom();
    fetchOutboundStandards();
  }, [fetchMaterials, fetchBom, fetchOutboundStandards]);

  const materialOptions = useMemo(
    () => materials.map((m) => m.materialName).sort((a, b) => a.localeCompare(b, "ko")),
    [materials]
  );

  const productOptions = useMemo(
    () => Array.from(new Set(bomList.map((b) => b.productName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko")),
    [bomList]
  );

  const baseNameOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of productOptions) {
      const parsed = splitProductName(p);
      if (parsed.baseName) set.add(parsed.baseName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [productOptions]);

  const variantOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_VARIANTS);
    for (const p of productOptions) {
      const parsed = splitProductName(p);
      if (!baseName || parsed.baseName === baseName) {
        if (parsed.variant) set.add(parsed.variant);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [productOptions, baseName]);

  const standardsByProduct = useMemo(() => {
    const map = new Map<string, OutboundStandard[]>();
    for (const row of outboundStandards) {
      const list = map.get(row.productName) ?? [];
      list.push(row);
      map.set(row.productName, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [outboundStandards]);

  const addDraftRow = () => {
    setRows((prev) => [...prev, { id: `r-${Date.now()}-${prev.length}`, materialName: "", standardGPerEa: "", basis: "완제품" }]);
  };

  const removeDraftRow = (id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length > 0 ? next : [{ id: `r-${Date.now()}`, materialName: "", standardGPerEa: "", basis: "완제품" }];
    });
  };

  const updateDraftRow = (id: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const clearForm = () => {
    setBaseName("");
    setVariant("");
    setRows([{ id: `r-${Date.now()}`, materialName: "", standardGPerEa: "", basis: "완제품" }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const productName = composeProductName(baseName, variant);
    if (!productName) {
      alert("제품명과 기준을 선택해 주세요.");
      return;
    }
    const validRows = rows
      .map((r) => ({
        productName,
        materialName: r.materialName.trim(),
        standardGPerEa: Number.parseFloat(r.standardGPerEa),
        basis: r.basis,
      }))
      .filter((r) => r.materialName && Number.isFinite(r.standardGPerEa) && r.standardGPerEa >= 0);

    if (validRows.length === 0) {
      alert("원료/출고기준(g)을 1개 이상 입력해 주세요.");
      return;
    }

    try {
      await addOutboundStandardRows(validRows);
      clearForm();
      setExpanded((prev) => ({ ...prev, [productName]: true }));
    } catch {
      alert("출고 기준 저장에 실패했습니다.");
    }
  };

  const handleInlineEdit = async (row: OutboundStandard) => {
    const nextVal = window.prompt("출고 기준 g/ea를 입력하세요.", String(row.standardGPerEa));
    if (nextVal == null) return;
    const n = Number.parseFloat(nextVal);
    if (!Number.isFinite(n) || n < 0) {
      alert("0 이상의 숫자를 입력해 주세요.");
      return;
    }
    try {
      await updateOutboundStandardRow(row.id, { standardGPerEa: n });
    } catch {
      alert("수정에 실패했습니다.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("이 출고 기준을 삭제하시겠습니까?")) return;
    try {
      await deleteOutboundStandardRow(id);
    } catch {
      alert("삭제에 실패했습니다.");
    }
  };

  const handleQuickAddForProduct = async (productName: string, list: OutboundStandard[]) => {
    const draft = quickAddByProduct[productName] ?? { materialName: "", standardGPerEa: "", basis: "완제품" };
    const materialName = draft.materialName.trim();
    const standard = Number.parseFloat(draft.standardGPerEa);
    if (!materialName || !Number.isFinite(standard) || standard < 0) {
      alert("원료와 출고 기준(g)을 올바르게 입력해 주세요.");
      return;
    }
    if (list.some((x) => x.materialName === materialName && x.basis === draft.basis)) {
      alert("이미 같은 원료·기준 조합이 등록되어 있습니다.");
      return;
    }
    try {
      await addOutboundStandardRows([
        {
          productName,
          materialName,
          standardGPerEa: standard,
          basis: draft.basis,
        },
      ]);
      setQuickAddByProduct((prev) => ({
        ...prev,
        [productName]: { materialName: "", standardGPerEa: "", basis: "완제품" },
      }));
    } catch {
      alert("원료 추가에 실패했습니다.");
    }
  };

  const isLoading = materialsLoading || bomLoading || outboundStandardsLoading;
  const isSaving = saving === "outboundStandard";

  return (
    <main className="min-h-screen py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-100 mb-2">제품 출고 기준 관리</h1>
        <p className="text-sm text-slate-400 mb-6">
          BOM과 별도로 출고 기준(g/ea)을 관리합니다. 이 값은 출고 계산기에서 <span className="text-cyan-300">참고용</span>으로만 표시되며 저장값에는 반영되지 않습니다.
        </p>

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

        <section className="bg-space-800/80 rounded-2xl border border-slate-700 shadow-glow p-4 sm:p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-100 mb-4">새 출고 기준 등록</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">제품명</label>
                <input
                  type="text"
                  list="outbound-standard-product-base-options"
                  value={baseName}
                  onChange={(e) => setBaseName(e.target.value)}
                  placeholder="예: 마르게리따"
                  className="w-full px-3 py-2.5 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                />
                <datalist id="outbound-standard-product-base-options">
                  {baseNameOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">기준</label>
                <select
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  className="w-full px-3 py-2.5 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50"
                >
                  <option value="">기준 선택</option>
                  {variantOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-600 bg-space-900/80 p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_110px_40px] gap-2">
                    <select
                      value={r.materialName}
                      onChange={(e) => updateDraftRow(r.id, { materialName: e.target.value })}
                      className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:ring-2 focus:ring-cyan-500/50"
                    >
                      <option value="">원료 선택</option>
                      {materialOptions.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={r.standardGPerEa}
                      onChange={(e) => updateDraftRow(r.id, { standardGPerEa: e.target.value })}
                      placeholder="기준(g)"
                      className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm tabular-nums focus:ring-2 focus:ring-cyan-500/50"
                    />
                    <select
                      value={r.basis}
                      onChange={(e) => updateDraftRow(r.id, { basis: e.target.value as "완제품" | "도우" })}
                      className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:ring-2 focus:ring-cyan-500/50"
                    >
                      <option value="완제품">완제품</option>
                      <option value="도우">도우</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeDraftRow(r.id)}
                      className="rounded-lg border border-slate-600 text-slate-400 hover:text-red-300 hover:border-red-500/40"
                      aria-label="행 삭제"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addDraftRow}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-600 text-sm text-slate-400 hover:border-cyan-500/50 hover:text-cyan-300"
              >
                + 원료 행 추가
              </button>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={clearForm}
                className="px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50"
              >
                초기화
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-2.5 rounded-lg bg-cyan-500 text-space-900 font-semibold hover:bg-cyan-400 disabled:opacity-50"
              >
                출고 기준 등록
              </button>
            </div>
          </form>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">등록된 출고 기준</h2>
          {standardsByProduct.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">등록된 출고 기준이 없습니다.</p>
          ) : (
            standardsByProduct.map(([productName, list]) => {
              const open = expanded[productName] ?? false;
              const sorted = [...list].sort((a, b) => a.materialName.localeCompare(b.materialName, "ko"));
              return (
                <div key={productName} className="rounded-2xl overflow-hidden border border-cyan-500/20 bg-space-800/80">
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [productName]: !open }))}
                    className={`w-full px-4 py-3 flex items-center justify-between ${open ? "border-b border-slate-700" : ""}`}
                    aria-expanded={open}
                  >
                    <span className="font-semibold text-slate-100 text-left">{productName}</span>
                    {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                  {open && (
                    <div>
                      <ul className="divide-y divide-slate-700">
                        {sorted.map((row) => (
                          <li key={row.id} className="px-4 py-3 flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-slate-100 font-medium">{row.materialName}</p>
                              <p className="text-xs text-slate-500">기준: {row.basis}</p>
                            </div>
                            <p className="text-cyan-300 font-semibold tabular-nums text-sm whitespace-nowrap">
                              {row.standardGPerEa}g/ea
                            </p>
                            <button
                              type="button"
                              onClick={() => handleInlineEdit(row)}
                              className="px-2 py-1 rounded border border-slate-600 text-xs text-slate-300 hover:border-cyan-500/50 hover:text-cyan-300"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(row.id)}
                              className="px-2 py-1 rounded border border-slate-600 text-xs text-slate-300 hover:border-red-500/50 hover:text-red-300"
                            >
                              삭제
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="border-t border-slate-700 px-4 py-3 bg-space-900/30">
                        <p className="text-xs font-medium text-slate-400 mb-2">원료 추가</p>
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_110px_64px] gap-2">
                          <select
                            value={quickAddByProduct[productName]?.materialName ?? ""}
                            onChange={(e) =>
                              setQuickAddByProduct((prev) => ({
                                ...prev,
                                [productName]: {
                                  materialName: e.target.value,
                                  standardGPerEa: prev[productName]?.standardGPerEa ?? "",
                                  basis: prev[productName]?.basis ?? "완제품",
                                },
                              }))
                            }
                            className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm"
                          >
                            <option value="">원료 선택</option>
                            {materialOptions.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={quickAddByProduct[productName]?.standardGPerEa ?? ""}
                            onChange={(e) =>
                              setQuickAddByProduct((prev) => ({
                                ...prev,
                                [productName]: {
                                  materialName: prev[productName]?.materialName ?? "",
                                  standardGPerEa: e.target.value,
                                  basis: prev[productName]?.basis ?? "완제품",
                                },
                              }))
                            }
                            placeholder="기준(g)"
                            className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm tabular-nums"
                          />
                          <select
                            value={quickAddByProduct[productName]?.basis ?? "완제품"}
                            onChange={(e) =>
                              setQuickAddByProduct((prev) => ({
                                ...prev,
                                [productName]: {
                                  materialName: prev[productName]?.materialName ?? "",
                                  standardGPerEa: prev[productName]?.standardGPerEa ?? "",
                                  basis: e.target.value as "완제품" | "도우",
                                },
                              }))
                            }
                            className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 text-sm"
                          >
                            <option value="완제품">완제품</option>
                            <option value="도우">도우</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => handleQuickAddForProduct(productName, sorted)}
                            disabled={isSaving}
                            className="px-3 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 disabled:opacity-50"
                          >
                            추가
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
