import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HACCP_LOGS } from "@/features/haccpExport/catalog";
import { buildAuditDayBackup, buildMonthBackup, canonicalJson, checkAuditChain } from "@/features/haccpArchive/backup";
import { buildEquipmentFloorIndex, resolveItemFloor } from "@/features/haccpArchive/floors";
import { checkPermissions } from "@/features/haccpArchive/folders";
import { decodeDataUrl, photoFileName } from "@/features/haccpArchive/photos";
import { ArchiveRunner } from "@/features/haccpArchive/runner";
import { buildMonthTabs, ITEM_COLUMNS, statusLabel, type Row } from "@/features/haccpArchive/sheetModel";
import { buildTabRequests, toCellData, writeTabs } from "@/features/haccpArchive/sheetWriter";
import type { ArchiveSource } from "@/features/haccpArchive/source";
import { FakeDrive, FakeSheets } from "@/features/haccpArchive/testing/fakeGoogle";

const spec = (key: string) => HACCP_LOGS.find((s) => s.key === key)!;

const EQUIPMENT = [
  { management_no: "FP-01", equipment_name: "데크오븐", display_name: "데크오븐 1호기", floor_label: "2층", organization_code: "100" },
  { management_no: "FP-02", equipment_name: "컨베이어", display_name: "컨베이어", floor_label: "2층", organization_code: "100" },
  { management_no: "FP-03", equipment_name: "컨베이어", display_name: "컨베이어 2호기", floor_label: "3층", organization_code: "100" },
  { management_no: "FP-04", equipment_name: "호이스트", display_name: "호이스트", floor_label: "전층", organization_code: "100" },
  { management_no: "FP-05", equipment_name: "데크오븐", display_name: "데크오븐 1호기", floor_label: "1층", organization_code: "200" },
];

describe("층 판정", () => {
  const index = buildEquipmentFloorIndex(EQUIPMENT);
  it("설비마스터에서 이름이 한 층으로만 대응될 때만 층을 적는다", () => {
    expect(resolveItemFloor({ question_text: "데크오븐1" }, index, "데크오븐 1호기")).toEqual({ floor: "2층", basis: "설비마스터 FP-01" });
    expect(resolveItemFloor({ question_text: "컨베이어" }, index, "컨베이어").floor).toBeNull();
    expect(resolveItemFloor({ question_text: "호이스트" }, index, "호이스트").floor).toBeNull();
    expect(resolveItemFloor({ question_text: "없는설비" }, index, "없는설비").floor).toBeNull();
  });
  it("항목 문구에 층이 하나만 있으면 문구를 근거로 쓴다", () => {
    expect(resolveItemFloor({ question_text: "2층 휴게실 에어컨" }, index, "2층 휴게실 에어컨")).toEqual({ floor: "2층", basis: "항목 문구" });
  });
});

describe("상태 표시", () => {
  it("승인 전·반려·정정·회수를 구분한다", () => {
    expect(statusLabel({ status: "approved" }, false)).toBe("승인");
    expect(statusLabel({ status: "approved" }, true)).toBe("승인(정정 후 재승인)");
    expect(statusLabel({ status: "submitted" }, false)).toBe("제출(승인 대기)");
    expect(statusLabel({ status: "rejected", reject_reason: "[정정 요청] 온도 오기" }, false)).toBe("정정 재검토 중(승인 취소)");
    expect(statusLabel({ status: "rejected", reject_reason: "다시" }, false)).toBe("반려");
    expect(statusLabel({ status: "draft", submitted_at: "2026-10-01T00:00:00Z" }, false)).toBe("작성 중(제출 회수)");
    expect(statusLabel({ status: "draft" }, false)).toBe("작성 중(미제출)");
  });
});

