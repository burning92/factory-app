export type PhotoCheck = {
  kind: string;
  access: string;
  httpStatus: string;
};

function looksLikeDataUrl(value: string): boolean {
  return /^data:[^;,]+;base64,/i.test(value) && value.length > 40;
}

async function requestStatus(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 405 || response.status === 400 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { Range: "bytes=0-0" },
        signal: controller.signal,
      });
    }
    return response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkPhotoValue(value: unknown): Promise<PhotoCheck> {
  if (value === null || value === undefined) return { kind: "NULL", access: "대상 없음", httpStatus: "" };
  if (value === "") return { kind: "빈 문자열", access: "대상 없음", httpStatus: "" };
  if (typeof value !== "string") return { kind: typeof value, access: "확인불가", httpStatus: "" };
  if (value.startsWith("data:")) {
    return {
      kind: "인라인 data URL",
      access: looksLikeDataUrl(value) ? "본문 있음" : "형식 이상",
      httpStatus: "",
    };
  }
  if (!/^https?:\/\//i.test(value)) return { kind: "URL 아님", access: "확인불가", httpStatus: "" };
  const status = await requestStatus(value);
  if (status == null) return { kind: "http", access: "접근 불가", httpStatus: "연결 실패" };
  const ok = status >= 200 && status < 400;
  return { kind: "http", access: ok ? "접근 가능" : "접근 불가", httpStatus: String(status) };
}

export async function checkPhotos(
  rows: { id: string; url: unknown }[],
  concurrency = 8
): Promise<Map<string, PhotoCheck>> {
  const out = new Map<string, PhotoCheck>();
  let index = 0;
  async function worker() {
    while (index < rows.length) {
      const current = index;
      index += 1;
      const row = rows[current];
      out.set(row.id, await checkPhotoValue(row.url));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
  return out;
}
