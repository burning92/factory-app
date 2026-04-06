import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawPath = path.join(__dirname, "../data/manual-imports/dough-production-raw-input.txt");
const outDir = path.join(__dirname, "../data/manual-imports");

const raw = fs.readFileSync(rawPath, "utf8");
const [before2025, after2025] = raw.split(/\*2025\s*도우생산량\s*\n/);
const block2024 = before2025.replace(/^\*2024\s*도우생산량\s*\n/, "").trim();
const block2025 = (after2025 ?? "").trim();

function jsonlLines(block) {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"));
}

const l2024 = jsonlLines(block2024);
const l2025 = jsonlLines(block2025);

fs.writeFileSync(path.join(outDir, "2024-dough-production.jsonl"), l2024.join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "2025-dough-production.jsonl"), l2025.join("\n") + "\n");

console.log(JSON.stringify({ lines_2024: l2024.length, lines_2025: l2025.length }, null, 2));
