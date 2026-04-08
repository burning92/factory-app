/**
 * 폐기율 상세용 더미 데이터 — 붙여넣기 Raw(구분자 생략) 파싱 후 생산일별 집계.
 * 테이블 컬럼: 반죽량·도우폐기·파베폐기 등은 스냅샷 일지와 동일한 의미로 사용.
 */

import type { DayProductionMetrics } from "@/features/dashboard/aggregateProductionFromSnapshots";

export interface WasteDetailMockRow {
  productionDate: string;
  productName: string;
  finishedQty: number;
  expiryDate: string;
  doughMixQty: number;
  doughWasteQty: number;
  parbakeWasteQty: number;
}

/** 테이블 1행 = 생산일 단위 집계 */
export interface WasteDetailMockDayRow {
  date: string;
  doughMixQty: number;
  doughWasteQty: number;
  parbakeWasteQty: number;
  /** 파베 분모: 일지 규칙과 맞추어 당일 반죽량 합(도우 사용량) 사용 */
  sameDayParbakeProductionQty: number;
  doughDiscardRatePct: number | null;
  parbakeDiscardRatePct: number | null;
  overallDiscardRatePct: number | null;
}

/** 원문(헤더 + 데이터). 공백은 제품명 등에 포함될 수 있음. */
export const WASTE_DETAIL_MOCK_RAW = `생산일제품명완제품수량완제품 소비기한도우반죽량도우폐기량파베이크 폐기량
2026-01-02허니갈릭페퍼로니20052027-01-013224,17,134
2026-01-05허니갈릭페퍼로니20862027-01-043227,17,110
2026-01-06트리플치즈라구16052027-01-053252,45,55
2026-01-09허니고르곤졸라19272027-01-083147,27,29
2026-01-12허니고르곤졸라30862027-01-113163,5,89
2026-01-14바질페스토마스카포네2027-01-133158,15,64
2026-01-16허니고르곤졸라31252027-01-153152,16,44
2026-01-19허니갈릭페퍼로니16042027-01-182604,3,64
2026-01-19미니페퍼로니4872027-01-18550,10,53
2026-01-22허니고르곤졸라33702027-01-213371,35,121
2026-01-23마르게리따25632027-01-223410,11,23
2026-01-24파베이크생산2027-01-233300,7,45
2026-01-26허니고르곤졸라25312027-01-252664,18,27
2026-01-26미니 허니고르곤졸라7782027-01-25800,1,21
2026-01-27허니고르곤졸라30442027-01-263366,15,22
2026-01-30허니갈릭페퍼로니14022027-01-293409,16,56
2026-02-02허니갈릭페퍼로니16022027-02-012338,5,77
2026-02-02미니피자 페퍼로니10492027-02-011100,20,31
2026-02-05마르게리따25242027-02-042574,24,72
2026-02-05미니마르게리따8572027-02-04900,4,39
2026-02-06허니고르곤졸라25262027-02-052512,10,76
2026-02-06미니 허니고르곤졸라9602027-02-051000,25,15
2026-02-09시금치베이컨리코타16032027-02-083366,6,73
2026-02-11허니고르곤졸라32082027-02-103512,37,105
2026-02-12파이브치즈16812027-02-113456,46,46
2026-02-19통통옥수수17622027-02-183457,4,68
2026-02-20허니갈릭페퍼로니20042027-02-193398,25,89
2026-02-23허니고르곤졸라32062027-02-223448,13,76
2026-02-25미니 페퍼로니32312027-02-253355,17,107
2026-02-26미니 마르게리따31202027-02-253360,20,220
2026-02-27미니고르곤졸라29512027-02-263270,10,118
2026-03-03허니고르곤졸라26432027-03-023506,20,88
2026-03-06마르게리따26072027-03-053550,16,106
2026-03-09허니고르곤졸라15042027-03-083525,20,94
2026-03-10트리플치즈라구17242027-03-093496,35,126
2026-01-07포노부오노 시그니처 화덕 브레드42912027-01-064451,160,0
2026-01-08포노부오노 시그니처 화덕 브레드42082027-01-074337,129,0
2026-01-13포노부오노 시그니처 화덕 브레드42632027-01-124347,84,0
2026-01-15포노부오노 시그니처 화덕 브레드42222027-01-144349,127,0
2026-01-20포노부오노 시그니처 화덕 브레드42422027-01-194347,105,0
2026-01-21포노부오노 시그니처 화덕 브레드42422027-01-204340,98,0
2026-01-28포노부오노 시그니처 화덕 브레드43332027-01-274414,81,0
2026-01-29포노부오노 시그니처 화덕 브레드42842027-01-284470,186,0
2026-02-03포노부오노 시그니처 화덕 브레드42882027-02-024402,114,0
2026-02-04포노부오노 시그니처 화덕 브레드43142027-02-034389,75,0
2026-02-10포노부오노 시그니처 화덕 브레드43012027-02-094391,90,0
2026-02-13포노부오노 시그니처 화덕 브레드44282027-02-124530,102,0
2026-02-24포노부오노 시그니처 화덕 브레드43272027-02-234421,94,0
2026-03-04포노부오노 시그니처 화덕 브레드43052027-03-034548,243,0
2026-03-05포노부오노 시그니처 화덕 브레드43022027-03-044538,236,0
2026-03-11포노부오노 시그니처 화덕 브레드43832027-03-104547,139,0`;

