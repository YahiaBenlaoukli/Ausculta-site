// Extract the real token vocabulary of the `form` field across BOTH sources,
// so the abbreviation dictionary can be built from data instead of guesses.
import { readFileSync } from "node:fs";

const dz = JSON.parse(readFileSync("scripts/sources/dz-pharma-meds.json", "utf8"));
const forms = [];
for (const v of Object.values(dz)) for (const m of v) if (m.form) forms.push(m.form);

// the ministry sheet, via the built output (formRaw preserves the original)
const built = JSON.parse(readFileSync("public/data/medications.json", "utf8")).medications;
for (const r of built) if (r.source !== "dz" && r.formRaw) forms.push(r.formRaw);

const tok = new Map();
for (const f of forms) {
  const clean = f.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[.,;:()\[\]/\\+]/g, " ").replace(/\s+/g, " ").trim();
  for (const t of clean.split(" ")) if (t) tok.set(t, (tok.get(t) ?? 0) + 1);
}
const sorted = [...tok.entries()].sort((a, b) => b[1] - a[1]);
console.log(`distinct form strings: ${new Set(forms).size}, distinct tokens: ${tok.size}\n`);
console.log("=== ALL TOKENS (count >= 2) ===");
console.log(sorted.filter(([, n]) => n >= 2).map(([t, n]) => `${String(n).padStart(4)} ${t}`).join("\n"));
console.log("\n=== SINGLETON TOKENS ===");
console.log(sorted.filter(([, n]) => n === 1).map(([t]) => t).join(" "));
