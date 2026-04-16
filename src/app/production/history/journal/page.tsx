"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMasterStore, type DoughLogRecord, type DoughProcessLine } from "@/store/useMasterStore";
import type {
  BomRowRef,
  DateGroupInput,
  ComputedResult,
} from "@/features/production/history/types";

/** 반죽 내역(사용일자 기준)을 원료별·LOT별 합산하여 총괄 표시용 배열로 반환. 밀가루 → 반죽원료 → 덧가루/덧기름 순. */
function aggregateDoughUsageForJournal(
  log: DoughLogRecord | null
): { name: string; g: number; lot: string }[] {
  if (!log) return [];
  const byKeyLot = (rec: Record<string, DoughProcessLine[]>) => {
    const map = new Map<string, number>();
    for (const [ingredientName, arr] of Object.entries(rec)) {
      if (!Array.isArray(arr)) continue;
      for (const line of arr) {
        const g = Number(line?.사용량_g) || 0;
        if (g <= 0) continue;
        const lot = line?.lot != null ? String(line.lot).trim() : "—";
        const name = ingredientName.trim() || "—";
        const key = `${name}\t${lot}`;
        map.set(key, (map.get(key) ?? 0) + g);
      }
    }
    return Array.from(map.entries()).map(([key, g]) => {
      const [name, lot] = key.split("\t");
      return { name: name ?? "—", g, lot: lot ?? "—" };
    });
  };

  const doughEntries = byKeyLot(log.반죽원료 ?? {});
  const dustEntries = byKeyLot(log.덧가루덧기름 ?? {});

  const FLOUR = "밀가루";
  const DOUGH_ORDER = ["설탕", "소금", "개량제", "이스트", "올리브오일"];
  const flour = doughEntries.filter((e) => e.name === FLOUR).sort((a, b) => (a.lot || "").localeCompare(b.lot || ""));
  const doughRest = doughEntries
    .filter((e) => e.name !== FLOUR)
    .sort((a, b) => {
      const ai = DOUGH_ORDER.indexOf(a.name);
      const bi = DOUGH_ORDER.indexOf(b.name);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.name.localeCompare(b.name) || (a.lot || "").localeCompare(b.lot || "");
    });
  const dustOil = dustEntries.sort((a, b) => a.name.localeCompare(b.name) || (a.lot || "").localeCompare(b.lot || ""));

  return [...flour, ...doughRest, ...dustOil];
}
import {
  getJournalStorageKey,
  buildPerProductUsage,
} from "@/features/production/history/journalAllocation";
import { getDateParbakeTypes } from "@/features/production/history/calculations";
import { mapTechnicalWarningsToOperatorMessages } from "@/features/production/history/operatorWarnings";
import { calculatePonoBreadDerived } from "@/features/production/history/ponoBreadDerived";
import type {
  ProductUsagePage,
  ProductUsageRow,
} from "@/features/production/history/journalTypes";
import type { PonoBreadDerived } from "@/features/production/history/ponoBreadDerived";

