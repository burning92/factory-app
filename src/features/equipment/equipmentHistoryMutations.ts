import type { Session } from "@supabase/supabase-js";

async function parseJson(res: Response): Promise<{ ok?: boolean; error?: string }> {
  try {
    return (await res.json()) as { ok?: boolean; error?: string };
  } catch {
    return { error: "응답을 해석할 수 없습니다." };
  }
}

/** 본문 이력 삭제 — API 경유 (admin) */
export async function deleteEquipmentHistoryRecord(recordId: string, session: Session | null): Promise<{ ok: true } | { error: string }> {
  if (!session?.access_token || !session.refresh_token) {
    return { error: "로그인이 필요합니다." };
  }
  const res = await fetch(`/api/equipment-history/records/${recordId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    return { error: json.error ?? "삭제에 실패했습니다." };
  }
  return { ok: true };
}

/** 결과 이력 1건 삭제 — API 경유 (manager·headquarters·admin) */
export async function deleteEquipmentHistoryUpdate(updateId: string, session: Session | null): Promise<{ ok: true } | { error: string }> {
  if (!session?.access_token || !session.refresh_token) {
    return { error: "로그인이 필요합니다." };
  }
  const res = await fetch(`/api/equipment-history/updates/${updateId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    return { error: json.error ?? "삭제에 실패했습니다." };
  }
  return { ok: true };
}
