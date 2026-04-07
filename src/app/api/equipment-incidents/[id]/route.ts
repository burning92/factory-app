import { NextResponse } from "next/server";

const EDIT_DISABLED_MESSAGE =
  "현재 수정 기능은 비활성화되어 있습니다. 이력 수정은 추후 권한 정책 확정 후 제공 예정입니다.";

/** 설비 이상 이력 수정·삭제 API — 현재 비활성화 */
export async function PATCH() {
  return NextResponse.json({ error: EDIT_DISABLED_MESSAGE }, { status: 403 });
}

export async function DELETE() {
  return NextResponse.json({ error: EDIT_DISABLED_MESSAGE }, { status: 403 });
}
