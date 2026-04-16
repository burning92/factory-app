"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMasterStore, type OutboundLine, type ProductionLog } from "@/store/useMasterStore";
import { calculateUsageSummary } from "@/features/production/history/calculations";
import { getJournalStorageKey } from "@/features/production/history/journalAllocation";
import type { DateGroupInput } from "@/features/production/history/types";
import type { DateGroupState, ProductOutput } from "../page";

/** 제품 표시명: "-일반", "-파베이크사용", "-브레드" 제거 */
function productDisplayName(label: string): string {
  const s = (label ?? "").trim();
  for (const suffix of [" - 일반", " - 파베이크사용", " - 브레드"]) {
    if (s.endsWith(suffix)) return s.slice(0, -suffix.length).trim();
  }
  return s;
}

type MaterialLike = { materialName: string; boxWeightG: number; unitWeightG: number };

function totalGFromQty(
  box: number,
  nack: number,
  g: number,
  material: MaterialLike | undefined
): number {
  if (!material) return g;
  if (material.boxWeightG === 0 && material.unitWeightG === 0) return g;
  const unitG = material.unitWeightG > 0 ? material.unitWeightG : material.boxWeightG;
  return box * material.boxWeightG + nack * unitG + g;
}

function getLines(log: ProductionLog): OutboundLine[] {
  if (Array.isArray(log.출고_라인) && log.출고_라인.length > 0) {
    return log.출고_라인;
  }
  return [
    {
      소비기한: log.소비기한 ?? "",
      박스: log.출고_박스 ?? 0,
      낱개: log.출고_낱개 ?? 0,
      g: log.출고_g ?? 0,
    },
  ];
}

/** 완료 목록에서 일지 생성 시, 서버 최신 출고를 스냅샷 원료행에 병합한다. */
function mergeOutboundFromLogs(
  materials: DateGroupState["materials"],
  logs: ProductionLog[],
  materialsList: MaterialLike[]
): DateGroupState["materials"] {
  const outboundByKey = new Map<string, number>();
  for (const log of logs) {
    const materialName = (log.원료명 ?? "").trim();
    if (!materialName) continue;
    const mat = materialsList.find((m) => m.materialName === materialName);
    for (const line of getLines(log)) {
      const outboundG = totalGFromQty(
        Number(line.박스 ?? 0),
        Number(line.낱개 ?? 0),
        Number(line.g ?? 0),
        mat
      );
      const expiryDate = String(line.소비기한 ?? "").trim();
      const key = `${materialName}\t${expiryDate}`;
      outboundByKey.set(key, (outboundByKey.get(key) ?? 0) + outboundG);
    }
  }

  const materialByName = new Map<string, DateGroupState["materials"][number]>();
  for (const card of materials) {
    const mn = (card.materialName ?? "").trim();
    materialByName.set(mn, { ...card, lots: card.lots.map((l) => ({ ...l })) });
  }

  for (const [mn, card] of Array.from(materialByName.entries())) {
    const nextLots = card.lots.map((lot) => {
      if (lot.sourceType === "manual") return lot;
      const key = `${mn}\t${(lot.expiryDate ?? "").trim()}`;
      return { ...lot, outboundQty: outboundByKey.get(key) ?? 0 };
    });
    materialByName.set(mn, { ...card, lots: nextLots });
  }

  for (const [key, qty] of Array.from(outboundByKey.entries())) {
    const [materialName, expiryDate] = key.split("\t");
    const card = materialByName.get(materialName);
    if (!card) {
      materialByName.set(materialName, {
        materialCardId: `${materialName}-${Date.now()}`,
        materialName,
        lots: [
          {
            lotRowId: `${materialName}-${expiryDate}-${Date.now()}`,
            sourceType: "from-log",
            expiryDate: expiryDate ?? "",
            outboundQty: qty,
            prevDayUnitCount: "",
            prevDayRemainderG: "",
            currentDayUnitCount: "",
            currentDayRemainderG: "",
          },
        ],
      });
      continue;
    }
    const exists = card.lots.some(
      (l) => l.sourceType === "from-log" && (l.expiryDate ?? "").trim() === (expiryDate ?? "")
    );
    if (!exists) {
      card.lots.push({
        lotRowId: `${materialName}-${expiryDate}-${Date.now()}`,
        sourceType: "from-log",
        expiryDate: expiryDate ?? "",
        outboundQty: qty,
        prevDayUnitCount: "",
        prevDayRemainderG: "",
        currentDayUnitCount: "",
        currentDayRemainderG: "",
      });
    }
  }

  return Array.from(materialByName.values());
}

type CompletedItem = {
  date: string;
  authorName: string;
  productLines: { name: string; qty: number }[];
  state: DateGroupState;
};

