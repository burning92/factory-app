/**
 * 카드 헤더 줄 — 툴팁은 ExecutivePortalTooltip(포털) 사용.
 * (구 absolute 툴팁용 z-index는 포털로 대체됨.)
 */
export const executiveTooltipHostRowClass = "relative";

/** 레거시: 인라인 absolute 툴팁. 신규는 ExecutivePortalTooltip 권장 */
export const executiveTooltipPanelClass =
  "pointer-events-none absolute top-full z-[100] mt-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs leading-relaxed text-slate-200 shadow-2xl shadow-black/50 ring-1 ring-black/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100";