const YMD = /\d{4}-\d{2}-\d{2}/g;

/**
 * 꼬리 숫자열을 반죽량·도우폐기·파베폐기 세 정수로 분리.
 * Raw 데이터 특성상 반죽량은 대개 3~5자리, 도우·파베 폐기는 1~4자리로 가정해 조합을 시도한다.
 */
function splitTailThreeInts(tail: string): { mix: number; dWaste: number; pWaste: number } | null {
  const t = tail.trim();
  if (!t || !/^\d+$/.test(t)) return null;
  const len = t.length;
  const candidates: { mix: number; dWaste: number; pWaste: number }[] = [];
  for (let lm = 3; lm <= 5; lm++) {
    for (let lw = 1; lw <= 4; lw++) {
      const lp = len - lm - lw;
      if (lp < 0 || lp > 4) continue;
      const a = t.slice(0, lm);
      const b = t.slice(lm, lm + lw);
      const c = lp === 0 ? "" : t.slice(lm + lw);
      if (a.length > 1 && a[0] === "0") continue;
      if (b.length > 1 && b[0] === "0") continue;
      if (lp > 0 && c.length > 1 && c[0] === "0") continue;
      const mix = parseInt(a, 10);
      const dWaste = parseInt(b, 10);
      const pWaste = lp === 0 ? 0 : parseInt(c, 10);
      if (![mix, dWaste, pWaste].every(Number.isFinite)) continue;
      if (mix < 400) continue;
      if (dWaste > mix || pWaste > mix) continue;
      candidates.push({ mix, dWaste, pWaste });
    }
  }
  if (candidates.length === 0) return null;
  /** 반죽량은 통상 2천~6천대 — 이 범위에 들어오는 분할을 우선 */
  const band = (mix: number) => (mix >= 500 && mix <= 6500 ? 0 : 800);
  /**
   * 꼬리 숫자 붙임이 애매할 때: 단순 합 최소는 45471390 → 13+90 처럼 오분할을 유발함.
   * 파베 폐기에 가중치를 두어 44511600 → 160+0, 45471390 → 139+0 을 택하고,
   * 351237105 형(도우·파베 둘 다 유의미)은 여전히 합리적으로 남도록 함.
   */
  const score = (c: { dWaste: number; pWaste: number }) => c.pWaste * 2 + c.dWaste;
  candidates.sort(
    (u, v) =>
      band(u.mix) - band(v.mix) ||
      score(u) - score(v) ||
      u.dWaste + u.pWaste - (v.dWaste + v.pWaste)
  );
  return candidates[0]!;
}

/** 소비기한 뒤 `반죽,도우폐기,파베폐기` 형태면 숫자 붙임 오분할 없이 그대로 사용 */
function splitTailExplicitCsv(tail: string): { mix: number; dWaste: number; pWaste: number } | null {
  const t = tail.trim();
  const m = /^(\d+),(\d+),(\d+)$/.exec(t);
  if (!m) return null;
  const mix = parseInt(m[1]!, 10);
  const dWaste = parseInt(m[2]!, 10);
  const pWaste = parseInt(m[3]!, 10);
  if (![mix, dWaste, pWaste].every(Number.isFinite)) return null;
  if (mix < 1) return null;
  if (dWaste > mix || pWaste > mix) return null;
  return { mix, dWaste, pWaste };
}

