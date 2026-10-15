import { GoogleClient } from "@/features/haccpArchive/google/client";

export type ProtectionInfo = {
  protectedRangeId: number;
  warningOnly: boolean;
  /** 탭 전체 보호인지(행·열 범위 없이 sheetId 만 지정) */
  wholeSheet: boolean;
};
export type SheetInfo = { sheetId: number; title: string; protections: ProtectionInfo[] };

export interface SheetsApi {
  getSheets(spreadsheetId: string): Promise<SheetInfo[]>;
  /** 요청 묶음은 Google 쪽에서 한꺼번에 적용되거나 전부 거부된다. */
  batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<{ replies?: unknown[] }>;
}

type RawRange = { sheetId?: number; startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number };

export class GoogleSheets implements SheetsApi {
  constructor(private readonly client: GoogleClient) {}

  async getSheets(spreadsheetId: string): Promise<SheetInfo[]> {
    const res = await this.client.json<{
      sheets: { properties: { sheetId: number; title: string }; protectedRanges?: { protectedRangeId: number; warningOnly?: boolean; range?: RawRange }[] }[];
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title),protectedRanges(protectedRangeId,warningOnly,range))`
    );
    return res.sheets.map((sheet) => ({
      sheetId: sheet.properties.sheetId,
      title: sheet.properties.title,
      protections: (sheet.protectedRanges ?? []).map((p) => ({
        protectedRangeId: p.protectedRangeId,
        warningOnly: Boolean(p.warningOnly),
        wholeSheet:
          p.range?.startRowIndex === undefined &&
          p.range?.endRowIndex === undefined &&
          p.range?.startColumnIndex === undefined &&
          p.range?.endColumnIndex === undefined,
      })),
    }));
  }

  async batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<{ replies?: unknown[] }> {
    return this.client.json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
  }
}
