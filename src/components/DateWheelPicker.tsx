"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ITEM_HEIGHT = 44;
const VISIBLE_COUNT = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_COUNT;
/** 뷰포트 가운데 선택선까지의 거리. spacer와 동일하게 첫/끝 항목이 가운데 올 수 있게 함 */
const CENTER_OFFSET = WHEEL_HEIGHT / 2 - ITEM_HEIGHT / 2;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function parseDate(value: string | undefined): { y: number; m: number; d: number } {
  if (!value || typeof value !== "string") {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }
  const clampedM = Math.max(1, Math.min(12, m));
  const maxD = getDaysInMonth(y, clampedM);
  const clampedD = Math.max(1, Math.min(maxD, d));
  return { y, m: clampedM, d: clampedD };
}

function toYYYYMMDD(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

const YEAR_MIN = 2020;
const YEAR_MAX = 2035;
const YEARS = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

type WheelColumnProps = {
  items: number[];
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
};

function WheelColumn({ items, value, onChange, format }: WheelColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const selectedIndex = items.indexOf(value);
  const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const maxScrollTop = Math.max(0, (items.length - 1) * ITEM_HEIGHT);

  // 초기 스크롤: 가운데 선택선 기준으로 selectedIndex번 항목이 오도록
  // scrollTop = selectedIndex * ITEM_HEIGHT (뷰포트 중심 = scrollTop + WHEEL_HEIGHT/2 = 스페이서 + 항목중심)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;
    const idx = Math.max(0, Math.min(safeIndex, items.length - 1));
    const scrollTop = Math.max(0, Math.min(idx * ITEM_HEIGHT, maxScrollTop));
    el.scrollTop = scrollTop;
  }, [items.length, safeIndex, maxScrollTop]);

  // 선택 인덱스 = 뷰포트 가운데(containerHeight/2)에 걸린 항목
  // contentYAtCenter = scrollTop + WHEEL_HEIGHT/2, 항목 i 중심 = CENTER_OFFSET + i*ITEM_HEIGHT + ITEM_HEIGHT/2 => i = scrollTop/ITEM_HEIGHT
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    let idx = Math.round(scrollTop / ITEM_HEIGHT);
    idx = Math.max(0, Math.min(idx, items.length - 1));
    const newVal = items[idx];
    if (items[idx] !== undefined && newVal !== value) onChange(newVal);
  }, [items, value, onChange]);

  // 스크롤 종료 시 같은 중앙 기준으로 nearest index 계산 후 스냅
  const handleScrollEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    let idx = Math.round(scrollTop / ITEM_HEIGHT);
    idx = Math.max(0, Math.min(idx, items.length - 1));
    const snapTop = Math.max(0, Math.min(idx * ITEM_HEIGHT, maxScrollTop));
    el.scrollTo({ top: snapTop, behavior: "smooth" });
    const newVal = items[idx];
    if (items[idx] !== undefined) onChange(newVal);
    setIsScrolling(false);
  }, [items, onChange, maxScrollTop]);

  return (
    <div className="flex-1 min-w-0 flex flex-col items-center">
      <div
        className="relative w-full overflow-hidden"
        style={{ height: WHEEL_HEIGHT }}
      >
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[44px] border-y border-cyan-500/40 pointer-events-none z-10"
          aria-hidden
        />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onTouchStart={() => setIsScrolling(true)}
          onTouchEnd={() => setTimeout(handleScrollEnd, 100)}
          onMouseDown={() => setIsScrolling(true)}
          onMouseUp={() => setTimeout(handleScrollEnd, 100)}
          onMouseLeave={() => setIsScrolling(false)}
          className="w-full h-full overflow-y-auto overflow-x-hidden scrollbar-hide snap-y snap-mandatory"
          style={{
            scrollSnapType: "y mandatory",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div style={{ height: CENTER_OFFSET }} />
          {items.map((v, i) => (
            <div
              key={v}
              className="flex items-center justify-center text-slate-100 text-lg font-medium snap-center"
              style={{
                height: ITEM_HEIGHT,
                opacity: v === value ? 1 : 0.45,
                transform: `scale(${v === value ? 1 : 0.92})`,
              }}
            >
              {format(v)}
            </div>
          ))}
          <div style={{ height: CENTER_OFFSET }} />
        </div>
      </div>
    </div>
  );
}

export type DateWheelPickerProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
};

export default function DateWheelPicker({
  value,
  onChange,
  className = "",
  placeholder = "날짜 선택",
  id,
  disabled = false,
}: DateWheelPickerProps) {
  const [open, setOpen] = useState(false);
  const initial = useMemo(() => parseDate(value), [value]);
  const [y, setY] = useState(initial.y);
  const [m, setM] = useState(initial.m);
  const [d, setD] = useState(initial.d);

  const daysInMonth = useMemo(() => getDaysInMonth(y, m), [y, m]);
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  useEffect(() => {
    if (d > daysInMonth) setD(daysInMonth);
  }, [daysInMonth, d]);

  useEffect(() => {
    if (open) {
      const { y: vy, m: vm, d: vd } = parseDate(value);
      setY(vy);
      setM(vm);
      setD(Math.min(vd, getDaysInMonth(vy, vm)));
    }
  }, [open, value]);

  const handleConfirm = useCallback(() => {
    onChange(toYYYYMMDD(y, m, d));
    setOpen(false);
  }, [y, m, d, onChange]);

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, []);

  const displayValue = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen(true)}
        className={`w-full text-left px-3 py-2 bg-space-900 border border-slate-600 rounded-lg text-slate-100 focus:ring-2 focus:ring-cyan-500/50 focus:outline-none ${disabled ? "opacity-70 cursor-not-allowed" : ""} ${className}`}
      >
        <span className={displayValue ? "text-slate-100" : "text-slate-500"}>
          {displayValue || placeholder}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60"
          onClick={handleCancel}
          role="dialog"
          aria-modal="true"
          aria-label="날짜 선택"
        >
          <div
            className="w-full max-w-sm bg-space-800 rounded-t-2xl sm:rounded-2xl border border-slate-600 shadow-xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-600 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">날짜 선택</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 rounded-lg"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="px-3 py-1.5 text-sm bg-cyan-500 text-space-900 font-medium rounded-lg hover:bg-cyan-400"
                >
                  확인
                </button>
              </div>
            </div>
            <div className="p-4 flex gap-2 overflow-hidden">
              <WheelColumn
                items={YEARS}
                value={y}
                onChange={(v) => setY(v)}
                format={(v) => `${v}년`}
              />
              <WheelColumn
                items={MONTHS}
                value={m}
                onChange={(v) => setM(v)}
                format={(v) => `${v}월`}
              />
              <WheelColumn
                items={days}
                value={d}
                onChange={(v) => setD(v)}
                format={(v) => `${v}일`}
              />
            </div>
            <div className="h-4 sm:h-6 flex-shrink-0" />
          </div>
        </div>
      )}
    </>
  );
}
