import { md5Hex, sha256Hex } from "@/features/haccpArchive/backup";
import { ensureSubfolder } from "@/features/haccpArchive/folders";
import type { DriveApi } from "@/features/haccpArchive/google/drive";
import type { ArchiveSource } from "@/features/haccpArchive/source";
import type { ArchiveState } from "@/features/haccpArchive/state";
import type { PhotoRecord } from "@/features/haccpArchive/sheetModel";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif" };

export function decodeDataUrl(value: string): { mimeType: string; ext: string; data: Buffer } | null {
  const m = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(value.trim());
  if (!m) return null;
  const mimeType = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
  const ext = EXT[mimeType];
  if (!ext) return null;
  const data = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  if (data.length === 0) return null;
  return { mimeType, ext, data };
}

export function sanitizeFilePart(text: string): string {
  const cleaned = text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, "").slice(0, 40);
  return cleaned || "품목";
}

export function photoFileName(date: string, itemName: string, seq: number, ext: string): string {
  return `${date}_${sanitizeFilePart(itemName)}_입고${String(seq).padStart(2, "0")}.${ext}`;
}

export type PhotoRunResult = { uploaded: number; reused: number; failed: { itemId: string; reason: string }[]; remaining: number };

/**
 * 사진을 한 장씩 읽어 Drive 에 올리고, Drive 가 계산한 md5·크기가 원본과 같을 때만 보관 완료로 기록한다.
 * DB 의 사진은 지우지 않는다.
 */
export async function migratePhotos(opts: {
  source: ArchiveSource;
  drive: DriveApi;
  photosFolderId: string;
  state: ArchiveState;
  limit: number;
  now: () => string;
}): Promise<PhotoRunResult> {
  const { source, drive, state } = opts;
  const result: PhotoRunResult = { uploaded: 0, reused: 0, failed: [], remaining: 0 };
  if (opts.limit <= 0) return result;
  const items = await source.listPhotoItems();
  const pending = items
    .filter((i) => !state.photos[String(i.id)])
    .sort((a, b) => {
      const fa = state.photoFailures[String(a.id)] ? 1 : 0;
      const fb = state.photoFailures[String(b.id)] ? 1 : 0;
      return fa - fb || String(a.created_at).localeCompare(String(b.created_at));
    });
  const batch = pending.slice(0, opts.limit);
  result.remaining = pending.length - batch.length;
  if (batch.length === 0) return result;
  const dates = await source.receivingDates(Array.from(new Set(batch.map((i) => String(i.log_id)))));
  const monthFolders = new Map<string, string>();

  for (const item of batch) {
    const itemId = String(item.id);
    const logId = String(item.log_id);
    try {
      const raw = await source.loadPhoto(itemId);
      if (!raw) throw new Error("사진 값이 비어 있음");
      const decoded = decodeDataUrl(raw);
      if (!decoded) throw new Error("이미지 data URL 형식이 아님");
      const sha256 = sha256Hex(decoded.data);
      const md5 = md5Hex(decoded.data);
      const date = dates.get(logId) ?? String(item.created_at ?? "").slice(0, 10);
      const month = date.slice(0, 7) || "날짜없음";
      let folderId = monthFolders.get(month);
      if (!folderId) {
        folderId = await ensureSubfolder(drive, opts.photosFolderId, month);
        monthFolders.set(month, folderId);
      }
      const props = { kind: "label-photo", itemId, logId, sha256 };
      let file = (await drive.findFiles(folderId, { kind: "label-photo", itemId })).find((f) => f.md5Checksum === md5);
      if (file) {
        result.reused += 1;
      } else {
        const seqKey = `${date}|${String(item.item_name ?? "")}`;
        const seq = (state.photoSeq[seqKey] ?? 0) + 1;
        state.photoSeq[seqKey] = seq;
        const uploaded = await drive.uploadFile({
          parentId: folderId,
          name: photoFileName(date, String(item.item_name ?? ""), seq, decoded.ext),
          mimeType: decoded.mimeType,
          data: decoded.data,
          appProperties: props,
        });
        file = await drive.getFile(uploaded.id);
        if (file.md5Checksum !== md5 || Number(file.size) !== decoded.data.length) {
          throw new Error(`업로드 검증 실패(md5 ${file.md5Checksum ?? "없음"} / 크기 ${file.size ?? "없음"})`);
        }
        result.uploaded += 1;
      }
      await drive.restrictSharing(file.id, true);
      await drive.lockReadOnly(file.id, "HACCP 원료 입고검수 라벨사진 원본");
      const record: PhotoRecord = {
        itemId,
        logId,
        fileId: file.id,
        name: file.name,
        webViewLink: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
        sha256,
        md5,
        size: decoded.data.length,
        uploadedAt: opts.now(),
      };
      state.photos[itemId] = record;
      delete state.photoFailures[itemId];
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state.photoFailures[itemId] = reason;
      result.failed.push({ itemId, reason });
    }
  }
  return result;
}
