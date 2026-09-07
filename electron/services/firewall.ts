import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getNetworkConfig } from "./networkConfig";

const run = promisify(execFile);

/**
 * The Windows Firewall rule that lets the front desk reach the host.
 *
 * Without it, the second machine's very first connection times out and the
 * install looks broken in a way that points at nothing — which is the single
 * most likely support call this feature could generate.
 *
 * Done here rather than in the installer because the installer cannot. The
 * NSIS package is per-user and unelevated (`perMachine: false`), and adding a
 * firewall rule needs administrator rights; forcing the whole installer to
 * elevate would put a UAC prompt in front of every standalone install that
 * will never open a port at all. So the prompt appears exactly once, on the
 * one machine that becomes a host, at the moment the doctor asks it to.
 */

const RULE_NAME = "Ausculta";

export type FirewallState = "unsupported" | "present" | "absent" | "unknown";

export interface FirewallResult {
    status: "success" | "fail" | "cancelled";
    state?: FirewallState;
    message?: string;
}

/** Whether the rule is already there. Reading does not need elevation. */
export async function checkFirewallRule(): Promise<FirewallResult> {
    if (process.platform !== "win32") return { status: "success", state: "unsupported" };
    try {
        const { stdout } = await run(
            "netsh",
            ["advfirewall", "firewall", "show", "rule", `name=${RULE_NAME}`],
            { windowsHide: true, timeout: 10_000 },
        );
        // netsh localises everything, so matching on message text would break
        // on a French or Arabic Windows. The port is the one token that does
        // not get translated.
        const port = String(getNetworkConfig().port);
        return { status: "success", state: stdout.includes(port) ? "present" : "absent" };
    } catch {
        // netsh exits non-zero when no rule matches, which is the answer rather
        // than an error.
        return { status: "success", state: "absent" };
    }
}

/**
 * Adds the rule, elevating for it.
 *
 * Scoped to the private profile: a clinic LAN is a private network, and a rule
 * that also opened the port on a public one would follow a laptop to a café.
 */
export async function addFirewallRule(): Promise<FirewallResult> {
    if (process.platform !== "win32") return { status: "success", state: "unsupported" };

    const port = getNetworkConfig().port;
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
        return { status: "fail", message: "Port invalide." };
    }

    // Replace any older rule first, so changing the port does not leave the
    // previous one open. Both run in one elevated shell — two UAC prompts for
    // one action would be worse than the problem.
    const script = [
        `netsh advfirewall firewall delete rule name='${RULE_NAME}' | Out-Null`,
        `netsh advfirewall firewall add rule name='${RULE_NAME}' dir=in action=allow protocol=TCP localport=${port} profile=private`,
    ].join("; ");

    try {
        await run(
            "powershell",
            [
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle", "Hidden",
                "-Command",
                // Start-Process -Verb RunAs is what raises the UAC prompt;
                // -Wait so the result below reflects what actually happened.
                `Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-Command',"${script}"`,
            ],
            { windowsHide: true, timeout: 120_000 },
        );
    } catch (error) {
        // The user declining the UAC prompt lands here. It is a choice, not a
        // failure, and the UI should say what it means rather than apologise.
        const message = (error as Error).message ?? "";
        if (/canceled|cancelled|1223/i.test(message)) {
            return { status: "cancelled", message: "Autorisation refusée." };
        }
        return { status: "fail", message };
    }

    return checkFirewallRule();
}
