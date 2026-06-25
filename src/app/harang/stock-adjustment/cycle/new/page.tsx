"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { displayHarangProductName } from "@/features/harang/displayProductName";
import {
  type CycleMaterialRow,
  type ProductionPickRow,
  aggregatePhysicalBySerialLot,
  aggregateMaterialConsumption,
  computeCycleActualUsageFromPhysical,
  sumLotUsageAfterAdjustmentDate,
  confirmCycleAdjustment,
  defaultSelectedHeaderIds,
  distributeDeltaForSerialLot,
  deleteStockAdjustmentDraft,
  formatConsumptionRatioPct,
  fetchCycleMaterialsForHeaders,
  fetchLastConfirmedAdjustmentDate,
  fetchProductNamesFromProduction,
  fetchProductionHeadersForProduct,
  formatLotDate,
  loadCycleDraft,
  saveCycleDraft,
  splitPhysicalAcrossConstituents,
} from "@/features/harang/stockAdjustment";
import {
  downloadCycleSurveyChecklistCsv,
  fetchCycleSurveyChecklistRows,
  type CycleSurveyChecklistRow,
} from "@/features/harang/exportCycleSurveyChecklist";

const STEPS = [
  { n: 1, label: "기본정보" },
  { n: 2, label: "분배대상" },
  { n: 3, label: "실사" },
  { n: 4, label: "확정" },
] as const;

function fmtNum(n: number): string {
  return Number(n || 0).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
}

