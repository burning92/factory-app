import { isAdminLikeRole } from "@/lib/roles";

/**
 * 데일리 일지 UI 권한 — `src/app/daily` 범위 전용.
 * 승인/반려 버튼: admin급(품질팀장 포함) + 일지 status가 submitted 일 때만 표시.
 */

export function canShowDailyApproveReject(
  role: string | undefined | null,
  status: string | undefined | null
): boolean {
  return isAdminLikeRole(role) && status === "submitted";
}

/** 화면 권한 판단에 필요한 일지 머리글 값 (13종 공통 컬럼) */
export type DailyLogAccessRow = {
  status?: string | null;
  author_user_id?: string | null;
  submitted_by?: string | null;
  submitted_at?: string | null;
};

export type DailyLogAccess = {
  isOwner: boolean;
  isAdminLike: boolean;
  /** 내용·항목 수정, 저장 */
  canEdit: boolean;
  /** 제출(재제출 포함) */
  canSubmit: boolean;
  /** 제출 회수: 제출 → 작성 중 */
  canWithdraw: boolean;
  canDelete: boolean;
  canApproveReject: boolean;
  /** 승인 취소 후 재검토(정정 요청) */
  canRequestCorrection: boolean;
  /** 수정할 수 없을 때 화면에 보여줄 이유 */
  lockReason: string | null;
};

/** 작성자: author_user_id, 없으면 submitted_by (DB 20261015096000 과 같은 기준) */
export function dailyLogOwnerId(row: DailyLogAccessRow | null | undefined): string | null {
  return row?.author_user_id ?? row?.submitted_by ?? null;
}

/**
 * DB 권한(20261015091000·094000·096000)과 같은 규칙.
 *   작성 중·반려: 작성자·관리자급 수정·제출 / 제출: 수정 불가, 작성자·관리자급 회수
 *   승인: 수정·삭제 불가, 관리자급 정정 요청 / 삭제: 한 번도 제출하지 않은 작성 중 일지만
 */
export function getDailyLogAccess(
  row: DailyLogAccessRow | null | undefined,
  userId: string | null | undefined,
  role: string | null | undefined
): DailyLogAccess {
  const isAdminLike = isAdminLikeRole(role);
  const status = row?.status ?? null;
  const owner = dailyLogOwnerId(row);
  const isOwner = Boolean(userId) && owner === userId;
  // 작성자 컬럼이 아직 없는 DB(096000 적용 전 조도 일지)는 작성자 제한도 없다
  const noAuthorColumn = row != null && !("author_user_id" in row) && !row.submitted_by;
  const mine = isOwner || isAdminLike || noAuthorColumn;
  const open = status === "draft" || status === "rejected";

  let lockReason: string | null = null;
  if (status === "approved") {
    lockReason = isAdminLike
      ? "승인 완료된 일지는 수정·삭제할 수 없습니다. 고쳐야 하면 상세 화면에서 정정 요청(승인 취소 후 재검토)을 하세요."
      : "승인 완료된 일지는 수정·삭제할 수 없습니다. 고쳐야 하면 관리자(품질팀장)에게 정정 요청을 해 주세요.";
  } else if (status === "submitted") {
    lockReason = mine
      ? "제출된 일지는 바로 수정할 수 없습니다. 상세 화면에서 '제출 회수' 후 수정하고 다시 제출하세요."
      : "제출된 일지입니다. 작성자 또는 관리자만 제출을 회수할 수 있습니다.";
  } else if (open && !mine) {
    lockReason = owner
      ? "다른 사람이 작성한 일지는 수정할 수 없습니다. 작성자 또는 관리자(품질팀장)만 수정할 수 있습니다."
      : "작성자 기록이 없는 기존 일지는 관리자(품질팀장)만 수정할 수 있습니다.";
  }

  return {
    isOwner,
    isAdminLike,
    canEdit: open && mine,
    canSubmit: open && mine,
    canWithdraw: status === "submitted" && mine,
    canDelete: status === "draft" && !row?.submitted_at && mine,
    canApproveReject: isAdminLike && status === "submitted",
    canRequestCorrection: isAdminLike && status === "approved",
    lockReason,
  };
}

/** 새 일지(아직 저장 전)는 누구나 작성 가능 */
export function getDailyLogAccessOrNew(
  row: DailyLogAccessRow | null | undefined,
  userId: string | null | undefined,
  role: string | null | undefined
): DailyLogAccess {
  if (!row) {
    return {
      isOwner: true,
      isAdminLike: isAdminLikeRole(role),
      canEdit: true,
      canSubmit: true,
      canWithdraw: false,
      canDelete: false,
      canApproveReject: false,
      canRequestCorrection: false,
      lockReason: null,
    };
  }
  return getDailyLogAccess(row, userId, role);
}