type StoredJournal = {
  date: string;
  dateGroup: DateGroupInput & { authorName?: string };
  computedResult: ComputedResult;
  /** 생산일지 보기 클릭 시점의 BOM — 스토어 BOM 로드 타이밍과 무관하게 동일한 제품별 원료 표시 */
  bomRefsSnapshot?: BomRowRef[];
};

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function JournalPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const date = searchParams.get("date") ?? "";
  const { bomList, fetchBom, fetchDoughLogs } = useMasterStore();
  /** 새로고침 직후 store에 BOM이 비어 있으면 fetch 완료까지 제품별 원료 표를 그리지 않음 */
  const [bomReady, setBomReady] = useState(() => bomList.length > 0);
  /** doughLogsMap 갱신 시 구독되어 반죽 사용량이 다시 계산되도록 함 (getDoughLogByDate만 쓰면 useMemo가 갱신 안 됨) */
  const doughLog = useMasterStore((s) =>
    date ? s.doughLogsMap[date.slice(0, 10)] ?? null : null
  );

  const [stored, setStored] = useState<StoredJournal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bomList.length > 0) {
      setBomReady(true);
      return;
    }
    let cancelled = false;
    void fetchBom().finally(() => {
      if (!cancelled) setBomReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchBom, bomList.length]);

  useEffect(() => {
    if (date) fetchDoughLogs();
  }, [date, fetchDoughLogs]);

  useEffect(() => {
    if (!date) {
      setError("날짜가 지정되지 않았습니다.");
      return;
    }
    try {
      const key = getJournalStorageKey();
      const raw =
        typeof window !== "undefined" ? sessionStorage.getItem(key) : null;
      if (!raw) {
        setError(
          "저장된 일지 데이터가 없습니다. 생산 → 생산일지 완료 목록에서 해당 날짜 '보기'를 눌러 주세요.",
        );
        setStored(null);
        return;
      }
      const data = JSON.parse(raw) as StoredJournal;
      if (data.date !== date) {
        setError(
          "선택한 날짜와 저장된 날짜가 다릅니다. 생산일지 완료 목록에서 다시 '보기'를 눌러 주세요.",
        );
        setStored(null);
        return;
      }
      setStored(data);
      setError(null);
    } catch {
      setError("데이터를 불러오는 데 실패했습니다.");
      setStored(null);
    }
  }, [date]);

  /** 저장 스냅샷이 있으면 그 BOM만 사용(일지 값 고정). 없으면 레거시 세션용으로 스토어 BOM */
  const bomRefsEffective = useMemo((): BomRowRef[] => {
    const snap = stored?.bomRefsSnapshot;
    if (Array.isArray(snap) && snap.length > 0) return snap;
    return bomList.map((b) => ({
      productName: b.productName,
      materialName: b.materialName,
      bomGPerEa: b.bomGPerEa,
      basis: b.basis,
    }));
  }, [stored?.bomRefsSnapshot, bomList]);

  const journalBomResolved = useMemo(() => {
    if (stored?.bomRefsSnapshot && stored.bomRefsSnapshot.length > 0) return true;
    return bomReady;
  }, [stored?.bomRefsSnapshot, bomReady]);

  const usageResult = useMemo(() => {
    if (!stored) return null;
    return buildPerProductUsage(
      stored.dateGroup,
      stored.computedResult,
      bomRefsEffective,
    );
  }, [stored, bomRefsEffective]);

  const ponoBreadDerived = useMemo((): PonoBreadDerived | null => {
    if (!stored) return null;
    return calculatePonoBreadDerived(
      stored.dateGroup,
      stored.computedResult,
      bomRefsEffective,
    );
  }, [stored, bomRefsEffective]);

  /** 반죽 내역(사용일자=생산일자 기준) 집계. P1 총괄 "반죽 사용량" 블록용. */
  const doughUsageLines = useMemo(
    () => aggregateDoughUsageForJournal(doughLog),
    [doughLog]
  );

  /** 페이지 배열: 총괄 1 + 제품별 N (빈 페이지 없음). Hook 순서 고정을 위해 항상 호출. */
  const journalPages = useMemo(() => {
    if (!usageResult) return [];
    const summary = { type: "summary" as const };
    const products = usageResult.productUsagePages.map((product) => ({
      type: "product" as const,
      product,
    }));
    return [summary, ...products];
  }, [usageResult]);

  const operatorMessages = useMemo(() => {
    if (!stored) return [];
    return mapTechnicalWarningsToOperatorMessages(stored.computedResult, {
      ponoApplicable: ponoBreadDerived?.applicable === true,
    });
  }, [stored, ponoBreadDerived?.applicable]);

  const backToHistory = useCallback(() => {
    const returnTo = searchParams.get("returnTo");
    if (returnTo) {
      try {
        const decoded = decodeURIComponent(returnTo);
        router.push(decoded);
        return;
      } catch {
        // decode 실패 시 아래 from 기준 fallback 사용
      }
    }

    const from = searchParams.get("from");
    if (from === "completed") {
      router.push("/production/history/completed");
      return;
    }

    // 기본: 사용량 계산으로
    router.push(`/production/history?date=${date}`);
  }, [router, date, searchParams]);

  /** URL에 ?print=1 이 있으면 데이터 로드 후 인쇄 대화상자 호출 (완료 목록 등에서 인쇄 버튼용) */
  useEffect(() => {
    if (!stored || searchParams.get("print") !== "1") return;
    const t = setTimeout(() => {
      window.print();
    }, 500);
    return () => clearTimeout(t);
  }, [stored, searchParams]);

  // Early returns: 모든 Hook 호출 이후에만 수행
  if (error) {
    return (
      <div className="min-h-screen bg-space-950 text-slate-200 py-12 px-4">
        <div className="max-w-lg mx-auto text-center space-y-4">
          <p className="text-amber-200">{error}</p>
          <Link
            href="/production/history"
            className="inline-block rounded-lg bg-cyan-600 text-white px-4 py-2"
          >
            사용량 계산으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  if (!stored || !usageResult) {
    return (
      <div className="min-h-screen bg-space-950 text-slate-200 py-12 px-4">
        <div className="max-w-lg mx-auto text-center">불러오는 중…</div>
      </div>
    );
  }

  if (stored && !journalBomResolved) {
    return (
      <div className="min-h-screen bg-space-950 text-slate-200 py-12 px-4">
        <div className="max-w-lg mx-auto text-center">원료 BOM 불러오는 중…</div>
      </div>
    );
  }

  const comp = stored.computedResult;
  /** 총괄 P1: 제품명 및 수량 (baseProductName만, 수량 큰 순) */
  const productLabelsAndQty = [...comp.productSummaries]
    .sort((a, b) => (b.finishedQty ?? 0) - (a.finishedQty ?? 0))
    .map(
      (p) =>
        `[${p.baseProductName ?? p.displayProductLabel} : ${(p.finishedQty ?? 0).toLocaleString()}개]`
    )
    .join(", ");
  const expiryDate = addDays(date, 364);

  const ponoApplicable = ponoBreadDerived?.applicable === true;
  const baseWasteRows = comp.baseWasteRows?.length ? comp.baseWasteRows : (comp.baseWaste?.resolved && comp.baseWaste?.baseSauceMaterialName ? [{
    resolved: true,
    parbakeName: comp.baseWaste.parbakeName,
    baseSauceMaterialName: comp.baseWaste.baseSauceMaterialName,
    baseWasteQty: comp.baseWaste.baseWasteQty,
    weightedBaseSaucePerUnitQty: comp.baseWaste.weightedBaseSaucePerUnitQty,
  }] : []);
  const baseUsageRows = comp.baseUsageRows?.length ? comp.baseUsageRows : (comp.baseUsage?.resolved && comp.baseUsage?.baseSauceMaterialName ? [{
    resolved: true,
    baseSauceMaterialName: comp.baseUsage.baseSauceMaterialName,
    totalBaseActualUsageBeforeWasteQty: comp.baseUsage.totalBaseActualUsageBeforeWasteQty,
    totalBaseUsageAfterWasteQty: comp.baseUsage.totalBaseUsageAfterWasteQty,
    fifoLots: comp.baseUsage.fifoLots,
    displayLabel: comp.baseUsage.displayLabel,
  }] : []);
  const authorName =
    (stored.dateGroup as { authorName?: string }).authorName?.trim() || "—";

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white text-slate-900">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          body { background: #fff !important; }
          .print\\:hidden { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `,
        }}
      />
      {/* 상단 안내 (인쇄 시 숨김) */}
      <div className="print:hidden sticky top-0 z-10 bg-slate-800 text-slate-200 px-4 py-3 flex items-center justify-between gap-4 shadow">
        <span className="font-medium">생산일지 · {date}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-cyan-600 text-white px-3 py-1.5 text-sm"
          >
            인쇄
          </button>
          <button
            type="button"
            onClick={backToHistory}
            className="rounded-lg border border-slate-500 px-3 py-1.5 text-sm"
          >
            돌아가기
          </button>
        </div>
      </div>

      <div className="w-full py-8 print:py-0 bg-slate-100 print:bg-white">
        <div className="journal-container max-w-[210mm] mx-auto w-full px-6 py-8 print:py-8 print:px-0 bg-white print:shadow-none shadow-md print:shadow-none rounded-none print:rounded-none">
        {journalPages.map((page, idx) => {
          if (page.type === "summary") {
            return (
              <section
                key={`summary-${idx}`}
                className="journal-page flex flex-col pb-8 print:pb-4"
              >
                {/* 상단: 좌측 기본정보 / 우측 승인 도장 */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 mb-6">
                  <div className="flex-1 min-w-0">
                    <h1 className="text-xl font-bold border-b border-slate-300 pb-2 mb-4 print:text-black">
                      생산일지 총괄
                    </h1>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm print:text-black leading-relaxed">
                      <dt className="text-slate-600 print:text-gray-700 font-medium">
                        생산일자
                      </dt>
                      <dd className="text-slate-900 print:text-black">{date}</dd>
                      <dt className="text-slate-600 print:text-gray-700 font-medium">
                        완제품 소비기한
                      </dt>
                      <dd className="text-slate-900 print:text-black">{expiryDate}</dd>
                      <dt className="text-slate-600 print:text-gray-700 font-medium">
                        작성자명
                      </dt>
                      <dd className="text-slate-900 print:text-black">{authorName}</dd>
                      <dt className="text-slate-600 print:text-gray-700 font-medium align-top pt-0.5">
                        제품명 및 수량
                      </dt>
                      <dd className="text-slate-900 print:text-black whitespace-pre-line">{productLabelsAndQty || "—"}</dd>
                    </dl>
                  </div>
                  <div className="shrink-0 flex flex-col items-center print:mt-0">
                    <span className="text-xs font-medium text-slate-500 print:text-gray-600 mb-1">
                      승인자
                    </span>
                    <div
                      className="border-2 border-slate-400 rounded bg-slate-50 print:bg-white print:border-gray-400"
                      style={{ width: "42mm", minHeight: "28mm" }}
                    >
                      <div className="w-full h-full min-h-[28mm]" />
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 text-sm print:text-black leading-relaxed">
                  <div>
                    <span className="text-slate-600 print:text-gray-700 font-medium block mb-0.5">도우 반죽량</span>
                    <p className="font-medium text-slate-900 print:text-black">{comp.doughMixQty.toLocaleString()}개</p>
                  </div>
                  <div>
                    <span className="text-slate-600 print:text-gray-700 font-medium block mb-0.5">도우 폐기량</span>
                    <p className="font-medium text-slate-900 print:text-black">{comp.doughWasteQty.toLocaleString()}개</p>
                  </div>
                  <div>
                    <span className="text-slate-600 print:text-gray-700 font-medium block mb-0.5">도우 사용량</span>
                    <p className="font-medium text-slate-900 print:text-black">
                      {ponoApplicable && ponoBreadDerived?.breadDoughUsageQty != null
                        ? ponoBreadDerived.breadDoughUsageQty.toLocaleString()
                        : comp.doughUsageQty.toLocaleString()}
                      개
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-600 print:text-gray-700 font-medium block mb-0.5">
                      {ponoApplicable ? "브레드 폐기량" : "파베이크 폐기량"}
                    </span>
                    <p className="font-medium text-slate-900 print:text-black">
                      {ponoApplicable && ponoBreadDerived?.breadWasteQty != null
                        ? ponoBreadDerived.breadWasteQty.toLocaleString()
                        : comp.parbakeWasteQty.toLocaleString()}
                      개
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-600 print:text-gray-700 font-medium block mb-0.5">파베이크 생산량(당일)</span>
                    <p className="font-medium text-slate-900 print:text-black">
                      {ponoApplicable && ponoBreadDerived?.breadDoughUsageQty != null
                        ? ponoBreadDerived.breadDoughUsageQty.toLocaleString()
                        : comp.sameDayParbakeProductionQty.toLocaleString()}
                      개
                    </p>
                  </div>
                </div>

                <div className="journal-section mt-6">
                  <p className="journal-section-title">반죽 사용량</p>
                  <div className="journal-section-body journal-section-list">
                    {doughUsageLines.length > 0 ? (
                      <ul className="list-none pl-0 space-y-1">
                        {doughUsageLines.map((line, i) => (
                          <li key={`${line.name}-${line.lot}-${i}`}>
                            {line.name}: {line.g.toLocaleString()}g ({line.lot})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-500 print:text-gray-600">없음</p>
                    )}
                  </div>
                </div>

                {ponoApplicable &&
                ponoBreadDerived?.ingredientUsageRows &&
                ponoBreadDerived.ingredientUsageRows.length > 0 ? (
                  <div className="journal-section">
                    <p className="journal-section-title">원료 폐기량</p>
                    <ul className="journal-section-body journal-section-list list-none pl-0 space-y-1">
                      {ponoBreadDerived.ingredientUsageRows.flatMap((r) =>
                        (r.lots ?? []).filter((lot) => lot.wasteDeductedQty > 0).map((lot) => (
                          <li key={`${r.materialName}-${lot.expiryDate}-waste`}>
                            {r.materialName} {lot.wasteDeductedQty.toLocaleString()}g ({lot.expiryDate || "—"})
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ) : baseWasteRows.some((r) => r.resolved && (r.baseWasteQty ?? 0) > 0) ? (
                  <div className="journal-section">
                    <p className="journal-section-title">베이스 폐기량</p>
                    <div className="journal-section-body journal-section-list">
                      <ul className="list-none pl-0 space-y-1">
                        {baseWasteRows.map((wasteRow, i) => {
                          if (!wasteRow.resolved || !wasteRow.baseSauceMaterialName) return null;
                          const qty = wasteRow.baseWasteQty ?? 0;
                          if (qty <= 0) return null;
                          const usageRow = baseUsageRows[i];
                          const wasteLotRows = usageRow?.fifoLots?.filter((l) => l.fifoDeductedWasteQty > 0) ?? [];
                          if (wasteLotRows.length > 0) {
                            return wasteLotRows.map((lot) => (
                              <li key={`${wasteRow.baseSauceMaterialName}-${lot.lotRowId}`}>
                                {wasteRow.baseSauceMaterialName} {lot.fifoDeductedWasteQty.toLocaleString()}g ({lot.expiryDate || "—"})
                              </li>
                            ));
                          }
                          return (
                            <li key={wasteRow.baseSauceMaterialName ?? wasteRow.parbakeName ?? i}>
                              {wasteRow.baseSauceMaterialName} {qty.toLocaleString()}g ({date})
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                ) : (() => {
                  const dateParbakeTypes = comp.productSummaries
                    ? getDateParbakeTypes(comp.productSummaries)
                    : [];

                  if (dateParbakeTypes.length > 1) {
                    return (
                      <div className="journal-section">
                        <p className="journal-section-title">베이스 폐기량</p>
                        <p className="journal-section-body text-slate-500 print:text-gray-600">
                          혼합 베이스 생산일입니다. 사용량 계산에서 파베이크 폐기량 상세(종류별)를 입력해 주세요.
                        </p>
                      </div>
                    );
                  }
                  return null;
                })()}

                {ponoApplicable &&
                ponoBreadDerived?.ingredientUsageRows &&
                ponoBreadDerived.ingredientUsageRows.length > 0 ? (
                  <div className="journal-section">
                    <p className="journal-section-title">원료 사용량</p>
                    <ul className="journal-section-body journal-section-list list-none pl-0 space-y-1">
                      {ponoBreadDerived.ingredientUsageRows.flatMap((r) =>
                        (r.lots ?? []).map((lot) => (
                          <li key={`${r.materialName}-${lot.expiryDate}-usage`}>
                            {r.materialName} {lot.finalUsageQty.toLocaleString()}g ({lot.expiryDate || "—"})
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ) : baseUsageRows.some((r) => r.resolved) ? (
                  <div className="journal-section">
                    <p className="journal-section-title">베이스 사용량</p>
                    <div className="journal-section-body journal-section-list">
                      <ul className="list-none pl-0 space-y-1">
                        {baseUsageRows.map((usageRow, i) => {
                          if (!usageRow.resolved || !usageRow.baseSauceMaterialName) return null;
                          const lotRows = usageRow.fifoLots?.filter((l) => l.effectiveUsageAfterWasteQty > 0) ?? [];
                          if (lotRows.length > 0) {
                            return lotRows.map((lot) => (
                              <li key={`${usageRow.baseSauceMaterialName}-${lot.lotRowId}`}>
                                {usageRow.baseSauceMaterialName} {lot.effectiveUsageAfterWasteQty.toLocaleString()}g ({lot.expiryDate || "—"})
                              </li>
                            ));
                          }
                          return (
                            <li key={usageRow.baseSauceMaterialName ?? i}>
                              {usageRow.displayLabel ?? `${usageRow.baseSauceMaterialName} ${(usageRow.totalBaseUsageAfterWasteQty ?? 0).toLocaleString()}g`}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                ) : null}

                <div className="journal-section">
                  <p className="journal-section-title">파베이크 목적별 생산량</p>
                  <ul className="journal-section-body journal-section-list list-none pl-0 space-y-1">
                    {comp.astronautParbakeOutputLabel && (
                      <li>우주인 파베이크(보관용): {comp.astronautParbakeOutputLabel}</li>
                    )}
                    {comp.saleParbakeOutputLabel && (
                      <li>판매용 파베이크(납품용): {comp.saleParbakeOutputLabel}</li>
                    )}
                  </ul>
                </div>

                {((comp.resolvedExtraParbakes?.length > 0 && comp.resolvedExtraParbakes.some((r) => r.qty > 0)) ||
                  (comp.unresolvedExtraParbakes?.length > 0 && comp.unresolvedExtraParbakes.some((r) => r.qty > 0))) && (
                  <div className="journal-section">
                    <p className="journal-section-title">추가 파베이크 사용량</p>
                    <ul className="journal-section-body journal-section-list list-none pl-0 space-y-1">
                      {comp.resolvedExtraParbakes
                        ?.filter((r) => r.qty > 0)
                        .map((r) => (
                          <li key={r.extraParbakeId}>
                            {r.parbakeName} {r.qty}개 ({r.expiryDate || "—"})
                          </li>
                        ))}
                      {comp.unresolvedExtraParbakes
                        ?.filter((r) => r.qty > 0)
                        .map((r) => (
                          <li key={r.extraParbakeId}>
                            추가 파베이크 {r.qty}개 ({r.expiryDate || "—"})
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          }

          const product = page.product;
          return (
            <section
              key={`product-${product.productKey}-${idx}`}
              className="journal-page flex flex-col pb-8 print:pb-4 print:text-black"
            >
              <h1 className="text-lg font-bold border-b border-slate-300 pb-2 mb-3 print:text-black">
                제품별 원료 사용량
              </h1>
              <h2 className="text-base font-semibold text-slate-800 mt-1 mb-2 print:text-black">
                {product.baseProductName}
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm leading-relaxed print:text-black">
                <dt className="text-slate-600 print:text-gray-700 font-medium">완제품 생산수량</dt>
                <dd className="text-slate-900 print:text-black">{product.finishedQty.toLocaleString()}개</dd>
                <dt className="text-slate-600 print:text-gray-700 font-medium">제품 구분</dt>
                <dd className="text-slate-900 print:text-black">{product.productStandardName || "—"}</dd>
                <dt className="text-slate-600 print:text-gray-700 font-medium">도우 사용 구분</dt>
                <dd className="text-slate-900 print:text-black">
                  {product.usesStoredParbake
                    ? "보관용 파베이크 사용"
                    : product.usesTodayDough
                      ? "당일 도우 사용"
                      : "—"}
                </dd>
              </dl>

              <div className="mt-5">
                <h3 className="journal-section-title mb-2">원료 사용량</h3>
                <table className="w-full text-sm border border-slate-300 border-collapse print:text-black">
                  <thead>
                    <tr className="bg-slate-100 print:bg-slate-100">
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold text-slate-800 print:text-black">
                        원료명
                      </th>
                      <th className="border border-slate-300 px-3 py-2 text-right font-semibold text-slate-800 print:text-black">
                        BOM
                      </th>
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold text-slate-800 print:text-black">
                        LOT(소비기한)
                      </th>
                      <th className="border border-slate-300 px-3 py-2 text-right font-semibold text-slate-800 print:text-black">
                        사용량
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const byMaterial = new Map<
                        string,
                        {
                          bomIndex: number;
                          bomDisplayQty: number | undefined;
                          usageType: ProductUsageRow["usageType"];
                          lots: { expiryDate: string; usageQty: number }[];
                        }
                      >();
                      product.usageRows.forEach((row, idx) => {
                        const key = row.materialName;
                        const lot = {
                          expiryDate: row.expiryDate,
                          usageQty: row.usageQty,
                        };
                        const existing = byMaterial.get(key);
                        if (!existing) {
                          byMaterial.set(key, {
                            bomIndex: idx,
                            bomDisplayQty: row.bomDisplayQty,
                            usageType: row.usageType,
                            lots: [lot],
                          });
                        } else {
                          existing.lots.push(lot);
                        }
                      });
                      const sorted = Array.from(byMaterial.entries())
                        .map(([materialName, g]) => ({
                          materialName,
                          ...g,
                          lots: [...g.lots].sort((a, b) =>
                            (a.expiryDate || "").localeCompare(b.expiryDate || "")
                          ),
                        }))
                        .sort(
                          (a, b) =>
                            a.bomIndex - b.bomIndex ||
                            a.materialName.localeCompare(b.materialName)
                        );
                      const lineBlockBase = "min-h-[1.25rem] flex items-center py-0.5 leading-relaxed";
                      const lineBlockClass = (i: number, total: number) =>
                        i < total - 1
                          ? `${lineBlockBase} border-b border-dashed border-slate-300/70`
                          : lineBlockBase;

                      return sorted.map(({ materialName, bomDisplayQty, usageType, lots }) => (
                        <tr key={materialName}>
                          <td
                            className="border border-slate-300 px-3 py-2 align-top leading-relaxed"
                            style={{ verticalAlign: "top" }}
                          >
                            {materialName}
                          </td>
                          <td
                            className="border border-slate-300 px-3 py-2 text-right align-top leading-relaxed"
                            style={{ verticalAlign: "top" }}
                          >
                            {usageType === "summary-reference"
                              ? "—"
                              : bomDisplayQty != null
                                ? `${bomDisplayQty.toLocaleString()}g`
                                : "—"}
                          </td>
                          <td
                            className="border border-slate-300 px-3 py-2 align-top"
                            style={{ verticalAlign: "top" }}
                          >
                            <div className="flex flex-col">
                              {lots.map((lot, i) => (
                                <div
                                  key={`${lot.expiryDate}-${i}`}
                                  className={lineBlockClass(i, lots.length)}
                                >
                                  {lot.expiryDate}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td
                            className="border border-slate-300 px-3 py-2 text-right align-top"
                            style={{ verticalAlign: "top" }}
                          >
                            <div className="flex flex-col text-right">
                              {lots.map((lot, i) => (
                                <div
                                  key={`${lot.expiryDate}-${i}`}
                                  className={lineBlockClass(i, lots.length)}
                                >
                                  {usageType === "summary-reference"
                                    ? "—"
                                    : `${lot.usageQty.toLocaleString()}g`}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>

              {/* 포노브레드 전용 계산: 해당 제품이 포노브레드이고 적용 가능할 때만 */}
              {ponoBreadDerived &&
                ponoBreadDerived.breadProductKey === product.productKey && (
                  <div className="mt-6 pt-4 border-t border-slate-300">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">
                      포노브레드 전용 계산
                    </h3>
                    {!ponoBreadDerived.applicable ? (
                      <p className="text-sm text-slate-600">
                        {ponoBreadDerived.reason}
                      </p>
                    ) : (
                      <>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                          <dt className="text-slate-600">도우 사용량</dt>
                          <dd>
                            {ponoBreadDerived.breadDoughUsageQty?.toLocaleString() ??
                              "—"}
                            개
                          </dd>
                          <dt className="text-slate-600">브레드 폐기량</dt>
                          <dd>
                            {ponoBreadDerived.breadWasteQty?.toLocaleString() ??
                              "—"}
                            개
                          </dd>
                        </dl>
                        {ponoBreadDerived.reason && (
                          <p className="mt-1 text-xs text-amber-600">
                            {ponoBreadDerived.reason}
                          </p>
                        )}
                        {ponoBreadDerived.ingredientUsageRows &&
                          ponoBreadDerived.ingredientUsageRows.some(
                            (r) => (r.lots ?? []).some((lot) => lot.wasteDeductedQty > 0)
                          ) && (
                            <div className="mt-4">
                              <h4 className="text-xs font-semibold text-slate-600 mb-2">
                                원료 폐기량
                              </h4>
                              <ul className="text-sm space-y-0.5">
                                {ponoBreadDerived.ingredientUsageRows.flatMap(
                                  (r) =>
                                    (r.lots ?? [])
                                      .filter((lot) => lot.wasteDeductedQty > 0)
                                      .map((lot) => (
                                        <li
                                          key={`${r.materialName}-${lot.expiryDate}-waste`}
                                        >
                                          {r.materialName}{" "}
                                          {lot.wasteDeductedQty.toLocaleString()}
                                          g ({lot.expiryDate || "—"})
                                        </li>
                                      ))
                                )}
                              </ul>
                            </div>
                          )}
                        {ponoBreadDerived.ingredientUsageRows &&
                          ponoBreadDerived.ingredientUsageRows.length > 0 && (
                            <div className="mt-4">
                              <h4 className="text-xs font-semibold text-slate-600 mb-2">
                                최종 원료 사용량
                              </h4>
                              <table className="w-full text-sm border border-slate-300 border-collapse">
                                <thead>
                                  <tr className="bg-slate-100">
                                    <th className="border border-slate-300 px-2 py-1 text-left">
                                      원료명
                                    </th>
                                    <th className="border border-slate-300 px-2 py-1 text-left">
                                      LOT(소비기한)
                                    </th>
                                    <th className="border border-slate-300 px-2 py-1 text-right">
                                      최종 사용량
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {ponoBreadDerived.ingredientUsageRows.flatMap(
                                    (r) =>
                                      (r.lots ?? []).map((lot) => (
                                        <tr
                                          key={`${r.materialName}-${lot.expiryDate}-${lot.lotRowId}`}
                                        >
                                          <td className="border border-slate-300 px-2 py-1">
                                            {r.materialName}
                                          </td>
                                          <td className="border border-slate-300 px-2 py-1">
                                            {lot.expiryDate || "—"}
                                          </td>
                                          <td className="border border-slate-300 px-2 py-1 text-right">
                                            {lot.finalUsageQty.toLocaleString()}g
                                          </td>
                                        </tr>
                                      ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                      </>
                    )}
                  </div>
                )}
            </section>
          );
        })}
        </div>
      </div>
    </div>
  );
}

export default function JournalPage() {
  return (
    <Suspense fallback={<div className="p-4">로딩 중...</div>}>
      <JournalPageContent />
    </Suspense>
  );
}
