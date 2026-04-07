"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { DashboardBackLink } from "../DashboardBackLink";

export default function ExecutiveEcountImportPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const canView = !!profile;
  const canPaste = profile?.role === "admin" || profile?.role === "manager";

  const [paste, setPaste] = useState("");
  const [dateFrom, setDateFrom] = useState("2024-01-02");
  const [dateTo, setDateTo] = useState("2026-04-02");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/");
  }, [authLoading, canView, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!canPaste) {
      setError("이카운트 붙여넣기 저장은 관리자·매니저만 사용할 수 있습니다.");
      return;
    }
    if (!paste.trim()) {
      setError("붙여넣기 내용이 비어 있습니다.");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !session.refresh_token) {
      setError("세션이 없습니다. 다시 로그인해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/executive/ecount-production-paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          paste,
          dateFrom: dateFrom.trim() || null,
          dateTo: dateTo.trim() || null,
        }),
      });
      const j = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "저장 실패");
        return;
      }
      const inserted = j.inserted;
      const skippedR = j.skippedNotReceipt;
      const skippedI = j.skippedByItemRule;
      setMessage(
        `저장 완료: 생산입고 ${String(inserted)}건 반영. (제외: 변동구분 ${String(skippedR ?? 0)}건, 품목규칙 ${String(skippedI ?? 0)}건)`
      );
    } catch {
      setError("요청 중 오류가 났습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!canView) return null;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-3xl mx-auto pb-24 md:pb-8">
      <DashboardBackLink />
      <h1 className="text-lg font-semibold text-slate-100 mb-1">이카운트 생산입고 붙여넣기</h1>
      <p className="text-slate-500 text-sm mb-4 leading-relaxed">
        프로젝트 폴더에 파일을 넣을 필요는 없습니다. 엑셀에서 이카운트 자료 영역을 복사한 뒤 아래에
        붙여 넣으면 됩니다. 파일 이름도 따로 정할 필요 없습니다.
      </p>
      {!canPaste && (
        <p className="text-sm text-amber-200/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-4">
          이 화면의 <strong className="font-semibold">저장</strong>은 관리자·매니저만 사용할 수 있습니다. 일반
          계정은 안내만 확인해 주세요.
        </p>
      )}
      <ul className="text-xs text-slate-600 space-y-1 mb-6 list-disc pl-5">
        <li>
          엑셀에서 <strong className="text-slate-500">열 전체를 선택해 복사</strong>하면 칸 사이가 탭으로
          유지됩니다. 메모장에 잠깐 붙였다가 다시 복사하면 탭이 공백으로 깨질 수 있으니, 가능하면{" "}
          <strong className="text-slate-500">엑셀 → 이 화면</strong>으로 바로 붙여 넣는 것을 권장합니다.
        </li>
        <li>
          한 줄 형식: 일자-No, 품목명, 로트, 수량, 변동구분, … (탭으로 구분).{" "}
          <strong className="text-slate-500">생산입고</strong>만 DB에 저장되고, 생산소모·불량-폐기는
          자동으로 빠집니다.
        </li>
        <li>미스터피자 볼도우 등은 집계에서 제외됩니다.</li>
        <li>날짜 범위는 기본 2024-01-02 ~ 2026-04-02이며, 필요하면 수정하세요. 비우면 전체 구간입니다.</li>
        <li>
          <strong className="text-slate-500">전체 교체</strong> 방식입니다. 저장하면 기존 이카운트
          동기화 행은 지우고 이번 붙여넣기만 남습니다.
        </li>
      </ul>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">시작일 (포함)</label>
            <input
              type="text"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="YYYY-MM-DD 비우면 제한 없음"
              disabled={!canPaste}
              className="w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">종료일 (포함)</label>
            <input
              type="text"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="YYYY-MM-DD 비우면 제한 없음"
              disabled={!canPaste}
              className="w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 disabled:cursor-not-allowed"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">붙여넣기</label>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={16}
            disabled={!canPaste}
            className="w-full px-3 py-2 text-sm font-mono bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder:text-slate-600 disabled:cursor-not-allowed"
            placeholder="엑셀에서 복사한 내용을 여기에 붙여 넣으세요…"
            spellCheck={false}
          />
        </div>
        {error && (
          <p className="text-sm text-amber-200/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            {error}
          </p>
        )}
        {message && (
          <p className="text-sm text-emerald-200/90 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !canPaste}
          className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm disabled:opacity-50"
        >
          {busy ? "저장 중…" : "서버에 저장"}
        </button>
      </form>
    </div>
  );
}
