/**
 * The brand palette, for the places Tailwind classes cannot reach.
 *
 * At the repo root rather than under src/, for the same reason types/ is: it is
 * shared by both processes.
 *
 * Almost all of the UI is themed through the `@theme inline` tokens in
 * src/index.css — `bg-navy`, `text-pink/50` and so on — and that remains the way
 * to colour anything that has a className. This module is for the handful of
 * places where there is no class to apply:
 *
 *   - Recharts, which takes colours as props and as inline data (`stroke`,
 *     `fill`, a per-slice `color` field), never as CSS classes;
 *   - the Electron main process, which paints a BrowserWindow's
 *     `backgroundColor` before any stylesheet exists.
 *
 * That second one is why this is a plain module of literals rather than
 * something read out of the DOM with getComputedStyle: the main process has no
 * document to read from.
 *
 * KEEP IN SYNC with the `@theme inline` block in src/index.css. The two are
 * separate declarations of one palette — CSS cannot import TypeScript — and
 * `npm run check:palette` fails if they drift. When the second product lands,
 * both will be generated from its profile and this warning goes away.
 */

export const PALETTE = {
    // Semantic aliases. `background`/`foreground` are the page surface and its
    // default ink; they happen to equal bg and navy today, and are kept as
    // separate names so a future palette can move one without the other.
    background: '#e9f1f1',
    foreground: '#1E2A56',

    navy: '#1E2A56',
    'navy-light': '#2d3d6e',
    'navy-dark': '#141d3d',
    bg: '#e9f1f1',
    'bg-light': '#f0f6f6',
    'bg-dark': '#dae5e5',
    pink: '#e91e8c',
    'pink-light': '#f472b6',
    'pink-dark': '#be185d',
    white: '#ffffff',
} as const;

/**
 * What Chromium paints before the renderer has drawn anything.
 *
 * Must equal `--background` in src/index.css: this is the colour shown for any
 * region the renderer has not painted yet, so a mismatch turns every resize and
 * route change into a visible flash of the wrong colour.
 */
export const APP_WINDOW_BACKGROUND = PALETTE.bg;

/** The waiting-room TV board's ground. Dark, for a screen read across a room. */
export const BOARD_BACKGROUND = PALETTE['navy-dark'];
