"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMasterStore } from "@/store/useMasterStore";
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

type CompletedItem = {
  date: string;
  authorName: string;
  productLines: { name: string; qty: number }[];
  state: DateGroupState;
};

export default function CompletedListPage() {
  const router = useRouter();
  const {
    bomList,
    materials,
    productionLogs,
    fetchBom,
    fetchProductionLogs,
    fetchProductionHistoryDateStates,
    productionHistoryDateStates,
    productionHistoryDateStatesLoading,
    getProductionHistoryDateState,
  } = useMasterStore();
  const [searchDate, setSearchDate] = useState("");
  const [searchAuthor, setSearchAuthor] = useState("");
  const [searchProduct, setSearchProduct] = useState("");

  /** 서버 기준 통일: production_history_date_state + production_logs 둘 다 로드. 사용량 계산과 동일한 날짜 집합 사용. */
  useEffect(() => {
    fetchBom();
    fetchProductionLogs();
    fetchProductionHistoryDateStates();
  }, [fetchBom, fetchProductionLogs, fetchProductionHistoryDateStates]);

  const bomRefs = useMemo(
    () =>
      bomList.map((b) => ({
        productName: b.productName,
        materialName: b.materialName,
        bomGPerEa: b.bomGPerEa,
        basis: b.basis,
      })),
    [bomList],
  );

  const materialsMeta = useMemo(
    () =>
      materials.map((m) => ({
        materialName: m.materialName,
        unitWeightG: m.unitWeightG,
        boxWeightG: m.boxWeightG,
      })),
    [materials],
  );

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
    (date: string, openPrint?: boolean) => {
      const row = getProductionHistoryDateState(date);
      const state = row?.state_snapshot && typeof row.state_snapshot === "object"
        ? (row.state_snapshot as DateGroupState)
        : null;
      if (!state) return;
      try {
        const computed = calculateUsageSummary(state as unknown as DateGroupInput, bomRefs, materialsMeta);
        const payload = {
          date,
          dateGroup: state as unknown as DateGroupInput,
          computedResult: computed,
        };
        if (typeof window === "undefined") return;
        sessionStorage.setItem(getJournalStorageKey(), JSON.stringify(payload));
        const params = new URLSearchParams();
        params.set("date", date);
        params.set("from", "completed");
        // 완료 목록 검색 조건을 그대로 보존할 수 있도록 returnTo에 인코딩
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
      }
    },
    [getProductionHistoryDateState, bomRefs, materialsMeta, router, searchDate, searchAuthor, searchProduct],
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
          2차 마감까지 완료된 날짜만 표시됩니다. 목록은 서버에 저장된 마감 상태를 기준으로 불러옵니다.
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
                      onClick={() => openJournal(item.date, false)}
                      className="rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 text-sm font-medium"
                    >
                      보기
                    </button>
                    <button
                      type="button"
                      onClick={() => openJournal(item.date, true)}
                      className="rounded-lg border border-slate-500 hover:bg-slate-700/80 text-slate-200 px-4 py-2 text-sm font-medium"
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