function parsePhysicalInput(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function CycleAdjustmentWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdParam = searchParams.get("draft_id");

  const [step, setStep] = useState(1);
  const [sessionId, setSessionId] = useState<string | undefined>(draftIdParam ?? undefined);
  const [adjustmentDate, setAdjustmentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [productName, setProductName] = useState("");
  const [memo, setMemo] = useState("");
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [lastConfirmedDate, setLastConfirmedDate] = useState<string | null>(null);
  const [productionRows, setProductionRows] = useState<ProductionPickRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [materials, setMaterials] = useState<CycleMaterialRow[]>([]);
  const [stockAsOfDate, setStockAsOfDate] = useState<string | null>(null);
  const [openingAsOfDate, setOpeningAsOfDate] = useState<string | null>(null);
  const [physicalBySerialKey, setPhysicalBySerialKey] = useState<Record<string, string>>({});
  const [pendingLotPhysical, setPendingLotPhysical] = useState<Array<{ lot_id: string; physical_qty: number }>>(
    [],
  );
  const [expandedSerialKeys, setExpandedSerialKeys] = useState<Set<string>>(new Set());
  const [expandedDistKeys, setExpandedDistKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [surveyChecklistRows, setSurveyChecklistRows] = useState<CycleSurveyChecklistRow[]>([]);
  const [surveyChecklistLoading, setSurveyChecklistLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const latestSelectedProductionDate = useMemo(() => {
    let max = "";
    for (const row of productionRows) {
      if (!selectedIds.has(row.id)) continue;
      if (row.production_date > max) max = row.production_date;
    }
    return max || null;
  }, [productionRows, selectedIds]);

  const productionExtendsPastAdjustment = Boolean(
    adjustmentDate && latestSelectedProductionDate && latestSelectedProductionDate > adjustmentDate,
  );

  const loadProducts = useCallback(async () => {
    const names = await fetchProductNamesFromProduction();
    setProductOptions(names);
  }, []);

  useEffect(() => {
    void loadProducts().catch((e) => alert(e instanceof Error ? e.message : "품목 목록 로드 실패"));
  }, [loadProducts]);

  useEffect(() => {
    if (!draftIdParam) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const { session, production_header_ids, lot_physical } = await loadCycleDraft(draftIdParam);
        setSessionId(session.id);
        setAdjustmentDate(session.adjustment_date);
        setProductName(session.product_name ?? "");
        setMemo(session.memo ?? "");
        setStep(session.wizard_step);
        setSelectedIds(new Set(production_header_ids));
        setPendingLotPhysical(lot_physical);
      } catch (e) {
        alert(e instanceof Error ? e.message : "임시저장 불러오기 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, [draftIdParam]);

  useEffect(() => {
    if (!productName) {
      setProductionRows([]);
      setLastConfirmedDate(null);
      return;
    }
    void (async () => {
      try {
        const [rows, lastDate] = await Promise.all([
          fetchProductionHeadersForProduct(productName),
          fetchLastConfirmedAdjustmentDate(productName),
        ]);
        setProductionRows(rows);
        setLastConfirmedDate(lastDate);
        if (!draftIdParam) {
          setSelectedIds(defaultSelectedHeaderIds(rows, lastDate));
        }
      } catch (e) {
        alert(e instanceof Error ? e.message : "생산입고 로드 실패");
      }
    })();
  }, [productName, draftIdParam]);

  useEffect(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !adjustmentDate.trim()) {
      setMaterials([]);
      setStockAsOfDate(null);
      setOpeningAsOfDate(null);
      setMaterialsLoading(false);
      return;
    }
    setMaterialsLoading(true);
    void fetchCycleMaterialsForHeaders(ids, adjustmentDate)
      .then(({ asOfDate, openingAsOfDate: openingDate, materials: rows }) => {
        setStockAsOfDate(asOfDate);
        setOpeningAsOfDate(openingDate);
        setMaterials(rows);
      })
      .catch((e) => alert(e instanceof Error ? e.message : "원료 목록 로드 실패"))
      .finally(() => setMaterialsLoading(false));
  }, [selectedIds, adjustmentDate]);

  useEffect(() => {
    if (pendingLotPhysical.length === 0 || materials.length === 0) return;
    setPhysicalBySerialKey(aggregatePhysicalBySerialLot(pendingLotPhysical, materials));
    setPendingLotPhysical([]);
  }, [materials, pendingLotPhysical]);

  const selectedRows = useMemo(
    () => productionRows.filter((r) => selectedIds.has(r.id)),
    [productionRows, selectedIds],
  );

  const selectedQtySum = useMemo(
    () => selectedRows.reduce((s, r) => s + r.finished_qty, 0),
    [selectedRows],
  );

  const lotRows = useMemo(() => {
    return materials.flatMap((m) =>
      m.lots.map((lot, lotIndex) => {
        const physical = parsePhysicalInput(physicalBySerialKey[lot.serial_key]);
        const usageAfterAdj = sumLotUsageAfterAdjustmentDate(lot.production_breakdown, adjustmentDate);
        const variance = physical === null ? null : physical - lot.system_stock;
        const actualUsage = computeCycleActualUsageFromPhysical(
          lot.opening_stock,
          physical,
          usageAfterAdj,
        );
        const usageDelta =
          actualUsage === null ? null : Math.round((actualUsage - lot.bom_usage_in_selection) * 1000) / 1000;
        return {
          material: m,
          lot,
          lotIndex,
          physical,
          usageAfterAdj,
          variance,
          actualUsage,
          usageDelta,
        };
      }),
    );
  }, [materials, physicalBySerialKey, adjustmentDate]);

  const physicalLots = lotRows.filter((row) => row.physical !== null);

  /** 선택 구간에서 실제 사용된 소비기한 LOT */
  const usedSerialLots = lotRows.filter((row) => row.lot.production_breakdown.length > 0);
  const missingPhysicalUsedLots = usedSerialLots.filter((row) => row.physical === null);

  const materialConsumption = useMemo(
    () =>
      aggregateMaterialConsumption(
        materials.flatMap((m) => {
          const lotsWithPhysical = m.lots.filter(
            (lot) => parsePhysicalInput(physicalBySerialKey[lot.serial_key]) !== null,
          );
          if (lotsWithPhysical.length === 0) return [];
          const actual = lotsWithPhysical.reduce((s, lot) => {
            const p = parsePhysicalInput(physicalBySerialKey[lot.serial_key])!;
            const after = sumLotUsageAfterAdjustmentDate(lot.production_breakdown, adjustmentDate);
            return s + (lot.opening_stock - p + after);
          }, 0);
          return [
            {
              materialKey: m.materialKey,
              material_name: m.material_name,
              unit: m.unit,
              view_category: m.view_category,
              bom: m.bom_usage_in_selection,
              actual: Math.round(actual * 1000) / 1000,
            },
          ];
        }),
      ),
    [materials, physicalBySerialKey, adjustmentDate],
  );

  const adjustableLots = lotRows.filter(
    (row) => row.physical !== null && row.usageDelta !== null && row.usageDelta !== 0,
  );

  const physicalSumByMaterialKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of materials) {
      let sum = 0;
      for (const lot of m.lots) {
        const p = parsePhysicalInput(physicalBySerialKey[lot.serial_key]);
        if (p !== null) sum += p;
      }
      if (sum > 0 || m.lots.some((lot) => parsePhysicalInput(physicalBySerialKey[lot.serial_key]) === 0)) {
        map.set(m.materialKey, Math.round(sum * 1000) / 1000);
      }
    }
    return map;
  }, [materials, physicalBySerialKey]);

  useEffect(() => {
    if (!adjustmentDate.trim() || materials.length === 0) {
      setSurveyChecklistRows([]);
      setSurveyChecklistLoading(false);
      return;
    }
    setSurveyChecklistLoading(true);
    void fetchCycleSurveyChecklistRows(adjustmentDate, openingAsOfDate, materials)
      .then(setSurveyChecklistRows)
      .catch((e) => {
        console.error(e);
        setSurveyChecklistRows([]);
      })
      .finally(() => setSurveyChecklistLoading(false));
  }, [adjustmentDate, openingAsOfDate, materials]);

  const surveyRequiredCount = useMemo(
    () => surveyChecklistRows.filter((r) => r.adjustment_required).length,
    [surveyChecklistRows],
  );

  const canDownloadSurveyChecklist =
    Boolean(productName.trim() && adjustmentDate.trim() && selectedIds.size > 0);

  const downloadSurveyChecklist = async () => {
    if (!canDownloadSurveyChecklist) {
      alert("조정일·품목·분배 대상 생산입고를 먼저 선택하세요.");
      return;
    }
    if (materialsLoading || surveyChecklistLoading) {
      alert("실사 대상 목록을 불러오는 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    let rows = surveyChecklistRows;
    if (rows.length === 0 && materials.length > 0) {
      try {
        rows = await fetchCycleSurveyChecklistRows(adjustmentDate, openingAsOfDate, materials);
      } catch (e) {
        alert(e instanceof Error ? e.message : "체크리스트 생성 실패");
        return;
      }
    }
    if (rows.length === 0) {
      alert("다운로드할 실사 대상 LOT가 없습니다.\n분배 대상 생산입고를 확인하세요.");
      return;
    }
    downloadCycleSurveyChecklistCsv(
      {
        productName,
        adjustmentDate,
        openingAsOfDate,
        selectedProduction: selectedRows,
        memo,
      },
      rows,
    );
  };

  const toggleAllEligible = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(productionRows.filter((r) => !r.locked).map((r) => r.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleRow = (id: string, locked: boolean) => {
    if (locked) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const collectLotPhysical = () => {
    const rows: Array<{ lot_id: string; physical_qty: number }> = [];
    for (const m of materials) {
      for (const lot of m.lots) {
        if (lot.production_breakdown.length === 0) continue;
        const physical = parsePhysicalInput(physicalBySerialKey[lot.serial_key]);
        if (physical === null) continue;
        rows.push(...splitPhysicalAcrossConstituents(physical, lot.constituents));
      }
    }
    return rows;
  };

  const persistDraft = async (nextStep: number) => {
    const id = await saveCycleDraft({
      sessionId,
      adjustment_date: adjustmentDate,
      product_name: productName,
      memo,
      wizard_step: nextStep,
      production_header_ids: Array.from(selectedIds),
      lot_physical: collectLotPhysical(),
    });
    setSessionId(id);
    return id;
  };

  const goNext = async () => {
    if (step === 1) {
      if (!productName.trim()) {
        alert("품목을 선택하세요.");
        return;
      }
      if (!adjustmentDate) {
        alert("조정일(실사일)을 입력하세요.");
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (selectedIds.size === 0) {
        alert("분배 대상 생산입고를 1건 이상 선택하세요.");
        return;
      }
      setBusy(true);
      try {
        await persistDraft(3);
        setStep(3);
        setToast("임시 저장되었습니다.");
      } catch (e) {
        alert(e instanceof Error ? e.message : "임시 저장 실패");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 3) {
      setStep(4);
      try {
        await persistDraft(4);
      } catch {
        // preview step — non-blocking
      }
    }
  };

  const saveDraftOnly = async () => {
    if (!productName.trim()) {
      alert("품목을 선택하세요.");
      return;
    }
    setBusy(true);
    try {
      const id = await persistDraft(step);
      setToast("임시 저장되었습니다.");
      router.replace(`/harang/stock-adjustment/cycle/new?draft_id=${id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "임시 저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const confirmAdjustment = async () => {
    if (!productName.trim() || selectedIds.size === 0) {
      alert("품목과 분배 대상 생산입고를 확인하세요.");
      return;
    }
    if (usedSerialLots.length > 0 && missingPhysicalUsedLots.length > 0) {
      alert(
        `선택 구간에서 사용한 소비기한 LOT ${missingPhysicalUsedLots.length}건에 실사 수량이 없습니다.\n\n` +
          missingPhysicalUsedLots
            .slice(0, 5)
            .map((r) => `${r.material.material_name} ${formatLotDate(r.lot.lot_date)}`)
            .join("\n") +
          (missingPhysicalUsedLots.length > 5 ? `\n…외 ${missingPhysicalUsedLots.length - 5}건` : "") +
          "\n\n사용 LOT는 모두 실사 입력 후 확정하세요.",
      );
      return;
    }
    if (physicalLots.length === 0) {
      alert("실사 수량을 1건 이상 입력하세요.");
      return;
    }
    const ok = window.confirm(
      `조정을 확정할까요?\n\n` +
        `· 실사 LOT ${physicalLots.length}건 반영\n` +
        `· 선택 생산입고 ${selectedIds.size}건 잠금\n` +
        `· 사용량 조정은 각 소비기한 LOT를 쓴 생산입고에만 분배됩니다.\n` +
        (productionExtendsPastAdjustment
          ? `· 실사일(${adjustmentDate}) 이후 사용 이력은 재고에서 추가 차감됩니다.`
          : ""),
    );
    if (!ok) return;
    setBusy(true);
    try {
      const id = await persistDraft(4);
      await confirmCycleAdjustment(id);
      router.push(`/harang/stock-adjustment/cycle/${id}`);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string"
            ? (e as { message: string }).message
            : "조정 확정 실패";
      alert(msg);
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = async () => {
    if (!sessionId) {
      router.push("/harang/stock-adjustment");
      return;
    }
    const ok = window.confirm(
      "이 작성중 조정을 삭제하고 목록으로 돌아갈까요?\n\n임시 저장 내용이 모두 사라집니다.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteStockAdjustmentDraft(sessionId);
      router.push("/harang/stock-adjustment");
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-16 text-center text-slate-500 text-sm">불러오는 중…</div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 text-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/harang/stock-adjustment" className="text-sm text-slate-600 hover:text-slate-900">
              ← 재고조정 목록
            </Link>
            <h1 className="text-2xl font-semibold text-slate-900 mt-2">생산 사이클 재고조정</h1>
            <p className="text-sm text-slate-600 mt-1">원재료·파베이크 · 생산입고 분배</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {sessionId && (
              <span className="text-xs text-slate-500 font-mono">draft: {sessionId.slice(0, 8)}…</span>
            )}
            <button
              type="button"
              onClick={() => void discardDraft()}
              disabled={busy}
              className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              {sessionId ? "작성 취소" : "목록으로"}
            </button>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                step === s.n
                  ? "bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200"
                  : step > s.n
                    ? "bg-slate-100 text-slate-700"
                    : "bg-white text-slate-400 border border-slate-200"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  step >= s.n ? "bg-cyan-600 text-white" : "bg-slate-200 text-slate-500"
                }`}
              >
                {s.n}
              </span>
              {s.label}
            </div>
          ))}
        </nav>

        {toast && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {toast}
          </div>
        )}

        {canDownloadSurveyChecklist && (
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-900">실사 체크리스트</h2>
              <p className="text-xs text-slate-600">
                {materialsLoading || surveyChecklistLoading
                  ? "실사 대상 원료·LOT 목록을 불러오는 중…"
                  : surveyChecklistRows.length > 0
                    ? `생산 BOM 원료 ${new Set(surveyChecklistRows.map((r) => r.material_name)).size}종 · LOT ${surveyChecklistRows.length}건 (조정 필수 ${surveyRequiredCount}건)`
                    : "선택한 생산입고에 실사 대상 LOT가 없습니다."}
              </p>
              {step < 2 && selectedIds.size > 0 && (
                <p className="text-xs text-slate-500">
                  마지막 조정 이후 생산입고가 기본 선택됩니다. 2단계에서 분배 대상을 바꾼 뒤 다시
                  받으세요.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void downloadSurveyChecklist()}
              disabled={materialsLoading || surveyChecklistLoading || surveyChecklistRows.length === 0}
              className="shrink-0 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              엑셀(CSV) 다운로드
            </button>
          </section>
        )}

        {step === 1 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-slate-900">1. 기본 정보</h2>
            <label className="block text-sm text-slate-700">
              조정일 (실사일)
              <input
                type="date"
                value={adjustmentDate}
                onChange={(e) => setAdjustmentDate(e.target.value)}
                className="mt-1 w-full max-w-xs px-3 py-2 rounded-lg border border-slate-300 text-slate-900"
              />
              <span className="mt-1 block text-xs text-slate-500">
                실사한 날짜의 잔량을 입력하세요. 확정 시 현재고 = 실사 잔량 − (실사일 이후 사용량)으로 반영됩니다.
              </span>
            </label>
            <label className="block text-sm text-slate-700">
              품목명
              <select
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="mt-1 w-full max-w-md px-3 py-2 rounded-lg border border-slate-300 text-slate-900"
              >
                <option value="">선택…</option>
                {productOptions.map((name) => (
                  <option key={name} value={name}>
                    {displayHarangProductName(name)}
                  </option>
                ))}
              </select>
            </label>
            {productName && lastConfirmedDate && (
              <p className="text-xs text-slate-500">
                이 품목 마지막 조정 완료일: <strong>{lastConfirmedDate}</strong>
              </p>
            )}
            <label className="block text-sm text-slate-700">
              메모 (선택)
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="예: 5월 허니갈릭 생산 종료 후 실사"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900"
              />
            </label>
          </section>
        )}

        {step === 2 && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">2. 분배 대상 생산입고</h2>
                <p className="text-sm text-slate-600 mt-1">
                  {displayHarangProductName(productName)} · 선택 {selectedIds.size}건 · 수량 합계{" "}
                  {fmtNum(selectedQtySum)}
                </p>
                {productionExtendsPastAdjustment && (
                  <p className="text-xs text-amber-800 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    선택 생산입고 중 <strong>{latestSelectedProductionDate}</strong> 생산이 실사일(
                    {adjustmentDate})보다 늦습니다. 확정 시 재고는 실사 잔량에서 실사일 이후 사용량을
                    추가로 차감해 반영합니다.
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={
                    productionRows.filter((r) => !r.locked).length > 0 &&
                    productionRows.filter((r) => !r.locked).every((r) => selectedIds.has(r.id))
                  }
                  onChange={(e) => toggleAllEligible(e.target.checked)}
                />
                조정 가능 전체 선택
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-900">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-2 w-10" />
                    <th className="px-4 py-2">일자-No.</th>
                    <th className="px-4 py-2">제품명</th>
                    <th className="px-4 py-2 text-right">수량</th>
                    <th className="px-4 py-2">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {productionRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        해당 품목 생산입고가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    productionRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100 text-slate-900">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.id)}
                            disabled={row.locked}
                            onChange={() => toggleRow(row.id, row.locked)}
                          />
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap font-mono text-xs">
                          {row.production_no}
                        </td>
                        <td className="px-4 py-2">{displayHarangProductName(row.product_name)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtNum(row.finished_qty)}</td>
                        <td className="px-4 py-2">
                          {row.locked ? (
                            <span className="text-xs text-slate-500">조정 완료</span>
                          ) : (
                            <span className="text-xs text-cyan-700">조정 대상</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">3. 실사 입력</h2>
              <p className="text-sm text-slate-600 mt-1">
                소비기한(시리얼 LOT)별로 실사합니다. 입고는 재고 원장 이력일 뿐, 행 구분 기준은
                소비기한입니다.
              </p>
              {stockAsOfDate && (
                <p className="text-xs text-cyan-800 mt-2 bg-cyan-50 border border-cyan-100 rounded-lg px-3 py-2 space-y-1">
                  <span className="block">
                    <strong>시리얼 LOT</strong> = 소비기한. 같은 소비기한으로 여러 번 입고해도 실사는
                    소비기한당 한 줄입니다.
                  </span>
                  <span className="block text-slate-600">
                    <strong>시스템 재고</strong> = 실사일({adjustmentDate}) 원장 역산 — 체크리스트·재고현황과 같아야 합니다.{" "}
                    <strong>실 사용량</strong> = 구간 시작 재고 − 실재고
                    {openingAsOfDate ? (
                      <>
                        {" "}
                        (구간 시작 = <strong>{openingAsOfDate}</strong> 원장, 선택 생산 첫일 전날)
                      </>
                    ) : null}
                    . 행을 펼치면 생산입고별 BOM
                    사용 내역을 볼 수 있습니다.
                  </span>
                  <span className="block text-slate-600">
                    <strong>선택 생산입고에서 사용한 소비기한 LOT</strong>는 모두 실사 입력이 필요합니다.
                    {usedSerialLots.length > 0 && (
                      <>
                        {" "}
                        ({physicalLots.length}/{usedSerialLots.length}건 입력
                        {missingPhysicalUsedLots.length > 0 && (
                          <span className="text-amber-700">
                            {" "}
                            · 미입력 {missingPhysicalUsedLots.length}건
                          </span>
                        )}
                        )
                      </>
                    )}
                  </span>
                  {productionExtendsPastAdjustment && (
                    <span className="block text-amber-800">
                      실사 수량은 <strong>{adjustmentDate}</strong> 기준 잔량입니다. 확정 후 현재고 =
                      실사 잔량 − 실사일 이후 사용 합계입니다.
                    </span>
                  )}
                  {adjustmentDate && (
                    <span className="block">
                      <Link
                        href={`/harang/inventory?asOf=${encodeURIComponent(adjustmentDate)}`}
                        className="text-cyan-700 underline hover:text-cyan-900"
                        target="_blank"
                        rel="noreferrer"
                      >
                        재고현황에서 실사일({adjustmentDate}) 기준 재고 확인 →
                      </Link>
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-900">
                <thead className="bg-slate-50 text-left text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2">구분</th>
                    <th className="px-3 py-2">품목명</th>
                    <th className="px-3 py-2">시리얼LOT(소비기한)</th>
                    <th className="px-3 py-2 text-right">구간시작재고<br /><span className="font-normal text-slate-400">({openingAsOfDate ?? "—"})</span></th>
                    <th className="px-3 py-2 text-right">시스템 재고<br /><span className="font-normal text-slate-400">(실사일 {adjustmentDate} as-of)</span></th>
                    <th className="px-3 py-2 text-right">실 재고</th>
                    <th className="px-3 py-2 text-right">차이</th>
                    <th className="px-3 py-2 text-right">BOM<br /><span className="font-normal text-slate-400">(생산×레시피)</span></th>
                    <th className="px-3 py-2 text-right">LOT 차감<br /><span className="font-normal text-slate-400">(line_lots)</span></th>
                    <th className="px-3 py-2 text-right">실 사용량<br /><span className="font-normal text-slate-400">(구간시작−실재고)</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lotRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                        선택된 생산입고가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    usedSerialLots.map((row) => (
                      <Fragment key={row.lot.serial_key}>
                        <tr className="border-t border-slate-100 text-slate-900">
                          <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                            {row.lotIndex === 0
                              ? row.material.view_category === "parbake"
                                ? "파베이크"
                                : "원재료"
                              : ""}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.lotIndex === 0 ? (
                              <>
                                {row.material.material_name}
                                <span className="ml-1 text-xs text-slate-400">{row.material.unit}</span>
                              </>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-sm text-cyan-900 font-medium">
                                {formatLotDate(row.lot.lot_date) || "—"}
                              </span>
                              {row.lot.production_breakdown.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedSerialKeys((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(row.lot.serial_key)) next.delete(row.lot.serial_key);
                                      else next.add(row.lot.serial_key);
                                      return next;
                                    })
                                  }
                                  className="text-xs text-slate-500 underline hover:text-slate-800"
                                >
                                  이 LOT {row.lot.production_breakdown.length}건
                                  {row.lot.production_breakdown.length < selectedRows.length && (
                                    <span className="text-slate-400 no-underline">
                                      {" "}
                                      (선택 {selectedRows.length}건)
                                    </span>
                                  )}{" "}
                                  {expandedSerialKeys.has(row.lot.serial_key) ? "접기" : "펼치기"}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                            {fmtNum(row.lot.opening_stock)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${
                              row.lot.system_stock < 0 ? "text-rose-600" : ""
                            }`}
                          >
                            {fmtNum(row.lot.system_stock)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              value={physicalBySerialKey[row.lot.serial_key] ?? ""}
                              onChange={(e) =>
                                setPhysicalBySerialKey((prev) => ({
                                  ...prev,
                                  [row.lot.serial_key]: e.target.value,
                                }))
                              }
                              placeholder="실사"
                              className="w-28 px-2 py-1.5 rounded border border-slate-300 bg-white text-slate-900 text-right tabular-nums"
                            />
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${
                              row.variance === null
                                ? "text-slate-400"
                                : row.variance === 0
                                  ? "text-emerald-600"
                                  : row.variance < 0
                                    ? "text-rose-600"
                                    : "text-amber-600"
                            }`}
                          >
                            {row.variance === null ? "—" : fmtNum(row.variance)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                            {fmtNum(row.lot.bom_usage_in_selection)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                            {fmtNum(row.lot.line_lot_usage_in_selection)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">
                            {row.actualUsage === null ? "—" : fmtNum(row.actualUsage)}
                          </td>
                        </tr>
                        {expandedSerialKeys.has(row.lot.serial_key) &&
                          row.lot.production_breakdown.length > 0 && (
                            <tr className="border-t border-slate-100 bg-slate-50/60">
                              <td colSpan={10} className="px-3 py-3">
                                <p className="text-xs text-slate-500 mb-2">
                                  이 소비기한 LOT에서 실제 차감된 생산입고만 표시됩니다. 다른 소비기한 LOT를 쓴
                                  생산은 해당 LOT 행에 나타납니다.
                                </p>
                                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                  <table className="min-w-full text-xs text-slate-800">
                                    <thead className="bg-slate-50 text-slate-600">
                                      <tr>
                                        <th className="px-3 py-2 text-left">생산일자</th>
                                        <th className="px-3 py-2 text-right">수량</th>
                                        <th className="px-3 py-2 text-right">BOM</th>
                                        <th className="px-3 py-2 text-right">이 LOT 차감</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.lot.production_breakdown.map((prod) => (
                                        <tr key={prod.production_header_id} className="border-t border-slate-100">
                                          <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                                            {prod.production_no || prod.production_date}
                                          </td>
                                          <td className="px-3 py-1.5 text-right tabular-nums">
                                            {fmtNum(prod.finished_qty)}
                                          </td>
                                          <td className="px-3 py-1.5 text-right tabular-nums">
                                            {fmtNum(prod.bom_qty)}
                                          </td>
                                          <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                                            {fmtNum(prod.line_lot_usage)}
                                          </td>
                                        </tr>
                                      ))}
                                      <tr className="border-t border-slate-200 bg-slate-50 font-medium">
                                        <td className="px-3 py-2" colSpan={2}>
                                          계
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                          {fmtNum(
                                            row.lot.production_breakdown.reduce((s, p) => s + p.bom_qty, 0),
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                          {fmtNum(row.lot.line_lot_usage_in_selection)}
                                        </td>
                                      </tr>
                                      <tr className="border-t border-slate-100">
                                        <td className="px-3 py-2" colSpan={3}>
                                          입고
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                          {fmtNum(row.lot.initial_quantity)}
                                        </td>
                                      </tr>
                                      <tr className="border-t border-slate-200 bg-amber-50 font-semibold text-amber-950">
                                        <td className="px-3 py-2" colSpan={3}>
                                          재고량 (시스템)
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                          {fmtNum(row.lot.system_stock)}
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {adjustableLots.length > 0 && (
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-600">
                사용량 조정 필요:{" "}
                {adjustableLots.map((row) => (
                  <span key={row.lot.serial_key} className="mr-3">
                    {row.material.material_name} {formatLotDate(row.lot.lot_date)} BOM{" "}
                    {fmtNum(row.lot.bom_usage_in_selection)} → 실{" "}
                    <strong className="text-cyan-800">{fmtNum(row.actualUsage!)}</strong>
                    {row.usageDelta !== null && row.usageDelta !== 0 && (
                      <span className={row.usageDelta > 0 ? "text-amber-600" : "text-rose-600"}>
                        {" "}
                        ({row.usageDelta > 0 ? "+" : ""}
                        {fmtNum(row.usageDelta)})
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {step === 4 && (
          <section className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
              <h2 className="text-base font-semibold text-slate-900">4. 분배 확인 (LOT별)</h2>
              <p className="text-sm text-slate-600">
                확정 시 <strong>재고현황(실사일)</strong>에는 3단계 <strong>실 재고</strong>가 반영됩니다.
                아래 <strong>실사용</strong>은 생산 구간 소모량(BOM 대비 조정)이며 창고 잔량과 다릅니다.
              </p>
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                실사용 = 구간시작재고 − 실 재고 (+ 실사일 이후 사용). 엑셀 실사수량과 맞는지{" "}
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="underline font-medium hover:text-amber-950"
                >
                  3단계 실 재고
                </button>
                를 먼저 확인하세요.
              </p>
            </div>
            {materialConsumption.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <h3 className="text-sm font-semibold text-slate-900">BOM 대비 소모비율</h3>
                  <p className="text-xs text-slate-500 mt-0.5">원료별 합산 · 선택 생산입고 BOM 기준</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-slate-900">
                    <thead className="text-left text-xs uppercase text-slate-600 bg-slate-50/80">
                      <tr>
                        <th className="px-4 py-2">원료</th>
                        <th className="px-4 py-2 text-right">BOM</th>
                        <th className="px-4 py-2 text-right">실 재고<br /><span className="font-normal normal-case text-slate-400">(실사일 잔량)</span></th>
                        <th className="px-4 py-2 text-right">실사용<br /><span className="font-normal normal-case text-slate-400">(구간 소모)</span></th>
                        <th className="px-4 py-2 text-right">소모비율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materialConsumption.map((row) => (
                        <tr key={row.materialKey} className="border-t border-slate-100">
                          <td className="px-4 py-2">{row.material_name}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {fmtNum(row.bom_usage_qty)}
                            <span className="ml-1 text-xs text-slate-500">{row.unit}</span>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-800">
                            {physicalSumByMaterialKey.has(row.materialKey)
                              ? fmtNum(physicalSumByMaterialKey.get(row.materialKey)!)
                              : "—"}
                            <span className="ml-1 text-xs text-slate-500">{row.unit}</span>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">
                            {fmtNum(row.actual_usage_qty)}
                            <span className="ml-1 text-xs text-slate-500">{row.unit}</span>
                          </td>
                          <td
                            className={`px-4 py-2 text-right tabular-nums font-semibold ${
                              row.consumption_ratio_pct === null
                                ? "text-slate-400"
                                : row.consumption_ratio_pct > 100
                                  ? "text-amber-700"
                                  : row.consumption_ratio_pct < 100
                                    ? "text-cyan-700"
                                    : "text-emerald-700"
                            }`}
                          >
                            {formatConsumptionRatioPct(row.consumption_ratio_pct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {adjustableLots.length === 0 ? (
              <p className="text-sm text-slate-500 px-1">
                BOM과 실사용량 차이가 있는 LOT가 없습니다. 실재고만 반영됩니다.
              </p>
            ) : (
              adjustableLots.map((row) => {
                const usageDelta = row.usageDelta ?? 0;
                const breakdown = row.lot.production_breakdown;
                const dist = distributeDeltaForSerialLot(usageDelta, breakdown);
                const isOpen = expandedDistKeys.has(row.lot.serial_key);
                return (
                  <div
                    key={row.lot.serial_key}
                    className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedDistKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.lot.serial_key)) next.delete(row.lot.serial_key);
                          else next.add(row.lot.serial_key);
                          return next;
                        })
                      }
                      className="w-full px-4 py-3 border-b border-slate-100 bg-slate-50 text-left hover:bg-slate-100/80 transition-colors"
                    >
                      <p className="font-medium text-slate-900 flex flex-wrap items-center gap-2">
                        <span className="text-slate-400 text-xs">{isOpen ? "▼" : "▶"}</span>
                        {row.material.material_name}{" "}
                        <span className="font-mono text-xs text-cyan-800 bg-cyan-50 px-2 py-0.5 rounded">
                          {formatLotDate(row.lot.lot_date)}
                        </span>
                        <span className="text-sm font-normal text-slate-600">
                          실 재고{" "}
                          <strong className="text-emerald-800">{fmtNum(row.physical!)}</strong>
                          {row.material.unit}
                          <span className="mx-2 text-slate-300">|</span>
                          BOM {fmtNum(row.lot.bom_usage_in_selection)} → 실사용 {fmtNum(row.actualUsage!)}{" "}
                          {row.material.unit}
                          <span className="ml-2 text-cyan-700">
                            (조정 {usageDelta >= 0 ? "+" : ""}
                            {fmtNum(usageDelta)})
                          </span>
                        </span>
                        <span className="text-xs text-slate-500 ml-auto">
                          이 LOT {breakdown.length}건 · {isOpen ? "접기" : "분배 상세 펼치기"}
                        </span>
                      </p>
                    </button>
                    {isOpen && (
                      <table className="min-w-full text-sm text-slate-900">
                        <thead className="text-left text-xs uppercase text-slate-600">
                          <tr>
                            <th className="px-4 py-2">생산입고</th>
                            <th className="px-4 py-2 text-right">수량</th>
                            <th className="px-4 py-2 text-right">분배(±)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdown.length === 0 ? (
                            <tr className="border-t border-slate-100 text-slate-500">
                              <td colSpan={3} className="px-4 py-3 text-sm">
                                이 소비기한 LOT 차감 내역이 없어 생산입고 분배 대상이 없습니다.
                              </td>
                            </tr>
                          ) : (
                            breakdown.map((prod) => (
                              <tr key={prod.production_header_id} className="border-t border-slate-100 text-slate-900">
                                <td className="px-4 py-2 font-mono text-xs">
                                  {prod.production_no || prod.production_date}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums">
                                  {fmtNum(prod.system_usage > 0 ? prod.system_usage : prod.finished_qty)}
                                  {prod.system_usage > 0 && (
                                    <span className="block text-xs text-slate-400">LOT차감</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums text-cyan-700">
                                  {dist.get(prod.production_header_id) !== undefined
                                    ? `${dist.get(prod.production_header_id)! >= 0 ? "+" : ""}${fmtNum(Math.round(dist.get(prod.production_header_id)!))}`
                                    : "—"}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })
            )}
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              조정 확정 시 LOT별 재고가 반영되고, 사용량 조정은{" "}
              <strong>해당 소비기한 LOT를 실제 차감한 생산입고</strong>에만 분배됩니다.
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
              >
                이전
              </button>
            )}
            <button
              type="button"
              onClick={() => void saveDraftOnly()}
              disabled={busy || !productName}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              임시 저장
            </button>
          </div>
          {step < 4 ? (
            <button
              type="button"
              onClick={() => void goNext()}
              disabled={busy}
              className="px-5 py-2 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-400 disabled:opacity-50"
            >
              {busy ? "저장 중…" : "다음"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void confirmAdjustment()}
              disabled={
                busy ||
                physicalLots.length === 0 ||
                (usedSerialLots.length > 0 && missingPhysicalUsedLots.length > 0)
              }
              className="px-5 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy ? "확정 중…" : "조정 확정"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HarangStockAdjustmentCycleNewPage() {
  return (
    <Suspense fallback={<div className="px-4 py-16 text-center text-slate-500 text-sm">불러오는 중…</div>}>
      <CycleAdjustmentWizard />
    </Suspense>
  );
}
