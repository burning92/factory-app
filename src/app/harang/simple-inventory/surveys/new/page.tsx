"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function HarangInventorySurveyNewPage() {
  const router = useRouter();
  const [surveyDate, setSurveyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const handleStart = async () => {
    if (!surveyDate) {
      alert("조사일을 입력하세요.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("harang_inventory_surveys")
      .insert({
        survey_date: surveyDate,
        title: title.trim() || null,
        note: note.trim() || null,
        status: "draft",
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.replace(`/harang/simple-inventory/surveys/${data.id}`);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-lg mx-auto space-y-5">
        <Link href="/harang/simple-inventory/surveys" className="text-sm text-slate-600 hover:text-slate-900">
          ← 재고조사 목록
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">새 재고조사</h1>
        <p className="text-sm text-slate-600">
          조사일 기준 창고 실사 수량을 LOT별로 입력합니다. 확정해도 생산입력·원장 usage·current_quantity는 변경되지
          않습니다.
        </p>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">첫 번째 확정 조사 = 기준선</p>
          <p className="mt-1">
            첫 조사는 소모량 계산에 쓰이지 않습니다. 이후 조사부터 전 조사 + 기간 입고 − 현 조사로 소모량이
            산출됩니다.
          </p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <label className="block text-xs text-slate-600">
            조사일
            <input
              type="date"
              value={surveyDate}
              onChange={(e) => setSurveyDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </label>
          <label className="block text-xs text-slate-600">
            제목 (선택)
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 6월 말 실사"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </label>
          <label className="block text-xs text-slate-600">
            메모 (선택)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </label>
        </section>

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleStart()}
          className="w-full px-4 py-2.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-60"
        >
          {busy ? "생성 중…" : "LOT 실사 입력 시작"}
        </button>
      </div>
    </div>
  );
}
