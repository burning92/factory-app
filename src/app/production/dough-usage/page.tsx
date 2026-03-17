"use client";

import { useState, useMemo, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMasterStore, type DoughBom, type DoughLogRecord, type DoughProcessLine } from "@/store/useMasterStore";
import DateWheelPicker from "@/components/DateWheelPicker";
import { getDefaultAuthorName, persistAuthorName } from "@/lib/authorDefault";

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Baker's percentage (flour = 100%). 도우 BOM 없을 때 폴백용. */
const RECIPE_FALLBACK: { name: string; percent: number }[] = [
  { name: "밀가루", percent: 100 },
  { name: "물", percent: 61 },
  { name: "소금", percent: 2.5 },
  { name: "이스트", percent: 1 },
  { name: "올리브오일", percent: 4 },
  { name: "설탕", percent: 1.5 },
  { name: "개량제", percent: 0.5 },
];

/**
 * 선택된 도우 BOM + 수분율로 배합 비율 배열 생성.
 * 총 배합 비율 = 100(밀가루) + 수분율 + (salt+yeast+oil+sugar+improver)/1000*100
 */
function getRecipeFromDoughBom(
  dough: DoughBom | null,
  hydrationPercent: number
): { name: string; percent: number }[] {
  if (!dough) {
    return RECIPE_FALLBACK.map((row) =>
      row.name === "물" ? { ...row, percent: hydrationPercent } : row
    );
  }
  const perKgToPercent = (g: number) => (g / 1000) * 100;
  return [
    { name: "밀가루", percent: 100 },
    { name: "물", percent: hydrationPercent },
    { name: "소금", percent: perKgToPercent(dough.salt) },
    { name: "이스트", percent: perKgToPercent(dough.yeast) },
    { name: "올리브오일", percent: perKgToPercent(dough.oil) },
    { name: "설탕", percent: perKgToPercent(dough.sugar) },
    { name: "개량제", percent: perKgToPercent(dough.improver) },
  ];
}

function getHydrationByDayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  if (Number.isNaN(d.getTime())) return 61;
  const day = d.getDay();
  if (day === 5) return 60;
  if (day === 6) return 60.5;
  return 61;
}

function getDayNameKo(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const names = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return names[d.getDay()] ?? "";
}

/** 24시간 숙성: 사용일자 = 반죽날짜 + 1일. 금요일 반죽은 월요일 사용(+3일) */
function getDefaultUsageDate(doughDateStr: string): string {
  const d = new Date(doughDateStr + "T12:00:00");
  if (Number.isNaN(d.getTime())) return doughDateStr;
  const day = d.getDay();
  const addDays = day === 5 ? 3 : 1;
  d.setDate(d.getDate() + addDays);
  return d.toISOString().slice(0, 10);
}

const KG_PER_BAG = 25;
const FLOUR_G_PER_BAG = KG_PER_BAG * 1000;
const MAX_BAGS_PER_BATCH = 6;
const MIN_BAGS_REQUIRED = 2;
/** 믹서기 잔류 등으로 인한 로스(개). 도우 중량과 무관하게 고정 합산 */
const FIXED_LOSS_QTY = 50;

/** 1회 최대 6포대 기준으로 균등 분배 제안 (예: 13 → [5,4,4]) */
function suggestBatchSplit(totalBags: number): number[] {
  if (totalBags <= 0) return [];
  const nBatches = Math.ceil(totalBags / MAX_BAGS_PER_BATCH);
  const sizes: number[] = [];
  for (let i = 0; i < nBatches; i++) {
    const remaining = totalBags - sizes.reduce((a, b) => a + b, 0);
    const slotsLeft = nBatches - i;
    const take = Math.min(MAX_BAGS_PER_BATCH, Math.max(1, Math.ceil(remaining / slotsLeft)));
    sizes.push(take);
  }
  return sizes;
}

const DOUGH_INGREDIENT_KEYS = ["밀가루", "올리브오일", "소금", "설탕", "이스트", "개량제"] as const;
const DUST_OIL_KEYS = ["덧가루-밀가루", "덧가루-세몰리나", "덧기름-카놀라유"] as const;

/** 반죽사용량 최근 작성자명: Supabase(cross-device) 1순위, localStorage 2순위 */
const DOUGH_LAST_AUTHOR_KEY = "dough-last-author-name";
const DOUGH_AUTHOR_STORAGE_KEY = "dough_process_author";

/** 백 단위 절사 (일·십의 자리 버림). 밀가루 제외 부재료용 */
function roundDownToHundreds(n: number): number {
  return Math.floor(n / 100) * 100;
}

function formatG(n: number): string {
  return `${Math.round(n).toLocaleString()}g`;
}

interface DoughLineInput {
  사용량_g: string;
  lot: string;
}

