"use client";

import { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import Link from "next/link";
import { useMasterStore, type ProductionLog, type OutboundLine } from "@/store/useMasterStore";
import { ChevronDown, ChevronRight, Trash2, Pencil, Plus } from "lucide-react";
import DateWheelPicker from "@/components/DateWheelPicker";

type MaterialLike = { materialName: string; boxWeightG: number; unitWeightG: number };

/** 박스/낱개/g → 총중량(g). g전용이면 boxG=0, unitG=0 → g만 사용 */
function totalGFromQty(
  box: number,
  bag: number,
  g: number,
  material: MaterialLike | undefined
): number {
  if (!material) return g;
  if (material.boxWeightG === 0 && material.unitWeightG === 0) return g;
  const unitG = material.unitWeightG > 0 ? material.unitWeightG : material.boxWeightG;
  return box * material.boxWeightG + bag * unitG + g;
}

/** (생산일자, 제품명)별 그룹 */
type OutboundGroup = {
  생산일자: string;
  제품명: string;
  작성자: string;
  도우수량: number | null;
  완제품예상수량: number | null;
  logs: ProductionLog[];
};

function groupByDateProduct(
  logs: ProductionLog[]
): OutboundGroup[] {
  const map = new Map<string, ProductionLog[]>();
  for (const log of logs) {
    const key = `${log.생산일자}\t${log.제품명}`;
    const list = map.get(key) ?? [];
    list.push(log);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([, list]) => {
    const first = list[0]!;
    const 도우수량로그 = list.find((x) => x.반죽량 != null);
    const 완제품예상로그 = list.find((x) => x.완제품예상수량 != null);
    return {
      생산일자: first.생산일자,
      제품명: first.제품명,
      작성자: first.출고자 ?? first.작성자2 ?? "—",
      도우수량: 도우수량로그?.반죽량 ?? null,
      완제품예상수량: 완제품예상로그?.완제품예상수량 ?? null,
      logs: list,
    };
  });
}

function getOutboundLines(log: ProductionLog): OutboundLine[] {
  if (Array.isArray(log.출고_라인) && log.출고_라인.length > 0) return log.출고_라인;
  return [
    { 소비기한: "", 박스: log.출고_박스 ?? 0, 낱개: log.출고_낱개 ?? 0, g: log.출고_g ?? 0 },
  ];
}

/** 단위 텍스트: 값이 0보다 큰 단위만 (예: 0박스 0개 39,920g → "39,920g") */
function formatUnitText(박스: number, 낱개: number, g: number): string {
  const parts: string[] = [];
  if (박스 > 0) parts.push(`${박스}박스`);
  if (낱개 > 0) parts.push(`${낱개}개`);
  if (g > 0) parts.push(`${g.toLocaleString()}g`);
  return parts.length > 0 ? parts.join(" ") : "0";
}

function getQuantityType(material: MaterialLike | undefined): "g_only" | "ea_only" | "box_ea" {
  if (!material) return "g_only";
  const box = material.boxWeightG ?? 0;
  const ea = material.unitWeightG ?? 0;
  if (box === 0 && ea === 0) return "g_only";
  if (box === 0 && ea > 0) return "ea_only";
  return "box_ea";
}

/** 상세 뷰 내 원료 1건 카드. LOT별로 한 줄씩 렌더하며, 각 줄 우측에 수정/삭제 버튼. */
function MaterialCard({
  log,
  material,
  editingLineIndex,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteLine,
  saving,
}: {
  log: ProductionLog;
  material: MaterialLike | undefined;
  editingLineIndex: number | null;
  onStartEdit: (lineIndex: number) => void;
  onSaveEdit: (lineIndex: number, payload: { 박스: number; 낱개: number; g: number }) => Promise<void>;
  onCancelEdit: () => void;
  onDeleteLine: (lineIndex: number) => void;
  saving: boolean;
}) {
  const lines = getOutboundLines(log);
  const lineGList = useMemo(() => {
    return lines.map((line) =>
      totalGFromQty(line.박스 ?? 0, line.낱개 ?? 0, line.g ?? 0, material)
    );
  }, [log, material]);

  const [editBox, setEditBox] = useState("");
  const [editBag, setEditBag] = useState("");
  const [editG, setEditG] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (editingLineIndex !== null && lines[editingLineIndex]) {
      const line = lines[editingLineIndex]!;
      setEditBox(String(line.박스 ?? 0));
      setEditBag(String(line.낱개 ?? 0));
      setEditG(String(line.g ?? 0));
    }
  }, [editingLineIndex, lines]);

  const handleSave = useCallback(
    async (lineIndex: number) => {
      const b = Math.max(0, parseInt(editBox, 10) || 0);
      const n = Math.max(0, parseInt(editBag, 10) || 0);
      const gg = Math.max(0, parseInt(editG, 10) || 0);
      setPending(true);
      try {
        await onSaveEdit(lineIndex, { 박스: b, 낱개: n, g: gg });
      } finally {
        setPending(false);
      }
    },
    [editBox, editBag, editG, onSaveEdit]
  );

  const handleKeyDown = (e: React.KeyboardEvent, lineIndex: number) => {
    if (e.key === "Enter") handleSave(lineIndex);
  };

  return (
    <div className="p-3 md:p-4 rounded-xl border border-slate-600 bg-space-800/80">
      <p className="text-lg font-bold text-gray-100 truncate mb-3">{log.원료명}</p>
      <div className="flex flex-col gap-y-3">
        {lines.map((line, idx) => {
          const 소비기한 = (line.소비기한 ?? "").trim() || "—";
          const b = line.박스 ?? 0;
          const n = line.낱개 ?? 0;
          const gg = line.g ?? 0;
          const lineG = lineGList[idx] ?? 0;
          const qtyText = formatUnitText(b, n, gg);
          const isEditing = editingLineIndex === idx;

          return (
            <div key={idx} className="rounded-lg border border-slate-700 bg-space-900/60 p-2.5 md:p-3">
              <div className="hidden md:flex flex-wrap items-center gap-4">
                <span className="text-base font-semibold text-cyan-400 tabular-nums shrink-0">
                  {lineG.toLocaleString()}g
                </span>
                <span className="inline-flex items-center bg-gray-700 text-gray-200 px-2.5 py-1 rounded-md text-sm font-medium shrink-0">
                  {소비기한}
                </span>
                {isEditing ? (
                  <>
                    <input type="number" min={0} inputMode="numeric" value={editBox} onChange={(e) => setEditBox(e.target.value)} onKeyDown={(e) => handleKeyDown(e, idx)} className="w-20 px-3 py-2 rounded-lg bg-space-900 border border-slate-600 text-slate-200 text-base tabular-nums" placeholder="박스" />
                    <input type="number" min={0} inputMode="numeric" value={editBag} onChange={(e) => setEditBag(e.target.value)} onKeyDown={(e) => handleKeyDown(e, idx)} className="w-20 px-3 py-2 rounded-lg bg-space-900 border border-slate-600 text-slate-200 text-base tabular-nums" placeholder="낱개" />
                    <input type="number" min={0} inputMode="numeric" value={editG} onChange={(e) => setEditG(e.target.value)} onKeyDown={(e) => handleKeyDown(e, idx)} className="w-24 px-3 py-2 rounded-lg bg-space-900 border border-slate-600 text-slate-200 text-base tabular-nums" placeholder="g" />
                    <button type="button" onClick={() => handleSave(idx)} disabled={saving || pending} className="px-4 py-2 rounded-lg bg-cyan-600 text-slate-900 text-base font-medium hover:bg-cyan-500 disabled:opacity-50">저장</button>
                    <button type="button" onClick={onCancelEdit} className="px-4 py-2 rounded-lg text-slate-400 hover:text-slate-200 text-base">취소</button>
                  </>
                ) : (
                  <>
                    <span className="text-slate-300 text-base tabular-nums">{qtyText}</span>
                    <div className="flex items-center gap-1 ml-auto">
                      <button type="button" onClick={() => onStartEdit(idx)} disabled={saving} className="p-2 rounded-lg text-slate-400 hover:bg-slate-700 hover:text-cyan-400 disabled:opacity-50" aria-label="수정">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => onDeleteLine(idx)} disabled={saving} className="p-2 rounded-lg text-slate-400 hover:bg-slate-700 hover:text-red-400 disabled:opacity-50" aria-label="삭제">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="md:hidden">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-sm font-semibold text-cyan-300 tabular-nums">{lineG.toLocaleString()}g</span>
                  <span className="inline-flex items-center bg-gray-700 text-gray-200 px-2 py-0.5 rounded text-xs">{소비기한}</span>
                </div>
                {isEditing ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" min={0} inputMode="numeric" value={editBox} onChange={(e) => setEditBox(e.target.value)} className="w-full px-2 py-2 rounded-lg bg-space-900 border border-slate-600 text-slate-200 text-sm tabular-nums" placeholder="박스" />
                      <input type="number" min={0} inputMode="numeric" value={editBag} onChange={(e) => setEditBag(e.target.value)} className="w-full px-2 py-2 rounded-lg bg-space-900 border border-slate-600 text-slate-200 text-sm tabular-nums" placeholder="낱개" />
                      <input type="number" min={0} inputMode="numeric" value={editG} onChange={(e) => setEditG(e.target.value)} className="w-full px-2 py-2 rounded-lg bg-space-900 border border-slate-600 text-slate-200 text-sm tabular-nums" placeholder="g" />
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => handleSave(idx)} disabled={saving || pending} className="px-3 py-1.5 rounded-lg bg-cyan-600 text-slate-900 text-sm font-medium">저장</button>
                      <button type="button" onClick={onCancelEdit} className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-sm">취소</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-300 tabular-nums">{qtyText}</p>
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => onStartEdit(idx)} disabled={saving} className="p-2 rounded-lg bg-space-800 text-cyan-300 hover:bg-space-700" aria-label="수정">
                        <Pencil className="w-5 h-5" />
                      </button>
                      <button type="button" onClick={() => onDeleteLine(idx)} disabled={saving} className="p-2 rounded-lg bg-space-800 text-red-400 hover:bg-space-700" aria-label="삭제">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddOutboundModal({
  open,
  onClose,
  materialOptions,
  materials,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  materialOptions: string[];
  materials: MaterialLike[];
  onSave: (payload: { materialName: string; expiry: string; boxQty: number; bagQty: number; gQty: number }) => Promise<void>;
  saving: boolean;
}) {
  const [materialName, setMaterialName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [boxQty, setBoxQty] = useState("");
  const [bagQty, setBagQty] = useState("");
  const [gQty, setGQty] = useState("");
  const [pending, setPending] = useState(false);
  const selectedMaterial = useMemo(
    () => materials.find((m) => m.materialName === materialName),
    [materials, materialName]
  );
  const qType = getQuantityType(selectedMaterial);

  const handleSave = async () => {
    const cleanName = materialName.trim();
    const cleanExpiry = expiry.trim();
    const b = Math.max(0, parseInt(boxQty, 10) || 0);
    const n = Math.max(0, parseInt(bagQty, 10) || 0);
    const g = Math.max(0, parseInt(gQty, 10) || 0);
    if (!cleanName || !cleanExpiry) {
      alert("원료명과 소비기한을 입력해 주세요.");
      return;
    }
    if (qType === "g_only" && g <= 0) {
      alert("g 전용 원료는 수량(g)을 1 이상 입력해 주세요.");
      return;
    }
    if (qType === "ea_only" && n <= 0 && g <= 0) {
      alert("낱개 또는 g 수량을 입력해 주세요.");
      return;
    }
    if (qType === "box_ea" && b <= 0 && n <= 0 && g <= 0) {
      alert("박스/낱개/g 중 하나 이상 입력해 주세요.");
      return;
    }
    setPending(true);
    try {
      await onSave({ materialName: cleanName, expiry: cleanExpiry, boxQty: b, bagQty: n, gQty: g });
      onClose();
      setMaterialName("");
      setExpiry("");
      setBoxQty("");
      setBagQty("");
      setGQty("");
    } finally {
      setPending(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-space-800 rounded-2xl border border-cyan-500/30 shadow-glow max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-600">
          <h3 className="text-lg font-bold text-slate-100">추가 출고 입력</h3>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs text-slate-400 mb-1">원료명</label>
            <select value={materialName} onChange={(e) => setMaterialName(e.target.value)} className="w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100">
              <option value="">원료 선택</option>
              {materialOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">소비기한(LOT)</label>
            <DateWheelPicker value={expiry} onChange={(v) => setExpiry(v)} className="w-full px-3 py-2 text-sm" placeholder="날짜 선택" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {qType === "box_ea" && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">박스</label>
                <input type="number" min={0} inputMode="numeric" value={boxQty} onChange={(e) => setBoxQty(e.target.value)} className="w-full px-2 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100" />
              </div>
            )}
            {qType !== "g_only" && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">낱개</label>
                <input type="number" min={0} inputMode="numeric" value={bagQty} onChange={(e) => setBagQty(e.target.value)} className="w-full px-2 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100" />
              </div>
            )}
            <div>
              <label className="block text-xs text-slate-400 mb-1">g</label>
              <input type="number" min={0} inputMode="numeric" value={gQty} onChange={(e) => setGQty(e.target.value)} className="w-full px-2 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100" />
            </div>
          </div>
        </div>
        <div className="p-5 border-t border-slate-600 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300">닫기</button>
          <button type="button" onClick={handleSave} disabled={saving || pending} className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium disabled:opacity-50">저장</button>
        </div>
      </div>
    </div>
  );
}

/** 상세 뷰: 원료별 카드 리스트 + 전체 삭제. LOT 단위 수정/삭제 */
function DetailView({
  logs,
  materials,
  bomMaterialNames,
  onUpdateOutbound,
  onDeleteLine,
  onAddMaterialOutbound,
  onDeleteRun,
  onUpdateRunDate,
  생산일자,
  제품명,
  saving,
  editingLogId,
  editingLineIndex,
  setEditing,
  showFirstCloseReminder,
}: {
  logs: ProductionLog[];
  materials: MaterialLike[];
  bomMaterialNames: string[];
  onUpdateOutbound: (logId: string, lineIndex: number, payload: { 박스: number; 낱개: number; g: number }) => Promise<void>;
  onDeleteLine: (logId: string, lineIndex: number) => Promise<void>;
  onAddMaterialOutbound: (payload: { materialName: string; expiry: string; boxQty: number; bagQty: number; gQty: number }) => Promise<void>;
  onDeleteRun: (생산일자: string, 제품명: string) => Promise<void>;
  onUpdateRunDate: (생산일자: string, 제품명: string, 새생산일자: string) => Promise<void>;
  생산일자: string;
  제품명: string;
  saving: boolean;
  editingLogId: string | null;
  editingLineIndex: number | null;
  setEditing: (logId: string | null, lineIndex: number | null) => void;
  /** 이미 1차 마감된 날짜면 안내(출고 수정은 가능, 사용량 계산·일지 재확인 권장) */
  showFirstCloseReminder: boolean;
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editDate, setEditDate] = useState(생산일자);

  useEffect(() => {
    setEditDate(생산일자);
  }, [생산일자]);

  const getMaterial = useCallback(
    (원료명: string) => materials.find((m) => m.materialName === 원료명),
    [materials]
  );

  const materialNameOptions = useMemo(
    () => {
      if (bomMaterialNames.length > 0) return Array.from(new Set(bomMaterialNames)).sort((a, b) => a.localeCompare(b, "ko-KR"));
      return Array.from(new Set(materials.map((m) => m.materialName))).sort((a, b) => a.localeCompare(b, "ko-KR"));
    },
    [materials, bomMaterialNames]
  );

  return (
    <div className="bg-space-900/80 border-t border-slate-600">
      <div className="px-2.5 md:px-4 py-3 space-y-3">
        {showFirstCloseReminder ? (
          <div className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-sm text-slate-200 leading-relaxed">
            이 생산일자는 <span className="font-medium text-cyan-200">1차 마감이 이미 저장</span>된 상태입니다. 출고를 수정·추가해도 됩니다. 다만{" "}
            <Link href="/production/history" className="text-cyan-300 underline hover:text-cyan-200">
              사용량 계산
            </Link>
            에서 해당 날짜 재고·마감을 다시 맞추고, 필요하면 생산일지를 다시 확인해 주세요. (이카운트 입력값과 일치하려면 마감 데이터가 출고와 같이 가야 합니다.)
          </div>
        ) : null}
        {logs.length === 0 ? (
          <p className="text-slate-500 text-sm py-4">출고된 원료가 없습니다.</p>
        ) : (
          [...logs]
            .sort((a, b) => a.원료명.localeCompare(b.원료명, "ko-KR"))
            .map((log) => (
            <MaterialCard
              key={log.id}
              log={log}
              material={getMaterial(log.원료명)}
              editingLineIndex={editingLogId === log.id ? editingLineIndex : null}
              onStartEdit={(lineIndex) => setEditing(log.id, lineIndex)}
              onSaveEdit={async (lineIndex, payload) => {
                await onUpdateOutbound(log.id, lineIndex, payload);
                setEditing(null, null);
              }}
              onCancelEdit={() => setEditing(null, null)}
              onDeleteLine={(lineIndex) => onDeleteLine(log.id, lineIndex)}
              saving={saving}
            />
            ))
        )}
        <div className="pt-1">
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-space-900/50 px-3 py-2">
            <div className="min-w-[180px]">
              <p className="mb-1 text-xs text-slate-400">출고일자 수정</p>
              <DateWheelPicker
                value={editDate}
                onChange={setEditDate}
                className="w-full px-2 py-1.5 rounded-lg bg-space-800 border border-slate-600 text-slate-200 text-sm"
                placeholder="날짜 선택"
              />
            </div>
            <button
              type="button"
              disabled={saving || !editDate || editDate === 생산일자}
              onClick={async () => {
                if (!editDate || editDate === 생산일자) return;
                if (!confirm(`출고일자를 ${생산일자} -> ${editDate}로 변경하시겠습니까?`)) return;
                await onUpdateRunDate(생산일자, 제품명, editDate);
              }}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium disabled:opacity-50"
            >
              날짜 저장
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> 추가 출고 입력
          </button>
        </div>
        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={() => onDeleteRun(생산일자, 제품명)}
            disabled={saving}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 text-sm disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> 이 출고 건 전체 삭제
          </button>
        </div>
      </div>
      <AddOutboundModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        materialOptions={materialNameOptions}
        materials={materials}
        onSave={onAddMaterialOutbound}
        saving={saving}
      />
    </div>
  );
}

export default function OutboundHistoryPage() {
  const {
    fetchProductionLogs,
    fetchBom,
    fetchMaterials,
    productionLogs,
    materials,
    bomList,
    productionLogsLoading,
    updateProductionLogOutbound,
    updateProductionRunDate,
    deleteProductionLogOutboundLine,
    deleteProductionLogsByGroup,
    appendOutboundLine,
    addProductionLog,
    saving,
    error,
    productionHistoryDateStates,
    productionHistoryDateStatesLoading,
    fetchProductionHistoryDateStates,
  } = useMasterStore();

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [filterDate, setFilterDate] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);

  const setEditing = useCallback((logId: string | null, lineIndex: number | null) => {
    setEditingLogId(logId);
    setEditingLineIndex(lineIndex);
  }, []);

  useEffect(() => {
    fetchProductionLogs();
    fetchBom();
    fetchMaterials();
    void fetchProductionHistoryDateStates();
  }, [fetchProductionLogs, fetchBom, fetchMaterials, fetchProductionHistoryDateStates]);

  /** 1차 마감된 날짜 안내용(출고 수정은 허용) */
  const showFirstCloseReminderForDate = useCallback(
    (생산일자: string) =>
      !productionHistoryDateStatesLoading &&
      Boolean(productionHistoryDateStates[생산일자.slice(0, 10)]?.first_closed_at),
    [productionHistoryDateStates, productionHistoryDateStatesLoading]
  );

  const materialsList = useMemo(
    () => materials.map((m) => ({ materialName: m.materialName, boxWeightG: m.boxWeightG, unitWeightG: m.unitWeightG })),
    [materials]
  );

  const groups = useMemo(() => groupByDateProduct(productionLogs), [productionLogs]);
  const bomMaterialNamesByProduct = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const b of bomList) {
      const list = map.get(b.productName) ?? [];
      list.push(b.materialName);
      map.set(b.productName, list);
    }
    return map;
  }, [bomList]);

  const filtered = useMemo(() => {
    let list = [...groups].sort((a, b) => b.생산일자.localeCompare(a.생산일자));
    if (filterDate.trim()) list = list.filter((r) => r.생산일자 === filterDate.trim());
    if (filterProduct.trim()) {
      const q = filterProduct.trim().toLowerCase();
      list = list.filter((r) => r.제품명.toLowerCase().includes(q));
    }
    return list;
  }, [groups, filterDate, filterProduct]);

  const handleUpdateOutbound = useCallback(
    async (logId: string, lineIndex: number, payload: { 박스: number; 낱개: number; g: number }) => {
      try {
        await updateProductionLogOutbound(logId, { lineIndex, ...payload });
        setToast({ message: "출고 수량이 반영되었습니다.", type: "success" });
      } catch {
        setToast({ message: "수량 반영에 실패했습니다.", type: "error" });
      }
    },
    [updateProductionLogOutbound]
  );

  const handleDeleteLine = useCallback(
    async (logId: string, lineIndex: number) => {
      if (!confirm("이 LOT 데이터를 삭제하시겠습니까? (마지막 1개일 경우 해당 원료 출고 기록 전체가 삭제됩니다.)")) return;
      try {
        await deleteProductionLogOutboundLine(logId, lineIndex);
        setEditing(null, null);
        setToast({ message: "삭제되었습니다.", type: "success" });
      } catch {
        setToast({ message: "삭제에 실패했습니다.", type: "error" });
      }
    },
    [deleteProductionLogOutboundLine, setEditing]
  );

  const handleDeleteRun = useCallback(
    async (생산일자: string, 제품명: string) => {
      if (!confirm("이 출고 기록을 정말 통째로 삭제하시겠습니까? 삭제된 데이터는 복구할 수 없습니다.")) return;
      try {
        await deleteProductionLogsByGroup(생산일자, 제품명);
        setExpandedKey(null);
        setEditing(null, null);
        setToast({ message: "삭제되었습니다.", type: "success" });
      } catch {
        setToast({ message: "삭제에 실패했습니다.", type: "error" });
      }
    },
    [deleteProductionLogsByGroup]
  );

  const handleAddMaterialOutbound = useCallback(
    async (
      group: OutboundGroup,
      payload: { materialName: string; expiry: string; boxQty: number; bagQty: number; gQty: number }
    ) => {
      const cleanMaterial = payload.materialName.trim();
      const cleanExpiry = payload.expiry.trim();
      const boxQty = Math.max(0, payload.boxQty || 0);
      const gQty = Math.max(0, payload.gQty || 0);
      const newLine: OutboundLine = {
        소비기한: cleanExpiry,
        박스: boxQty,
        낱개: Math.max(0, payload.bagQty || 0),
        g: gQty,
      };
      try {
        const existing = group.logs.find((l) => l.원료명 === cleanMaterial);
        if (existing) {
          await appendOutboundLine(existing.id, newLine);
        } else {
          await addProductionLog({
            생산일자: group.생산일자,
            제품명: group.제품명,
            원료명: cleanMaterial,
            출고_라인: [newLine],
            출고_박스: 0,
            출고_낱개: 0,
            출고_g: 0,
            출고자: group.작성자 === "—" ? undefined : group.작성자,
          });
        }
        setToast({ message: "추가 출고 원료가 반영되었습니다.", type: "success" });
      } catch {
        setToast({ message: "추가 출고 저장에 실패했습니다.", type: "error" });
      }
    },
    [appendOutboundLine, addProductionLog]
  );

  const handleUpdateRunDate = useCallback(
    async (생산일자: string, 제품명: string, 새생산일자: string) => {
      try {
        await updateProductionRunDate(생산일자, 제품명, 새생산일자);
        setExpandedKey(`${새생산일자}-${제품명}`);
        setEditing(null, null);
        setToast({ message: "출고 날짜가 변경되었습니다.", type: "success" });
      } catch {
        setToast({ message: "출고 날짜 변경에 실패했습니다.", type: "error" });
      }
    },
    [updateProductionRunDate, setEditing]
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const showError = Boolean(
    !productionLogsLoading &&
    error &&
    (!Array.isArray(productionLogs) || productionLogs.length < 1)
  );

  return (
    <div className="py-10 px-4 sm:px-6 lg:px-8">
      {toast && (
        <div
          role="alert"
          className={`app-toast ${
            toast.type === "success" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-slate-100">생산 출고 현황</h1>
          <Link
            href="/production/outbound"
            className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm hover:bg-cyan-400 transition-colors"
          >
            + 출고 입력
          </Link>
        </div>

        {showError && (
          <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 text-sm">
            {error}
          </div>
        )}
        {productionLogsLoading && (
          <p className="mb-4 text-slate-400 flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            로딩 중…
          </p>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            출고일자
            <DateWheelPicker
              value={filterDate}
              onChange={(v) => setFilterDate(v)}
              className="px-3 py-1.5 rounded-lg bg-space-800 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 min-w-[140px]"
              placeholder="전체"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            제품명
            <input
              type="search"
              placeholder="검색"
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-space-800 border border-slate-600 text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 min-w-[140px]"
            />
          </label>
          {(filterDate || filterProduct) && (
            <button
              type="button"
              onClick={() => { setFilterDate(""); setFilterProduct(""); }}
              className="text-sm text-slate-500 hover:text-slate-300"
            >
              필터 초기화
            </button>
          )}
        </div>

        {filtered.length === 0 && !productionLogsLoading && (
          <div className="rounded-2xl border border-slate-700 bg-space-800/80 p-12 text-center">
            <p className="text-slate-400 mb-4">
              {groups.length === 0 ? "저장된 출고 내역이 없습니다." : "조건에 맞는 출고 내역이 없습니다."}
            </p>
            {groups.length === 0 && (
              <Link href="/production/outbound" className="inline-block px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium hover:bg-cyan-400">
                출고 입력하기
              </Link>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="rounded-2xl border border-slate-700 bg-space-800/80 overflow-hidden">
            <div className="md:hidden p-3 space-y-3">
              {filtered.map((group) => {
                const key = `${group.생산일자}-${group.제품명}`;
                const isExpanded = expandedKey === key;
                return (
                  <div key={key} className="rounded-xl border border-slate-700 bg-space-900/70 overflow-hidden">
                    <div className="p-3">
                      <p className="text-base font-bold text-slate-100">{group.제품명}</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="text-slate-400">날짜 <span className="text-slate-200 ml-1">{group.생산일자}</span></div>
                        <div className="text-slate-400">작성자 <span className="text-slate-200 ml-1">{group.작성자}</span></div>
                        <div className="text-slate-400">
                          도우수량 <span className="text-cyan-300 ml-1">{group.도우수량 != null ? `${group.도우수량}` : "—"}</span>
                        </div>
                        <div className="text-slate-400">
                          완제품 예상 <span className="text-cyan-300 ml-1">{group.완제품예상수량 != null ? `${group.완제품예상수량}` : "—"}</span>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setExpandedKey(isExpanded ? null : key); setEditingLogId(null); }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-space-800 text-slate-200 text-sm"
                          aria-expanded={isExpanded}
                          aria-label="상세보기 토글"
                        >
                          상세보기 {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRun(group.생산일자, group.제품명)}
                          disabled={saving !== ""}
                          className="p-2.5 rounded-lg text-red-400 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50"
                          aria-label="출고 기록 삭제"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <DetailView
                        logs={group.logs}
                        materials={materialsList}
                        bomMaterialNames={bomMaterialNamesByProduct.get(group.제품명) ?? []}
                        onUpdateOutbound={handleUpdateOutbound}
                        onDeleteLine={handleDeleteLine}
                        onAddMaterialOutbound={(payload) => handleAddMaterialOutbound(group, payload)}
                        onDeleteRun={handleDeleteRun}
                        onUpdateRunDate={handleUpdateRunDate}
                        생산일자={group.생산일자}
                        제품명={group.제품명}
                        saving={saving !== ""}
                        editingLogId={editingLogId}
                        editingLineIndex={editingLineIndex}
                        setEditing={setEditing}
                        showFirstCloseReminder={showFirstCloseReminderForDate(group.생산일자)}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[780px]">
                <thead>
                  <tr className="bg-space-700/80 border-b border-slate-600">
                    <th className="px-4 py-3 text-left font-semibold text-slate-200 w-[120px]">날짜</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-200 min-w-[140px]">제품명</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-200 w-[140px]">도우수량(목표치)</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-200 w-[160px]">완제품 예상수량</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-200 w-[100px]">작성자</th>
                    <th className="px-4 py-3 text-center font-semibold text-slate-200 w-[140px]">상세/삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((group) => {
                    const key = `${group.생산일자}-${group.제품명}`;
                    const isExpanded = expandedKey === key;
                    return (
                      <Fragment key={key}>
                        <tr
                          className="border-b border-slate-700 hover:bg-space-700/40 cursor-pointer"
                          onClick={() => { setExpandedKey(isExpanded ? null : key); setEditingLogId(null); }}
                        >
                          <td className="px-4 py-3 font-medium text-slate-100">{group.생산일자}</td>
                          <td className="px-4 py-3 text-slate-200">{group.제품명}</td>
                          <td className="px-4 py-3 text-slate-300 tabular-nums">
                            {group.도우수량 != null ? group.도우수량.toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-300 tabular-nums">
                            {group.완제품예상수량 != null ? group.완제품예상수량.toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-300">{group.작성자}</td>
                          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setExpandedKey(isExpanded ? null : key)}
                                className="p-1.5 rounded-md text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                                aria-expanded={isExpanded}
                                aria-label="상세보기 토글"
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRun(group.생산일자, group.제품명)}
                                disabled={saving !== ""}
                                className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                                aria-label="출고 기록 삭제"
                                title="출고 기록 삭제"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${key}-detail`} className="bg-transparent">
                            <td colSpan={6} className="p-0 align-top">
                              <DetailView
                                logs={group.logs}
                                materials={materialsList}
                                bomMaterialNames={bomMaterialNamesByProduct.get(group.제품명) ?? []}
                                onUpdateOutbound={handleUpdateOutbound}
                                onDeleteLine={handleDeleteLine}
                                onAddMaterialOutbound={(payload) => handleAddMaterialOutbound(group, payload)}
                                onDeleteRun={handleDeleteRun}
                                onUpdateRunDate={handleUpdateRunDate}
                                생산일자={group.생산일자}
                                제품명={group.제품명}
                                saving={saving !== ""}
                                editingLogId={editingLogId}
                                editingLineIndex={editingLineIndex}
                                setEditing={setEditing}
                                showFirstCloseReminder={showFirstCloseReminderForDate(group.생산일자)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
