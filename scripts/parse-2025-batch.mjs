import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawPath = path.join(__dirname, "../data/manual-imports/2025-raw-input.txt");
const outDir = path.join(__dirname, "../data/manual-imports");

const raw = fs.readFileSync(rawPath, "utf8");
const withoutPreamble = raw.replace(/^[\s\S]*?\*생산\s*\n/, "");
const [prodBlock, rest1] = withoutPreamble.split(/\*파베이크폐기\s*\n/);
const [parbakeBlock, doughBlock] = rest1.split(/\*도우폐기\s*\n/);

const prod = prodBlock.trim();
const parbakeRaw = parbakeBlock.trim();
const dough = doughBlock.trim();

fs.writeFileSync(path.join(outDir, "2025-production-import.jsonl"), prod + "\n");

const parbakeLines = parbakeRaw
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("{"));
const parbakeOut =
  parbakeLines
    .map((l) => {
      const o = JSON.parse(l);
      o.waste_scope = "parbake";
      return JSON.stringify(o);
    })
    .join("\n") + "\n";
fs.writeFileSync(path.join(outDir, "2025-waste-parbake.jsonl"), parbakeOut);

const doughLines = dough
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("{"));
fs.writeFileSync(path.join(outDir, "2025-waste-dough.jsonl"), doughLines.join("\n") + "\n");

console.log(
  JSON.stringify(
    {
      production_lines: prod.split("\n").filter(Boolean).length,
      parbake_lines: parbakeLines.length,
      dough_lines: doughLines.length,
    },
    null,
    2
  )
);
