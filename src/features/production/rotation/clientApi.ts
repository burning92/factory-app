import { supabase } from "@/lib/supabase";
import type { RotationDayPayload, RotationMasterPayload } from "./persist";

async function authHeaders(): Promise<HeadersInit | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.access_token) return null;
  return {
    Authorization: `Bearer ${session.access_token}`,
    "x-refresh-token": session.refresh_token ?? "",
    "Content-Type": "application/json",
  };
}

export async function fetchRotationMaster(): Promise<RotationMasterPayload> {
  const headers = await authHeaders();
  if (!headers) throw new Error("로그인 세션이 없습니다.");
  const res = await fetch("/api/production/rotation/master", { headers });
  const json = (await res.json()) as { ok?: boolean; data?: RotationMasterPayload; error?: string; message?: string };
  if (!res.ok || !json.ok || !json.data) throw new Error(json.message ?? json.error ?? "마스터를 불러오지 못했습니다.");
  return json.data;
}

export async function saveRotationMaster(payload: RotationMasterPayload): Promise<void> {
  const headers = await authHeaders();
  if (!headers) throw new Error("로그인 세션이 없습니다.");
  const res = await fetch("/api/production/rotation/master", { method: "PUT", headers, body: JSON.stringify(payload) });
  const text = await res.text();
  let json: { ok?: boolean; error?: string; message?: string } = {};
  try {
    json = text ? (JSON.parse(text) as { ok?: boolean; error?: string; message?: string }) : {};
  } catch {
    throw new Error(text.slice(0, 180) || `마스터 저장에 실패했습니다. (${res.status})`);
  }
  if (!res.ok || !json.ok) {
    const raw = json.message ?? json.error ?? `마스터 저장에 실패했습니다. (${res.status})`;
    if (/unique|duplicate/i.test(raw)) {
      throw new Error("같은 숙련을 여러 명에게 저장하려면 DB에서 rotation_priorities_unique_rank 인덱스를 제거하세요.");
    }
    throw new Error(raw);
  }
}

export async function fetchRotationDay(date: string): Promise<RotationDayPayload> {
  const headers = await authHeaders();
  if (!headers) throw new Error("로그인 세션이 없습니다.");
  const res = await fetch(`/api/production/rotation/day?date=${encodeURIComponent(date)}`, { headers });
  const json = (await res.json()) as { ok?: boolean; data?: RotationDayPayload; error?: string; message?: string };
  if (!res.ok || !json.ok || !json.data) throw new Error(json.message ?? json.error ?? "일별 데이터를 불러오지 못했습니다.");
  return json.data;
}

export async function saveRotationDay(payload: RotationDayPayload): Promise<void> {
  const headers = await authHeaders();
  if (!headers) throw new Error("로그인 세션이 없습니다.");
  const res = await fetch("/api/production/rotation/day", { method: "PUT", headers, body: JSON.stringify(payload) });
  const json = (await res.json()) as { ok?: boolean; error?: string; message?: string };
  if (!res.ok || !json.ok) throw new Error(json.message ?? json.error ?? "일별 저장에 실패했습니다.");
}
