import { supabase } from "@/lib/supabase";

export async function patchEquipmentIncidentApi(
  id: string,
  organizationCode: string,
  patch: Record<string, unknown>
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || !session.refresh_token) {
    throw new Error("세션이 없습니다. 다시 로그인해 주세요.");
  }
  const res = await fetch(`/api/equipment-incidents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      organization_code: organizationCode,
      ...patch,
    }),
  });
  const j = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(typeof j.error === "string" ? j.error : "수정에 실패했습니다.");
  }
}

export async function deleteEquipmentIncidentApi(id: string, organizationCode: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || !session.refresh_token) {
    throw new Error("세션이 없습니다. 다시 로그인해 주세요.");
  }
  const res = await fetch(`/api/equipment-incidents/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      organization_code: organizationCode,
    }),
  });
  const j = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(typeof j.error === "string" ? j.error : "삭제에 실패했습니다.");
  }
}
