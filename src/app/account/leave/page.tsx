"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type DeductionRow = {
  id: number;
  usage_date: string;
  days: number | string;
  memo: string | null;
};

export default function AccountLeavePage() {
  const { profile, loading: authLoading } = useAuth();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [totalDays, setTotalDays] = useState<number | null>(null);
  const [deductions, setDeductions] = useState<DeductionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    const [tRes, dRes] = await Promise.all([
      supabase.from("leave_annual_totals").select("total_days").eq("profile_id", profile.id).eq("year", year).maybeSingle(),
      supabase
        .from("leave_deductions")
        .select("id,usage_date,days,memo")
        .eq("profile_id", profile.id)
        .eq("year", year)
        .order("usage_date", { ascending: false }),
    ]);
    if (tRes.error) {
      setError(tRes.error.message);
      setLoading(false);
      return;
    }
    if (dRes.error) {
      setError(dRes.error.message);
      setLoading(false);
      return;
    }
    const td = tRes.data?.total_days;
    setTotalDays(td != null && Number.isFinite(Number(td)) ? Number(td) : 0);
    setDeductions((dRes.data ?? []) as DeductionRow[]);
    setLoading(false);
  }, [profile?.id, year]);

  useEffect(() => {
    if (authLoading) return;
    if (!profile?.id) {
      setLoading(false);
      return;
    }
    load();
  }, [authLoading, profile?.id, load]);

  const used = deductions.reduce((s, r) => {
    const d = Number(r.days);
    return s + (Number.isFinite(d) ? d : 0);
  }, 0);
  const remain = (totalDays ?? 0) - used;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-lg mx-auto">
      <Link href="/account" className="text-sm text-cyan-400 hover:underline mb-4 inline-block">
        ← 계정
      </Link>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">나의 연차</h1>
      <p className="text-slate-500 text-sm mb-6">발생 총량·차감 내역은 관리자가 등록합니다. 문의는 관리자에게 해 주세요.</p>

      {error && (
        <p className="text-red-400 text-sm mb-4" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs text-slate-400">연도</label>
        <input
          type="number"
          min={2000}
          max={2100}
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || year)}
          className="w-24 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
        />
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      ) : !profile?.id ? (
        <p className="text-slate-500 text-sm">로그인이 필요합니다.</p>
      ) : (
        <>
          <div className="rounded-xl border border-slate-700 bg-space-800/80 p-4 mb-4 space-y-2 text-sm">
            <div className="flex justify-between text-slate-300">
              <span>발생 총량</span>
              <span className="tabular-nums font-medium text-slate-100">{(totalDays ?? 0).toLocaleString("ko-KR")} 일</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>차감 합계</span>
              <span className="tabular-nums">{used.toLocaleString("ko-KR")} 일</span>
            </div>
            <div className="flex justify-between border-t border-slate-700 pt-2 text-cyan-200/90">
              <span className="font-medium">잔여</span>
              <span className="tabular-nums font-semibold">{remain.toLocaleString("ko-KR")} 일</span>
            </div>
          </div>

          <h2 className="text-sm font-semibold text-slate-300 mb-2">차감 내역</h2>
          <ul className="space-y-2">
            {deductions.length === 0 ? (
              <li className="text-slate-500 text-sm">등록된 차감이 없습니다.</li>
            ) : (
              deductions.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-slate-700/80 bg-space-900/50 px-3 py-2 text-sm text-slate-300"
                >
                  <span className="tabular-nums">{String(r.usage_date).slice(0, 10)}</span>
                  <span className="mx-2 text-slate-600">·</span>
                  <span className="tabular-nums">{Number(r.days).toLocaleString("ko-KR")}일</span>
                  {r.memo ? <span className="text-slate-500"> — {r.memo}</span> : null}
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}
