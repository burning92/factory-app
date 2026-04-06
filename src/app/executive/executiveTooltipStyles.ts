/**
 * 임원 대시보드·상세 페이지 카드 툴팁 공통 스타일.
 * 툴팁이 카드 내 큰 숫자 등 형제 요소 뒤로 가려지지 않도록 호스트 행에 z-index를 둡니다.
 */
export const executiveTooltipHostRowClass = "relative z-[60]";

export const executiveTooltipPanelClass =
  "pointer-events-none absolute top-full z-[100] mt-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs leading-relaxed text-slate-200 shadow-2xl shadow-black/50 ring-1 ring-black/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100";
