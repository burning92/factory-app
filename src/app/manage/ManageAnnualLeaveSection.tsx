"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export type ManageLeaveProfileRow = {
  id: string;
  login_id: string;
  display_name: string | null;
  organization_id: string;
  organizations?: { organization_code: string; name: string } | { organization_code: string; name: string }[] | null;
};

type LeaveDeductionRow = {
  id: number;
  profile_id: string;
  year: number;
  usage_date: string;
  days: number | string;
  memo: string | null;
  created_at: string;
};

function orgCode(p: ManageLeaveProfileRow): string {
  const o = p.organizations;
  if (Array.isArray(o)) return o[0]?.organization_code ?? "";
  return o?.organization_code ?? "";
}

function parseTotal(raw: string): number {
  const n = parseFloat(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function sumDeductions(rows: LeaveDeductionRow[]): number {
  return rows.reduce((s, r) => {
    const d = Number(r.days);
    return s + (Number.isFinite(d) ? d : 0);
  }, 0);
}

export default function ManageAnnualLeaveSection({ profiles }: { profiles: ManageLeaveProfileRow[] }) {
  const { user } = useAuth();
  const [leaveYear, setLeaveYear] = useState(() => new Date().getFullYear());
  const [totalsByProfile, setTotalsByProfile] = useState<Record<string, number>>({});
  const [deductionsByProfile, setDeductionsByProfile] = useState<Record<string, LeaveDeductionRow[]>>({});
  const [draftTotals, setDraftTotals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [modalProfileId, setModalProfileId] = useState<string | null>(null);
  const [newUsageDate, setNewUsageDate] = useState("");
  const [newDays, setNewDays] = useState("1");
  const [newMemo, setNewMemo] = useState("");
  const [submittingDeduction, setSubmittingDeduction] = useState(false);

  const profileIdsKey = profiles.map((p) => p.id).join(",");

  const loadLeave = useCallback(async () => {
    const ids = profileIdsKey ? profileIdsKey.split(",").filter(Boolean) : [];
    if (ids.length === 0) {
      setTotalsByProfile({});
      setDeductionsByProfile({});
      setDraftTotals({});
      return;
    }
    setLoading(true);
    setError(null);
    const [tRes, dRes] = await Promise.all([
      supabase.from("leave_annual_totals").select("profile_id,year,total_days").eq("year", leaveYear).in("profile_id", ids),
      supabase
        .from("leave_deductions")
        .select("id,profile_id,year,usage_date,days,memo,created_at")
        .eq("year", leaveYear)
        .in("profile_id", ids)
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
    const nextTotals: Record<string, number> = {};
    for (const row of tRes.data ?? []) {
      const pid = String(row.profile_id);
      const v = Number(row.total_days);
      nextTotals[pid] = Number.isFinite(v) ? v : 0;
    }
    const nextDed: Record<string, LeaveDeductionRow[]> = {};
    for (const id of ids) nextDed[id] = [];
    for (const row of dRes.data ?? []) {
      const pid = String(row.profile_id);
      if (!nextDed[pid]) nextDed[pid] = [];
      nextDed[pid].push(row as LeaveDeductionRow);
    }
    setTotalsByProfile(nextTotals);
    setDeductionsByProfile(nextDed);
    const drafts: Record<string, string> = {};
    for (const id of ids) {
      const v = nextTotals[id];
      drafts[id] = v !== undefined ? String(v) : "";
    }
    setDraftTotals(drafts);
    setLoading(false);
  }, [leaveYear, profileIdsKey]);

  useEffect(() => {
    loadLeave();
  }, [loadLeave]);

  const saveTotal = async (profileId: string) => {
    const raw = draftTotals[profileId] ?? "";
    const total_days = parseTotal(raw);
    setSavingId(profileId);
    setError(null);
    const { error: e } = await supabase.from("leave_annual_totals").upsert(
      { profile_id: profileId, year: leaveYear, total_days },
      { onConflict: "profile_id,year" }
    );
    setSavingId(null);
    if (e) {
      setError(e.message);
      return;
    }
    setTotalsByProfile((prev) => ({ ...prev, [profileId]: total_days }));
  };

  const openModal = (profileId: string) => {
    setModalProfileId(profileId);
    const today = new Date();
    const y = leaveYear;
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    setNewUsageDate(`${y}-${m}-${d}`);
    setNewDays("1");
    setNewMemo("");
  };

  const addDeduction = async () => {
    if (!modalProfileId || !user?.id) return;
    const days = parseTotal(newDays);
    if (!(days > 0)) {
      setError("차감 일수는 0보다 커야 합니다.");
      return;
    }
    setSubmittingDeduction(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("leave_deductions")
      .insert({
        profile_id: modalProfileId,
        year: leaveYear,
        usage_date: newUsageDate,
        days,
        memo: newMemo.trim() || null,
        created_by: user.id,
      })
      .select("id,profile_id,year,usage_date,days,memo,created_at")
      .single();
    setSubmittingDeduction(false);
    if (e) {
      setError(e.message);
      return;
    }
    if (data) {
      setDeductionsByProfile((prev) => {
        const pid = modalProfileId;
        const list = [...(prev[pid] ?? []), data as LeaveDeductionRow];
        return { ...prev, [pid]: list.sort((a, b) => String(b.usage_date).localeCompare(String(a.usage_date))) };
      });
    }
    setNewDays("1");
    setNewMemo("");
  };

  const deleteDeduction = async (id: number, profileId: string) => {
    if (!window.confirm("이 차감 내역을 삭제할까요?")) return;
    setError(null);
    const { error: e } = await supabase.from("leave_deductions").delete().eq("id", id);
    if (e) {
      setError(e.message);
      return;
    }
    setDeductionsByProfile((prev) => ({
      ...prev,
      [profileId]: (prev[profileId] ?? []).filter((r) => r.id !== id),
    }));
  };

  const modalProfile = modalProfileId ? profiles.find((p) => p.id === modalProfileId) : null;

  return (
    <section className="rounded-xl border border-slate-700 bg-space-800/80 p-6">
      <h2 className="text-lg font-semibold text-slate-100 mb-1">연차 (발생 총량 · 차감)</h2>
      <p className="text-xs text-slate-500 mb-4">
        발생 총량은 연도별로 관리합니다. 차감은 일수만 누적되며, 잔여 = 발생 총량 − 차감 합계입니다. 병가 등 연차가 아닌 경우
        차감 행을 넣지 않거나, 잘못 넣었다면 삭제하거나 발생 총량을 조정하세요.
      </p>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-xs text-slate-400">연도</label>
        <input
          type="number"
          min={2000}
          max={2100}
          value={leaveYear}
          onChange={(e) => setLeaveYear(Number(e.target.value) || leaveYear)}
          className="w-24 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
        />
        <button
          type="button"
          onClick={() => loadLeave()}
          disabled={loading}
          className="px-3 py-2 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 disabled:opacity-50"
        >
          새로고침
        </button>
      </div>
      {error && (
        <p className="text-red-400 text-sm mb-3" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      ) : profiles.length === 0 ? (
        <p className="text-slate-500 text-sm">표시할 사용자가 없습니다. 조직 필터를 확인하세요.</p>
      ) : (
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-sm text-left min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-xs">
                <th className="py-2 pr-2">회사</th>
                <th className="py-2 pr-2">아이디</th>
                <th className="py-2 pr-2">이름</th>
                <th className="py-2 pr-2">발생 총량</th>
                <th className="py-2 pr-2">차감 합계</th>
                <th className="py-2 pr-2">잔여</th>
                <th className="py-2 pr-2 w-[100px]">차감</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const total = totalsByProfile[p.id] ?? 0;
                const dlist = deductionsByProfile[p.id] ?? [];
                const used = sumDeductions(dlist);
                const remain = total - used;
                return (
                  <tr key={p.id} className="border-b border-slate-800/80 text-slate-300">
                    <td className="py-2 pr-2 font-mono text-xs">{orgCode(p) || "—"}</td>
                    <td className="py-2 pr-2 font-mono">{p.login_id}</td>
                    <td className="py-2 pr-2">{p.display_name ?? "—"}</td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={draftTotals[p.id] ?? ""}
                          onChange={(e) => setDraftTotals((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          onBlur={() => saveTotal(p.id)}
                          className="w-20 px-2 py-1 text-xs bg-space-900 border border-slate-600 rounded text-slate-100"
                          aria-label={`${p.login_id} 발생 총량`}
                        />
                        {savingId === p.id ? <span className="text-[10px] text-slate-500">저장…</span> : null}
                      </div>
                    </td>
                    <td className="py-2 pr-2 tabular-nums text-slate-400">{used.toLocaleString("ko-KR")}</td>
                    <td className="py-2 pr-2 tabular-nums font-medium text-cyan-200/90">{remain.toLocaleString("ko-KR")}</td>
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        onClick={() => openModal(p.id)}
                        className="text-xs text-cyan-400 hover:text-cyan-300"
                      >
                        등록 · 내역
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalProfile && modalProfileId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal
          aria-labelledby="leave-modal-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-600 bg-space-900 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-slate-700 flex justify-between items-start gap-2">
              <div>
                <h3 id="leave-modal-title" className="text-slate-100 font-semibold text-sm">
                  연차 차감 — {modalProfile.display_name ?? modalProfile.login_id}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  잔여 {(
                    (totalsByProfile[modalProfileId] ?? 0) - sumDeductions(deductionsByProfile[modalProfileId] ?? [])
                  ).toLocaleString("ko-KR")}{" "}
                  일
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalProfileId(null)}
                className="text-slate-400 hover:text-slate-200 text-lg leading-none px-1"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-3 border-b border-slate-800">
              <p className="text-[11px] text-slate-500">차감 등록 (연차·반차 등 사용분)</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">사용일</label>
                  <input
                    type="date"
                    value={newUsageDate}
                    onChange={(e) => setNewUsageDate(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-space-800 border border-slate-600 rounded text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">일수</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newDays}
                    onChange={(e) => setNewDays(e.target.value)}
                    placeholder="1 또는 0.5"
                    className="w-full px-2 py-1.5 text-xs bg-space-800 border border-slate-600 rounded text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">메모 (선택)</label>
                <input
                  type="text"
                  value={newMemo}
                  onChange={(e) => setNewMemo(e.target.value)}
                  placeholder="예: 연차, 오전반차"
                  className="w-full px-2 py-1.5 text-xs bg-space-800 border border-slate-600 rounded text-slate-100"
                />
              </div>
              <button
                type="button"
                disabled={submittingDeduction}
                onClick={addDeduction}
                className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium disabled:opacity-50"
              >
                차감 반영
              </button>
            </div>
            <div className="p-4">
              <p className="text-[11px] text-slate-500 mb-2">차감 내역</p>
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {(deductionsByProfile[modalProfileId] ?? []).length === 0 ? (
                  <li className="text-slate-500 text-xs">내역이 없습니다.</li>
                ) : (
                  (deductionsByProfile[modalProfileId] ?? []).map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs bg-space-800/80 rounded-lg px-2 py-1.5 border border-slate-700/80"
                    >
                      <span className="text-slate-300">
                        {String(r.usage_date).slice(0, 10)} · {Number(r.days).toLocaleString("ko-KR")}일
                        {r.memo ? <span className="text-slate-500"> — {r.memo}</span> : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteDeduction(r.id, modalProfileId)}
                        className="text-rose-400 hover:text-rose-300 shrink-0"
                      >
                        삭제
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
