"use client";

import { useEffect, useMemo, useRef } from "react";

type MobilePlanRow = {
  id: number;
  label: string;
  qty: number | null;
  note: string | null;
  className: string;
};

type MobilePlanEntry = {
  date: string;
  rows: MobilePlanRow[];
};

type Props = {
  monthTitle: string;
  entries: MobilePlanEntry[];
};

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function formatQty(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ko-KR");
}

function formatDateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAY_LABELS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d} (${weekday})`;
}

function pickTargetDate(dates: string[], todayIso: string): string | null {
  if (dates.length === 0) return null;
  if (dates.includes(todayIso)) return todayIso;
  const future = dates.find((d) => d > todayIso);
  if (future) return future;
  return dates[dates.length - 1];
}

export default function MobilePlanList({ monthTitle, entries }: Props) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const sortedDates = useMemo(() => entries.map((e) => e.date).sort((a, b) => a.localeCompare(b)), [entries]);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    const targetDate = pickTargetDate(sortedDates, todayIso);
    if (!targetDate) return;
    const el = refs.current[targetDate];
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [sortedDates]);

  if (entries.length === 0) {
    return (
      <section className="md:hidden space-y-3">
        <h2 className="text-base font-semibold text-cyan-300/90">{monthTitle}</h2>
        <div className="rounded-xl border border-slate-700 bg-space-800/60 p-3 text-xs text-slate-500">
          표시할 계획이 없습니다.
        </div>
      </section>
    );
  }

  return (
    <section className="md:hidden space-y-3">
      <h2 className="text-base font-semibold text-cyan-300/90">{monthTitle}</h2>
      {entries.map((entry) => (
        <article
          key={entry.date}
          ref={(el) => {
            refs.current[entry.date] = el;
          }}
          className="rounded-xl border border-slate-700 bg-space-800/60 p-3"
        >
          <p className="text-sm font-semibold text-slate-100 mb-2">{formatDateLabel(entry.date)}</p>
          <div className="space-y-1.5">
            {entry.rows.map((row) => (
              <div key={row.id} className={`rounded-md px-2 py-1 text-xs ${row.className}`}>
                <p>{row.label}</p>
                {row.qty != null && Number.isFinite(row.qty) ? (
                  <p className="text-[11px] mt-0.5 tabular-nums">수량 {formatQty(row.qty)}</p>
                ) : null}
                {row.note ? <p className="text-[11px] mt-0.5 opacity-90">비고: {row.note}</p> : null}
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