export function parseWasteDetailMockLine(line: string): WasteDetailMockRow | null {
  const s = line.trim();
  if (!s || s.startsWith("생산일")) return null;

  const dates: { m: string; i: number }[] = [];
  YMD.lastIndex = 0;
  let rm: RegExpExecArray | null;
  while ((rm = YMD.exec(s)) !== null) {
    dates.push({ m: rm[0], i: rm.index });
  }
  if (dates.length < 2) return null;

  const prodDate = dates[0].m;
  const expDate = dates[1].m;
  const mid = s.slice(dates[0].i + 10, dates[1].i);
  const tail = s.slice(dates[1].i + 10);

  const qtyMatch = mid.match(/^(.+?)(\d+)$/);
  let productName: string;
  let finishedQty: number;
  if (qtyMatch) {
    productName = qtyMatch[1].trim();
    finishedQty = parseInt(qtyMatch[2], 10);
  } else {
    productName = mid.trim();
    finishedQty = 0;
  }

  const split = splitTailExplicitCsv(tail) ?? splitTailThreeInts(tail);
  if (!split) return null;

  return {
    productionDate: prodDate,
    productName,
    finishedQty,
    expiryDate: expDate,
    doughMixQty: split.mix,
    doughWasteQty: split.dWaste,
    parbakeWasteQty: split.pWaste,
  };
}

export function parseWasteDetailMockRaw(raw: string): WasteDetailMockRow[] {
  const out: WasteDetailMockRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const row = parseWasteDetailMockLine(line);
    if (row) out.push(row);
  }
  return out;
}

function ratesForSums(
  sumMix: number,
  sumDoughWaste: number,
  sumParbakeWaste: number,
  sumParbakeProd: number
): Pick<WasteDetailMockDayRow, "doughDiscardRatePct" | "parbakeDiscardRatePct" | "overallDiscardRatePct"> {
  const doughDiscardRatePct =
    sumMix > 0 ? (sumDoughWaste / sumMix) * 100 : null;
  const parbakeDiscardRatePct =
    sumParbakeProd > 0 ? (sumParbakeWaste / sumParbakeProd) * 100 : null;
  const overallDiscardRatePct =
    sumMix > 0 ? ((sumDoughWaste + sumParbakeWaste) / sumMix) * 100 : null;
  return { doughDiscardRatePct, parbakeDiscardRatePct, overallDiscardRatePct };
}

/** 생산일 기준 합산 + 일별 폐기율 재계산 */
export function aggregateWasteMockByProductionDate(rows: WasteDetailMockRow[]): WasteDetailMockDayRow[] {
  const byDate = new Map<
    string,
    { mix: number; dW: number; pW: number }
  >();
  for (const r of rows) {
    const cur = byDate.get(r.productionDate) ?? { mix: 0, dW: 0, pW: 0 };
    cur.mix += r.doughMixQty;
    cur.dW += r.doughWasteQty;
    cur.pW += r.parbakeWasteQty;
    byDate.set(r.productionDate, cur);
  }
  const sorted = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([date, v]) => {
    const sameDayParbakeProductionQty = v.mix;
    const rates = ratesForSums(v.mix, v.dW, v.pW, sameDayParbakeProductionQty);
    return {
      date,
      doughMixQty: v.mix,
      doughWasteQty: v.dW,
      parbakeWasteQty: v.pW,
      sameDayParbakeProductionQty,
      ...rates,
    };
  });
}

/** 파싱 + 집계 한 번에 */
export function getWasteDetailMockDayRows(): WasteDetailMockDayRow[] {
  return aggregateWasteMockByProductionDate(parseWasteDetailMockRaw(WASTE_DETAIL_MOCK_RAW));
}

/** 품목 단위 파싱 결과(JSON 직렬화·테스트용) */
export const WASTE_DETAIL_MOCK_PARSED_ROWS: WasteDetailMockRow[] =
  parseWasteDetailMockRaw(WASTE_DETAIL_MOCK_RAW);

