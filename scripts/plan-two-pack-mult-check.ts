/**
 * 로컬에서 배수 판별만 빠르게 확인: npx tsx scripts/plan-two-pack-mult-check.ts
 */
import { getPlanSheetQtySinglesMultiplier } from "../src/features/dashboard/planVsActual";

const samples = [
  "미니 고르곤졸라(2입)",
  "미니 마르게리따(2입)",
  "미니 페퍼로니(2입)",
  "미니 고르곤졸라（2입）",
  "미니피자 허니고르곤졸라",
  "허니고르곤졸라",
];

for (const s of samples) {
  const m = getPlanSheetQtySinglesMultiplier(s);
  const hex = Array.from(s).map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"));
  console.log(m === 2 ? "×2" : "×1", "|", s, "|", hex.slice(0, 12).join(" ") + (hex.length > 12 ? " …" : ""));
}
