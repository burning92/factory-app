"use client";

import Link from "next/link";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useMasterStore } from "@/store/useMasterStore";
import DateWheelPicker from "@/components/DateWheelPicker";
import { createSafeId } from "@/lib/createSafeId";
import { useAuth } from "@/contexts/AuthContext";

interface OutboundRow {
  materialName: string;
  basis: string;
  totalG: number;
  boxQty: number;
  bagQty: number;
  isGOnly: boolean;
}

function calcOutbound(
  productName: string,
  doughQty: number,
  finishedQty: number,
  bomList: { productName: string; materialName: string; bomGPerEa: number; basis: "완제품" | "도우" }[],
  materials: { materialName: string; boxWeightG: number; unitWeightG: number }[]
): OutboundRow[] {
  const productBom = bomList.filter((b) => b.productName === productName);
  const materialMap = new Map(materials.map((m) => [m.materialName, m]));
  const result: OutboundRow[] = [];

  for (const row of productBom) {
    const perDough = row.basis === "도우" ? row.bomGPerEa : 0;
    const perFinished = row.basis === "완제품" ? row.bomGPerEa : 0;
    const totalG = perDough * doughQty + perFinished * finishedQty;
    const mat = materialMap.get(row.materialName);
    if (!mat) continue;

    const isGOnly = mat.boxWeightG === 0 && mat.unitWeightG === 0;
    if (isGOnly) {
      result.push({
        materialName: row.materialName,
        basis: row.basis,
        totalG,
        boxQty: 0,
        bagQty: 0,
        isGOnly: true,
      });
      continue;
    }

    const bagG = mat.unitWeightG > 0 ? mat.unitWeightG : mat.boxWeightG;
    const bagsPerBox = mat.boxWeightG > 0 && bagG > 0 ? Math.floor(mat.boxWeightG / bagG) : 1;
    const totalBagsNeeded = Math.ceil(totalG / bagG);
    const boxQty = Math.floor(totalBagsNeeded / bagsPerBox);
    const bagQty = totalBagsNeeded - boxQty * bagsPerBox;

    result.push({
      materialName: row.materialName,
      basis: row.basis,
      totalG,
      boxQty,
      bagQty,
      isGOnly: false,
    });
  }

  return result;
}

function formatRequiredQty(boxQty: number, bagQty: number, isGOnly: boolean): string {
  if (isGOnly) return "g 전용";
  const parts: string[] = [];
  if (boxQty > 0) parts.push(`${boxQty}박스`);
  if (bagQty > 0) parts.push(`${bagQty}개`);
  return parts.length ? parts.join(" ") : "0박스 0개";
}

