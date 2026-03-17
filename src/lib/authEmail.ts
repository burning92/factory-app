/**
 * 로그인 ID를 Auth 이메일 local-part로 안전하게 변환.
 * 한글 등 non-ASCII를 그대로 쓰면 Supabase Auth/이메일 규격에서 문제될 수 있으므로
 * 항상 ASCII만 사용하는 base64url(UTF-8) 인코딩으로 통일.
 * - 사용자 입력용 login_id: 그대로 profiles.login_id에 저장 (표시/조회용)
 * - 내부 auth email: 이 함수 결과 + '@' + organization_code + '.local'
 */
export function toAuthEmailLocal(loginId: string): string {
  const trimmed = (loginId ?? "").trim();
  if (!trimmed) return "";
  let base64: string;
  if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(trimmed, "utf8").toString("base64");
  } else {
    const bytes = new TextEncoder().encode(trimmed);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
