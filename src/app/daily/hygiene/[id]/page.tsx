"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { HYGIENE_CHECKLIST } from "@/features/daily/hygieneChecklist";

type LogHeader = {
  id: string;
  inspection_date: string;
  author_name: string | null;
  corrective_content: string | null;
  corrective_datetime: string | null;
  corrective_deviation: string | null;
  corrective_detail: string | null;
  corrective_actor: string | null;
  corrective_approver: string | null;
  created_at: string;
};

type LogItem = {
  category: string;
  question_index: number;
  question_text: string;
  result: string;
};

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function DailyHygieneViewPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const [header, setHeader] = useState<LogHeader | null>(null);
  const [items, setItems] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setError("일지 ID가 없습니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: logData, error: logErr } = await supabase
      .from("daily_hygiene_logs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (logErr) {
      setError(logErr.message);
      setHeader(null);
      setItems([]);
      setLoading(false);
      return;
    }
    if (!logData) {
      setError("해당 일지를 찾을 수 없습니다.");
      setHeader(null);
      setItems([]);
      setLoading(false);
      return;
    }
    setHeader(logData as LogHeader);
    const { data: itemsData, error: itemsErr } = await supabase
      .from("daily_hygiene_log_items")
      .select("category, question_index, question_text, result")
      .eq("log_id", id)
      .order("category")
      .order("question_index");
    if (itemsErr) {
      setItems([]);
    } else {
      setItems((itemsData ?? []) as LogItem[]);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }

  if (error || !header) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-red-400 text-sm mb-4">{error ?? "데이터 없음"}</p>
        <Link href="/daily/hygiene" className="text-cyan-400 hover:text-cyan-300 text-sm">
          목록으로
        </Link>
      </div>
    );
  }

  const itemMap = new Map<string, string>();
  items.forEach((i) => {
    const key = `${i.category}-${i.question_index}`;
    itemMap.set(key, i.result);
  });

  const hasCorrective =
    header.corrective_content ||
    header.corrective_datetime ||
    header.corrective_deviation ||
    header.corrective_detail ||
    header.corrective_actor ||
    header.corrective_approver;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">
          데일리
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/hygiene" className="text-slate-400 hover:text-slate-200 text-sm">
          영업장환경위생점검일지
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{header.inspection_date}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">영업장환경위생점검일지</h1>
      <p className="text-slate-500 text-sm mb-4">
        점검일자: {header.inspection_date}
        {header.author_name && ` · 작성: ${header.author_name}`}
      </p>

      <div className="space-y-6 mb-8">
        {HYGIENE_CHECKLIST.map((category) => (
          <section
            key={category.title}
            className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden"
          >
            <h2 className="px-4 py-3 text-sm font-semibold text-cyan-300 bg-slate-800/80 border-b border-slate-700/60">
              {category.title}
            </h2>
            <ul className="divide-y divide-slate-700/50">
              {category.questions.map((question, qIndex) => {
                const key = `${category.title}-${qIndex + 1}`;
                const result = itemMap.get(key) ?? "—";
                return (
                  <li key={key} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <p className="flex-1 text-sm text-slate-300 min-w-0">{question}</p>
                    <span
                      className={`shrink-0 w-8 h-8 flex items-center justify-center rounded text-sm font-medium ${
                        result === "O"
                          ? "bg-emerald-900/50 text-emerald-300"
                          : result === "X"
                            ? "bg-amber-900/50 text-amber-300"
                            : "bg-slate-700/50 text-slate-500"
                      }`}
                    >
                      {result}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {hasCorrective && (
        <section className="rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8">
          <h2 className="text-sm font-semibold text-amber-300 mb-4">부적합 조치</h2>
          <dl className="grid gap-3 text-sm">
            {header.corrective_content && (
              <>
                <dt className="text-slate-500">내용</dt>
                <dd className="text-slate-200">{header.corrective_content}</dd>
              </>
            )}
            {header.corrective_datetime && (
              <>
                <dt className="text-slate-500">일시</dt>
                <dd className="text-slate-200">{formatDt(header.corrective_datetime)}</dd>
              </>
            )}
            {header.corrective_deviation && (
              <>
                <dt className="text-slate-500">이탈내용</dt>
                <dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_deviation}</dd>
              </>
            )}
            {header.corrective_detail && (
              <>
                <dt className="text-slate-500">세부 개선 조치 내역</dt>
                <dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_detail}</dd>
              </>
            )}
            {(header.corrective_actor || header.corrective_approver) && (
              <div className="flex gap-6">
                {header.corrective_actor && (
                  <>
                    <dt className="text-slate-500">개선조치자</dt>
                    <dd className="text-slate-200">{header.corrective_actor}</dd>
                  </>
                )}
                {header.corrective_approver && (
                  <>
                    <dt className="text-slate-500">승인자</dt>
                    <dd className="text-slate-200">{header.corrective_approver}</dd>
                  </>
                )}
              </div>
            )}
          </dl>
        </section>
      )}

      <div className="flex justify-end">
        <Link
          href="/daily/hygiene"
          className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          목록으로
        </Link>
      </div>
    </div>
  );
}
