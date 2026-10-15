import { GoogleClient, readGoogleCredentials } from "@/features/haccpArchive/google/client";
import { GoogleDrive } from "@/features/haccpArchive/google/drive";
import { GoogleSheets } from "@/features/haccpArchive/google/sheets";
import { ArchiveRunner, DEFAULT_LIMITS, type RunnerLimits } from "@/features/haccpArchive/runner";
import { ArchiveSource, fetchColumnCatalog } from "@/features/haccpArchive/source";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const n = Number(env[name]);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function readLimits(env: NodeJS.ProcessEnv = process.env): RunnerLimits {
  return {
    monthsPerRun: intEnv(env, "HACCP_ARCHIVE_MONTHS_PER_RUN", DEFAULT_LIMITS.monthsPerRun, 6),
    photosPerRun: intEnv(env, "HACCP_ARCHIVE_PHOTOS_PER_RUN", DEFAULT_LIMITS.photosPerRun, 50),
    auditDaysPerRun: intEnv(env, "HACCP_ARCHIVE_AUDIT_DAYS_PER_RUN", DEFAULT_LIMITS.auditDaysPerRun, 31),
  };
}

export async function createArchiveRunnerFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<ArchiveRunner> {
  const credentials = readGoogleCredentials(env);
  if (!credentials) throw new Error("Google OAuth 환경변수가 설정되지 않았습니다");
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase 서버 환경변수가 설정되지 않았습니다");
  const catalog = await fetchColumnCatalog(`${url.replace(/\/$/, "")}/rest/v1/`, key);
  const client = new GoogleClient(credentials);
  return new ArchiveRunner({
    source: new ArchiveSource(getSupabaseAdmin(), catalog, intEnv(env, "HACCP_ARCHIVE_PAGE_SIZE", 200, 500) || 200),
    drive: new GoogleDrive(client),
    sheets: new GoogleSheets(client),
    folders: {
      viewParentId: env.HACCP_ARCHIVE_VIEW_PARENT_ID || "root",
      privateParentId: env.HACCP_ARCHIVE_PRIVATE_PARENT_ID || "root",
    },
    limits: readLimits(env),
  });
}
