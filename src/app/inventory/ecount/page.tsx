import Link from "next/link";
import { formatDateTimeKorea } from "@/lib/formatDateTimeKorea";
import { getEcountInventoryPageData } from "@/features/ecount/inventory/getEcountInventoryPageData";
import { INVENTORY_TABS, INVENTORY_SORT_OPTIONS } from "@/features/ecount/inventory/types";
import type { InventorySort } from "@/features/ecount/inventory/types";
import NearExpiryAlertModal from "./NearExpiryAlertModal";

const TAB_PARAM = "tab";
const Q_PARAM = "q";
const SORT_PARAM = "sort";
const NEAR_EXPIRY_EXCLUDE_KEYWORDS = [
  "설탕",
  "소금",
  "천일염",
  "요거트향",
  "피자박스",
  "진공봉투",
  "배송박스",
  "무지봉투",
  "아이마크",
  "포장재",
  "박스",
  "스티커",
  "상자",
  "필름",
  "세척사과",
  "플래터",
  "가지",
  "지퍼백",
];

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ko-KR");
}

function parseLotDate(lotNo: string): Date | null {
  const m = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(lotNo.trim());
  if (!m) return null;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function diffDaysFromToday(target: Date): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((target.getTime() - today.getTime()) / 86400000);
}

function isExcludedName(itemName: string): boolean {
  const trimmed = itemName.trim();
  if (!trimmed) return true;
  if (trimmed === "바질") return true;
  return NEAR_EXPIRY_EXCLUDE_KEYWORDS.some((kw) => trimmed.includes(kw));
}

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function InventoryEcountPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tabParam = params[TAB_PARAM];
  const tab =
    typeof tabParam === "string" && INVENTORY_TABS.includes(tabParam as "원재료" | "부자재" | "반제품")
      ? (tabParam as "원재료" | "부자재" | "반제품")
      : "원재료";
  const q = typeof params[Q_PARAM] === "string" ? params[Q_PARAM] : "";
  const sortParam = params[SORT_PARAM];
  const sort: InventorySort =
    typeof sortParam === "string" && INVENTORY_SORT_OPTIONS.includes(sortParam as InventorySort)
      ? (sortParam as InventorySort)
      : "category";

  let data;
  try {
    data = await getEcountInventoryPageData(tab, q, sort);
  } catch {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-red-400 text-sm">
          재고 데이터를 불러올 수 없습니다. 로컬 개발환경의 Supabase 설정을 확인하세요.
        </p>
        <p className="text-slate-500 text-xs mt-2">
          .env.local에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 설정했는지 확인하세요.
        </p>
      </div>
    );
  }

  const basePath = "/inventory/ecount";
  const nearExpiryAlertKey = `${data.lastSyncedAt ?? "none"}|${data.sourceRefreshedAt ?? "none"}`;
  const nearExpiryRows = data.rows
    .map((row) => {
      const lotDate = parseLotDate(row.lot_no);
      if (!lotDate || isExcludedName(row.display_item_name)) return null;
      const dDay = diffDaysFromToday(lotDate);
      if (dDay < 0 || dDay > 30) return null;
      return {
        item_code: row.item_code,
        item_name: row.display_item_name,
        lot_no: row.lot_no,
        qty: row.qty,
        d_day: dDay,
      };
    })
    .filter((row): row is { item_code: string; item_name: string; lot_no: string; qty: number; d_day: number } => row != null)
    .sort((a, b) => (a.d_day !== b.d_day ? a.d_day - b.d_day : b.qty - a.qty));

  function buildQuery(t: string, searchQ: string, s: InventorySort) {
    const sp = new URLSearchParams();
    sp.set(TAB_PARAM, t);
    if (searchQ) sp.set(Q_PARAM, searchQ);
    if (s !== "category") sp.set(SORT_PARAM, s);
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col p-4 sm:p-6 max-w-6xl mx-auto">
      <NearExpiryAlertModal rows={nearExpiryRows} alertKey={nearExpiryAlertKey} />
      <h1 className="text-lg font-semibold text-slate-100 mb-4">
        이카운트 재고현황
      </h1>

      {/* 상단 요약: 한국 시간 24시간제 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 p-3 rounded-lg bg-slate-800/60 border border-slate-700/60 text-sm">
        <span className="text-slate-400">마지막 동기화</span>
        <span className="text-slate-200">{formatDateTimeKorea(data.lastSyncedAt)}</span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-400">RAW 갱신시각</span>
        <span className="text-slate-200">{formatDateTimeKorea(data.sourceRefreshedAt)}</span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-400">현재 탭</span>
        <span className="text-cyan-300 font-medium">{data.tab}</span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-400">표시 행 수</span>
        <span className="text-slate-200">{data.totalCount}건</span>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 border-b border-slate-700/60">
        {INVENTORY_TABS.map((t) => (
          <Link
            key={t}
            href={buildQuery(t, q, sort)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              data.tab === t
                ? "bg-slate-700/80 text-cyan-300 border-b-2 border-cyan-500 -mb-px"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            {t}
          </Link>
        ))}
      </div>

      {/* 정렬 */}
      <div className="flex items-center gap-2 mb-3 text-sm">
        <span className="text-slate-500">정렬:</span>
        <Link
          href={buildQuery(tab, q, "category")}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            sort === "category"
              ? "bg-cyan-500/20 text-cyan-300 font-medium"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/60"
          }`}
        >
          카테고리순
        </Link>
        <Link
          href={buildQuery(tab, q, "name")}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            sort === "name"
              ? "bg-cyan-500/20 text-cyan-300 font-medium"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/60"
          }`}
        >
          품목명순
        </Link>
      </div>

      {/* 검색 */}
      <form
        method="get"
        action={basePath}
        className="mb-4 flex gap-2 flex-wrap"
      >
        <input type="hidden" name={TAB_PARAM} value={tab} />
        {sort !== "category" && <input type="hidden" name={SORT_PARAM} value={sort} />}
        <input
          type="search"
          name={Q_PARAM}
          defaultValue={q}
          placeholder="품목코드 / 품목명 / LOT 검색"
          className="flex-1 min-w-[180px] max-w-md px-3 py-2 rounded-lg border border-slate-600 bg-slate-800/80 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 text-sm"
          aria-label="검색"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition-colors"
        >
          검색
        </button>
        {q && (
          <Link
            href={buildQuery(tab, "", sort)}
            className="px-4 py-2 rounded-lg text-slate-400 hover:text-slate-200 text-sm"
          >
            초기화
          </Link>
        )}
      </form>

      {/* 모바일: 카드형 리스트 (품목명 / 소비기한 / 재고수량 중심) */}
      <div className="space-y-2 md:hidden">
        {data.rows.length === 0 ? (
          <div className="py-8 px-3 text-center text-slate-500 border border-slate-700/60 rounded-lg bg-slate-800/40">
            표시할 데이터가 없습니다.
          </div>
        ) : (
          data.rows.map((row, i) => (
            <div
              key={`${row.item_code}-${row.lot_no}-${i}`}
              className="rounded-lg border border-slate-700/70 bg-slate-800/60 px-3 py-2.5 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-slate-50 font-medium text-sm leading-snug truncate">
                  {row.display_item_name}
                </p>
                <p className="text-cyan-300 font-semibold text-base tabular-nums">
                  {formatNumber(row.qty)}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                <span className="font-mono">
                  소비기한: <span className="text-slate-200">{row.lot_no}</span>
                </span>
                {row.category && (
                  <span className="truncate max-w-[40%] text-slate-500">
                    {row.category}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 데스크톱: 표 (품목코드 숨김, 가로 스크롤 허용) */}
      <div className="hidden md:block">
        <div className="overflow-x-auto rounded-lg border border-slate-700/60 bg-slate-800/40">
          <table className="w-full min-w-[640px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-600 bg-slate-800/80">
                <th className="text-left py-3 px-3 text-slate-400 font-medium whitespace-nowrap">
                  품목명
                </th>
                <th className="text-left py-3 px-3 text-slate-400 font-medium whitespace-nowrap">
                  LOT
                </th>
                <th className="text-right py-3 px-3 text-slate-400 font-medium whitespace-nowrap">
                  재고수량
                </th>
                <th className="text-left py-3 px-3 text-slate-400 font-medium whitespace-nowrap">
                  카테고리
                </th>
                <th className="text-right py-3 px-3 text-slate-400 font-medium whitespace-nowrap">
                  1박스(g)
                </th>
                <th className="text-right py-3 px-3 text-slate-400 font-medium whitespace-nowrap">
                  1개(g)
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 px-3 text-center text-slate-500"
                  >
                    표시할 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                data.rows.map((row, i) => (
                  <tr
                    key={`${row.item_code}-${row.lot_no}-${i}`}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30"
                  >
                    <td
                      className="py-2.5 px-3 text-slate-200 whitespace-nowrap max-w-[220px] truncate"
                      title={row.display_item_name}
                    >
                      {row.display_item_name}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300 font-mono text-xs whitespace-nowrap">
                      {row.lot_no}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200 tabular-nums font-semibold">
                      {formatNumber(row.qty)}
                    </td>
                    <td
                      className="py-2.5 px-3 text-slate-400 whitespace-nowrap max-w-[140px] truncate"
                      title={row.category ?? ""}
                    >
                      {row.category ?? "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-400 tabular-nums">
                      {formatNumber(row.box_weight_g)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-400 tabular-nums">
                      {formatNumber(row.unit_weight_g)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
