import { GoogleClient } from "@/features/haccpArchive/google/client";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

export type DriveFile = {
  id: string;
  name: string;
  md5Checksum?: string;
  size?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
};

export type DrivePermission = {
  type: string;
  role: string;
  emailAddress?: string;
  domain?: string;
  permissionDetails?: { inherited?: boolean; inheritedFrom?: string }[];
};

export interface DriveApi {
  findFolder(parentId: string, name: string): Promise<string | null>;
  createFolder(parentId: string, name: string): Promise<string>;
  findFiles(parentId: string, appProperties: Record<string, string>): Promise<DriveFile[]>;
  uploadFile(input: {
    parentId: string;
    name: string;
    mimeType: string;
    data: Buffer;
    appProperties: Record<string, string>;
  }): Promise<DriveFile>;
  updateFileContent(fileId: string, data: Buffer, mimeType: string): Promise<DriveFile>;
  createSpreadsheet(parentId: string, name: string, appProperties: Record<string, string>): Promise<string>;
  lockReadOnly(fileId: string, reason: string): Promise<void>;
  listPermissions(fileId: string): Promise<DrivePermission[]>;
  getFile(fileId: string): Promise<DriveFile>;
  downloadText(fileId: string): Promise<string>;
  /** 편집자의 재공유를 막고, 비공개 원본은 열람자의 다운로드·인쇄·복사도 막는다. */
  restrictSharing(fileId: string, copyRequiresWriterPermission: boolean): Promise<void>;
}

const FILE_FIELDS = "id,name,md5Checksum,size,webViewLink,appProperties";

function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export class GoogleDrive implements DriveApi {
  constructor(private readonly client: GoogleClient) {}

  private async search(q: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({ q, fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: "200", spaces: "drive" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await this.client.json<{ files: DriveFile[]; nextPageToken?: string }>(
        `https://www.googleapis.com/drive/v3/files?${params}`
      );
      files.push(...res.files);
      pageToken = res.nextPageToken ?? "";
    } while (pageToken);
    return files;
  }

  async findFolder(parentId: string, name: string): Promise<string | null> {
    const found = await this.search(
      `${quote(parentId)} in parents and trashed = false and mimeType = ${quote(FOLDER_MIME)} and name = ${quote(name)}`
    );
    return found[0]?.id ?? null;
  }

  async createFolder(parentId: string, name: string): Promise<string> {
    const res = await this.client.json<DriveFile>(`https://www.googleapis.com/drive/v3/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    return res.id;
  }

  async findFiles(parentId: string, appProperties: Record<string, string>): Promise<DriveFile[]> {
    const props = Object.entries(appProperties)
      .map(([key, value]) => `appProperties has { key=${quote(key)} and value=${quote(value)} }`)
      .join(" and ");
    return this.search(`${quote(parentId)} in parents and trashed = false${props ? ` and ${props}` : ""}`);
  }

  async uploadFile(input: {
    parentId: string;
    name: string;
    mimeType: string;
    data: Buffer;
    appProperties: Record<string, string>;
  }): Promise<DriveFile> {
    const boundary = `haccp-archive-${Date.now().toString(36)}`;
    const meta = JSON.stringify({
      name: input.name,
      parents: [input.parentId],
      mimeType: input.mimeType,
      appProperties: input.appProperties,
    });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`),
      input.data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return this.client.json<DriveFile>(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FILE_FIELDS}`,
      { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body) }
    );
  }

  async updateFileContent(fileId: string, data: Buffer, mimeType: string): Promise<DriveFile> {
    return this.client.json<DriveFile>(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=${FILE_FIELDS}`,
      { method: "PATCH", headers: { "Content-Type": mimeType }, body: new Uint8Array(data) }
    );
  }

  async createSpreadsheet(parentId: string, name: string, appProperties: Record<string, string>): Promise<string> {
    const res = await this.client.json<DriveFile>(`https://www.googleapis.com/drive/v3/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: SPREADSHEET_MIME, parents: [parentId], appProperties }),
    });
    return res.id;
  }

  async lockReadOnly(fileId: string, reason: string): Promise<void> {
    await this.client.request(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentRestrictions: [{ readOnly: true, reason }] }),
    });
  }

  async listPermissions(fileId: string): Promise<DrivePermission[]> {
    const res = await this.client.json<{ permissions: DrivePermission[] }>(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(type,role,emailAddress,domain,permissionDetails(inherited,inheritedFrom))`
    );
    return res.permissions ?? [];
  }

  async getFile(fileId: string): Promise<DriveFile> {
    return this.client.json<DriveFile>(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=${FILE_FIELDS}`);
  }

  async restrictSharing(fileId: string, copyRequiresWriterPermission: boolean): Promise<void> {
    await this.client.request(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writersCanShare: false, copyRequiresWriterPermission }),
    });
  }

  async downloadText(fileId: string): Promise<string> {
    const res = await this.client.request(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return res.text();
  }
}
