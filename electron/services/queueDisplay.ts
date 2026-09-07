import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { getNetworkConfig } from "./networkConfig";
import { BOARD_BACKGROUND } from "../../theme/palette";
import type { DisplayOption } from "../../types/network";

/**
 * The waiting-room board: a second window, fullscreen on the TV.
 *
 * It runs the same renderer bundle at the `#/display` hash, which src/main.tsx
 * detects and renders WITHOUT the app shell — no sidebar, no update toast, no
 * host banner. A waiting room TV showing an "update available" pill is worse
 * than one showing nothing.
 *
 * Nobody interacts with this window. It is frameless, has no menu, and refuses
 * to open further windows; the only input it takes is the queue it polls.
 */

// Chromium paints this for any frame the renderer has not drawn yet, so a
// mismatch with the board page's own ground turns opening the window into a
// flash of the wrong colour. Both now come from theme/palette.ts, so they
// cannot disagree.

let board: BrowserWindow | null = null;
let listeningForDisplayChanges = false;

/** Every monitor attached to this machine, for the Settings picker. */
export function listDisplays(): { status: "success"; data: DisplayOption[] } {
    const primaryId = screen.getPrimaryDisplay().id;
    const data = screen.getAllDisplays().map((display, index) => ({
        id: display.id,
        // Electron exposes no friendly monitor name on Windows, so build one
        // that is at least identifiable by resolution when there are several.
        label: display.label || `${index + 1} — ${display.size.width}×${display.size.height}`,
        bounds: display.bounds,
        isPrimary: display.id === primaryId,
    }));
    return { status: "success", data };
}

/**
 * Which screen the board should open on.
 *
 * The stored id is a hint rather than an address: Electron display ids change
 * across reboots and re-plugging, so a TV that was switched off over the weekend
 * would otherwise strand the window at coordinates that no longer exist. Falls
 * back to the first non-primary screen — which is what a waiting-room TV almost
 * always is — and finally to the primary one, so the board is always somewhere
 * visible rather than nowhere.
 */
function resolveDisplay(requestedId?: number | null) {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();

    if (requestedId != null) {
        const exact = displays.find(display => display.id === requestedId);
        if (exact) return exact;
    }
    return displays.find(display => display.id !== primary.id) ?? primary;
}

/**
 * Where the renderer lives, derived the same way main.ts derives it.
 *
 * Read off process.env rather than imported from main.ts, which exports exactly
 * these values: main.ts imports the channel registry, the registry imports this
 * file, so importing back would be a cycle. APP_ROOT is set at the top of
 * main.ts, long before any channel can be called.
 */
function rendererPaths() {
    const appRoot = process.env.APP_ROOT ?? path.join(__dirname, "..");
    return {
        devServerUrl: process.env.VITE_DEV_SERVER_URL,
        indexHtml: path.join(appRoot, "dist", "index.html"),
        preload: path.join(appRoot, "dist-electron", "preload.mjs"),
    };
}

/** Opens the board, or moves an already-open one to the requested screen. */
export function openQueueDisplay(
    displayId?: number | null
): { status: "success" | "fail"; data?: { displayId: number }; message?: string } {
    try {
        const target = resolveDisplay(displayId ?? getNetworkConfig().queueDisplayId);
        const { x, y, width, height } = target.bounds;

        if (board && !board.isDestroyed()) {
            board.setBounds(target.bounds);
            board.setFullScreen(true);
            board.focus();
            return { status: "success", data: { displayId: target.id } };
        }

        board = new BrowserWindow({
            x, y, width, height,
            backgroundColor: BOARD_BACKGROUND,
            frame: false,
            fullscreen: true,
            autoHideMenuBar: true,
            show: false,
            // Nothing on this screen should be a target: it faces a room of
            // strangers and has no keyboard.
            skipTaskbar: false,
            webPreferences: {
                preload: rendererPaths().preload,
            },
        });

        board.once("ready-to-show", () => board?.show());
        board.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        board.on("closed", () => { board = null; });

        const { devServerUrl, indexHtml } = rendererPaths();
        if (devServerUrl) {
            board.loadURL(`${devServerUrl}#/display`);
        } else {
            board.loadFile(indexHtml, { hash: "/display" });
        }

        watchDisplayChanges();
        return { status: "success", data: { displayId: target.id } };
    } catch (error) {
        console.error("openQueueDisplay error:", error);
        return { status: "fail", message: (error as Error).message };
    }
}

export function closeQueueDisplay(): { status: "success" } {
    if (board && !board.isDestroyed()) board.close();
    board = null;
    return { status: "success" };
}

export function getQueueDisplayStatus(): { status: "success"; data: { open: boolean; displayId: number | null } } {
    const open = !!board && !board.isDestroyed();
    return {
        status: "success",
        data: {
            open,
            displayId: open ? screen.getDisplayNearestPoint(board!.getBounds()).id : null,
        },
    };
}

/**
 * Closes the board if its screen is unplugged.
 *
 * Without this the window survives on coordinates that no longer exist —
 * invisible, still polling, and impossible to close from the UI because the
 * Settings panel would report it open while nobody can see it.
 */
function watchDisplayChanges() {
    if (listeningForDisplayChanges) return;
    listeningForDisplayChanges = true;

    screen.on("display-removed", (_event, removed) => {
        if (!board || board.isDestroyed()) return;
        const stillThere = screen.getAllDisplays().some(display => display.id === removed.id);
        if (stillThere) return;
        const boardScreen = screen.getDisplayNearestPoint(board.getBounds());
        if (boardScreen.id === removed.id || screen.getAllDisplays().length === 1) {
            closeQueueDisplay();
        }
    });
}