/** 번들 일자 1건 → 폐기율 상세 테이블 행(비율 포함) */
export function bundleDayToWasteDetailRow(d: DayProductionMetrics): WasteDetailMockDayRow {
  const { doughMixQty, doughWasteQty, parbakeWasteQty, sameDayParbakeProductionQty } = d;
  return {
    date: d.date,
    doughMixQty,
    doughWasteQty,
    parbakeWasteQty,
    sameDayParbakeProductionQty,
    ...ratesForSums(doughMixQty, doughWasteQty, parbakeWasteQty, sameDayParbakeProductionQty),
  };
}

/**
 * 2차 마감 스냅샷 일자 중 반죽·파베생산·폐기가 모두 0인 행은 표시용으로만 mock을 채움.
 * (수동 JSONL 병합은 mergeBundleDaysWithManualImportsForTable + rollupWasteMockFromDayRows 사용.)
 */
export function mergeBundleDaysWithWasteMockForTable(
  bundleDays: DayProductionMetrics[],
  mockDayRows: WasteDetailMockDayRow[]
): { rows: WasteDetailMockDayRow[]; filledMockDates: string[] } {
  const mockByDate = new Map(mockDayRows.map((r) => [r.date, r]));
  const filledMockDates: string[] = [];
  const rows = bundleDays.map((d) => {
    const mock = mockByDate.get(d.date);
    const emptySnapshot =
      d.doughMixQty === 0 &&
      d.sameDayParbakeProductionQty === 0 &&
      d.doughWasteQty === 0 &&
      d.parbakeWasteQty === 0;
    if (emptySnapshot && mock) {
      filledMockDates.push(d.date);
      return { ...mock };
    }
    return bundleDayToWasteDetailRow(d);
  });
  return { rows, filledMockDates };
}

export interface ManualWasteImportSeries {
  doughProductionByDate: Record<string, number>;
  doughWasteByDate: Record<string, number>;
  parbakeWasteByDate: Record<string, number>;
  /** 일자별 파베이크 생산량(개수). 있으면 파베%·Σ 파베생산 분모로 우선 사용 */
  parbakeProductionByDate: Record<string, number>;
}

/**
 * 수동 JSONL(도우생산/도우폐기/파베폐기/선택 파베생산)을 번들 일자와 합쳐 표 표시용 행을 만든다.
 * - 번들에 값이 있으면 우선 사용
 * - 번들 값이 0이고 수동 값이 있으면 수동 값으로 보강
 * - 번들에 없는 날짜도 수동 데이터가 있으면 행으로 추가
 * - parbakeProductionByDate[date] > 0 이면 당일 파베 생산 분모(sameDayParbakeProductionQty)로 사용
 */
export function mergeBundleDaysWithManualImportsForTable(
  bundleDays: DayProductionMetrics[],
  manual: ManualWasteImportSeries
): { rows: WasteDetailMockDayRow[]; filledManualDates: string[] } {
  const bundleByDate = new Map(bundleDays.map((d) => [d.date, d]));
  const allDates = new Set<string>();
  for (const day of bundleDays) allDates.add(day.date);
  for (const d of Object.keys(manual.doughProductionByDate)) allDates.add(d);
  for (const d of Object.keys(manual.doughWasteByDate)) allDates.add(d);
  for (const d of Object.keys(manual.parbakeWasteByDate)) allDates.add(d);
  for (const d of Object.keys(manual.parbakeProductionByDate ?? {})) allDates.add(d);

  const filledManualDates: string[] = [];
  const rows = Array.from(allDates)
    .sort()
    .map((date) => {
      const b = bundleByDate.get(date);
      const manualMix = manual.doughProductionByDate[date] ?? 0;
      const manualDWaste = manual.doughWasteByDate[date] ?? 0;
      const manualPWaste = manual.parbakeWasteByDate[date] ?? 0;
      const manualParbakeProd = manual.parbakeProductionByDate?.[date] ?? 0;

      const fromBundle = b
        ? {
            doughMixQty: b.doughMixQty,
            doughWasteQty: b.doughWasteQty,
            parbakeWasteQty: b.parbakeWasteQty,
            sameDayParbakeProductionQty: b.sameDayParbakeProductionQty,
          }
        : {
            doughMixQty: 0,
            doughWasteQty: 0,
            parbakeWasteQty: 0,
            sameDayParbakeProductionQty: 0,
          };

      const useManual =
        (fromBundle.doughMixQty === 0 &&
          fromBundle.doughWasteQty === 0 &&
          fromBundle.parbakeWasteQty === 0 &&
          (manualMix > 0 || manualDWaste > 0 || manualPWaste > 0)) ||
        !b;

      const doughMixQty = useManual ? manualMix : fromBundle.doughMixQty;
      const doughWasteQty = useManual ? manualDWaste : fromBundle.doughWasteQty;
      const parbakeWasteQty = useManual ? manualPWaste : fromBundle.parbakeWasteQty;
      const sameDayParbakeProductionQty =
        manualParbakeProd > 0
          ? manualParbakeProd
          : useManual
            ? doughMixQty
            : fromBundle.sameDayParbakeProductionQty;

      if (useManual && (manualMix > 0 || manualDWaste > 0 || manualPWaste > 0)) {
        filledManualDates.push(date);
      }

      return {
        date,
        doughMixQty,
        doughWasteQty,
        parbakeWasteQty,
        sameDayParbakeProductionQty,
        ...ratesForSums(
          doughMixQty,
          doughWasteQty,
          parbakeWasteQty,
          sameDayParbakeProductionQty
        ),
      } satisfies WasteDetailMockDayRow;
    });

  return { rows, filledManualDates };
}