export default function CompletedListPage() {
  const router = useRouter();
  const {
    productionLogs,
    fetchBom,
    fetchMaterials,
    fetchProductionLogs,
    fetchProductionHistoryDateStates,
    productionHistoryDateStates,
    productionHistoryDateStatesLoading,
  } = useMasterStore();
  const [searchDate, setSearchDate] = useState("");
  const [searchAuthor, setSearchAuthor] = useState("");
  const [searchProduct, setSearchProduct] = useState("");
  /** 보기/인쇄 시 서버·출고 최신화 중 */
  const [openingJournalDate, setOpeningJournalDate] = useState<string | null>(null);

  /** 서버 기준 통일: production_history_date_state + production_logs 둘 다 로드. 사용량 계산과 동일한 날짜 집합 사용. */
  useEffect(() => {
    fetchBom();
    fetchProductionLogs();
    fetchProductionHistoryDateStates();
  }, [fetchBom, fetchProductionLogs, fetchProductionHistoryDateStates]);

  /** 사용량 계산과 동일 기준: production_history_date_state.second_closed_at IS NOT NULL 인 날짜만,
   * 且 해당 날짜에 production_logs 가 1건 이상 있는 경우만 표시. 테스트 후 로그만 삭제된 날짜는 제외. */
  const datesWithLogs = useMemo(() => {
    const set = new Set<string>();
    for (const log of productionLogs) {
      const d = (log.생산일자 ?? "").slice(0, 10);
      if (d) set.add(d);
    }
    return set;
  }, [productionLogs]);

  const completedList = useMemo((): CompletedItem[] => {
    const items: CompletedItem[] = [];
    for (const [date, row] of Object.entries(productionHistoryDateStates)) {
      if (!row.second_closed_at) continue;
      if (!datesWithLogs.has(date)) continue;
      const snapshot = row.state_snapshot;
      const state = snapshot && typeof snapshot === "object" ? (snapshot as DateGroupState) : null;
      if (!state) continue;
      const outputs = state.secondClosure?.productOutputs ?? [];
      const productLines: { name: string; qty: number }[] = outputs
        .map((o: ProductOutput) => {
          const name = productDisplayName(o.displayProductLabel ?? o.productName ?? "");
          const qty = typeof o.finishedQty === "number" ? o.finishedQty : 0;
          return { name, qty };
        })
        .filter((p) => p.name)
        .sort((a, b) => b.qty - a.qty);
      items.push({
        date,
        authorName: (row.author_name ?? state.authorName ?? "").trim() || (state.authorName ?? ""),
        productLines,
        state,
      });
    }
    items.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
    return items;
  }, [productionHistoryDateStates, datesWithLogs]);

  const filteredList = useMemo(() => {
    let list = completedList;
    if (searchDate.trim()) {
      const q = searchDate.trim().toLowerCase();
      list = list.filter((item) => item.date.includes(q));
    }
    if (searchAuthor.trim()) {
      const q = searchAuthor.trim().toLowerCase();
      list = list.filter((item) => item.authorName.toLowerCase().includes(q));
    }
    if (searchProduct.trim()) {
      const q = searchProduct.trim().toLowerCase();
      list = list.filter((item) =>
        item.productLines.some((p) => p.name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [completedList, searchDate, searchAuthor, searchProduct]);

  const openJournal = useCallback(
    async (date: string, openPrint?: boolean) => {
      setOpeningJournalDate(date);
      try {
        await Promise.all([
          fetchBom(),
          fetchMaterials(),
          fetchProductionLogs(),
          fetchProductionHistoryDateStates(),
        ]);
        const st = useMasterStore.getState();
        const row = st.getProductionHistoryDateState(date);
        const state = row?.state_snapshot && typeof row.state_snapshot === "object"
          ? (row.state_snapshot as DateGroupState)
          : null;
        if (!state) return;
        const logs = st.productionLogs.filter((l) => (l.생산일자 ?? "").slice(0, 10) === date);
        const materialsList = st.materials.map((m) => ({
          materialName: m.materialName,
          boxWeightG: m.boxWeightG,
          unitWeightG: m.unitWeightG,
        }));
        const materialsMetaFresh = st.materials.map((m) => ({
          materialName: m.materialName,
          unitWeightG: m.unitWeightG,
          boxWeightG: m.boxWeightG,
        }));
        const bomRefsFresh = st.bomList.map((b) => ({
          productName: b.productName,
          materialName: b.materialName,
          bomGPerEa: b.bomGPerEa,
          basis: b.basis,
        }));
        const mergedState: DateGroupState = {
          ...state,
          materials: mergeOutboundFromLogs(state.materials, logs, materialsList),
        };
        const computed = calculateUsageSummary(
          mergedState as unknown as DateGroupInput,
          bomRefsFresh,
          materialsMetaFresh
        );
        const payload = {
          date,
          dateGroup: mergedState as unknown as DateGroupInput,
          computedResult: computed,
          bomRefsSnapshot: bomRefsFresh,
        };
        if (typeof window === "undefined") return;
        sessionStorage.setItem(getJournalStorageKey(), JSON.stringify(payload));
        const params = new URLSearchParams();
        params.set("date", date);
        params.set("from", "completed");
        const returnToSearch = new URLSearchParams();
        if (searchDate.trim()) returnToSearch.set("date", searchDate.trim());
        if (searchAuthor.trim()) returnToSearch.set("author", searchAuthor.trim());
        if (searchProduct.trim()) returnToSearch.set("product", searchProduct.trim());
        const returnToBase = "/production/history/completed";
        const returnTo =
          returnToSearch.toString().length > 0
            ? `${returnToBase}?${returnToSearch.toString()}`
            : returnToBase;
        params.set("returnTo", encodeURIComponent(returnTo));
        if (openPrint) params.set("print", "1");
        const url = `/production/history/journal?${params.toString()}`;
        if (openPrint) {
          window.open(url, "_blank", "noopener,noreferrer");
        } else {
          router.push(url);
        }
      } catch {
        // ignore
      } finally {
        setOpeningJournalDate(null);
      }
    },
    [
      fetchBom,
      fetchMaterials,
      fetchProductionLogs,
      fetchProductionHistoryDateStates,
      router,
      searchDate,
      searchAuthor,
      searchProduct,
    ],
  );

  return (
    <div className="min-h-screen bg-space-950 text-slate-200 py-8 px-4 print:hidden">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-100">생산일지 완료 목록</h1>
          <Link
            href="/production/history"
            className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
          >
            ← 사용량 계산으로
          </Link>
        </div>

        <p className="text-slate-400 text-sm mb-6">
          2차 마감까지 완료된 날짜만 표시됩니다. 보기·인쇄 시 출고·마감·BOM을 서버에서 다시 불러온 뒤 생산일지를 만듭니다.
        </p>

        {productionHistoryDateStatesLoading && (
          <p className="text-slate-500 text-sm mb-4">목록 불러오는 중…</p>
        )}

        {/* 검색 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">날짜 검색</span>
            <input
              type="text"
              placeholder="예: 2026-03"
              value={searchDate}
              onChange={(e) => setSearchDate(e.target.value)}
              className="rounded-lg border border-slate-600 bg-space-900 px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:ring-2 focus:ring-cyan-500/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">작성자명 검색</span>
            <input
              type="text"
              placeholder="작성자명"
              value={searchAuthor}
              onChange={(e) => setSearchAuthor(e.target.value)}
              className="rounded-lg border border-slate-600 bg-space-900 px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:ring-2 focus:ring-cyan-500/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">제품명 검색</span>
            <input
              type="text"
              placeholder="제품명 포함"
              value={searchProduct}
              onChange={(e) => setSearchProduct(e.target.value)}
              className="rounded-lg border border-slate-600 bg-space-900 px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:ring-2 focus:ring-cyan-500/50"
            />
          </label>
        </div>

        {filteredList.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-space-800/80 p-8 text-center text-slate-500">
            {completedList.length === 0
              ? "완료된 생산일지가 없습니다. 사용량 계산에서 2차 마감을 완료한 날짜가 여기에 표시됩니다."
              : "검색 조건에 맞는 항목이 없습니다."}
          </div>
        ) : (
          <ul className="space-y-4">
            {filteredList.map((item) => (
              <li
                key={item.date}
                className="rounded-2xl border border-slate-700 bg-space-800/80 overflow-hidden shadow-glow"
              >
                <div className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-100 text-lg mb-1">{item.date}</div>
                    <div className="text-sm text-slate-400 mb-2">
                      작성자: {item.authorName || "—"}
                    </div>
                    <div className="text-sm text-slate-300 flex flex-wrap gap-x-2 gap-y-1">
                      {item.productLines.map((p, i) => (
                        <span key={i}>
                          [{p.name}: {p.qty.toLocaleString()}개]
                          {i < item.productLines.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                    <span className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium bg-cyan-500/20 text-cyan-300">
                      생산일지 완료
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={openingJournalDate === item.date}
                      onClick={() => void openJournal(item.date, false)}
                      className="rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {openingJournalDate === item.date ? "불러오는 중…" : "보기"}
                    </button>
                    <button
                      type="button"
                      disabled={openingJournalDate === item.date}
                      onClick={() => void openJournal(item.date, true)}
                      className="rounded-lg border border-slate-500 hover:bg-slate-700/80 text-slate-200 px-4 py-2 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      인쇄
                    </button>
                    <Link
                      href={`/production/history?date=${item.date}`}
                      className="rounded-lg border border-slate-500 hover:bg-slate-700/80 text-slate-200 px-4 py-2 text-sm font-medium inline-block"
                    >
                      수정
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