function monthFixture() {
  const mfg: Row = {
    id: "h-mfg-1", inspection_date: "2026-10-14", status: "approved", author_name: "작업자", author_user_id: "u1",
    submitted_by: "u1", submitted_at: "2026-10-14T01:00:00Z", approved_by: "u2", approved_by_name: "품질팀장", approved_at: "2026-10-14T05:30:00Z",
    created_at: "2026-10-14T00:30:00Z",
  };
  const mfgItems: Row[] = [
    { id: "i-1", log_id: "h-mfg-1", question_index: 0, category: "가열실", question_text: "데크오븐1", result: "O" },
    { id: "i-2", log_id: "h-mfg-1", question_index: 1, category: "가열실", question_text: "컨베이어", result: "X", nonconformity_note: "벨트 오염" },
  ];
  const recv: Row = { id: "h-r-1", received_at: "2026-10-13T16:10:00Z", status: "submitted", author_name: "입고자", created_at: "2026-10-13T16:20:00Z" };
  const recvItems: Row[] = [
    { id: "r-1", log_id: "h-r-1", line_index: 0, storage_category: "cold", item_name: "밀가루", box_qty: 2, conformity: "적합" },
    { id: "r-2", log_id: "h-r-1", line_index: 1, storage_category: "room", item_name: "설탕", box_qty: 1, conformity: "적합" },
  ];
  const cold: Row = { id: "h-c-1", inspection_date: "2026-10-02", status: "rejected", reject_reason: "[정정 요청] 오전 온도", am_temp_floor1_freezer_c: -20, am_measure_time: "09:00", created_at: "2026-10-02T00:00:00Z" };
  return {
    logs: HACCP_LOGS.map((s) => ({
      spec: s,
      headers: s.key === "mfg" ? [mfg] : s.key === "receiving" ? [recv] : s.key === "cold" ? [cold] : [],
      items: s.key === "mfg" ? mfgItems : s.key === "receiving" ? recvItems : [],
    })),
    profiles: new Map([["u1", { display_name: "작업자", login_id: "w1" }], ["u2", { display_name: "품질팀장", login_id: "qm" }]]),
  };
}

describe("월별 시트 모델", () => {
  it("안내·전체목록·13종·정정삭제이력 탭을 만들고 항목 1건당 1행, KST 표시", () => {
    const f = monthFixture();
    const built = buildMonthTabs({
      month: "2026-10",
      generatedAt: "2026-10-15T00:00:00Z",
      logs: f.logs,
      profiles: f.profiles,
      equipment: buildEquipmentFloorIndex(EQUIPMENT),
      photos: new Map([["r-1", { itemId: "r-1", logId: "h-r-1", fileId: "F1", name: "x.jpg", webViewLink: "https://drive.google.com/file/d/F1/view", sha256: "s", md5: "m", size: 1, uploadedAt: "" }]]),
      photoPresent: new Set(["r-1", "r-2"]),
      corrections: [{ id: "c1", created_at: "2026-10-03T00:00:00Z", kind: "reopen", target_table: "daily_cold_storage_hygiene_logs", target_ids: ["h-c-1"], reason: "오전 온도", requested_by_name: "관리자", approved_by_name: "관리자" }],
      deletes: [{ auditId: "a1", created_at: "2026-10-05T00:00:00Z", target_table: "daily_hygiene_logs", target_id: "h-del", actor_display_name: "관리자", target_label: "2026-10-05", recordDate: "2026-10-05" }],
      createAudits: new Map([[`${spec("mfg").headerTable}:h-mfg-1`, { actor_source: "app_user", actor_user_id: "u1" }]]),
    });
    expect(built.tabs.map((t) => t.title)).toEqual(["안내", "전체목록", ...HACCP_LOGS.map((s) => s.short), "정정·삭제이력"]);
    const mfgTab = built.tabs.find((t) => t.title === spec("mfg").short)!;
    expect(mfgTab.columns).toEqual(ITEM_COLUMNS);
    expect(mfgTab.rows).toHaveLength(2);
    const col = (name: string) => ITEM_COLUMNS.indexOf(name);
    expect(mfgTab.rows[0][col("층")]).toBe("2층");
    expect(mfgTab.rows[1][col("층")]).toBe("");
    expect(mfgTab.rows[0][col("승인시각")]).toBe("2026-10-14 14:30");
    expect(mfgTab.rows[0][col("일지 ID")]).toBe("h-mfg-1");
    expect(mfgTab.rows[0][col("세부항목 ID")]).toBe("i-1");
    expect(mfgTab.rows[0][col("저장 위치")]).toBe("Supabase 전자일지 DB");
    expect(mfgTab.rows[0][col("작성 경로")]).toBe("웹 전자일지 작성(감사로그 근거)");
    const recvTab = built.tabs.find((t) => t.title === spec("receiving").short)!;
    expect(recvTab.rows[0][col("점검일")]).toBe("2026-10-14");
    expect(recvTab.rows[0][col("사진")]).toEqual({ url: "https://drive.google.com/file/d/F1/view", label: "사진 보기" });
    expect(recvTab.rows[1][col("사진")]).toBe("보관 대기");
    expect(recvTab.rows[0][col("상태")]).toBe("제출(승인 대기)");
    expect(recvTab.rows[0][col("작성 경로")]).toBe("출처 미확인(작성 감사로그 없음)");
    expect(built.tabs.flatMap((t) => t.rows.flat()).some((c) => c === "웹 전자일지")).toBe(false);
    const coldTab = built.tabs.find((t) => t.title === spec("cold").short)!;
    expect(coldTab.rows[0][col("층")]).toBe("1층");
    expect(coldTab.rows[0][col("상태")]).toBe("정정 재검토 중(승인 취소)");
    const history = built.tabs.find((t) => t.title === "정정·삭제이력")!;
    expect(history.rows.map((r) => r[1])).toEqual(["정정 요청(승인 취소)", "삭제"]);
  });

  it("셀 길이를 50,000자 이내로 자른다", () => {
    const f = monthFixture();
    f.logs.find((l) => l.spec.key === "mfg")!.items[0].nonconformity_note = "가".repeat(60000);
    const built = buildMonthTabs({ month: "2026-10", generatedAt: "2026-10-15T00:00:00Z", logs: f.logs, profiles: f.profiles, equipment: new Map(), photos: new Map(), photoPresent: new Set(), corrections: [], deletes: [], createAudits: new Map() });
    const max = Math.max(...built.tabs.flatMap((t) => t.rows.flat().map((c) => (typeof c === "string" ? c.length : 0))));
    expect(max).toBeLessThanOrEqual(50000);
  });
});

