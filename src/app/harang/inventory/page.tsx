"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HarangCategory, HarangInventoryLot, HarangInventoryTransaction } from "@/features/harang/types";
import { fetchLotStockAsOfMap, isOnOrBeforeAsOf, todayIsoDate } from "@/features/harang/inventoryAsOf";

type StockRow = {
  lot_id: string;
  lot_date: string;
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  unit: string;
  current_qty: number;
  inbound_date: string | null;
  recent_usage_date: string | null;
};

type ItemStockGroup = {
  group_key: string;
  category: HarangCategory;
  view_category: InventoryViewCategory;
  item_id: string;
  item_name: string;
  unit: string;
  total_qty: number;
  lot_count: number;
  latest_inbound_date: string | null;
  latest_usage_date: string | null;
  lots: StockRow[];
};

type InventoryViewCategory = "parbake" | HarangCategory;

function viewCategoryOf(row: Pick<StockRow, "category" | "item_name">): InventoryViewCategory {
  if (row.category === "raw_material" && isParbakeDoughName(row.item_name)) return "parbake";
  return row.category;
}

function categoryLabel(category: InventoryViewCategory): string {
  if (category === "parbake") return "파베이크";
  return category === "raw_material" ? "원재료" : "부자재";
}

function isParbakeDoughName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

function displayUnit(category: HarangCategory, itemName: string): "EA" | "g" {
  if (category === "packaging_material") return "EA";
  return isParbakeDoughName(itemName) ? "EA" : "g";
}

const VIEW_CATEGORY_ORDER: InventoryViewCategory[] = ["parbake", "raw_material", "packaging_material"];

function itemGroupKey(row: Pick<StockRow, "category" | "item_id">): string {
  return `${row.category}:${row.item_id}`;
}

function latestDate(values: (string | null | undefined)[]): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!latest || value > latest) latest = value;
  }
  return latest;
}

function groupRowsByItem(rows: StockRow[]): ItemStockGroup[] {
  const byItem = new Map<string, StockRow[]>();
  for (const row of rows) {
    const key = itemGroupKey(row);
    const list = byItem.get(key) ?? [];
    list.push(row);
    byItem.set(key, list);
  }
  return Array.from(byItem.values())
    .map((lots) => {
      const sortedLots = [...lots].sort((a, b) => a.lot_date.localeCompare(b.lot_date) || a.lot_id.localeCompare(b.lot_id));
      const first = sortedLots[0];
      return {
        group_key: itemGroupKey(first),
        category: first.category,
        view_category: viewCategoryOf(first),
        item_id: first.item_id,
        item_name: first.item_name,
        unit: first.unit,
        total_qty: sortedLots.reduce((sum, lot) => sum + lot.current_qty, 0),
        lot_count: sortedLots.length,
        latest_inbound_date: latestDate(sortedLots.map((lot) => lot.inbound_date)),
        latest_usage_date: latestDate(sortedLots.map((lot) => lot.recent_usage_date)),
        lots: sortedLots,
      };
    })
    .sort((a, b) => {
      const categoryDiff =
        VIEW_CATEGORY_ORDER.indexOf(a.view_category) - VIEW_CATEGORY_ORDER.indexOf(b.view_category);
      if (categoryDiff !== 0) return categoryDiff;
      return a.item_name.localeCompare(b.item_name, "ko-KR");
    });
}

