export type MaterialStorage3fRoomKey = "raw" | "sub";

export type MaterialStorage3fRoom = {
  key: MaterialStorage3fRoomKey;
  name: string;
};

export const MATERIAL_STORAGE_3F_ROOMS: MaterialStorage3fRoom[] = [
  { key: "raw", name: "원료보관실" },
  { key: "sub", name: "부자재보관실" },
];

export const MATERIAL_STORAGE_3F_QUESTIONS: string[] = [
  "제품의 적재 및 이격상태는 양호한가?",
  "제품-부적합품은 구분하여 보관하고 있는가?",
  "조명시설의 파손은 없는가?",
  "출입문은 밀폐가 잘 되는가?",
  "부적합품 외에 보관품은 없는가?",
  "바닥에 이물질 및 오염 흔적은 없는가?",
];

export type MaterialStorage3fResult = "O" | "X";
export type MaterialStorage3fResultMap = Record<string, MaterialStorage3fResult>;

export function keyForResult(roomKey: MaterialStorage3fRoomKey, questionIndex: number): string {
  return `${roomKey}:${questionIndex}`;
}

export function parseOptionalNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function formatOneDecimal(n: number): string {
  return n.toFixed(1);
}

function tempOutOfRange(temp: number | null): boolean {
  if (temp == null) return false;
  return temp < 10 || temp > 35;
}

function humidityOutOfRange(humidity: number | null): boolean {
  if (humidity == null) return false;
  return humidity > 50;
}

export function hasAnyMaterialStorage3fIssue(
  results: MaterialStorage3fResultMap,
  temps: Record<MaterialStorage3fRoomKey, string>,
  humidities: Record<MaterialStorage3fRoomKey, string>
): boolean {
  const hasFail = Object.values(results).some((v) => v === "X");
  if (hasFail) return true;
  return MATERIAL_STORAGE_3F_ROOMS.some((room) => {
    const t = parseOptionalNum(temps[room.key] ?? "");
    const h = parseOptionalNum(humidities[room.key] ?? "");
    return tempOutOfRange(t) || humidityOutOfRange(h);
  });
}

export function buildMaterialStorage3fAutoDeviationText(
  results: MaterialStorage3fResultMap,
  temps: Record<MaterialStorage3fRoomKey, string>,
  humidities: Record<MaterialStorage3fRoomKey, string>
): string {
  const lines: string[] = [];

  MATERIAL_STORAGE_3F_ROOMS.forEach((room) => {
    const t = parseOptionalNum(temps[room.key] ?? "");
    const h = parseOptionalNum(humidities[room.key] ?? "");
    if (tempOutOfRange(t)) {
      lines.push(`${room.name} 온도: ${formatOneDecimal(t!)}℃ / 기준 10~35℃`);
    }
    if (humidityOutOfRange(h)) {
      lines.push(`${room.name} 습도: ${formatOneDecimal(h!)}% / 기준 50% 이하`);
    }
    MATERIAL_STORAGE_3F_QUESTIONS.forEach((q, qi) => {
      if (results[keyForResult(room.key, qi)] === "X") {
        lines.push(`${room.name} - ${q}: 부적합`);
      }
    });
  });

  return lines.join("\n");
}