describe("시트 쓰기", () => {
  it("링크는 HYPERLINK 수식, 따옴표는 이스케이프, https 아닌 링크는 글자만", () => {
    expect(toCellData({ url: "https://x.y/a\"b", label: "사진 보기" }, new Map())).toEqual({ userEnteredValue: { formulaValue: '=HYPERLINK("https://x.y/a""b","사진 보기")' } });
    expect(toCellData({ url: "javascript:alert(1)", label: "사진 보기" }, new Map())).toEqual({ userEnteredValue: { stringValue: "사진 보기" } });
    expect(toCellData({ tabLink: "제조설비", label: "제조설비" }, new Map([["제조설비", 7]]))).toEqual({ userEnteredValue: { formulaValue: '=HYPERLINK("#gid=7","제조설비")' } });
    expect(toCellData("=IMPORTXML(1)", new Map())).toEqual({ userEnteredValue: { stringValue: "=IMPORTXML(1)" } });
  });
  it("크기 맞춤·고정·필터·너비 요청을 만든다", () => {
    const reqs = buildTabRequests({ title: "A", columns: ["x", "y"], widths: [10, 20], rows: [["1", 2]] }, 0, new Map([["A", 5]]));
    expect(reqs.map((r) => Object.keys(r)[0])).toEqual(["updateSheetProperties", "updateCells", "repeatCell", "repeatCell", "setBasicFilter", "updateDimensionProperties", "updateDimensionProperties"]);
  });
  it("실패하면 이전 내용이 그대로 남는다", async () => {
    const sheets = new FakeSheets();
    sheets.create("S");
    await writeTabs(sheets, "S", [{ title: "A", columns: ["x"], widths: [10], rows: [["old"]] }]);
    sheets.failNextBatch = "중간 실패";
    await expect(writeTabs(sheets, "S", [{ title: "A", columns: ["x"], widths: [10], rows: [["new"], ["new2"]] }])).rejects.toThrow("중간 실패");
    expect(sheets.read("S", "A")).toEqual([["x"], ["old"]]);
    expect(sheets.tabInfo("S").map((t) => t.title)).toEqual(["A"]);
  });
  it("경고만 하던 보호는 소유자만 편집 가능한 보호로 바꾼다", async () => {
    const sheets = new FakeSheets();
    sheets.create("S");
    await sheets.batchUpdate("S", [{ addProtectedRange: { protectedRange: { range: { sheetId: 0 }, warningOnly: true } } }]);
    await writeTabs(sheets, "S", [{ title: "A", columns: ["x"], widths: [10], rows: [["1"]] }]);
    const [tab] = sheets.tabInfo("S");
    expect(tab.protections).toEqual([expect.objectContaining({ warningOnly: false, editors: [] })]);
    await writeTabs(sheets, "S", [{ title: "A", columns: ["x"], widths: [10], rows: [["2"]] }]);
    expect(sheets.tabInfo("S")[0].protections).toHaveLength(1);
  });
});

