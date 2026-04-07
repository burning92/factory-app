"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const panelBase =
  "pointer-events-none fixed z-[10000] rounded-lg border border-slate-600 bg-slate-800 text-slate-100 shadow-2xl shadow-black/50 ring-1 ring-black/30 break-words whitespace-normal";

type ExecutivePortalTooltipProps = {
  /** 트리거 버튼 등 */
  trigger: ReactNode;
  /** 툴팁 본문 */
  children: ReactNode;
  /** 트리거와 툴팁 사이 간격(px) */
  gap?: number;
  /** 기본: 본문 툴팁 / compact: 막대·작은 수치용 */
  size?: "default" | "compact";
};

/**
 * document.body로 포털 렌더 — 카드 overflow에 잘리지 않음.
 * 위치는 뷰포트 기준으로 계산하고, 아래 공간이 부족하면 위로 뒤집음.
 */
export function ExecutivePortalTooltip({
  trigger,
  children,
  gap = 10,
  size = "default",
}: ExecutivePortalTooltipProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320 });
  const tooltipId = useId();

  const updatePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(320, window.innerWidth - 2 * margin);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    const th = tooltipRef.current?.offsetHeight ?? 100;
    let top = rect.bottom + gap;
    if (top + th > window.innerHeight - margin) {
      top = rect.top - gap - th;
    }
    if (top < margin) top = margin;
    setPos({ top, left, width });
  }, [gap]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => updatePosition());
    });
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePosition]);

  const paddingClass = size === "compact" ? "px-2.5 py-1.5 text-xs font-semibold tabular-nums" : "px-3.5 py-3 text-sm leading-relaxed";

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      {trigger}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className={`${panelBase} ${paddingClass}`}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {children}
          </div>,
          document.body
        )}
    </span>
  );
}