function toInputLines(lines: DoughProcessLine[]): DoughLineInput[] {
  if (!lines?.length) return [{ 사용량_g: "", lot: "" }];
  return lines.map((l) => ({ 사용량_g: String(l.사용량_g), lot: l.lot ?? "" }));
}

function fromInputLines(rows: DoughLineInput[]): DoughProcessLine[] {
  return rows
    .filter((r) => (r.사용량_g != null && String(r.사용량_g).trim() !== "") || (r.lot != null && String(r.lot).trim() !== ""))
    .map((r) => {
      const g = parseInt(String(r.사용량_g).trim(), 10);
      const 사용량_g = Number.isFinite(g) && !Number.isNaN(g) ? Math.max(0, g) : 0;
      const lotRaw = r.lot != null ? String(r.lot).trim() : "";
      const lot = lotRaw === "" ? "—" : lotRaw;
      return { 사용량_g, lot };
    });
}

const INITIAL_반죽원료 = Object.fromEntries(
  DOUGH_INGREDIENT_KEYS.map((k) => [k, [{ 사용량_g: "", lot: "" }]])
) as Record<string, DoughLineInput[]>;
const INITIAL_덧가루덧기름 = Object.fromEntries(
  DUST_OIL_KEYS.map((k) => [k, [{ 사용량_g: "", lot: "" }]])
) as Record<string, DoughLineInput[]>;

function DoughUsageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editDate = searchParams.get("date");
  const isEditMode = !!editDate;

  const { getDoughLogByDate, saveDoughLog, saving, fetchDoughBoms, fetchDoughLogs, doughBoms, doughLogsMap } = useMasterStore();
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [autoLotNoticeDate, setAutoLotNoticeDate] = useState<string | null>(null);

  // 상단: 권장량 확인 + 실제 투입량 결정 (도우 BOM 연동: 선택된 전체 객체 보유)
  const [selectedDough, setSelectedDough] = useState<DoughBom | null>(null);
  const [doughDate, setDoughDate] = useState(todayStr());
  const [hydrationPercent, setHydrationPercent] = useState(61);
  const [hydrationAutoMessage, setHydrationAutoMessage] = useState<string | null>(null);
  const [targetQty, setTargetQty] = useState("");
  const [actualBags, setActualBags] = useState("");
  const [extraKg, setExtraKg] = useState("");

  // 중단: 배합 분할 (실제 투입 포대 입력 시 자동 제안, 사용자 수정 가능)
  const [batchSplits, setBatchSplits] = useState<string[]>([]);
  /** 회차별 추가 잔량(kg). 1회차에 1단계 추가 잔량이 자동 세팅됨 */
  const [batchExtraKgs, setBatchExtraKgs] = useState<string[]>([]);

  const [usageDate, setUsageDate] = useState(() => getDefaultUsageDate(todayStr()));

  useEffect(() => {
    fetchDoughBoms();
    fetchDoughLogs();
  }, [fetchDoughBoms, fetchDoughLogs]);

  // 신규 작성 모드(?date= 없음): 폼 전체 상태 강제 초기화 (이전 쓰레기 데이터 제거)
  useEffect(() => {
    if (editDate != null && editDate !== "") return;
    setUsageDate(getDefaultUsageDate(todayStr()));
    setDoughDate(todayStr());
    setTargetQty("");
    setActualBags("");
    setExtraKg("");
    setSelectedDough(null);
    setHydrationPercent(61);
    setHydrationAutoMessage(null);
    setAuthorName("");
    set반죽원료(INITIAL_반죽원료);
    set덧가루덧기름(INITIAL_덧가루덧기름);
    setBatchSplits([]);
    setBatchExtraKgs([]);
    setAutoLotNoticeDate(null);
  }, [editDate]);

  // 수정 모드: URL date 기준으로 Store에서 최신 데이터 패칭 후 날짜 세팅 (Store 믿지 않고 URL 기준)
  useEffect(() => {
    if (!isEditMode || !editDate || !/^\d{4}-\d{2}-\d{2}$/.test(editDate)) return;
    fetchDoughLogs().then(() => {
      setUsageDate(editDate);
      setDoughDate(editDate);
    });
  }, [isEditMode, editDate, fetchDoughLogs]);

  // 도우 BOM 로드 후 첫 항목 자동 선택 — 수정 모드면 절대 덮어쓰지 않음 (editData 바인딩이 도우를 세팅함)
  useEffect(() => {
    if (isEditMode) return;
    if (doughBoms.length > 0 && selectedDough === null) setSelectedDough(doughBoms[0]);
  }, [doughBoms, selectedDough, isEditMode]);
  const [authorName, setAuthorName] = useState("");
  const [반죽원료, set반죽원료] = useState<Record<string, DoughLineInput[]>>(INITIAL_반죽원료);
  const [덧가루덧기름, set덧가루덧기름] = useState<Record<string, DoughLineInput[]>>(INITIAL_덧가루덧기름);

  // 수분율 요일별 자동 적용 — 수정 모드면 단 1ms도 실행 안 함
  useEffect(() => {
    if (isEditMode) return;
    const value = getHydrationByDayOfWeek(doughDate);
    setHydrationPercent(value);
    const dayName = getDayNameKo(doughDate);
    if (dayName) setHydrationAutoMessage(`${dayName} 반죽으로 수분율 ${value}%가 자동 적용되었습니다.`);
    else setHydrationAutoMessage(null);
  }, [doughDate, isEditMode]);

  // 기본 사용일자(오늘/내일) 세팅 — 수정 모드면 단 1ms도 실행 안 함
  useEffect(() => {
    if (isEditMode) return;
    setUsageDate(getDefaultUsageDate(doughDate));
  }, [doughDate, isEditMode]);

  const actualBagsNum = useMemo(() => Math.max(0, parseInt(actualBags, 10) || 0), [actualBags]);
  const extraKgNum = useMemo(() => Math.max(0, parseFloat(extraKg) || 0), [extraKg]);
  const actualBagsValid = actualBagsNum >= MIN_BAGS_REQUIRED;

  // 여유 공간(6포대 미만)이 있는 첫 회차에 잔량 할당. 모두 6포대면 마지막 회차에 할당 (믹서 6포대 한계)
  const getTargetIndexForExtraKg = useCallback((splits: string[]) => {
    const bags = splits.map((s) => Math.max(0, parseInt(s, 10) || 0));
    const idx = bags.findIndex((b) => b < MAX_BAGS_PER_BATCH);
    return idx >= 0 ? idx : Math.max(0, bags.length - 1);
  }, []);

  // 실제 투입 포대 수 변경 시 배합 분할 자동 제안 + 회차별 kg 스마트 할당 (6포대 미만 회차 또는 마지막 회차)
  useEffect(() => {
    if (actualBagsNum >= MIN_BAGS_REQUIRED) {
      const splits = suggestBatchSplit(actualBagsNum).map(String);
      setBatchSplits(splits);
      const firstKg = extraKg.trim() ? String(parseFloat(extraKg) || 0) : "";
      const targetIdx = getTargetIndexForExtraKg(splits);
      setBatchExtraKgs(splits.map((_, i) => (i === targetIdx ? firstKg : "")));
    } else {
      setBatchSplits([]);
      setBatchExtraKgs([]);
    }
  }, [actualBagsNum, getTargetIndexForExtraKg]);

  // 1단계 추가 잔량(kg) 변경 시 같은 규칙으로 대상 회차에만 반영 (수동 수정은 그대로 유지 가능)
  useEffect(() => {
    const v = extraKg.trim() ? String(parseFloat(extraKg) || 0) : "";
    setBatchExtraKgs((prev) => {
      if (prev.length === 0) return prev;
      const splits = batchSplits;
      if (splits.length === 0) return prev;
      const targetIdx = getTargetIndexForExtraKg(splits);
      if (prev[targetIdx] === v) return prev;
      const next = prev.map((_, i) => (i === targetIdx ? v : ""));
      return next;
    });
  }, [extraKg, batchSplits, getTargetIndexForExtraKg]);

  const existing = useMemo(() => getDoughLogByDate(usageDate), [usageDate, getDoughLogByDate]);
  /** 수정 모드로 열린 원본 데이터 (리스트에서 수정 클릭 시 전달되는 날짜로 store에서 조회) */
  const editData = existing;

  const latestDoughLog = useMemo(() => {
    const entries = Object.entries(doughLogsMap ?? {});
    if (entries.length === 0) return null;
    entries.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    return entries[0]?.[1] ?? null;
  }, [doughLogsMap]);

  // 수정 모드이고 URL date로 패칭된 editData가 있을 때만 원본 바인딩. 신규일 때만 최근 LOT 자동완성.
  useEffect(() => {
    if (isEditMode && editData) {
      setUsageDate(editData.사용일자);
      setDoughDate(editData.반죽일자 ?? editData.사용일자);
      setTargetQty(String(editData.예상수량 ?? ""));
      setAuthorName(editData.작성자명 ?? "");

      const flourLines = editData.반죽원료?.["밀가루"] ?? [];
      const flourG = flourLines.reduce((s, l) => s + (l.사용량_g ?? 0), 0);
      if (flourG > 0) {
        setActualBags(String(Math.floor(flourG / FLOUR_G_PER_BAG)));
        setExtraKg(String((flourG % FLOUR_G_PER_BAG) / 1000));
      }

      const doughDateForHydration = editData.반죽일자 ?? editData.사용일자;
      setHydrationPercent(getHydrationByDayOfWeek(doughDateForHydration));
      setHydrationAutoMessage(null);

      if (editData.dough_id && doughBoms.length > 0) {
        const matched = doughBoms.find((d) => d.id === editData.dough_id);
        setSelectedDough(matched ?? doughBoms[0]);
      } else if (doughBoms.length > 0) {
        setSelectedDough(doughBoms[0]);
      }

      const next반죽: Record<string, DoughLineInput[]> = {};
      for (const k of DOUGH_INGREDIENT_KEYS) {
        next반죽[k] = toInputLines(editData.반죽원료?.[k] ?? []);
      }
      set반죽원료(next반죽);
      const next덧: Record<string, DoughLineInput[]> = {};
      for (const k of DUST_OIL_KEYS) {
        next덧[k] = toInputLines(editData.덧가루덧기름?.[k] ?? []);
      }
      set덧가루덧기름(next덧);
      setAutoLotNoticeDate(null);
    } else if (!isEditMode) {
      // 신규 작성 시에만: 최근 덧가루·원료 LOT 자동 세팅 (수정 모드에서는 절대 실행 안 함). 작성자명은 아래 useEffect에서 Supabase → localStorage 순으로 로드.
      const getLatestLot = (lines: DoughProcessLine[] | undefined): string => {
        const firstLot = (lines?.[0]?.lot ?? "").trim();
        if (!firstLot || firstLot === "—") return "";
        return firstLot;
      };
      const getLatestUsageG = (lines: DoughProcessLine[] | undefined): string => {
        const g = lines?.[0]?.사용량_g;
        if (g == null || !Number.isFinite(Number(g))) return "";
        const n = Math.max(0, Math.round(Number(g)));
        return n > 0 ? String(n) : "";
      };
      const next반죽: Record<string, DoughLineInput[]> = {};
      for (const k of DOUGH_INGREDIENT_KEYS) {
        next반죽[k] = [{ 사용량_g: "", lot: getLatestLot(latestDoughLog?.반죽원료?.[k]) }];
      }
      set반죽원료(next반죽);
      const next덧: Record<string, DoughLineInput[]> = {};
      for (const k of DUST_OIL_KEYS) {
        const lines = latestDoughLog?.덧가루덧기름?.[k];
        const usageG = getLatestUsageG(lines);
        next덧[k] = [{ 사용량_g: usageG, lot: getLatestLot(lines) }];
      }
      set덧가루덧기름(next덧);
      const hasAutoLot = Object.values(next반죽).some((rows) => (rows[0]?.lot ?? "").trim() !== "")
        || Object.values(next덧).some((rows) => (rows[0]?.lot ?? "").trim() !== "");
      setAutoLotNoticeDate(hasAutoLot ? (latestDoughLog?.사용일자 ?? null) : null);
    }
  }, [isEditMode, editData, latestDoughLog, doughBoms]);

  /** 신규 작성 모드: 작성자 기본값 주입 (Supabase → localStorage, 로그인 도입 시 getDefaultAuthorName에서 user 반영) */
  useEffect(() => {
    if (isEditMode) return;
    let cancelled = false;
    getDefaultAuthorName(DOUGH_LAST_AUTHOR_KEY, DOUGH_AUTHOR_STORAGE_KEY)
      .then((name) => {
        if (!cancelled) setAuthorName(name);
      })
      .catch(() => {
        if (!cancelled && typeof window !== "undefined")
          setAuthorName(localStorage.getItem(DOUGH_AUTHOR_STORAGE_KEY) ?? "");
      });
    return () => {
      cancelled = true;
    };
  }, [isEditMode]);

  const targetQtyNum = Math.max(0, parseInt(targetQty, 10) || 0);
  const totalTargetQty = targetQtyNum + FIXED_LOSS_QTY;
  const qtyPerBag = selectedDough?.qtyPerBag ?? 0;

  // 권장 포대 수·추가 kg: 목표+로스(totalTargetQty) 기준 총 반죽 중량으로 수분율 동적 계산
  const { recommendedBags, recommendedExtraKg } = useMemo(() => {
    const BASELINE_HYDRATION = 61;
    const subIngredientsG = selectedDough
      ? selectedDough.salt + selectedDough.oil + selectedDough.sugar + selectedDough.yeast + selectedDough.improver
      : 62.5;
    const baselineBagWeight =
      25000 + 25000 * (BASELINE_HYDRATION / 100) + 25 * subIngredientsG;
    const weightPerDough = qtyPerBag > 0 ? baselineBagWeight / qtyPerBag : 0;

    let bags = 0;
    let extraKg = 0;
    if (weightPerDough > 0 && totalTargetQty > 0) {
      const targetTotalWeight = totalTargetQty * weightPerDough;
      const currentWeightPerKgFlour =
        1000 + 1000 * (hydrationPercent / 100) + subIngredientsG;
      const requiredFlourKg = targetTotalWeight / currentWeightPerKgFlour;
      bags = Math.floor(requiredFlourKg / 25);
      extraKg = Math.ceil(requiredFlourKg % 25);
    }
    return { recommendedBags: bags, recommendedExtraKg: extraKg };
  }, [totalTargetQty, selectedDough, hydrationPercent, qtyPerBag]);

  const recipeWithHydration = useMemo(
    () => getRecipeFromDoughBom(selectedDough, hydrationPercent),
    [selectedDough, hydrationPercent]
  );

  // Step 2: 실제 투입 포대 기준 총 밀가루 (포대 수 × 25kg + 추가 kg). 레시피는 BOM 1kg당 배합량 × (총 밀가루 kg)
  const actualFlourG = actualBagsNum * FLOUR_G_PER_BAG + extraKgNum * 1000;

  const batchBagsNums = useMemo(
    () => batchSplits.map((s) => Math.max(0, parseInt(s, 10) || 0)),
    [batchSplits]
  );
  const batchExtraKgNums = useMemo(
    () => batchExtraKgs.map((s) => Math.max(0, parseFloat(s) || 0)),
    [batchExtraKgs]
  );
  const batchSum = batchBagsNums.reduce((a, b) => a + b, 0);
  const batchSumValid = actualBagsNum === 0 || batchSum === actualBagsNum;
  const batchKgSum = batchExtraKgNums.reduce((a, b) => a + b, 0);
  const batchKgSumValid = extraKgNum === 0 ? batchKgSum === 0 : Math.abs(batchKgSum - extraKgNum) < 0.01;
  const batchColumns = batchBagsNums.map((bags, i) => ({ bags, extraKg: batchExtraKgNums[i] ?? 0 }));
  const batchFlourGPerColumn = useMemo(
    () => batchBagsNums.map((bags, i) => bags * FLOUR_G_PER_BAG + (batchExtraKgNums[i] ?? 0) * 1000),
    [batchBagsNums, batchExtraKgNums]
  );

  const batchTableData = useMemo(() => {
    if (!actualBagsValid) return [];
    return recipeWithHydration.map(({ name, percent }) => {
      const totalG = name === "밀가루" ? actualFlourG : roundDownToHundreds((actualFlourG * percent) / 100);
      const batchG = batchFlourGPerColumn.map((flourG) =>
        name === "밀가루" ? flourG : roundDownToHundreds((flourG * percent) / 100)
      );
      return { name, totalG, batchG };
    });
  }, [recipeWithHydration, actualFlourG, batchFlourGPerColumn, actualBagsValid]);

  const getLatestLot = useCallback((lines: DoughProcessLine[] | undefined): string => {
    const firstLot = (lines?.[0]?.lot ?? "").trim();
    if (!firstLot || firstLot === "—") return "";
    return firstLot;
  }, []);

  /** 권장량 불러오기: 실제 투입 포대 기준 총합(백 단위 절사) + 최근 소비기한(LOT)을 반죽원료에 채움 */
  const loadRecommendedIntoActual = useCallback(() => {
    if (!actualBagsValid) return;
    const next: Record<string, DoughLineInput[]> = {};
    for (const k of DOUGH_INGREDIENT_KEYS) {
      const row = recipeWithHydration.find((r) => r.name === k);
      const g = row
        ? (row.name === "밀가루" ? actualFlourG : roundDownToHundreds((actualFlourG * row.percent) / 100))
        : 0;
      const lot = getLatestLot(latestDoughLog?.반죽원료?.[k]);
      next[k] = [{ 사용량_g: String(g), lot }];
    }
    set반죽원료((prev) => ({ ...prev, ...next }));
    setToast({ message: "권장량이 원료란에 채워졌습니다.\nLOT는 확인해 주세요.", type: "success" });
  }, [actualBagsValid, recipeWithHydration, actualFlourG, latestDoughLog, getLatestLot]);

  const addBatchSlot = useCallback(() => {
    setBatchSplits((prev) => [...prev, ""]);
    setBatchExtraKgs((prev) => [...prev, ""]);
  }, []);
  const setBatchSlot = useCallback((index: number, value: string) => {
    setBatchSplits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);
  const setBatchExtraKg = useCallback((index: number, value: string) => {
    setBatchExtraKgs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);
  const removeBatchSlot = useCallback((index: number) => {
    setBatchSplits((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
    setBatchExtraKgs((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  const set반죽원료Row = useCallback((name: string, rows: DoughLineInput[]) => {
    set반죽원료((prev) => ({ ...prev, [name]: rows }));
  }, []);
  const set덧가루덧기름Row = useCallback((name: string, rows: DoughLineInput[]) => {
    set덧가루덧기름((prev) => ({ ...prev, [name]: rows }));
  }, []);

  const handleSave = useCallback(async () => {
    const 반죽원료Parsed: Record<string, DoughProcessLine[]> = {};
    for (const k of DOUGH_INGREDIENT_KEYS) {
      const lines = fromInputLines(반죽원료[k] ?? []);
      if (lines.length) 반죽원료Parsed[k] = lines;
    }
    const 덧가루덧기름Parsed: Record<string, DoughProcessLine[]> = {};
    for (const k of DUST_OIL_KEYS) {
      const lines = fromInputLines(덧가루덧기름[k] ?? []);
      if (lines.length) 덧가루덧기름Parsed[k] = lines;
    }
    if (authorName.trim())
      await persistAuthorName(DOUGH_LAST_AUTHOR_KEY, DOUGH_AUTHOR_STORAGE_KEY, authorName.trim());
    const targetQtyNum = targetQty.trim() ? Math.max(0, parseInt(targetQty, 10) || 0) : undefined;
    const data: DoughLogRecord = {
      사용일자: usageDate,
      작성자명: authorName.trim(),
      반죽원료: 반죽원료Parsed,
      덧가루덧기름: 덧가루덧기름Parsed,
      반죽일자: doughDate || undefined,
      예상수량: targetQtyNum,
      dough_id: selectedDough?.id ?? undefined,
    };
    try {
      await saveDoughLog(usageDate, data);
      setToast({ message: "저장되었습니다.", type: "success" });
      router.push("/production/dough-logs");
    } catch (err) {
      const detail =
        err instanceof Error
          ? err.message
          : err != null && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
      console.error("[반죽 사용량 저장 실패]", { error: err, detail, usageDate, data });
      setToast({ message: `저장에 실패했습니다. ${detail}`, type: "error" });
    }
  }, [usageDate, authorName, 반죽원료, 덧가루덧기름, doughDate, targetQty, selectedDough, saveDoughLog, router]);

  return (
    <div className="py-10 px-4 sm:px-6 lg:px-8">
      {toast && (
        <div
          role="alert"
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-lg text-sm font-medium w-[calc(100vw-2rem)] max-w-md whitespace-pre-line break-words ${
            toast.type === "success" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-100 mb-2">{editData ? "반죽사용량 수정" : "반죽사용량 입력"}</h1>
        <p className="text-slate-400 text-sm mb-6">
          권장량 확인 → 실제 투입량 결정 → 배치 분할표 확인 → 실제 사용량 입력 및 저장. 관리일지 출력 시 해당 날짜로 자동 매핑됩니다.
        </p>

        {/* 상단: 권장량 확인 + 실제 투입량 결정 */}
        <section className="rounded-2xl border border-slate-700 bg-space-800/80 p-6 mb-6">
          <h2 className="text-lg font-bold text-slate-100 mb-1">1. 권장량 확인 및 실제 투입량 결정</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">도우 종류</label>
              <select
                value={selectedDough?.id ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const found = doughBoms.find((d) => d.id === id) ?? null;
                  setSelectedDough(found);
                }}
                className="w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
              >
                {doughBoms.length === 0 ? (
                  <option value="">도우 BOM을 등록해 주세요 (기준 정보 관리)</option>
                ) : (
                  doughBoms.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">목표 수량 (생산할 도우 개수)</label>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={targetQty}
                onChange={(e) => setTargetQty(e.target.value)}
                placeholder="예: 2500"
                className="w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">반죽날짜</label>
              <DateWheelPicker
                value={doughDate}
                onChange={(v) => setDoughDate(v)}
                className="w-full text-sm"
                placeholder="날짜 선택"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">수분율 (Hydration, %)</label>
              <input
                type="number"
                min={0}
                max={100}
                inputMode="decimal"
                step={0.5}
                value={hydrationPercent}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isNaN(v)) setHydrationPercent(v);
                  setHydrationAutoMessage(null);
                }}
                className="w-full max-w-[6rem] px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
              />
              {hydrationAutoMessage && (
                <p className="text-xs text-cyan-300/90 mt-1.5">{hydrationAutoMessage}</p>
              )}
            </div>
          </div>

          {targetQtyNum > 0 && qtyPerBag > 0 && (
            <div className="rounded-xl border border-cyan-500/30 bg-space-900/50 p-4 mb-4">
              <p className="text-sm font-semibold text-cyan-300 mb-1">[권장 투입 가이드]</p>
              <p className="text-slate-200 text-sm mb-0.5">
                목표 {targetQtyNum.toLocaleString()}개 + 예상 로스 {FIXED_LOSS_QTY}개 = 총 {totalTargetQty.toLocaleString()}개
              </p>
              <p className="text-slate-200 text-sm mb-0.5">수분율 적용시 권장량</p>
              <p className="text-slate-100 text-sm font-semibold">
                {recommendedBags}포대{recommendedExtraKg > 0 ? ` + ${recommendedExtraKg}kg` : ""} 필요.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">실제 투입 포대 수</label>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={actualBags}
                onChange={(e) => setActualBags(e.target.value)}
                placeholder="예: 13"
                className="w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">추가 잔량 (kg)</label>
              <input
                type="number"
                min={0}
                inputMode="decimal"
                step={0.1}
                value={extraKg}
                onChange={(e) => setExtraKg(e.target.value)}
                placeholder="예: 0"
                className="w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500"
              />
            </div>
          </div>

          {actualBagsNum > 0 && actualBagsNum < MIN_BAGS_REQUIRED && (
            <p className="text-amber-400 text-sm mt-3">최소 2포대 이상 반죽해야 합니다.</p>
          )}
        </section>

        {/* 중단: 배합 분할(Batch) 상세표 (실제 투입 포대 입력 시 자동 생성, 수정 가능) */}
        <section className="rounded-2xl border border-slate-700 bg-space-800/80 p-6 mb-6">
          <h2 className="text-lg font-bold text-slate-100 mb-1">2. 배합 분할(Batch) 상세표</h2>
          <p className="text-slate-400 text-sm mb-4">
            1회 최대 {MAX_BAGS_PER_BATCH}포대 기준으로 회차를 자동 제안합니다. 필요 시 숫자를 수정하세요.
          </p>

          {!actualBagsValid && (
            <p className="text-slate-500 text-sm">실제 투입 포대 수를 2포대 이상 입력하면 표가 나타납니다.</p>
          )}

          {actualBagsValid && (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                {batchSplits.map((val, i) => (
                  <span key={i} className="flex items-center gap-1.5 flex-wrap">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={val}
                      onChange={(e) => setBatchSlot(i, e.target.value)}
                      placeholder="0"
                      className="w-14 px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded text-slate-100 text-center"
                      title="포대 수"
                    />
                    <span className="text-slate-500 text-xs">포대</span>
                    <span className="text-slate-500">+</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      step={0.1}
                      value={batchExtraKgs[i] ?? ""}
                      onChange={(e) => setBatchExtraKg(i, e.target.value)}
                      placeholder="0"
                      className="w-14 px-2 py-1.5 text-sm bg-space-900 border border-slate-600 rounded text-slate-100 text-center"
                      title="해당 회차 추가 잔량(kg)"
                    />
                    <span className="text-slate-500 text-xs">kg</span>
                    {batchSplits.length > 1 && (
                      <button type="button" onClick={() => removeBatchSlot(i)} className="text-slate-500 hover:text-red-400 text-xs p-1" aria-label="삭제">×</button>
                    )}
                  </span>
                ))}
                <button type="button" onClick={addBatchSlot} className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded border border-slate-600 hover:border-cyan-500/50">+ 회차 추가</button>
              </div>
              {!batchSumValid && (
                <p className="text-amber-400 text-xs mb-2">분할 합계({batchSum})가 실제 투입 포대 수({actualBagsNum})와 일치해야 합니다.</p>
              )}
              {!batchKgSumValid && extraKgNum > 0 && (
                <p className="text-amber-400 text-xs mb-2">각 회차 kg 합계({batchKgSum.toFixed(1)}kg)가 1단계 추가 잔량({extraKgNum}kg)과 일치해야 합니다.</p>
              )}

              {batchSumValid && batchKgSumValid && batchColumns.length > 0 && batchTableData.length > 0 && (
                <>
                  <div className="overflow-x-auto rounded-xl border border-slate-600">
                    <table className="w-full min-w-[500px] text-sm border-collapse">
                      <thead>
                        <tr className="bg-space-700/80 border-b border-slate-600">
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">원료명</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-200">총 투입량 ({actualBagsNum}포대{extraKgNum > 0 ? `+${extraKgNum}kg` : ""})</th>
                          {batchColumns.map((col, i) => (
                            <th key={i} className="px-3 py-2 text-right font-semibold text-slate-200">
                              {i + 1}회차 ({col.bags}포대{col.extraKg > 0 ? `+${col.extraKg}kg` : ""})
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {batchTableData.map((row, ri) => (
                          <tr key={ri} className="border-b border-slate-700">
                            <td className="px-3 py-2 font-medium text-slate-100">{row.name}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-300">{formatG(row.totalG)}</td>
                            {row.batchG.map((g, i) => (
                              <td key={i} className="px-3 py-2 text-right tabular-nums text-cyan-300/90">{formatG(g)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">* 회차별 밀가루 = (포대 수 × 25kg) + 해당 회차 kg. 부재료는 밀가루 기준 백 단위 절사.</p>
                </>
              )}
            </>
          )}
        </section>

        {/* 하단: 최종 실제 사용량 및 LOT 입력 */}
        <section className="rounded-2xl border border-slate-700 bg-space-800/80 p-6">
          <h2 className="text-lg font-bold text-slate-100 mb-1">3. 최종 실제 사용량 및 LOT 입력</h2>
          <p className="text-slate-400 text-sm mb-4">배치 작업 후 실제 소모량을 기록하세요. [권장량 불러오기]로 위 계산값을 채운 뒤 LOT를 입력하고 저장할 수 있습니다.</p>
          {autoLotNoticeDate && (
            <p className="text-xs text-cyan-300/90 mb-4">
              이전 반죽 작업({autoLotNoticeDate})의 소비기한이 자동으로 불러와졌습니다.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-xs text-slate-400 mb-1">사용일자 (저장 기준일)</label>
              <DateWheelPicker
                value={usageDate}
                onChange={(v) => setUsageDate(v)}
                className="w-full text-sm"
                placeholder="날짜 선택"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">작성자</label>
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="이름"
                className="w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={loadRecommendedIntoActual}
            disabled={!actualBagsValid}
            className="mb-6 px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 text-sm font-medium hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            권장량 불러오기
          </button>

          <h3 className="text-sm font-semibold text-cyan-300/90 mb-2">반죽 원료 (사용량 g · LOT 소비기한) · + 추가로 다중 LOT</h3>
          <div className="space-y-3 mb-6">
            {DOUGH_INGREDIENT_KEYS.map((name) => {
              const rows = 반죽원료[name] ?? [{ 사용량_g: "", lot: "" }];
              return (
                <div key={name} className="flex flex-wrap items-end gap-2">
                  <span className="text-slate-300 text-sm w-24 shrink-0">{name}</span>
                  {rows.map((row, ri) => (
                    <span key={ri} className="flex gap-1 items-center">
                      <input type="number" min={0} inputMode="numeric" placeholder="g" value={row.사용량_g} onChange={(e) => set반죽원료Row(name, rows.map((r, i) => (i === ri ? { ...r, 사용량_g: e.target.value } : r)))} className="w-20 px-2 py-1 text-sm bg-space-900 border border-slate-600 rounded text-slate-100" />
                      <DateWheelPicker value={row.lot} onChange={(v) => set반죽원료Row(name, rows.map((r, i) => (i === ri ? { ...r, lot: v } : r)))} className="w-36 px-2 py-1 text-sm" placeholder="LOT" />
                      <button type="button" onClick={() => set반죽원료Row(name, rows.length > 1 ? rows.filter((_, i) => i !== ri) : [{ 사용량_g: "", lot: "" }])} className="text-slate-500 hover:text-red-400 text-xs">삭제</button>
                    </span>
                  ))}
                  <button type="button" onClick={() => set반죽원료Row(name, [...rows, { 사용량_g: "", lot: "" }])} className="text-xs text-cyan-400 hover:text-cyan-300">+ 추가</button>
                </div>
              );
            })}
          </div>

          <h3 className="text-sm font-semibold text-cyan-300/90 mb-2">덧가루 · 덧기름 (2종 + 1종)</h3>
          <div className="space-y-3 mb-6">
            {DUST_OIL_KEYS.map((name) => {
              const rows = 덧가루덧기름[name] ?? [{ 사용량_g: "", lot: "" }];
              return (
                <div key={name} className="flex flex-wrap items-end gap-2">
                  <span className="text-slate-300 text-sm w-28 shrink-0">{name}</span>
                  {rows.map((row, ri) => (
                    <span key={ri} className="flex gap-1 items-center">
                      <input type="number" min={0} inputMode="numeric" placeholder="g" value={row.사용량_g} onChange={(e) => set덧가루덧기름Row(name, rows.map((r, i) => (i === ri ? { ...r, 사용량_g: e.target.value } : r)))} className="w-20 px-2 py-1 text-sm bg-space-900 border border-slate-600 rounded text-slate-100" />
                      <DateWheelPicker value={row.lot} onChange={(v) => set덧가루덧기름Row(name, rows.map((r, i) => (i === ri ? { ...r, lot: v } : r)))} className="w-36 px-2 py-1 text-sm" placeholder="LOT" />
                      <button type="button" onClick={() => set덧가루덧기름Row(name, rows.length > 1 ? rows.filter((_, i) => i !== ri) : [{ 사용량_g: "", lot: "" }])} className="text-slate-500 hover:text-red-400 text-xs">삭제</button>
                    </span>
                  ))}
                  <button type="button" onClick={() => set덧가루덧기름Row(name, [...rows, { 사용량_g: "", lot: "" }])} className="text-xs text-cyan-400 hover:text-cyan-300">+ 추가</button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving !== ""}
            className="w-full py-3 rounded-xl bg-cyan-500 text-space-900 font-bold shadow-glow hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "저장 중…" : "해당 내역 저장"}
          </button>
        </section>
      </div>
    </div>
  );
}

export default function DoughUsagePage() {
  return (
    <Suspense fallback={<div className="py-10 px-4 text-center text-slate-400">로딩 중…</div>}>
      <DoughUsageContent />
    </Suspense>
  );
}
