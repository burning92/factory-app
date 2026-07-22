"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Info, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isAdminLikeRole } from "@/lib/roles";
import { useAuth } from "@/contexts/AuthContext";

type ViolationRow = {
  production_header_id: string;
  production_date: string;
  production_no: string;
  product_name: string;
  material_name: string;
  material_category: string;
  lot_date: string;
  inbound_date: string;
  quantity_used: number;
  unit: string;
  line_lot_id: string;
};

function formatYmdDot(iso: string): string {
  return iso ? iso.replaceAll("-", ".") : "";
}

export default function ProductionLotAuditPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<ViolationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("harang_list_production_lot_inbound_violations");
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as ViolationRow[]);
  }, []);

  useEffect(() => {
    if (isAdminLikeRole(profile?.role)) void load();
  }, [profile?.role, load]);

  if (!isAdminLikeRole(profile?.role)) {
    return <div className="px-6 py-10 text-slate-600">관리자만 접근할 수 있습니다.</div>;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto">
        <Link
          href="/harang/admin"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          하랑 마스터 관리
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">과거 생산입고 LOT 이력 (참고)</h1>
            <p className="mt-1 text-sm text-slate-600">
              생산일보다 늦게 입고된 LOT가 배정된 과거 건을 조회합니다. 정리·수정은 필수가 아닙니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
          <p>
            신규 생산입고부터는 입고일이 생산일보다 늦은 LOT를 사용할 수 없습니다. 아래 목록은 과거 데이터
            참고용이며, 재고조정 사이클 확정과는 무관합니다.
          </p>
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
            <p className="mt-1 text-xs text-red-700">
              Supabase에 마이그레이션 <code className="text-red-900">20260623160000</code>이 적용되었는지 확인하세요.
            </p>
          </div>
        ) : null}

        {!loading && !error && rows.length === 0 ? (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-900">
            입고일 위반 건이 없습니다.
          </div>
        ) : null}

        {!loading && rows.length > 0 ? (
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
              총 <strong className="text-slate-800">{rows.length}</strong>건
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm text-slate-800">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="px-3 py-2 text-left">생산일</th>
                    <th className="px-3 py-2 text-left">생산번호</th>
                    <th className="px-3 py-2 text-left">품목</th>
                    <th className="px-3 py-2 text-left">원료/부자재</th>
                    <th className="px-3 py-2 text-left">소비기한 LOT</th>
                    <th className="px-3 py-2 text-left">입고일</th>
                    <th className="px-3 py-2 text-right">사용량</th>
                    <th className="px-3 py-2 text-center">상세</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.line_lot_id} className="border-b border-slate-100 hover:bg-slate-50/80">
                      <td className="px-3 py-2 tabular-nums">{formatYmdDot(row.production_date)}</td>
                      <td className="px-3 py-2">{row.production_no}</td>
                      <td className="px-3 py-2">{row.product_name}</td>
                      <td className="px-3 py-2">{row.material_name}</td>
                      <td className="px-3 py-2 tabular-nums">{formatYmdDot(row.lot_date)}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">{formatYmdDot(row.inbound_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(row.quantity_used).toLocaleString("ko-KR", { maximumFractionDigits: 3 })}
                        <span className="ml-0.5 text-slate-500">{row.unit}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Link
                          href={`/harang/production-input/${row.production_header_id}`}
                          className="text-cyan-700 hover:underline"
                        >
                          보기
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {loading ? <p className="mt-6 text-center text-sm text-slate-500">불러오는 중…</p> : null}
      </div>
    </div>
  );
}
