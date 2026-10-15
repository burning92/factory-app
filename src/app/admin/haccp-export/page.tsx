"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { isAdminLikeRole } from "@/lib/roles";
import { HACCP_LOGS } from "@/features/haccpExport/catalog";
import { FLOOR_VALUES, type FloorValue } from "@/features/haccpExport/floor";

type PreviewLog = {
  key: string;
  label: string;
  headers: number;
  items: number;
  nullRecordDates: number;
  floors: { "1층": number; "2층": number; "3층": number; none: number; units: number };
};

type Preview = {
  from: string;
  to: string;
  headerTotal: number;
  itemTotal: number;
  authorException: number;
  approvalException: number;
  auditMissing: number;
  org000Count: number;
  logs: PreviewLog[];
  verified: boolean;
};

function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export default function HaccpExportPage() {
  const { profile, loading } = useAuth();
  const [from, setFrom] = useState("2026-03-24");
  const [to, setTo] = useState(todayKst());
  const [selected, setSelected] = useState<string[]>(HACCP_LOGS.map((log) => log.key));
  const [floors, setFloors] = useState<FloorValue[]>(["1층", "2층", "3층"]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "full" | "floor" | null>(null);

  const requestKey = useMemo(() => JSON.stringify({ from, to, selected: [...selected].sort() }), [from, to, selected]);
  const previewReady = preview?.verified === true && previewKey === requestKey;

  async function authHeaders(): Promise<HeadersInit | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    return {
      Authorization: `Bearer ${session.access_token}`,
      "x-refresh-token": session.refresh_token ?? "",
      "Content-Type": "application/json",
    };
  }

  async function loadPreview() {
    setBusy("preview");
    setError(null);
    setMessage(null);
    setPreview(null);
    const headers = await authHeaders();
    if (!headers) {
      setError("로그인 세션이 없습니다.");
      setBusy(null);
      return;
    }
    const response = await fetch("/api/admin/haccp-export/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ from, to, logKeys: selected }),
    });
    const json = (await response.json()) as Preview & { error?: string };
    if (!response.ok || json.verified !== true) {
      setError(json.error ?? "건수 조회에 실패했습니다.");
      setBusy(null);
      return;
    }
    setPreview(json);
    setPreviewKey(requestKey);
    setMessage(`예상 건수: 헤더 ${json.headerTotal.toLocaleString("ko-KR")}건, 항목 ${json.itemTotal.toLocaleString("ko-KR")}건`);
    setBusy(null);
  }

  async function download(mode: "full" | "floor") {
    if (!previewReady || !preview) {
      setError("다운로드 전에 예상 건수를 다시 조회하세요.");
      return;
    }
    setBusy(mode);
    setError(null);
    setMessage(null);
    const headers = await authHeaders();
    if (!headers) {
      setError("로그인 세션이 없습니다.");
      setBusy(null);
      return;
    }
    const response = await fetch("/api/admin/haccp-export/download", {
      method: "POST",
      headers,
      body: JSON.stringify({ from, to, logKeys: selected, mode, floors }),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("spreadsheet")) {
      const json = (await response.json().catch(() => ({}))) as { error?: string; verified?: boolean };
      setError(json.error ?? "엑셀 추출에 실패했습니다.");
      setBusy(null);
      return;
    }
    const dbHeaders = response.headers.get("X-Haccp-Db-Headers");
    const excelHeaders = response.headers.get("X-Haccp-Excel-Headers");
    const dbItems = response.headers.get("X-Haccp-Db-Items");
    const excelItems = response.headers.get("X-Haccp-Excel-Items");
    const verified = response.headers.get("X-Haccp-Verified") === "1";
    const same =
      verified &&
      dbHeaders === excelHeaders &&
      dbItems === excelItems &&
      Number(dbHeaders) === preview.headerTotal &&
      Number(dbItems) === preview.itemTotal;
    if (!same) {
      setError("파일을 받았지만 DB 건수와 추출 건수가 일치하지 않습니다. 성공으로 처리하지 않습니다.");
      setBusy(null);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = mode === "floor" ? `HACCP-floor-${from}-${to}.xlsx` : `HACCP-original-${from}-${to}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(
      mode === "full"
        ? `원본 추출 완료. 헤더 ${dbHeaders}건, 항목 ${dbItems}건이 DB와 같습니다.`
        : `층별 분석 파일을 만들었습니다. 원본 헤더 ${dbHeaders}건, 항목 ${dbItems}건과 같고, 층별 행 검증은 파일의 검증 시트에 있습니다.`
    );
    setBusy(null);
  }

  if (loading || !isAdminLikeRole(profile?.role)) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">{loading ? "확인 중…" : "관리자만 사용할 수 있습니다."}</p>
      </div>
    );
  }

  const allChecked = selected.length === HACCP_LOGS.length;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">HACCP 기록 내보내기</h1>
        <p className="mt-1 text-sm text-slate-400">
          저장된 전자일지 13종을 읽기만 합니다. 원본 데이터는 바꾸지 않습니다.
          <span className="mx-2 text-slate-600">·</span>
          <Link href="/admin/logs" className="text-cyan-400 hover:text-cyan-300">
            로그 조회
          </Link>
        </p>
      </div>

      <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/45 p-4">
        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-slate-300">
            시작일
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 block rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-100"
            />
          </label>
          <label className="text-sm text-slate-300">
            종료일
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 block rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-100"
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          날짜 컬럼은 저장된 날짜 그대로 고릅니다. 입고 시각은 한국시간 달력 날짜로 고릅니다. 파일 안의 시각 원본은 오프셋이 있는 문자열이고, 표시KST 열만 한국시간입니다.
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={(event) => setSelected(event.target.checked ? HACCP_LOGS.map((log) => log.key) : [])}
          />
          전체 일지
        </label>
        <ul className="grid gap-2 sm:grid-cols-2">
          {HACCP_LOGS.map((log) => (
            <li key={log.key}>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={selected.includes(log.key)}
                  onChange={(event) => {
                    setSelected((current) =>
                      event.target.checked ? [...current, log.key] : current.filter((key) => key !== log.key)
                    );
                  }}
                />
                {log.label}
              </label>
            </li>
          ))}
        </ul>
        <div>
          <p className="mb-2 text-sm text-slate-300">층별 분석에 넣을 층</p>
          <div className="flex gap-4">
            {FLOOR_VALUES.map((floor) => (
              <label key={floor} className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={floors.includes(floor)}
                  onChange={(event) => {
                    setFloors((current) =>
                      event.target.checked ? [...current, floor] : current.filter((value) => value !== floor)
                    );
                  }}
                />
                {floor}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            원본 파일은 모든 층을 그대로 담습니다. 층별 파일은 문구로 확인된 층만 나누고, 층이 없는 행은 특정 층에 넣지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadPreview()}
            disabled={busy !== null || selected.length === 0}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
          >
            {busy === "preview" ? "건수 조회 중…" : "예상 건수 조회"}
          </button>
          <button
            type="button"
            onClick={() => void download("full")}
            disabled={busy !== null || !previewReady}
            className="rounded-lg bg-cyan-700 px-3 py-2 text-sm text-white hover:bg-cyan-600 disabled:opacity-50"
          >
            {busy === "full" ? "원본 추출 중…" : "원본 Excel"}
          </button>
          <button
            type="button"
            onClick={() => void download("floor")}
            disabled={busy !== null || !previewReady || floors.length === 0}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
          >
            {busy === "floor" ? "층별 추출 중…" : "층별 분석 Excel"}
          </button>
        </div>
        {message && <p className="text-sm text-emerald-300">{message}</p>}
        {error && <p className="text-sm text-red-300">{error}</p>}
      </section>

      {preview && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-100">예상 건수</h2>
          <p className="text-sm text-slate-400">
            헤더 {preview.headerTotal.toLocaleString("ko-KR")}건 · 항목 {preview.itemTotal.toLocaleString("ko-KR")}건 · 작성자 대조 예외 {preview.authorException}건 · 승인 정합 예외 {preview.approvalException}건 · 이력 추적자료 미보유 {preview.auditMissing}건 · 조직 000 공조 {preview.org000Count}건
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="min-w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-3 py-2">일지</th>
                  <th className="px-3 py-2">헤더</th>
                  <th className="px-3 py-2">항목</th>
                  <th className="px-3 py-2">기록일 없음</th>
                  <th className="px-3 py-2">1층</th>
                  <th className="px-3 py-2">2층</th>
                  <th className="px-3 py-2">3층</th>
                  <th className="px-3 py-2">층 없음</th>
                </tr>
              </thead>
              <tbody>
                {preview.logs.map((log) => (
                  <tr key={log.key} className="border-t border-slate-800">
                    <td className="px-3 py-2">{log.label}</td>
                    <td className="px-3 py-2">{log.headers}</td>
                    <td className="px-3 py-2">{log.items}</td>
                    <td className="px-3 py-2">{log.nullRecordDates}</td>
                    <td className="px-3 py-2">{log.floors["1층"]}</td>
                    <td className="px-3 py-2">{log.floors["2층"]}</td>
                    <td className="px-3 py-2">{log.floors["3층"]}</td>
                    <td className="px-3 py-2">{log.floors.none}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            층 수는 항목 문구와, 냉장·냉동 일지의 온도 칸 이름으로 센 분석 단위입니다. 층이 없는 칸을 2층이나 3층으로 세지 않습니다. 이력 추적자료 미보유는 수정이 없었다는 뜻이 아닙니다.
          </p>
        </section>
      )}
    </div>
  );
}
