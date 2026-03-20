import Link from "next/link";
import { getProductionPlanPageData } from "@/features/production/plan/getProductionPlanPageData";
import { formatDateTimeKorea } from "@/lib/formatDateTimeKorea";

export const dynamic = "force-dynamic";

function formatQty(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ko-KR");
}

export default async function ProductionPlanPage() {
  let data;
  try {
    data = await getProductionPlanPageData();
  } catch {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <p className="text-red-400 text-sm">
          생산계획 데이터를 불러올 수 없습니다. Supabase 마이그레이션 적용 및 환경 변수를 확인하세요.
        </p>
        <p className="text-slate-500 text-xs mt-2">
          로컬에서는 .env.local의 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 확인하세요.
        </p>
        <Link href="/production" className="inline-block mt-4 text-cyan-400 text-sm hover:underline">
          ← 생산 허브
        </Link>
      </div>
    );
  }

  const byDate = new Map<string, typeof data.rows>();
  for (const r of data.rows) {
    const list = byDate.get(r.plan_date) ?? [];
    list.push(r);
    byDate.set(r.plan_date, list);
  }
  const dates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <Link href="/production" className="text-sm text-cyan-400 hover:underline">
          ← 생산 허브
        </Link>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">생산계획</h1>
      <p className="text-sm text-slate-500 mb-4">조회 전용 · 시트 동기화 후 반영됩니다.</p>

      {data.sync && (
        <div className="rounded-lg border border-slate-700 bg-space-800/60 px-3 py-2 text-xs text-slate-400 mb-6 space-y-1">
          <p>
            마지막 동기화:{" "}
            {data.sync.last_synced_at
              ? formatDateTimeKorea(data.sync.last_synced_at)
              : "—"}
            {data.sync.last_status ? ` · ${data.sync.last_status}` : ""}
          </p>
          {data.sync.source_refreshed_at && (
            <p>시트 갱신 시각: {formatDateTimeKorea(data.sync.source_refreshed_at)}</p>
          )}
          <p>행 수: {data.sync.row_count}</p>
        </div>
      )}

      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-space-800/80 p-8 text-center text-slate-500">
          등록된 생산계획이 없습니다. 시트 → 동기화 후 여기에 표시됩니다.
        </div>
      ) : (
        <div className="space-y-6">
          {dates.map((d) => (
            <section key={d} className="rounded-xl border border-slate-700 bg-space-800/50 overflow-hidden">
              <h2 className="text-sm font-medium text-cyan-300/90 px-4 py-2 border-b border-slate-700/80 bg-space-900/40">
                {d}
              </h2>
              <ul className="divide-y divide-slate-700/60">
                {(byDate.get(d) ?? []).map((row) => (
                  <li key={row.id} className="px-4 py-3 text-sm text-slate-200">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-slate-100">{row.product_name}</span>
                      <span className="text-slate-400 tabular-nums">수량 {formatQty(row.qty)}</span>
                    </div>
                    {(row.category || row.note) && (
                      <div className="mt-1 text-xs text-slate-500 space-x-2">
                        {row.category ? <span>구분: {row.category}</span> : null}
                        {row.note ? <span>비고: {row.note}</span> : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
