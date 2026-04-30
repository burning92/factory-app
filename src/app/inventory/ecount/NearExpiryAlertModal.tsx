"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type NearExpiryAlertRow = {
  item_code: string;
  item_name: string;
  lot_no: string;
  qty: number;
  d_day: number;
};

function nearExpiryBadgeClassName(dDay: number): string {
  if (dDay <= 7) return "bg-red-500/25 text-red-200";
  if (dDay <= 14) return "bg-orange-500/25 text-orange-200";
  return "bg-indigo-500/25 text-indigo-200";
}

function nearExpiryLevelText(dDay: number): string {
  if (dDay <= 7) return "위험";
  if (dDay <= 14) return "경고";
  return "주의";
}

type Props = {
  rows: NearExpiryAlertRow[];
  alertKey: string;
};

const SEEN_STORAGE_KEY = "ecount-near-expiry-alert-seen-key";

export default function NearExpiryAlertModal({ rows, alertKey }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (rows.length === 0) return;
    try {
      const seenKey = window.sessionStorage.getItem(SEEN_STORAGE_KEY);
      if (seenKey === alertKey) return;
      window.sessionStorage.setItem(SEEN_STORAGE_KEY, alertKey);
      setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [alertKey, rows.length]);

  if (!open || rows.length === 0) return null;

  return (
    <>
      <button
        type="button"
        aria-label="소비기한 임박 팝업 닫기"
        className="fixed inset-0 z-[360] bg-black/60"
        onClick={() => setOpen(false)}
      />
      <div className="fixed inset-x-2 top-1/2 z-[370] max-h-[84vh] -translate-y-1/2 overflow-hidden rounded-xl border border-amber-500/40 bg-slate-900 shadow-2xl shadow-black/50 sm:inset-x-auto sm:left-1/2 sm:w-[min(94vw,46rem)] sm:-translate-x-1/2">
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div>
            <p className="text-xs text-amber-300/90">재고현황 진입 알림</p>
            <h3 className="text-base font-semibold text-amber-100 sm:text-lg">소비기한 30일 이내 원부자재</h3>
            <p className="mt-1 text-xs text-slate-400">제외 품목(포장재/박스류, 설탕/소금류 등)과 품목명 "바질"은 자동 제외되었습니다.</p>
            <p className="mt-1 text-[11px] text-slate-500">※ 본 알림은 마지막으로 불러온 이카운트 재고 데이터를 기준으로 표시됩니다.</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[58vh] overflow-y-auto px-3 py-3 sm:px-4">
          <div className="space-y-2 sm:hidden">
            {rows.map((row) => (
              <div key={`${row.item_code}-${row.lot_no}`} className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-100 leading-snug">{row.item_name}</p>
                  <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${nearExpiryBadgeClassName(row.d_day)}`}>
                    {nearExpiryLevelText(row.d_day)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-slate-300">
                  <span className="tabular-nums">{row.lot_no}</span>
                  <span className={`inline-flex rounded px-2 py-0.5 font-semibold ${nearExpiryBadgeClassName(row.d_day)}`}>
                    D-{row.d_day}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">재고 {row.qty.toLocaleString("ko-KR")}</p>
              </div>
            ))}
          </div>

          <table className="hidden w-full text-sm sm:table">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr className="border-b border-slate-700">
                <th className="px-2 py-2 text-left font-medium">품목명</th>
                <th className="px-2 py-2 text-left font-medium">LOT</th>
                <th className="px-2 py-2 text-right font-medium">재고</th>
                <th className="px-2 py-2 text-right font-medium">등급</th>
                <th className="px-2 py-2 text-right font-medium">D-Day</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.item_code}-${row.lot_no}`} className="border-b border-slate-800 text-slate-200">
                  <td className="px-2 py-2">{row.item_name}</td>
                  <td className="px-2 py-2 tabular-nums">{row.lot_no}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.qty.toLocaleString("ko-KR")}</td>
                  <td className="px-2 py-2 text-right">
                    <span className={`inline-flex rounded px-2 py-0.5 font-semibold ${nearExpiryBadgeClassName(row.d_day)}`}>
                      {nearExpiryLevelText(row.d_day)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <span className={`inline-flex rounded px-2 py-0.5 font-semibold ${nearExpiryBadgeClassName(row.d_day)}`}>
                      D-{row.d_day}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-slate-700 px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
          >
            확인
          </button>
        </div>
      </div>
    </>
  );
}