describe("원본백업·해시", () => {
  it("키 순서와 무관하게 같은 해시", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    const f = monthFixture();
    const a = buildMonthBackup("2026-10", f.logs, new Set(["r-1"]));
    const b = buildMonthBackup("2026-10", f.logs.map((l) => ({ ...l, headers: [...l.headers].reverse() })), new Set(["r-1"]));
    expect(a.sha256).toBe(b.sha256);
    expect(a.body).not.toContain("label_photo_url");
    expect(a.body).toContain('"has_label_photo":true');
  });
  it("해시 체인 끊김을 찾는다", () => {
    const rows = [
      { chain_seq: 10, prev_hash: "h9", row_hash: "h10" },
      { chain_seq: 11, prev_hash: "h10", row_hash: "h11" },
      { chain_seq: 13, prev_hash: "hx", row_hash: "h13" },
    ];
    expect(checkAuditChain(rows.slice(0, 2), { seq: 9, hash: "h9" }).ok).toBe(true);
    const bad = checkAuditChain(rows, { seq: 9, hash: "h9" });
    expect(bad.ok).toBe(false);
    expect(bad.lastSeq).toBe(13);
    expect(checkAuditChain([{ chain_seq: 10, prev_hash: "zz", row_hash: "h10" }], { seq: 9, hash: "h9" }).ok).toBe(false);
    expect(buildAuditDayBackup("2026-10-14", [], checkAuditChain([], { seq: null, hash: null })).sha256).toHaveLength(64);
  });
});

