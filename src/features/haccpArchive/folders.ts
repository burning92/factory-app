import type { DriveApi, DrivePermission } from "@/features/haccpArchive/google/drive";

export const VIEW_ROOT_NAME = "HACCP 전자일지 자동보관(열람용)";
export const PRIVATE_ROOT_NAME = "HACCP 전자일지 자동보관(비공개 원본)";

export const FOLDER_NAMES = {
  monthlySheets: "01_월별 전자일지(열람용 Google Sheets)",
  photos: "02_원료 입고검수 라벨사진",
  monthlyBackups: "03_월별 전자일지 원본백업",
  auditLogs: "04_감사로그 장기보관",
  corrections: "05_데이터 정정·보완 이력",
  status: "00_동기화 상태",
} as const;

export type ArchiveFolders = {
  viewRoot: string;
  privateRoot: string;
  monthlySheets: string;
  photos: string;
  monthlyBackups: string;
  auditLogs: string;
  corrections: string;
  status: string;
};

export type FolderConfig = {
  /** 열람용 폴더를 만들 상위 폴더(앱이 만든 폴더이거나 'root'). */
  viewParentId: string;
  /** 비공개 원본 폴더를 만들 상위 폴더. 공유 폴더 아래에 두지 않는다. */
  privateParentId: string;
};

async function ensureFolder(drive: DriveApi, parentId: string, name: string): Promise<string> {
  return (await drive.findFolder(parentId, name)) ?? (await drive.createFolder(parentId, name));
}

export async function ensureFolders(drive: DriveApi, config: FolderConfig): Promise<ArchiveFolders> {
  const viewRoot = await ensureFolder(drive, config.viewParentId, VIEW_ROOT_NAME);
  const privateRoot = await ensureFolder(drive, config.privateParentId, PRIVATE_ROOT_NAME);
  return {
    viewRoot,
    privateRoot,
    monthlySheets: await ensureFolder(drive, viewRoot, FOLDER_NAMES.monthlySheets),
    photos: await ensureFolder(drive, privateRoot, FOLDER_NAMES.photos),
    monthlyBackups: await ensureFolder(drive, privateRoot, FOLDER_NAMES.monthlyBackups),
    auditLogs: await ensureFolder(drive, privateRoot, FOLDER_NAMES.auditLogs),
    corrections: await ensureFolder(drive, privateRoot, FOLDER_NAMES.corrections),
    status: await ensureFolder(drive, privateRoot, FOLDER_NAMES.status),
  };
}

export async function ensureSubfolder(drive: DriveApi, parentId: string, name: string): Promise<string> {
  return ensureFolder(drive, parentId, name);
}

export type PermissionReport = { ok: boolean; problems: string[]; warnings: string[] };

const EDIT_ROLES = new Set(["writer", "fileOrganizer", "organizer"]);

function who(p: DrivePermission): string {
  const inherited = p.permissionDetails?.some((d) => d.inherited) ? "(상위 폴더에서 상속)" : "";
  return `${p.emailAddress ?? p.domain ?? p.type} ${p.role}${inherited}`;
}

/**
 * 링크 공개·도메인 공개는 어디서든 중단 사유다(상위 폴더 상속 포함).
 * 비공개 원본은 소유자 외 공유도 중단 사유다.
 * 열람용은 사용자·그룹 열람 공유를 허용하고, 편집 권한자는 경고로 남긴다(시트 탭 보호로 셀 수정은 막힘).
 */
export function checkPermissions(perms: DrivePermission[], scope: "view" | "private"): PermissionReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const p of perms) {
    if (p.role === "owner") continue;
    if (p.type === "anyone") problems.push(`링크가 있는 모든 사용자에게 공개됨(${p.role})`);
    else if (p.type === "domain") problems.push(`도메인 전체 공개(${p.domain ?? ""} ${p.role})`);
    else if (scope === "private") problems.push(`소유자 외 공유: ${who(p)}`);
    else if (EDIT_ROLES.has(p.role)) warnings.push(`편집 권한 공유: ${who(p)}. 시트 보호로 셀 수정은 막히지만 열람 권한으로 낮추는 것을 권장`);
  }
  return { ok: problems.length === 0, problems, warnings };
}

export async function verifyFolderPermissions(drive: DriveApi, folders: ArchiveFolders): Promise<PermissionReport> {
  const view = checkPermissions(await drive.listPermissions(folders.viewRoot), "view");
  const priv = checkPermissions(await drive.listPermissions(folders.privateRoot), "private");
  return {
    ok: view.ok && priv.ok,
    problems: [...view.problems.map((p) => `열람용 폴더: ${p}`), ...priv.problems.map((p) => `비공개 원본 폴더: ${p}`)],
    warnings: view.warnings.map((w) => `열람용 폴더: ${w}`),
  };
}