/** 상단 요약용: 집계 행 전체 합 */
export function rollupWasteMockFromDayRows(days: WasteDetailMockDayRow[]) {
  let sumDoughMix = 0;
  let sumDoughWaste = 0;
  let sumParbakeWaste = 0;
  let sumSameDayParbakeProduction = 0;
  for (const d of days) {
    sumDoughMix += d.doughMixQty;
    sumDoughWaste += d.doughWasteQty;
    sumParbakeWaste += d.parbakeWasteQty;
    sumSameDayParbakeProduction += d.sameDayParbakeProductionQty;
  }
  const { doughDiscardRatePct, parbakeDiscardRatePct, overallDiscardRatePct } = ratesForSums(
    sumDoughMix,
    sumDoughWaste,
    sumParbakeWaste,
    sumSameDayParbakeProduction
  );
  return {
    sumDoughMix,
    sumDoughWaste,
    sumParbakeWaste,
    sumSameDayParbakeProduction,
    doughDiscardRatePct,
    parbakeDiscardRatePct,
    overallDiscardRatePct,
    closedDayCount: days.length,
  };
}

export type WasteRollupFromDayRows = ReturnType<typeof rollupWasteMockFromDayRows>;

/** 선택 연도의 월별 가중 폐기율(일별 병합 행과 동일 합산·동일 식) */
export type WasteMonthlyRollupRow = {
  month: number;
  sumDoughMix: number;
  sumDoughWaste: number;
  sumParbakeWaste: number;
  sumSameDayParbakeProduction: number;
  doughDiscardRatePct: number | null;
  parbakeDiscardRatePct: number | null;
  overallDiscardRatePct: number | null;
  /** 해당 월에 포함된 일자 수 */
  dayCount: number;
};

/**
 * `mergeBundleDaysWithManualImportsForTable` 결과 `tableRows`를 연도로 필터한 뒤 월 단위로 합산.
 * - 도우% = Σ도우폐기 / Σ반죽량
 * - 파베% = Σ파베폐기 / Σ파베생산(당일 분모 합)
 * - 전체% = Σ(도우폐기+파베폐기) / Σ반죽량
 */