describe("사진·권한", () => {
  it("data URL 해석과 파일 이름", () => {
    const d = decodeDataUrl(`data:image/jpeg;base64,${Buffer.from("abc").toString("base64")}`)!;
    expect(d.ext).toBe("jpg");
    expect(d.data.toString()).toBe("abc");
    expect(decodeDataUrl("https://example.com/a.jpg")).toBeNull();
    expect(decodeDataUrl("data:text/html;base64,AAAA")).toBeNull();
    expect(photoFileName("2026-10-14", "밀가루 / 강력:1kg", 1, "jpg")).toBe("2026-10-14_밀가루강력1kg_입고01.jpg");
  });
  it("링크 공개·도메인 공개·비공개 폴더의 외부 공유를 막는다", () => {
    expect(checkPermissions([{ type: "user", role: "owner" }], "private").ok).toBe(true);
    expect(checkPermissions([{ type: "anyone", role: "reader" }], "view").ok).toBe(false);
    expect(checkPermissions([{ type: "domain", role: "reader", domain: "x.com" }], "view").ok).toBe(false);
    expect(checkPermissions([{ type: "user", role: "reader" }], "view").ok).toBe(true);
    expect(checkPermissions([{ type: "user", role: "reader" }], "private").ok).toBe(false);
  });
  it("열람용 폴더에 편집 권한이 있으면(상속 포함) 경고한다", () => {
    const inherited = checkPermissions(
      [{ type: "user", role: "writer", emailAddress: "a@x.com", permissionDetails: [{ inherited: true, inheritedFrom: "P" }] }],
      "view"
    );
    expect(inherited.ok).toBe(true);
    expect(inherited.warnings.join()).toMatch(/상속/);
    expect(checkPermissions([{ type: "user", role: "reader" }], "view").warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 실행기: 메모리 원본 + 가짜 Google
// ---------------------------------------------------------------------------
function jpeg(text: string) {
  return `data:image/jpeg;base64,${Buffer.from(text).toString("base64")}`;
}

function fakeSource() {
  const f = monthFixture();
  const photos: Record<string, string> = { "r-1": jpeg("photo-1"), "r-2": jpeg("photo-2") };
  const calls: string[] = [];
  const audit: Row[] = [
    { id: "a1", created_at: "2026-10-13T01:00:00Z", chain_seq: 1, prev_hash: null, row_hash: "h1", target_table: "daily_hygiene_logs", before_data: null, after_data: { x: 1 } },
    { id: "a2", created_at: "2026-10-14T01:00:00Z", chain_seq: 2, prev_hash: "h1", row_hash: "h2", target_table: "daily_hygiene_logs", before_data: { x: 1 }, after_data: { x: 2 } },
  ];
  const src = {
    calls,
    photos,
    f,
    async earliestMonth() { return "2026-09"; },
    async changedMonthsSince() { calls.push("changed"); return new Set<string>(); },
    async loadProfiles() { return f.profiles; },
    async loadEquipment() { return EQUIPMENT; },
    async loadCorrections() { return []; },
    async loadCorrectionSnapshots() { return []; },
    async loadHeaderDeletes() { return []; },
    async loadCreateAudits() { return new Map(); },
    async loadMonth(s: { key: string }, month: string) {
      calls.push(`month:${month}`);
      const log = f.logs.find((l) => l.spec.key === s.key)!;
      return month === "2026-10" ? { headers: log.headers, items: log.items } : { headers: [], items: [] };
    },
    async photoPresentIds(_t: string, _c: string, ids: string[]) { return new Set(ids.filter((id) => photos[id])); },
    async listPhotoItems() { return f.logs.find((l) => l.spec.key === "receiving")!.items.filter((i) => photos[String(i.id)]); },
    async receivingDates() { return new Map([["h-r-1", "2026-10-14"]]); },
    async loadPhoto(id: string) { calls.push(`photo:${id}`); return photos[id] ?? null; },
    async earliestAuditDay() { return "2026-10-13"; },
    async loadAuditDay(day: string) { return audit.filter((a) => String(a.created_at).startsWith(day)); },
  };
  return src;
}

describe("동기화 실행기", () => {
  const now = () => new Date("2026-10-15T03:30:00+09:00");

  async function setup() {
    const sheets = new FakeSheets();
    const drive = new FakeDrive(sheets);
    const source = fakeSource();
    const runner = new ArchiveRunner({
      source: source as unknown as ArchiveSource,
      drive,
      sheets,
      folders: { viewParentId: "root", privateParentId: "root" },
      limits: { monthsPerRun: 1, photosPerRun: 1, auditDaysPerRun: 7 },
      now,
    });
    return { sheets, drive, source, runner };
  }

  it("첫 실행: 현재 달 + 과거 1달, 사진 1장, 감사로그 2일 보관 / 두 번째 실행: 중복 없음", async () => {
    const { sheets, drive, source, runner } = await setup();
    const first = await runner.run();
    expect(first.ok).toBe(true);
    expect(first.months.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    expect(first.months.every((m) => m.backup === "new")).toBe(true);
    expect(first.photos?.uploaded).toBe(1);
    expect(first.auditDays.map((d) => d.day)).toEqual(["2026-10-13", "2026-10-14"]);

    const files = Array.from(drive.files.values());
    const sheetsFiles = files.filter((x) => x.appProperties.kind === "month-sheet");
    expect(sheetsFiles).toHaveLength(2);
    expect(drive.pathOf(sheetsFiles[0].id)).toMatch(/^HACCP 전자일지 자동보관\(열람용\)\/01_월별/);
    const photo = files.find((x) => x.appProperties.kind === "label-photo")!;
    expect(drive.pathOf(photo.id)).toBe("HACCP 전자일지 자동보관(비공개 원본)/02_원료 입고검수 라벨사진/2026-10/2026-10-14_밀가루_입고01.jpg");
    expect(photo.locked).toBe(true);
    expect(photo.appProperties.sha256).toBe(createHash("sha256").update("photo-1").digest("hex"));
    expect(files.filter((x) => ["month-backup", "audit-day", "label-photo"].includes(x.appProperties.kind)).every((x) => x.locked)).toBe(true);

    const oct = sheetsFiles.find((x) => x.appProperties.month === "2026-10")!;
    const recv = sheets.read(oct.id, spec("receiving").short);
    const photoCol = ITEM_COLUMNS.indexOf("사진");
    expect(recv[1][photoCol]).toBe(`=HYPERLINK("https://drive.google.com/file/d/${photo.id}/view","사진 보기")`);
    expect(recv[2][photoCol]).toBe("보관 대기");
    const info = sheets.tabInfo(oct.id);
    expect(info.every((t) => t.frozen === 1 && t.filter && t.protections.length === 1 && !t.protections[0].warningOnly && t.protections[0].editors.length === 0)).toBe(true);
    expect(sheetsFiles.every((x) => !x.writersCanShare)).toBe(true);
    expect(files.filter((x) => ["month-backup", "audit-day", "label-photo"].includes(x.appProperties.kind)).every((x) => !x.writersCanShare && x.copyRequiresWriterPermission)).toBe(true);
    expect(info.map((t) => t.title)).not.toContain("시트1");

    const second = await runner.run();
    expect(second.ok).toBe(true);
    expect(second.months.map((m) => m.month)).toEqual(["2026-10"]);
    expect(second.months[0].backup).toBe("same");
    expect(second.photos?.uploaded).toBe(1);
    expect(second.auditDays).toEqual([]);
    expect(source.calls).toContain("changed");
    const after = Array.from(drive.files.values());
    expect(after.filter((x) => x.appProperties.kind === "month-sheet")).toHaveLength(2);
    expect(after.filter((x) => x.appProperties.kind === "month-backup")).toHaveLength(2);
    expect(after.filter((x) => x.appProperties.kind === "label-photo")).toHaveLength(2);
    expect(after.filter((x) => x.appProperties.kind === "haccp-archive-state")).toHaveLength(1);
    const recv2 = sheets.read(oct.id, spec("receiving").short);
    expect(String(recv2[2][photoCol])).toContain("사진 보기");
  });

  it("사진 업로드 검증이 실패하면 보관 완료로 기록하지 않는다", async () => {
    const { drive, runner } = await setup();
    drive.corruptNextUpload = true;
    const res = await runner.run();
    expect(res.photos?.uploaded).toBe(0);
    expect(res.photos?.failed[0].reason).toMatch(/업로드 검증 실패/);
    const res2 = await runner.run();
    expect(res2.photos?.uploaded).toBe(1);
  });

  it("시트 쓰기가 실패하면 해당 달은 실패로 남고 마지막 성공 시각을 올리지 않는다", async () => {
    const { sheets, runner } = await setup();
    await runner.run();
    sheets.failNextBatch = "Sheets 일시 오류";
    const res = await runner.run();
    expect(res.ok).toBe(false);
    expect(res.months[0]).toMatchObject({ month: "2026-10", ok: false });
  });

  it("월별 시트가 링크 공개면 그 달은 쓰지 않고 실패로 남긴다", async () => {
    const { sheets, drive, runner } = await setup();
    await runner.run();
    const oct = Array.from(drive.files.values()).find((x) => x.appProperties.kind === "month-sheet" && x.appProperties.month === "2026-10")!;
    drive.permissions.set(oct.id, [{ type: "anyone", role: "reader" }]);
    const batches = sheets.batchIds.length;
    const res = await runner.run();
    expect(res.months[0]).toMatchObject({ month: "2026-10", ok: false });
    expect(res.months[0].error).toMatch(/링크가 있는 모든 사용자/);
    expect(sheets.batchIds.slice(batches)).not.toContain(oct.id);
  });

  it("폴더가 링크 공개면 아무것도 쓰지 않고 중단한다", async () => {
    const { drive, runner } = await setup();
    await runner.run();
    const priv = Array.from(drive.files.values()).find((x) => x.name === "HACCP 전자일지 자동보관(비공개 원본)")!;
    drive.permissions.set(priv.id, [{ type: "anyone", role: "reader" }]);
    const before = drive.files.size;
    const uploadsBefore = drive.calls.filter((c) => c === "uploadFile" || c === "updateFileContent").length;
    const res = await runner.run();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/링크가 있는 모든 사용자/);
    expect(drive.files.size).toBe(before);
    expect(drive.calls.filter((c) => c === "uploadFile" || c === "updateFileContent").length).toBe(uploadsBefore);
  });
});
