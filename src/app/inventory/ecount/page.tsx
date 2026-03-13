import Link from "next/link";
import { getEcountInventoryPageData } from "@/features/ecount/inventory/getEcountInventoryPageData";
import { INVENTORY_TABS } from "@/features/ecount/inventory/types";

const TAB_PARAM = "tab";
const Q_PARAM = "q";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
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

  let data;
  try {
    data = await getEcountInventoryPageData(tab, q);
  } catch (err) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-red-400 text-sm">
          재고 데이터를 불러올 수 없습니다. 서버 설정을 확인하세요.
        </p>
        <p className="text-slate-500 text-xs mt-2">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </div>
    );
  }

  const basePath = "/inventory/ecount";

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col p-4 sm:p-6 max-w-6xl mx-auto">
      <h1 className="text-lg font-semibold text-slate-100 mb-4">
        이카운트 재고현황
      </h1>

      {/* 상단 요약 */}
      <div className="flex flex-wrap items-center gap-4 mb-4 p-3 rounded-lg bg-slate-800/60 border border-slate-700/60 text-sm">
        <span className="text-slate-400">마지막 동기화</span>
        <span className="text-slate-200">{formatDateTime(data.lastSyncedAt)}</span>
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
            href={
              q
                ? `${basePath}?${TAB_PARAM}=${encodeURIComponent(t)}&${Q_PARAM}=${encodeURIComponent(q)}`
                : `${basePath}?${TAB_PARAM}=${encodeURIComponent(t)}`
            }
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

      {/* 검색 */}
      <form
        method="get"
        action={basePath}
        className="mb-4 flex gap-2 flex-wrap"
      >
        <input type="hidden" name={TAB_PARAM} value={tab} />
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
            href={`${basePath}?${TAB_PARAM}=${encodeURIComponent(tab)}`}
            className="px-4 py-2 rounded-lg text-slate-400 hover:text-slate-200 text-sm"
          >
            초기화
          </Link>
        )}
      </form>

      {/* 표: 가로 스크롤 허용 */}
      <div className="overflow-x-auto rounded-lg border border-slate-700/60 bg-slate-800/40">
        <table className="w-full min-w-[720px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-600 bg-slate-800/80">
              <th className="text-left py-3 px-3 text-slate-400 font-medium whitespace-nowrap">
                품목코드
              </th>
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
                  colSpan={7}
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
                  <td className="py-2.5 px-3 text-slate-200 font-mono text-xs whitespace-nowrap">
                    {row.item_code}
                  </td>
                  <td className="py-2.5 px-3 text-slate-200 whitespace-nowrap max-w-[200px] truncate" title={row.display_item_name}>
                    {row.display_item_name}
                  </td>
                  <td className="py-2.5 px-3 text-slate-300 font-mono text-xs whitespace-nowrap">
                    {row.lot_no}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-200 tabular-nums">
                    {row.qty}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap max-w-[120px] truncate" title={row.category ?? ""}>
                    {row.category ?? "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-400 tabular-nums">
                    {row.box_weight_g}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-400 tabular-nums">
                    {row.unit_weight_g}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
