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
  source?: string | null;
};
type AdjustmentRow = {
  id: number;
  usage_date: string;
  adjust_days: number | string;
  reason: string | null;
  source?: string | null;
};

export default function AccountLeavePage() {
  const { profile, loading: authLoading } = useAuth();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [totalDays, setTotalDays] = useState<number | null>(null);
  const [deductions, setDeductions] = useState<DeductionRow[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    const [tRes, dRes, aRes] = await Promise.all([
      supabase.from("leave_annual_totals").select("total_days").eq("profile_id", profile.id).eq("year", year).maybeSingle(),
      supabase
        .from("leave_deductions")
        .select("id,usage_date,days,memo,source")
        .eq("profile_id", profile.id)
        .eq("year", year)
        .order("usage_date", { ascending: false }),
      supabase
        .from("leave_adjustments")
        .select("id,usage_date,adjust_days,reason,source")
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
    if (aRes.error) {
      setError(aRes.error.message);
      setLoading(false);
      return;
    }
    const td = tRes.data?.total_days;
    setTotalDays(td != null && Number.isFinite(Number(td)) ? Number(td) : 0);
    setDeductions((dRes.data ?? []) as DeductionRow[]);
    setAdjustments((aRes.data ?? []) as AdjustmentRow[]);
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
  const added = adjustments.reduce((s, r) => {
    const d = Number(r.adjust_days);
    return s + (Number.isFinite(d) ? d : 0);
  }, 0);
  const remain = Math.max(0, (totalDays ?? 0) + added - used);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-lg mx-auto">
      <Link href="/account" className="text-sm text-cyan-400 hover:underline mb-4 inline-block">
        ← 계정
      </Link>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">나의 연차</h1>
      <p className="text-slate-500 text-sm mb-6">
        사내 운영 기준에 따라 등록된 부여일수, 추가 부여, 사용 내역을 바탕으로 현재 잔여일수를 참고용으로 보여줍니다.
      </p>
      <div className="mb-6 rounded-xl border border-cyan-700/60 bg-cyan-950/15 px-4 py-3 text-xs leading-relaxed text-cyan-100">
        <p className="mb-1 font-semibold text-cyan-200">연차 관리 기준 안내</p>
        <p className="text-cyan-100/90">
          본 화면은 사내 연차 관리 및 사용 내역 확인을 위한 참고용 화면입니다.
        </p>
        <div className="mt-2 rounded-lg border border-cyan-700/40 bg-cyan-950/10 px-3 py-2 text-[11px] text-cyan-100/90">
          <p>
            표시되는 일수는 관리자 등록값, 추가 부여, 사용(차감) 내역을 반영한 관리 기준 값이며, 법정 연차유급휴가의 발생일수 또는
            최종 정산 결과와 차이가 있을 수 있습니다.
          </p>
          <p className="mt-2 font-medium text-cyan-100">현재 관리 잔여 = 운영 기준 부여일수 + 추가 부여 − 사용/차감 합계</p>
          <p className="text-cyan-100/80">예) 부여 15일, 추가 1일, 사용 3.5일 → 현재 관리 잔여 12.5일</p>
        </div>
      </div>

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
              <span>운영 기준 부여일수</span>
              <span className="tabular-nums font-medium text-slate-100">{(totalDays ?? 0).toLocaleString("ko-KR")} 일</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>추가 부여</span>
              <span className="tabular-nums text-emerald-300">+{added.toLocaleString("ko-KR")} 일</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>사용/차감 합계</span>
              <span className="tabular-nums">{used.toLocaleString("ko-KR")} 일</span>
            </div>
            <div className="flex justify-between border-t border-slate-700 pt-2 text-cyan-200/90">
              <span className="font-medium">현재 관리 잔여</span>
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
                  {r.source === "production_plan" ? (
                    <span className="mr-1.5 rounded bg-violet-500/25 px-1.5 py-0.5 text-[10px] text-violet-200">
                      생산계획
                    </span>
                  ) : null}
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