export default function HarangInventoryPage() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [category, setCategory] = useState<"" | InventoryViewCategory>("");
  const [keyword, setKeyword] = useState("");
  const [showDepleted, setShowDepleted] = useState(false);
  const [asOfDate, setAsOfDate] = useState(() => searchParams.get("asOf")?.slice(0, 10) ?? "");
  const [loading, setLoading] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    const cut = asOfDate.slice(0, 10);
    const [lotsRes, usageRes, stockAsOf] = await Promise.all([
      supabase
        .from("harang_inventory_lots")
        .select(`
          id, category, item_id, item_code, item_name, lot_date, inbound_date, inbound_route,
          source_header_id, source_item_id, initial_quantity, current_quantity, unit, note, created_at
        `),
      supabase
        .from("harang_inventory_transactions")
        .select("id, category, item_id, item_code, item_name, lot_id, tx_date, tx_type, reference_no, quantity_delta, unit, note, created_at")
        .eq("tx_type", "usage")
        .order("tx_date", { ascending: false })
        .order("created_at", { ascending: false }),
      cut ? fetchLotStockAsOfMap(cut) : Promise.resolve(null),
    ]);
    setLoading(false);
    if (lotsRes.error) return alert(lotsRes.error.message);
    if (usageRes.error) return alert(usageRes.error.message);

    const lots = (lotsRes.data ?? []) as HarangInventoryLot[];
    const usageTx = ((usageRes.data ?? []) as HarangInventoryTransaction[]).filter((tx) =>
      isOnOrBeforeAsOf(cut, tx.tx_date),
    );
    const usageMap = new Map<string, string>();
    for (const tx of usageTx) {
      const key = String(tx.lot_id ?? "");
      if (!key) continue;
      if (!usageMap.has(key)) usageMap.set(key, tx.tx_date);
    }

    const mappedRows = lots.map((lot) => {
      const shownUnit = displayUnit(lot.category, lot.item_name);
      const qty = cut
        ? (stockAsOf?.get(lot.id) ?? 0)
        : Number(lot.current_quantity ?? 0);
      return {
        lot_id: lot.id,
        lot_date: lot.lot_date,
        category: lot.category,
        item_id: lot.item_id,
        item_code: lot.item_code,
        item_name: lot.item_name,
        unit: shownUnit,
        current_qty: qty,
        inbound_date: lot.inbound_date ?? null,
        recent_usage_date: usageMap.get(lot.id) ?? null,
      } as StockRow;
    });
    setRows(mappedRows);
  }, [asOfDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const searchMatchedKeys = q
      ? new Set(
          rows
            .filter(
              (row) =>
                row.item_name.toLowerCase().includes(q) || row.item_code.toLowerCase().includes(q)
            )
            .map(itemGroupKey)
        )
      : null;

    return rows.filter((row) => {
      if (category && viewCategoryOf(row) !== category) return false;
      if (searchMatchedKeys?.has(itemGroupKey(row))) return true;
      if (!showDepleted && row.current_qty <= 0) return false;
      return true;
    });
  }, [rows, category, showDepleted, keyword]);

  const itemGroups = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const groups = groupRowsByItem(filtered);
    if (showDepleted) return groups;
    return groups.filter((group) => {
      if (group.total_qty > 0) return true;
      if (!q) return false;
      return (
        group.item_name.toLowerCase().includes(q) ||
        group.lots.some((lot) => lot.item_code.toLowerCase().includes(q))
      );
    });
  }, [filtered, showDepleted, keyword]);

  const toggleItem = (groupKey: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">원부자재 재고현황</h1>
          <p className="mt-1 text-sm text-slate-600">
            기본적으로 잔량이 있는 품목·LOT만 표시합니다. 기준일을 선택하면 그날 포함 당시 재고(원장 역산)를
            봅니다. 재고조정 실사일과 맞추면 작업 3에 활용할 수 있습니다.
          </p>
        </div>
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="w-full sm:w-[11.5rem] shrink-0">
              <label
                htmlFor="inventory-as-of-date"
                className="mb-1.5 block text-xs font-medium text-slate-700"
              >
                기준일
                <span className="ml-1 font-normal text-slate-500">(비우면 현재)</span>
              </label>
              <input
                id="inventory-as-of-date"
                type="date"
                value={asOfDate}
                max={todayIsoDate()}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
            </div>

            <div className="w-full sm:w-[9.5rem] shrink-0">
              <label htmlFor="inventory-category" className="mb-1.5 block text-xs font-medium text-slate-700">
                분류
              </label>
              <select
                id="inventory-category"
                value={category}
                onChange={(e) => setCategory((e.target.value || "") as "" | InventoryViewCategory)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value="">분류 전체</option>
                <option value="parbake">파베이크</option>
                <option value="raw_material">원재료</option>
                <option value="packaging_material">부자재</option>
              </select>
            </div>

            <div className="min-w-0 flex-1 lg:min-w-[14rem]">
              <label htmlFor="inventory-keyword" className="mb-1.5 block text-xs font-medium text-slate-700">
                검색
              </label>
              <input
                id="inventory-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="품목명 / 코드 (소진 품목 포함)"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400"
              />
            </div>

            <div className="flex flex-wrap items-end gap-3 sm:gap-4">
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={showDepleted}
                  onChange={(e) => setShowDepleted(e.target.checked)}
                  className="size-4 rounded border-slate-300 text-cyan-600"
                />
                소진 LOT 포함
              </label>
              <button
                type="button"
                onClick={() => {
                  setCategory("");
                  setKeyword("");
                  setShowDepleted(false);
                  setAsOfDate("");
                }}
                className="h-10 shrink-0 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                필터 초기화
              </button>
            </div>
          </div>

          {asOfDate ? (
            <p className="mt-3 text-xs text-cyan-900 bg-cyan-50 border border-cyan-100 rounded-lg px-3 py-2">
              <span className="font-medium">조회 기준:</span>{" "}
              {asOfDate.replaceAll("-", ".")} 포함 시점 재고 (원장 역산)
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 w-8" aria-label="펼치기" />
                  <th className="px-3 py-2 text-left">분류</th>
                  <th className="px-3 py-2 text-left">품목명</th>
                  <th className="px-3 py-2 text-right">LOT 수</th>
                  <th className="px-3 py-2 text-right">총 재고수량</th>
                  <th className="px-3 py-2 text-left">최근 입고일</th>
                  <th className="px-3 py-2 text-left">최근 사용일</th>
                  <th className="px-3 py-2 text-left">상세보기</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-slate-500">불러오는 중...</td>
                  </tr>
                )}
                {!loading && itemGroups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-slate-500">재고 데이터가 없습니다.</td>
                  </tr>
                )}
                {!loading &&
                  itemGroups.map((group) => {
                    const isExpanded = expandedItems.has(group.group_key);
                    const asOfQuery = asOfDate ? `&asOf=${encodeURIComponent(asOfDate)}` : "";
                    const detailHref = `/harang/inventory/${group.category}/${group.item_id}?itemName=${encodeURIComponent(group.item_name)}${asOfQuery}`;
                    return (
                      <Fragment key={group.group_key}>
                        <tr
                          className="border-b border-slate-200 text-slate-900 bg-slate-50/80 hover:bg-slate-100/80 cursor-pointer"
                          onClick={() => toggleItem(group.group_key)}
                        >
                          <td className="px-3 py-2.5 text-slate-500">
                            <span
                              className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              aria-hidden
                            >
                              ▶
                            </span>
                          </td>
                          <td className="px-3 py-2.5">{categoryLabel(group.view_category)}</td>
                          <td className="px-3 py-2.5 font-medium">
                            {group.item_name}
                            {group.total_qty <= 0 && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-xs font-normal">
                                소진
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                            {group.lot_count.toLocaleString("ko-KR")}개
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-cyan-800">
                            {group.total_qty.toLocaleString("ko-KR")} {group.unit}
                          </td>
                          <td className="px-3 py-2.5">{group.latest_inbound_date ?? "-"}</td>
                          <td className="px-3 py-2.5">{group.latest_usage_date ?? "-"}</td>
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Link
                              href={detailHref}
                              className="px-2.5 py-1.5 rounded border border-cyan-300 text-cyan-800 bg-cyan-50 text-xs"
                            >
                              보기
                            </Link>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={8} className="px-0 py-0 border-b border-slate-200 bg-white">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-slate-100 text-slate-500 text-xs">
                                    <th className="px-3 py-2 pl-10 text-left font-normal">LOT</th>
                                    <th className="px-3 py-2 text-right font-normal">재고수량</th>
                                    <th className="px-3 py-2 text-left font-normal">입고일</th>
                                    <th className="px-3 py-2 text-left font-normal">최근 사용일</th>
                                    <th className="px-3 py-2 text-left font-normal">상세보기</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.lots.map((lot) => {
                                    const isDepleted = lot.current_qty <= 0;
                                    return (
                                    <tr
                                      key={lot.lot_id}
                                      className={`border-b border-slate-50 text-slate-800 last:border-b-0 ${isDepleted ? "bg-slate-50/60 text-slate-500" : ""}`}
                                    >
                                      <td className="px-3 py-2 pl-10 tabular-nums">
                                        {lot.lot_date}
                                        {isDepleted && (
                                          <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-xs">
                                            소진
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                                        {lot.current_qty.toLocaleString("ko-KR")} {lot.unit}
                                      </td>
                                      <td className="px-3 py-2">{lot.inbound_date ?? "-"}</td>
                                      <td className="px-3 py-2">{lot.recent_usage_date ?? "-"}</td>
                                      <td className="px-3 py-2">
                                        <Link
                                          href={`${detailHref}&lotId=${encodeURIComponent(lot.lot_id)}`}
                                          className="px-2.5 py-1.5 rounded border border-cyan-300 text-cyan-800 bg-cyan-50 text-xs"
                                        >
                                          보기
                                        </Link>
                                      </td>
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
