import { BrowserWindow, shell } from "electron";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getNetworkConfig } from "./networkConfig";
import type { PrinterOption } from "../../types/print";

/**
 * Putting a document on paper, on the machine that asked.
 *
 * Always local: the printer is the one next to whoever pressed the button, and
 * a host printing on the doctor's behalf would produce the prescription in the
 * wrong room.
 *
 * Two ways out, and the choice is deliberate. With a printer chosen in
 * Settings, Chromium prints it silently — the desk presses one button and the
 * page appears. With none chosen, the document is opened in whatever the OS
 * uses for PDFs and the user presses Ctrl+P. The fallback is the default
 * because it works on an install nobody has configured, and because a
 * prescription silently appearing on a printer with nobody standing at it is
 * worse than one extra click.
 */

/** Chromium needs a moment to lay the PDF out before print() sees anything. */
const RENDER_SETTLE_MS = 400;
/** A jammed or offline printer must not leave a hidden window alive forever. */
const PRINT_TIMEOUT_MS = 60_000;

export interface PrintResult {
    status: "success" | "fail";
    /** True when the OS viewer was opened instead of printing directly. */
    opened?: boolean;
    message?: string;
}

/** The printers this machine can see, for the picker in Settings. */
export async function listPrinters(win: BrowserWindow | null): Promise<{ status: string; data: PrinterOption[] }> {
    try {
        const printers = (await win?.webContents.getPrintersAsync()) ?? [];
        return {
            status: "success",
            data: printers.map((printer) => ({
                name: printer.name,
                displayName: printer.displayName || printer.name,
                isDefault: printer.isDefault,
            })),
        };
    } catch (error) {
        console.error("listPrinters error:", error);
        return { status: "success", data: [] };
    }
}

/**
 * Prints a file that is already on this machine's disk.
 *
 * `filePath` must be local — the caller is responsible for having fetched it
 * from the host first, which is what the client's document cache is for.
 */
export async function printLocalFile(filePath: string): Promise<PrintResult> {
    if (!filePath || !fs.existsSync(filePath)) {
        return { status: "fail", message: "Fichier introuvable." };
    }

    const printerName = getNetworkConfig().printerName;
    if (!printerName) {
        const error = await shell.openPath(filePath);
        return error
            ? { status: "fail", message: error }
            : { status: "success", opened: true };
    }

    // A window of its own rather than the app's: printing navigates it to the
    // PDF, and doing that to the window the user is working in would take the
    // application away from them mid-consultation.
    const printWindow = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: false, sandbox: true },
    });

    try {
        await printWindow.loadURL(pathToFileURL(filePath).toString());
        await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));

        const result = await new Promise<PrintResult>((resolve) => {
            const timer = setTimeout(
                () => resolve({ status: "fail", message: "L'imprimante n'a pas répondu." }),
                PRINT_TIMEOUT_MS,
            );
            printWindow.webContents.print(
                { silent: true, deviceName: printerName, printBackground: true },
                (success, failureReason) => {
                    clearTimeout(timer);
                    resolve(success
                        ? { status: "success" }
                        : { status: "fail", message: failureReason || "Impression refusée." });
                },
            );
        });

        // A configured printer that refuses is still a document the desk needs
        // to hand over, so fall back rather than leaving them stuck.
        if (result.status === "fail") {
            const error = await shell.openPath(filePath);
            if (!error) return { status: "success", opened: true, message: result.message };
        }
        return result;
    } catch (error) {
        return { status: "fail", message: (error as Error).message };
    } finally {
        if (!printWindow.isDestroyed()) printWindow.destroy();
    }
}
