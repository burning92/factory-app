/**
 * data/manual-imports/*.jsonl 끼리 날짜가 맞물리는지 요약합니다.
 * 사용: node scripts/audit-manual-imports-continuity.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "../data/manual-imports");

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function dateSet(rows) {
  const s = new Set();
  for (const r of rows) {
    const d = String(r.date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) s.add(d);
  }
  return s;
}

/** 같은 날짜 여러 행이면 qty 합산 (폐기 등) */
function sumQtyByDate(rows) {
  const m = new Map();
  for (const r of rows) {
    const d = String(r.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const q = Number(r.qty);
    if (!Number.isFinite(q)) continue;
    m.set(d, (m.get(d) ?? 0) + q);
  }
  return m;
}

function minMax(dates) {
  const arr = [...dates].sort();
  if (arr.length === 0) return { min: null, max: null };
  return { min: arr[0], max: arr[arr.length - 1] };
}

function onlyIn(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

function fmtShort(arr, limit = 12) {
  if (arr.length === 0) return "(없음)";
  if (arr.length <= limit) return arr.join(", ");
  return `${arr.slice(0, limit).join(", ")} … 외 ${arr.length - limit}일`;
}

function section(year) {
  const prod = readJsonl(path.join(root, `${year}-production-import.jsonl`));
  const dough = readJsonl(path.join(root, `${year}-dough-production.jsonl`));
  const wDough = readJsonl(path.join(root, `${year}-waste-dough.jsonl`));
  const wPar = readJsonl(path.join(root, `${year}-waste-parbake.jsonl`));

  const dsProd = dateSet(prod);
  const dsDough = dateSet(dough);
  const dsWD = dateSet(wDough);
  const dsWP = dateSet(wPar);

  const sumDough = sumQtyByDate(dough);
  const sumWD = sumQtyByDate(wDough);
  const sumWP = sumQtyByDate(wPar);

  return {
    year,
    prod,
    dough,
    wDough,
    wPar,
    dsProd,
    dsDough,
    dsWD,
    dsWP,
    sumDough,
    sumWD,
    sumWP,
  };
}

function printYear(s) {
  const { year, prod, dough, wDough, wPar, dsProd, dsDough, dsWD, dsWP, sumDough, sumWD, sumWP } =
    s;

  console.log(`\n======== ${year}년 =========`);
  console.log(
    [
      `생산(품목별) JSONL     행 ${prod.length.toString().padStart(5)}  고유일 ${dsProd.size}  ${JSON.stringify(minMax(dsProd))}`,
      `도우(나폴리) JSONL     행 ${dough.length.toString().padStart(5)}  고유일 ${dsDough.size}  ${JSON.stringify(minMax(dsDough))}`,
      `폐기·도우 JSONL       행 ${wDough.length.toString().padStart(5)}  고유일 ${dsWD.size}  ${JSON.stringify(minMax(dsWD))}`,
      `폐기·파베이크 JSONL   행 ${wPar.length.toString().padStart(5)}  고유일 ${dsWP.size}  ${JSON.stringify(minMax(dsWP))}`,
    ].join("\n")
  );

  console.log("\n[고유 날짜 집합 차이 — 맞물림 확인]");
  const dOnlyDough = onlyIn(dsDough, dsWD);
  const dOnlyWD = onlyIn(dsWD, dsDough);
  console.log(`  도우 생산 O, 도우 폐기 기록 없음: ${dOnlyDough.length}일 → ${fmtShort(dOnlyDough)}`);
  console.log(`  도우 폐기 O, 도우 생산 파일에 날짜 없음: ${dOnlyWD.length}일 → ${fmtShort(dOnlyWD)}`);

  const pOnlyPar = onlyIn(dsWP, dsDough);
  const pOnlyD = onlyIn(dsDough, dsWP);
  console.log(`  파베이크 폐기 O, 도우 생산 날짜 없음: ${pOnlyPar.length}일 → ${fmtShort(pOnlyPar)}`);
  console.log(`  도우 생산 O, 파베이크 폐기 날짜 없음: ${pOnlyD.length}일 → ${fmtShort(pOnlyD)}`);

  const inAllFour = [...dsDough].filter((d) => dsWD.has(d) && dsWP.has(d) && dsProd.has(d)).length;
  console.log(
    `\n  네 종 모두에서 날짜가 한 번 이상 등장: ${inAllFour}일 (도우·도우폐기·파베폐기·생산 품목 중 최소 한 줄)`
  );

  const doughTotals = [...sumDough.values()].reduce((a, b) => a + b, 0);
  const wdTotals = [...sumWD.values()].reduce((a, b) => a + b, 0);
  const wpTotals = [...sumWP.values()].reduce((a, b) => a + b, 0);
  console.log("\n[일별 합산 수량 — 파일 안에서만]");
  console.log(`  도우 생산 qty 합: ${Math.round(doughTotals)}`);
  console.log(`  도우 폐기 qty 합: ${Math.round(wdTotals)}`);
  console.log(`  파베이크 폐기 qty 합: ${Math.round(wpTotals)}`);
}

console.log("data/manual-imports 연속성 점검 (로컬 JSONL만, DB/페이지와는 별개)\n");

for (const y of [2024, 2025]) {
  const p = path.join(root, `${y}-production-import.jsonl`);
  if (!fs.existsSync(p)) {
    console.log(`\n(${y}년 생산 파일 없음 — 스킵)`);
    continue;
  }
  printYear(section(y));
}

console.log("\n끝. 위 ‘집합 차이’가 비어 있으면(또는 의도한 영업일만) 수동 파일끼리 날짜가 잘 맞는 것입니다.\n");