export function rollupWasteMockByMonthFromDayRows(
  rows: WasteDetailMockDayRow[],
  year: number
): WasteMonthlyRollupRow[] {
  const prefix = `${year}-`;
  const byMonth = new Map<number, WasteDetailMockDayRow[]>();
  for (let m = 1; m <= 12; m++) byMonth.set(m, []);

  for (const r of rows) {
    if (!r.date.startsWith(prefix)) continue;
    const parsed = /^(\d{4})-(\d{2})-\d{2}$/.exec(r.date);
    if (!parsed) continue;
    const monthNum = Number(parsed[2]);
    if (monthNum < 1 || monthNum > 12) continue;
    byMonth.get(monthNum)!.push(r);
  }

  const out: WasteMonthlyRollupRow[] = [];
  for (let month = 1; month <= 12; month++) {
    const monthRows = byMonth.get(month)!;
    if (monthRows.length === 0) {
      out.push({
        month,
        sumDoughMix: 0,
        sumDoughWaste: 0,
        sumParbakeWaste: 0,
        sumSameDayParbakeProduction: 0,
        doughDiscardRatePct: null,
        parbakeDiscardRatePct: null,
        overallDiscardRatePct: null,
        dayCount: 0,
      });
      continue;
    }
    const roll = rollupWasteMockFromDayRows(monthRows);
    out.push({
      month,
      sumDoughMix: roll.sumDoughMix,
      sumDoughWaste: roll.sumDoughWaste,
      sumParbakeWaste: roll.sumParbakeWaste,
      sumSameDayParbakeProduction: roll.sumSameDayParbakeProduction,
      doughDiscardRatePct: roll.doughDiscardRatePct,
      parbakeDiscardRatePct: roll.parbakeDiscardRatePct,
      overallDiscardRatePct: roll.overallDiscardRatePct,
      dayCount: monthRows.length,
    });
  }
  return out;
}

/** 전년 동일 월·일(윤년 등은 말일로 클램프) */
export function toPrevYearCalendarDate(isoDate: string, prevYear: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return `${prevYear}-12-31`;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const lastDay = new Date(prevYear, month, 0).getDate();
  const d = Math.min(day, lastDay);
  return `${prevYear}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export type WasteYoySamePeriodResult = {
  currentRate: number | null;
  prevSamePeriodRate: number | null;
  deltaPctPoint: number | null;
  /** 올해 집계에 포함된 마지막 일자 */
  periodEndDate: string | null;
  /** 전년 동기 구간의 종료일(달력 기준) */
  prevPeriodEndDate: string | null;
};

/**
 * 올해 병합 행 기준 마지막 일자까지 vs 전년 같은 월·일까지 누적 전체 폐기율 비교.
 * rowsThisYear / rowsPrevYear는 각 연도의 mergeBundleDaysWithManualImportsForTable 결과 전체.
 */
export function computeWasteYoySamePeriod(
  rowsThisYear: WasteDetailMockDayRow[],
  rowsPrevYear: WasteDetailMockDayRow[],
  year: number
): WasteYoySamePeriodResult {
  const prefix = `${year}-`;
  const dates = rowsThisYear.filter((r) => r.date.startsWith(prefix)).map((r) => r.date);
  if (dates.length === 0) {
    return {
      currentRate: null,
      prevSamePeriodRate: null,
      deltaPctPoint: null,
      periodEndDate: null,
      prevPeriodEndDate: null,
    };
  }
  dates.sort();
  const periodEndDate = dates[dates.length - 1]!;
  const curSlice = rowsThisYear.filter((r) => r.date >= `${year}-01-01` && r.date <= periodEndDate);
  const curRoll = rollupWasteMockFromDayRows(curSlice);

  const prevYear = year - 1;
  const prevPeriodEndDate = toPrevYearCalendarDate(periodEndDate, prevYear);
  const prevSlice = rowsPrevYear.filter(
    (r) => r.date >= `${prevYear}-01-01` && r.date <= prevPeriodEndDate
  );
  const prevRoll = rollupWasteMockFromDayRows(prevSlice);

  const currentRate = curRoll.overallDiscardRatePct;
  const prevSamePeriodRate = prevRoll.overallDiscardRatePct;
  const deltaPctPoint =
    currentRate != null && prevSamePeriodRate != null ? currentRate - prevSamePeriodRate : null;

  return {
    currentRate,
    prevSamePeriodRate,
    deltaPctPoint,
    periodEndDate,
    prevPeriodEndDate,
  };
}

/** %p 증감 문자열 (+/- 부호, 소수 자리 통일) */
export function formatDeltaPctPoint(delta: number | null, digits = 2): string {
  if (delta == null || !Number.isFinite(delta)) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(digits)}%p`;
}

/**
 * 폐기율 하락 = 개선. 아주 작은 변화는 중립 처리.
 */
export function wasteYoYDeltaToneClass(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return "text-slate-500";
  if (delta < -0.005) return "text-emerald-400/80";
  if (delta > 0.005) return "text-amber-400/85";
  return "text-slate-500";
}