interface OutboundEntryRow {
  id: string;
  expiryDate: string;
  boxQty: string;
  bagQty: string;
  remainderG: string;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

function OutboundModal({
  materialName,
  requiredText,
  defaultExpiryDate,
  initialEntries,
  onClose,
  onSave,
}: {
  materialName: string;
  requiredText: string;
  defaultExpiryDate: string;
  initialEntries?: { expiryDate: string; boxQty: number; bagQty: number; remainderG: number }[];
  onClose: () => void;
  onSave: (entries: { expiryDate: string; boxQty: number; bagQty: number; remainderG: number }[]) => void;
}) {
  const [rows, setRows] = useState<OutboundEntryRow[]>(() => {
    if (initialEntries?.length) {
      return initialEntries.map((e) => ({
        id: createSafeId(),
        expiryDate: e.expiryDate || defaultExpiryDate,
        boxQty: String(e.boxQty),
        bagQty: String(e.bagQty),
        remainderG: String(e.remainderG),
      }));
    }
    return [
      {
        id: createSafeId(),
        expiryDate: defaultExpiryDate,
        boxQty: "",
        bagQty: "",
        remainderG: "",
      },
    ];
  });

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { id: createSafeId(), expiryDate: defaultExpiryDate, boxQty: "", bagQty: "", remainderG: "" },
    ]);
  }, [defaultExpiryDate]);

  const updateRow = useCallback((id: string, field: keyof OutboundEntryRow, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }, []);

  const handleSave = useCallback(() => {
    const entries = rows
      .filter((r) => r.expiryDate.trim() !== "")
      .map((r) => ({
        expiryDate: r.expiryDate,
        boxQty: parseInt(r.boxQty, 10) || 0,
        bagQty: parseInt(r.bagQty, 10) || 0,
        remainderG: parseInt(r.remainderG, 10) || 0,
      }));
    if (entries.length) {
      onSave(entries);
      onClose();
    }
  }, [rows, onSave, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-space-800 rounded-2xl border border-cyan-500/30 shadow-glow max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-600">
          <h3 className="text-lg font-bold text-slate-100">{materialName}</h3>
          <p className="text-sm text-slate-400 mt-1">필요 수량: {requiredText}</p>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          <div className="space-y-4">
            {rows.map((row, index) => (
              <div key={row.id} className="p-3 rounded-xl border border-slate-600 bg-space-900/80 space-y-2">
                <span className="text-xs font-medium text-slate-500">소비기한 #{index + 1}</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">소비기한(날짜)</label>
                    <DateWheelPicker value={row.expiryDate} onChange={(v) => updateRow(row.id, "expiryDate", v)} className="w-full px-2 py-1.5 text-sm focus:ring-2 focus:ring-cyan-500/50" placeholder="날짜 선택" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">잔량(g)</label>
                    <input type="number" min={0} inputMode="numeric" value={row.remainderG} onChange={(e) => updateRow(row.id, "remainderG", e.target.value)} placeholder="0" className="w-full px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">박스 수량</label>
                    <input type="number" min={0} inputMode="numeric" value={row.boxQty} onChange={(e) => updateRow(row.id, "boxQty", e.target.value)} placeholder="0" className="w-full px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">낱개 수량</label>
                    <input type="number" min={0} inputMode="numeric" value={row.bagQty} onChange={(e) => updateRow(row.id, "bagQty", e.target.value)} placeholder="0" className="w-full px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addRow} className="mt-3 w-full py-2 rounded-xl border-2 border-dashed border-slate-600 text-slate-400 text-sm font-medium hover:border-cyan-500/50 hover:text-cyan-400 transition-colors">
            + 소비기한 추가
          </button>
        </div>
        <div className="p-5 border-t border-slate-600 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 font-medium hover:bg-slate-700/50">닫기</button>
          <button type="button" onClick={handleSave} className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400 shadow-glow focus:outline-none focus:ring-2 focus:ring-cyan-400">저장</button>
        </div>
      </div>
    </div>
  );
}

interface PendingOutbound {
  productionDate: string;
  productName: string;
  materialName: string;
  entries: { expiryDate: string; boxQty: number; bagQty: number; remainderG: number }[];
}

export default function JournalPage() {
  const { profile } = useAuth();
  const loginAuthor =
    (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const {
    materials,
    bomList,
    lastUsedDates,
    materialsLoading,
    bomLoading,
    saving,
    error,
    fetchMaterials,
    fetchBom,
    fetchLastUsedDates,
    addProductionLog,
    setLastUsedDate,
  } = useMasterStore();
  const [productionDate, setProductionDate] = useState(todayStr);
  const [productName, setProductName] = useState("");
  const [doughQty, setDoughQty] = useState("");
  const [finishedQty, setFinishedQty] = useState("");
  const [preparerName, setPreparerName] = useState("");
  const [preparerName2, setPreparerName2] = useState("");
  const preparerTouchedRef = useRef(false);
  const preparer2TouchedRef = useRef(false);
  const [doughQtyInput, setDoughQtyInput] = useState("");
  const [doughWasteQty, setDoughWasteQty] = useState("");
  const [rows, setRows] = useState<OutboundRow[] | null>(null);
  const [pendingOutbound, setPendingOutbound] = useState<Record<string, PendingOutbound>>({});
  const [modal, setModal] = useState<{ row: OutboundRow } | null>(null);

  useEffect(() => {
    fetchMaterials();
    fetchBom();
    fetchLastUsedDates();
  }, [fetchMaterials, fetchBom, fetchLastUsedDates]);

  // 최초 표시값: 로그인 사용자명(1순위 display_name, 2순위 login_id). 사용자가 수정했다면 덮어쓰지 않음.
  useEffect(() => {
    if (!loginAuthor) return;
    if (!preparerTouchedRef.current) setPreparerName((prev) => prev || loginAuthor);
    if (!preparer2TouchedRef.current) setPreparerName2((prev) => prev || loginAuthor);
  }, [loginAuthor]);

  const productOptions = useMemo(() => {
    const set = new Set(bomList.map((b) => b.productName));
    return Array.from(set).sort();
  }, [bomList]);

  const handleCalculate = () => {
    const d = parseInt(doughQty, 10) || 0;
    const f = parseInt(finishedQty, 10) || 0;
    if (!productName.trim()) {
      setRows([]);
      return;
    }
    if (d <= 0 && f <= 0) {
      setRows([]);
      return;
    }
    const result = calcOutbound(productName.trim(), d, f, bomList, materials);
    setRows(result);
  };

  const getDefaultExpiry = (materialName: string) =>
    lastUsedDates[materialName] || todayStr();

  const handleSaveToPending = (
    entries: { expiryDate: string; boxQty: number; bagQty: number; remainderG: number }[],
    ctx: { productionDate: string; productName: string; materialName: string }
  ) => {
    if (!entries.length) return;
    setPendingOutbound((prev) => ({
      ...prev,
      [ctx.materialName]: {
        productionDate: ctx.productionDate,
        productName: ctx.productName,
        materialName: ctx.materialName,
        entries,
      },
    }));
    setModal(null);
  };

  const handleFinalSave = async () => {
    const list = Object.values(pendingOutbound);
    if (!list.length) {
      alert("임시 저장된 출고 내역이 없습니다.");
      return;
    }
    try {
      const doughVal = parseInt(doughQtyInput, 10);
      const doughWasteVal = parseInt(doughWasteQty, 10);
      for (const p of list) {
        const 출고_라인 = p.entries.map((e) => ({
          소비기한: e.expiryDate,
          박스: e.boxQty || 0,
          낱개: e.bagQty || 0,
          g: e.remainderG || 0,
        }));
        await addProductionLog({
          생산일자: p.productionDate,
          제품명: p.productName,
          원료명: p.materialName,
          출고_라인,
          출고_박스: 0,
          출고_낱개: 0,
          출고_g: 0,
          출고자: preparerName.trim() || undefined,
          작성자2: preparerName2.trim() || undefined,
          반죽량: Number.isNaN(doughVal) ? undefined : doughVal,
          반죽폐기량: Number.isNaN(doughWasteVal) ? undefined : doughWasteVal,
        });
        if (p.entries[0]?.expiryDate) {
          await setLastUsedDate(p.materialName, p.entries[0].expiryDate);
        }
      }
      setPendingOutbound({});
      setRows(null);
      setModal(null);
      alert(`전체 출고 내역 ${list.length}건이 저장되었습니다.`);
    } catch {
      alert("저장에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  return (
    <main className="min-h-screen py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-100">
            생산 일지 작성
          </h1>
          <Link
            href="/"
            className="text-sm text-slate-400 hover:text-cyan-400 transition-colors"
          >
            ← 대시보드
          </Link>
        </div>

        {error && (
          <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-sm">
            {error}
          </div>
        )}
        {(materialsLoading || bomLoading) && (
          <p className="mb-4 text-slate-400 flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            로딩 중...
          </p>
        )}

        <div className="bg-space-800/80 rounded-2xl border border-slate-700 shadow-glow p-6 mb-8">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">출고자 (작성자)</label>
                <input
                  type="text"
                  value={preparerName}
                  onChange={(e) => {
                    preparerTouchedRef.current = true;
                    setPreparerName(e.target.value);
                  }}
                  placeholder="이름"
                  className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">작성자 2</label>
                <input
                  type="text"
                  value={preparerName2}
                  onChange={(e) => {
                    preparer2TouchedRef.current = true;
                    setPreparerName2(e.target.value);
                  }}
                  placeholder="이름"
                  className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">생산 일자</label>
              <DateWheelPicker value={productionDate} onChange={(v) => setProductionDate(v)} className="w-full px-3 py-2 focus:ring-2 focus:ring-cyan-500/50" placeholder="생산일자" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">제품 선택</label>
              <select value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500">
                <option value="">제품을 선택하세요</option>
                {productOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">도우 수량</label>
                <input type="number" min={0} inputMode="numeric" value={doughQty} onChange={(e) => setDoughQty(e.target.value)} placeholder="숫자 입력" className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">완제품 예상 수량</label>
                <input type="number" min={0} inputMode="numeric" value={finishedQty} onChange={(e) => setFinishedQty(e.target.value)} placeholder="숫자 입력" className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">반죽량</label>
                <input type="number" min={0} inputMode="numeric" value={doughQtyInput} onChange={(e) => setDoughQtyInput(e.target.value)} placeholder="선택 입력" className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">반죽폐기량</label>
                <input type="number" min={0} inputMode="numeric" value={doughWasteQty} onChange={(e) => setDoughWasteQty(e.target.value)} placeholder="선택 입력" className="w-full px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50" />
              </div>
            </div>
            <button type="button" onClick={handleCalculate} className="w-full py-3 rounded-xl bg-cyan-500 text-space-900 font-semibold shadow-glow hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-space-900 transition-colors">
              계산하기
            </button>
          </div>
        </div>

        {rows !== null && (
          <>
            <div className="bg-space-800/80 rounded-2xl border border-slate-700 overflow-hidden shadow-glow">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="bg-space-700/80 border-b border-slate-600">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200">원료명</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200">계산기준</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">총 필요량(g)</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">필요 박스</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-200">필요 낱개</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200">실제 출고 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-500">제품을 선택하고 도우/완제품 수량을 입력한 뒤 계산하기를 눌러 주세요.</td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        const pending = pendingOutbound[row.materialName];
                        return (
                          <tr key={row.materialName} className="border-b border-slate-700 hover:bg-space-700/40">
                            <td className="px-4 py-3 font-medium text-slate-100">{row.materialName}</td>
                            <td className="px-4 py-3 text-center text-slate-300">{row.basis}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.totalG.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.isGOnly ? "-" : row.boxQty}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-300">{row.isGOnly ? "-" : row.bagQty}</td>
                            <td className="px-4 py-3 text-center">
                              <button
                                type="button"
                                onClick={() => setModal({ row })}
                                className={pending ? "inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-500/80 text-space-900 text-sm font-medium shadow-glow hover:bg-emerald-400 transition-colors" : "inline-flex items-center justify-center px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium shadow-glow hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 transition-colors"}
                              >
                                {pending ? "✅ 입력 완료 (수정)" : "출고 입력"}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6">
              {saving === "logs" && (
                <p className="mb-2 text-cyan-400 flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  저장 중...
                </p>
              )}
              <button
                type="button"
                onClick={handleFinalSave}
                disabled={Object.keys(pendingOutbound).length === 0 || saving === "logs"}
                className="w-full py-4 rounded-xl bg-cyan-500 text-space-900 text-lg font-bold shadow-glow hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-space-900 transition-colors"
              >
                전체 출고 내역 최종 저장
                {Object.keys(pendingOutbound).length > 0 && (
                  <span className="ml-2 text-space-900/80">({Object.keys(pendingOutbound).length}건)</span>
                )}
              </button>
            </div>
          </>
        )}

        {modal && (
          <OutboundModal
            materialName={modal.row.materialName}
            requiredText={formatRequiredQty(modal.row.boxQty, modal.row.bagQty, modal.row.isGOnly)}
            defaultExpiryDate={getDefaultExpiry(modal.row.materialName)}
            initialEntries={pendingOutbound[modal.row.materialName]?.entries}
            onClose={() => setModal(null)}
            onSave={(entries) => handleSaveToPending(entries, { productionDate, productName: productName.trim(), materialName: modal.row.materialName })}
          />
        )}
      </div>
    </main>
  );
}
