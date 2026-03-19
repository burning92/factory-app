/**
 * 영업장 온·습도점검일지 — 구역별 기준 (온도·습도 상한)
 * 기준: 온도 "이하", 습도 "이하" → 실측이 기준을 초과하면 이탈
 */
export type TempHumidityZone = {
  id: string;
  name: string;
  maxTempC: number;
  maxHumidityPct: number;
};

/** 표시·저장(zone_index) 순서: 1 가열실 … 9 토핑실 */
export const TEMP_HUMIDITY_ZONES: TempHumidityZone[] = [
  { id: "heating", name: "가열실", maxTempC: 25, maxHumidityPct: 80 },
  { id: "forming", name: "성형실", maxTempC: 30, maxHumidityPct: 80 },
  { id: "dough", name: "도우실", maxTempC: 30, maxHumidityPct: 80 },
  { id: "outer_pack", name: "외포장실", maxTempC: 25, maxHumidityPct: 80 },
  { id: "raw_in", name: "원료반입실", maxTempC: 25, maxHumidityPct: 80 },
  { id: "metal", name: "금속검출실", maxTempC: 25, maxHumidityPct: 80 },
  { id: "sorting", name: "선별실", maxTempC: 30, maxHumidityPct: 80 },
  { id: "inner_pack", name: "내포장실", maxTempC: 25, maxHumidityPct: 80 },
  { id: "topping", name: "토핑실", maxTempC: 25, maxHumidityPct: 80 },
];