/** 전년 동기 폐기율 대비 상대 변화(%). (전년−올해)/전년×100 — 양수면 폐기율이 그만큼 낮아짐(개선). */
export function wasteYoYRelativeDropVersusPrevPct(
  prevSamePeriodRate: number | null,
  currentRate: number | null
): number | null {
  if (
    prevSamePeriodRate == null ||
    currentRate == null ||
    !Number.isFinite(prevSamePeriodRate) ||
    !Number.isFinite(currentRate) ||
    prevSamePeriodRate <= 0
  ) {
    return null;
  }
  return ((prevSamePeriodRate - currentRate) / prevSamePeriodRate) * 100;
}

export type WasteYoYCompareStatus =
  | "greatly_improved"
  | "improved"
  | "about_same"
  | "worsened"
  | "much_worse"
  | null;

/** deltaPctPoint = 올해−전년 동기. 음수면 폐기율 개선. */
export function wasteYoYCompareStatusFromDelta(deltaPctPoint: number | null): WasteYoYCompareStatus {
  if (deltaPctPoint == null || !Number.isFinite(deltaPctPoint)) return null;
  if (deltaPctPoint <= -2) return "greatly_improved";
  if (deltaPctPoint < -0.05) return "improved";
  if (deltaPctPoint <= 0.05) return "about_same";
  if (deltaPctPoint < 2) return "worsened";
  return "much_worse";
}

export function wasteYoYCompareStatusLabel(s: WasteYoYCompareStatus): string {
  switch (s) {
    case "greatly_improved":
      return "크게 개선";
    case "improved":
      return "개선";
    case "about_same":
      return "비슷";
    case "worsened":
      return "악화";
    case "much_worse":
      return "크게 악화";
    default:
      return "";
  }
}

/** 배지용: 테마 내 연한 보더·배경 */
export function wasteYoYCompareBadgeClass(s: WasteYoYCompareStatus): string {
  switch (s) {
    case "greatly_improved":
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300/90";
    case "improved":
      return "border-emerald-500/25 bg-emerald-500/5 text-emerald-400/85";
    case "about_same":
      return "border-slate-600/40 bg-slate-800/55 text-slate-400";
    case "worsened":
      return "border-amber-500/30 bg-amber-500/10 text-amber-400/85";
    case "much_worse":
      return "border-amber-500/40 bg-amber-500/15 text-amber-300/90";
    default:
      return "border-slate-600/40 bg-slate-800/50 text-slate-500";
  }
}

/** 1줄: %p 방향을 풀어 쓴 문구 */
export function wasteYoYDeltaPlainPhrase(deltaPctPoint: number | null, digits = 2): string | null {
  if (deltaPctPoint == null || !Number.isFinite(deltaPctPoint)) return null;
  const abs = Math.abs(deltaPctPoint);
  if (deltaPctPoint < -0.005) return `전년 동기 대비 ${abs.toFixed(digits)}%p 개선`;
  if (deltaPctPoint > 0.005) return `전년 동기 대비 ${abs.toFixed(digits)}%p 상승`;
  return "전년 동기 대비 비슷한 수준";
}

/** 2줄: 상대 감소/증가 + 전년 동기 기준값(문장 안에 포함) */
export function wasteYoYSecondLineMeta(
  prevSamePeriodRate: number | null,
  currentRate: number | null,
  prevPctDigits = 2
): string | null {
  if (prevSamePeriodRate == null || !Number.isFinite(prevSamePeriodRate)) return null;
  const prevStr = `${prevSamePeriodRate.toFixed(prevPctDigits)}%`;
  const rel = wasteYoYRelativeDropVersusPrevPct(prevSamePeriodRate, currentRate);
  if (rel == null || !Number.isFinite(rel)) return `전년 동기 ${prevStr}`;
  if (Math.abs(rel) < 0.05) return `전년 동기 ${prevStr}`;
  if (rel > 0.05) return `전년 대비 ${rel.toFixed(1)}% 감소 · 전년 동기 ${prevStr}`;
  const rise = -rel;
  return `전년 대비 ${rise.toFixed(1)}% 증가 · 전년 동기 ${prevStr}`;
}
