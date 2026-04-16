"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export type ManageLeaveProfileRow = {
  id: string;
  login_id: string;
  display_name: string | null;
  organization_id: string;
  hire_date?: string | null;
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
  source?: string | null;
};
type LeaveAdjustmentRow = {
  id: number;
  profile_id: string;
  year: number;
  usage_date: string;
  adjust_days: number | string;
  reason: string | null;
  created_at: string;
  source?: string | null;
};

type ManualLeaveType = "annual" | "half" | "monthly" | "substitute";

function getManualLeaveTypeMeta(t: ManualLeaveType): { label: string; days: string; memo: string } {
  switch (t) {
    case "half":
      return { label: "반차", days: "0.5", memo: "반차" };
    case "monthly":
      return { label: "월차", days: "1", memo: "월차" };
    case "substitute":
      return { label: "대체휴무", days: "1", memo: "대체휴무" };
    case "annual":
    default:
      return { label: "연차", days: "1", memo: "연차" };
  }
}

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
  const [adjustmentsByProfile, setAdjustmentsByProfile] = useState<Record<string, LeaveAdjustmentRow[]>>({});
  const [draftTotals, setDraftTotals] = useState<Record<string, string>>({});
  const [draftExtraByProfile, setDraftExtraByProfile] = useState<Record<string, string>>({});
  const [draftHireDates, setDraftHireDates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingHireId, setSavingHireId] = useState<string | null>(null);
  const [savingExtraId, setSavingExtraId] = useState<string | null>(null);
  const [modalProfileId, setModalProfileId] = useState<string | null>(null);
  const [newUsageDate, setNewUsageDate] = useState("");
  const [newDays, setNewDays] = useState("1");
  const [newMemo, setNewMemo] = useState("");
  const [newLeaveType, setNewLeaveType] = useState<ManualLeaveType>("annual");
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
    const [tRes, dRes, aRes] = await Promise.all([
      supabase.from("leave_annual_totals").select("profile_id,year,total_days").eq("year", leaveYear).in("profile_id", ids),
      supabase
        .from("leave_deductions")
        .select("id,profile_id,year,usage_date,days,memo,created_at,source")
        .eq("year", leaveYear)
        .in("profile_id", ids)
        .order("usage_date", { ascending: false }),
      supabase
        .from("leave_adjustments")
        .select("id,profile_id,year,usage_date,adjust_days,reason,created_at,source")
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
    if (aRes.error) {
      setError(aRes.error.message);
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
    const nextAdj: Record<string, LeaveAdjustmentRow[]> = {};
    for (const id of ids) nextDed[id] = [];
    for (const id of ids) nextAdj[id] = [];
    for (const row of dRes.data ?? []) {
      const pid = String(row.profile_id);
      if (!nextDed[pid]) nextDed[pid] = [];
      nextDed[pid].push(row as LeaveDeductionRow);
    }
    for (const row of aRes.data ?? []) {
      const pid = String(row.profile_id);
      if (!nextAdj[pid]) nextAdj[pid] = [];
      nextAdj[pid].push(row as LeaveAdjustmentRow);
    }
    setTotalsByProfile(nextTotals);
    setDeductionsByProfile(nextDed);
    setAdjustmentsByProfile(nextAdj);
    const drafts: Record<string, string> = {};
    for (const id of ids) {
      const v = nextTotals[id];
      drafts[id] = v !== undefined ? String(v) : "";
    }
    setDraftTotals(drafts);
    const extraDrafts: Record<string, string> = {};
    for (const id of ids) {
      const extra = (nextAdj[id] ?? [])
        .filter((r) => r.source === "manual" && (r.reason ?? "") === "관리자 추가연차")
        .reduce((s, r) => {
          const d = Number(r.adjust_days);
          return s + (Number.isFinite(d) ? d : 0);
        }, 0);
      extraDrafts[id] = extra ? String(extra) : "0";
    }
    setDraftExtraByProfile(extraDrafts);
    setLoading(false);
  }, [leaveYear, profileIdsKey]);

  useEffect(() => {
    loadLeave();
  }, [loadLeave]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const p of profiles) {
      next[p.id] = p.hire_date ? String(p.hire_date).slice(0, 10) : "";
    }
    setDraftHireDates(next);
  }, [profiles]);

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

  const saveHireDate = async (profileId: string) => {
    const raw = (draftHireDates[profileId] ?? "").trim();
    const hire_date = raw.length > 0 ? raw : null;
    setSavingHireId(profileId);
    setError(null);
    const { error: e } = await supabase.from("profiles").update({ hire_date }).eq("id", profileId);
    setSavingHireId(null);
    if (e) {
      setError(e.message);
      return;
    }
  };

  const saveExtraDays = async (profileId: string) => {
    const raw = draftExtraByProfile[profileId] ?? "0";
    const extraDays = parseTotal(raw);
    if (extraDays < 0) {
      setError("추가연차는 0 이상으로 입력하세요.");
      return;
    }
    setSavingExtraId(profileId);
    setError(null);
    const usageDate = `${leaveYear}-01-01`;
    const { error: delErr } = await supabase
      .from("leave_adjustments")
      .delete()
      .eq("profile_id", profileId)
      .eq("year", leaveYear)
      .eq("source", "manual")
      .eq("reason", "관리자 추가연차");
    if (delErr) {
      setSavingExtraId(null);
      setError(delErr.message);
      return;
    }
    if (extraDays > 0) {
      const { error: insErr } = await supabase.from("leave_adjustments").insert({
        profile_id: profileId,
        year: leaveYear,
        usage_date: usageDate,
        adjust_days: extraDays,
        reason: "관리자 추가연차",
        created_by: user?.id ?? null,
        source: "manual",
      });
      if (insErr) {
        setSavingExtraId(null);
        setError(insErr.message);
        return;
      }
    }
    setAdjustmentsByProfile((prev) => {
      const rest = (prev[profileId] ?? []).filter((r) => !(r.source === "manual" && (r.reason ?? "") === "관리자 추가연차"));
      const nextList =
        extraDays > 0
          ? [
              ...rest,
              {
                id: -1,
                profile_id: profileId,
                year: leaveYear,
                usage_date: usageDate,
                adjust_days: extraDays,
                reason: "관리자 추가연차",
                created_at: new Date().toISOString(),
                source: "manual",
              } as LeaveAdjustmentRow,
            ]
          : rest;
      return { ...prev, [profileId]: nextList };
    });
    setSavingExtraId(null);
  };

  const openModal = (profileId: string) => {
    setModalProfileId(profileId);
    const today = new Date();
    const y = leaveYear;
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    setNewUsageDate(`${y}-${m}-${d}`);
    const meta = getManualLeaveTypeMeta("annual");
    setNewLeaveType("annual");
    setNewDays(meta.days);
    setNewMemo(meta.memo);
  };

  const applyManualLeaveType = (nextType: ManualLeaveType) => {
    const meta = getManualLeaveTypeMeta(nextType);
    setNewLeaveType(nextType);
    setNewDays(meta.days);
    if (!newMemo.trim() || newMemo === getManualLeaveTypeMeta("annual").memo || newMemo === getManualLeaveTypeMeta("half").memo || newMemo === getManualLeaveTypeMeta("monthly").memo || newMemo === getManualLeaveTypeMeta("substitute").memo) {
      setNewMemo(meta.memo);
    }
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
        source: "manual",
      })
      .select("id,profile_id,year,usage_date,days,memo,created_at,source")
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
    const meta = getManualLeaveTypeMeta(newLeaveType);
    setNewDays(meta.days);
    setNewMemo(meta.memo);
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
    <section className="rounded-2xl border border-slate-700/80 bg-gradient-to-b from-space-800/90 to-space-900/90 p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">연차 (운영 기준 부여 · 차감)</h2>
        <p className="text-xs leading-relaxed text-slate-400">
        운영 기준 부여 연차는 관리자가 직접 입력/조정합니다. 입사일자는 기록용으로만 사용합니다. 차감은 일수만 누적되며, 잔여 =
        운영 기준 부여 연차 + 추가연차 − 차감 합계입니다.{" "}
        <span className="text-slate-300">
          생산계획 시트 동기화 시 <strong className="text-slate-300">기준본</strong> 버전의 연차·반차·월차가 자동 반영됩니다(메모에
          「생산계획 자동」). 수동 등록과 합산됩니다.
        </span>{" "}
        병가 등은 시트에 넣지 않거나, 수동으로만 조정하세요.
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-700/80 bg-space-900/60 p-3">
        <label className="text-xs font-medium text-slate-400">연도</label>
        <input
          type="number"
          min={2000}
          max={2100}
          value={leaveYear}
          onChange={(e) => setLeaveYear(Number(e.target.value) || leaveYear)}
          className="w-24 rounded-lg border border-slate-600 bg-space-950 px-3 py-2 text-sm text-slate-100"
        />
        <button
          type="button"
          onClick={() => loadLeave()}
          disabled={loading}
          className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700/60 disabled:opacity-50"
        >
          새로고침
        </button>
        <span className="ml-auto rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-400">
          표시 인원 {profiles.length.toLocaleString("ko-KR")}명
        </span>
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
        <div className="overflow-x-auto rounded-xl border border-slate-700/70">
          <table className="min-w-[900px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-space-900/95 text-xs text-slate-400">
                <th className="w-[56px] py-2.5 px-3">No</th>
                <th className="py-2.5 px-3">회사</th>
                <th className="py-2.5 px-3">아이디</th>
                <th className="py-2.5 px-3">이름</th>
                <th className="py-2.5 px-3">입사일자</th>
                <th className="py-2.5 px-3">운영 기준 부여</th>
                <th className="py-2.5 px-3">추가연차 부여</th>
                <th className="py-2.5 px-3">차감 합계</th>
                <th className="py-2.5 px-3">잔여</th>
                <th className="w-[110px] py-2.5 px-3">차감</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p, index) => {
                const savedTotal = totalsByProfile[p.id] ?? 0;
                const draftStr = draftTotals[p.id];
                /** 입력 중에도 잔여 미리보기: 칸이 비어 있으면 저장값 기준 */
                const effectiveTotal =
                  draftStr !== undefined && String(draftStr).trim() !== "" ? parseTotal(String(draftStr)) : savedTotal;
                const dlist = deductionsByProfile[p.id] ?? [];
                const used = sumDeductions(dlist);
                const alist = adjustmentsByProfile[p.id] ?? [];
                const added = alist.reduce((s, r) => {
                  const d = Number(r.adjust_days);
                  return s + (Number.isFinite(d) ? d : 0);
                }, 0);
                const remain = Math.max(0, effectiveTotal + added - used);
                return (
                  <tr key={p.id} className="border-b border-slate-800/70 text-slate-300 odd:bg-space-900/30 hover:bg-slate-800/40">
                    <td className="py-2 px-3 tabular-nums text-slate-500">{index + 1}</td>
                    <td className="py-2 px-3 font-mono text-xs">{orgCode(p) || "—"}</td>
                    <td className="py-2 px-3 font-mono">{p.login_id}</td>
                    <td className="py-2 px-3">{p.display_name ?? "—"}</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="date"
                          value={draftHireDates[p.id] ?? ""}
                          onChange={(e) => setDraftHireDates((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          onBlur={() => saveHireDate(p.id)}
                          className="w-36 rounded border border-slate-600 bg-space-950 px-2 py-1 text-xs text-slate-100"
                          aria-label={`${p.login_id} 입사일자`}
                        />
                        {savingHireId === p.id ? <span className="text-[10px] text-slate-500">저장…</span> : null}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={draftTotals[p.id] ?? ""}
                          onChange={(e) => setDraftTotals((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          onBlur={() => saveTotal(p.id)}
                          className="w-20 rounded border border-slate-600 bg-space-950 px-2 py-1 text-xs text-slate-100"
                          aria-label={`${p.login_id} 운영 기준 부여 연차`}
                        />
                        {savingId === p.id ? <span className="text-[10px] text-slate-500">저장…</span> : null}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={draftExtraByProfile[p.id] ?? "0"}
                          onChange={(e) => setDraftExtraByProfile((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          onBlur={() => saveExtraDays(p.id)}
                          className="w-20 rounded border border-slate-600 bg-space-950 px-2 py-1 text-xs text-emerald-300"
                          aria-label={`${p.login_id} 추가연차 부여`}
                        />
                        {savingExtraId === p.id ? <span className="text-[10px] text-slate-500">저장…</span> : null}
                      </div>
                    </td>
                    <td className="py-2 px-3 tabular-nums text-slate-400">{used.toLocaleString("ko-KR")}</td>
                    <td className="py-2 px-3 tabular-nums font-medium text-cyan-200/90">{remain.toLocaleString("ko-KR")}</td>
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => openModal(p.id)}
                        className="rounded-md px-2 py-1 text-xs text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
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
                  잔여 {Math.max(
                    0,
                    (totalsByProfile[modalProfileId] ?? 0) +
                      (adjustmentsByProfile[modalProfileId] ?? []).reduce((s, r) => {
                        const d = Number(r.adjust_days);
                        return s + (Number.isFinite(d) ? d : 0);
                      }, 0) -
                      sumDeductions(deductionsByProfile[modalProfileId] ?? [])
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
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">구분</label>
                <select
                  value={newLeaveType}
                  onChange={(e) => applyManualLeaveType((e.target.value as ManualLeaveType) || "annual")}
                  className="w-full px-2 py-1.5 text-xs bg-space-800 border border-slate-600 rounded text-slate-100"
                >
                  <option value="annual">연차</option>
                  <option value="half">반차</option>
                  <option value="monthly">월차</option>
                  <option value="substitute">대체휴무</option>
                </select>
              </div>
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
                        {r.source === "production_plan" ? (
                          <span className="mr-1.5 rounded bg-violet-500/25 px-1 py-0.5 text-[10px] text-violet-200">
                            계획
                          </span>
                        ) : null}
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
