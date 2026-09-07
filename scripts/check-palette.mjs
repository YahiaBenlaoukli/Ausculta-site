/**
 * Fails if theme/palette.ts and the `@theme inline` block in src/index.css
 * disagree about the brand colours.
 *
 * They are two declarations of one palette because CSS cannot import
 * TypeScript, and the main process cannot read CSS. That duplication is
 * deliberate and small — but it is exactly the kind that rots silently, and the
 * symptom (a window background that flashes the old colour on resize, or a
 * chart series that stayed navy after a rebrand) looks nothing like the cause.
 *
 * Run by `npm run check:palette`, and as part of `npm run build`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const css = readFileSync(path.join(root, 'src/index.css'), 'utf8');
const ts = readFileSync(path.join(root, 'theme/palette.ts'), 'utf8');

/** `--color-navy: #1E2A56;` inside the @theme block. */
const themeBlock = css.match(/@theme inline\s*\{([\s\S]*?)\}/);
if (!themeBlock) {
    console.error('check:palette — no `@theme inline` block found in src/index.css');
    process.exit(1);
}
const cssColors = new Map();
for (const [, name, value] of themeBlock[1].matchAll(/--color-([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    cssColors.set(name, value.toLowerCase());
}

/** `navy: '#1E2A56',` or `'navy-dark': '#141d3d',` inside PALETTE. */
const paletteBlock = ts.match(/export const PALETTE = \{([\s\S]*?)\} as const;/);
if (!paletteBlock) {
    console.error('check:palette — no `PALETTE` object found in theme/palette.ts');
    process.exit(1);
}
const tsColors = new Map();
for (const [, quoted, bare, value] of paletteBlock[1].matchAll(/(?:'([\w-]+)'|([\w-]+))\s*:\s*'(#[0-9a-fA-F]{3,8})'/g)) {
    tsColors.set(quoted ?? bare, value.toLowerCase());
}

const problems = [];
for (const [name, value] of cssColors) {
    if (!tsColors.has(name)) problems.push(`--color-${name} (${value}) is in index.css but missing from PALETTE`);
    else if (tsColors.get(name) !== value) problems.push(`${name}: index.css says ${value}, palette.ts says ${tsColors.get(name)}`);
}
for (const name of tsColors.keys()) {
    if (!cssColors.has(name)) problems.push(`${name} is in PALETTE but has no --color-${name} in index.css`);
}

// The background the main process paints must equal the one the page paints,
// or every resize flashes. index.css declares it a second time as --background.
const background = css.match(/--background\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/);
if (background && tsColors.get('bg') !== background[1].toLowerCase()) {
    problems.push(`--background is ${background[1].toLowerCase()} but PALETTE.bg is ${tsColors.get('bg')} — the window background would flash on resize`);
}

if (problems.length) {
    console.error('check:palette — theme/palette.ts and src/index.css have drifted:\n');
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error('\nUpdate both, or the two processes will paint different colours.');
    process.exit(1);
}

console.log(`check:palette — ${cssColors.size} colours match between src/index.css and theme/palette.ts`);
