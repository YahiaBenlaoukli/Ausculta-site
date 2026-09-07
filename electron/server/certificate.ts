import { app } from "electron";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import selfsigned from "selfsigned";
import { localAddresses } from "../services/networkConfig";

/**
 * The host's TLS identity.
 *
 * Self-signed, generated once on this machine and kept in the user-data
 * directory beside the database it protects. No authority signs it and no
 * hostname is validated against it — the client pins its SHA-256 fingerprint
 * on first connection and refuses anything else afterwards. The certificate is
 * really just a carrier for the key; the fingerprint is the trust.
 *
 * That is a deliberate trade. A clinic has no PKI and no DNS worth trusting,
 * and asking a doctor to install a root certificate on two machines is how a
 * feature stops being used. Pinning gives the property that actually matters
 * here — this connection is to the same machine as last time, and nobody on
 * the network can read what passes over it.
 */

const CERT_PATH = () => path.join(app.getPath("userData"), "host-cert.pem");
const KEY_PATH = () => path.join(app.getPath("userData"), "host-key.pem");

/** Regenerate this long before expiry, so a live install never trips over it. */
const RENEW_WITHIN_DAYS = 30;

export interface HostCertificate {
    cert: string;
    key: string;
    /** Upper-case, colon-separated SHA-256 — the form Node reports it in. */
    fingerprint: string;
}

let cached: HostCertificate | null = null;

/**
 * Loads the host certificate, generating one on first use.
 *
 * Async because certificate generation is: selfsigned v5 signs through
 * WebCrypto. Called once when the server starts, never on a request path.
 */
export async function ensureHostCertificate(): Promise<HostCertificate> {
    if (cached) return cached;

    const existing = loadExisting();
    if (existing) {
        cached = existing;
        return cached;
    }

    const generated = await generate();
    fs.writeFileSync(CERT_PATH(), generated.cert, { mode: 0o600 });
    fs.writeFileSync(KEY_PATH(), generated.key, { mode: 0o600 });
    cached = generated;
    return cached;
}

/** The fingerprint to read out in Settings, or null before the server has run. */
export function currentFingerprint(): string | null {
    if (cached) return cached.fingerprint;
    return loadExisting()?.fingerprint ?? null;
}

// ─── Private ─────────────────────────────────────────────────────────────

function loadExisting(): HostCertificate | null {
    try {
        const cert = fs.readFileSync(CERT_PATH(), "utf8");
        const key = fs.readFileSync(KEY_PATH(), "utf8");
        const parsed = new X509Certificate(cert);

        // Expiry does not break pinning — the client validates the fingerprint,
        // not the dates — but rolling it over well before it lapses keeps the
        // certificate ordinary, so a future stricter TLS stack has nothing to
        // object to. Re-pairing the client is the cost, hence the long life
        // and the wide margin.
        const expiresAt = new Date(parsed.validTo).getTime();
        if (Number.isFinite(expiresAt) && expiresAt - Date.now() < RENEW_WITHIN_DAYS * 86_400_000) {
            return null;
        }

        return { cert, key, fingerprint: parsed.fingerprint256 };
    } catch {
        // Absent on first run; unreadable or malformed if something truncated
        // it. Both mean "make a new one" — there is nothing here to preserve.
        return null;
    }
}

async function generate(): Promise<HostCertificate> {
    // Every address this machine answers on goes in the SAN. Nothing validates
    // it today, but a certificate that names the host it is actually served
    // from costs nothing now and is what a stricter client would need later.
    // GeneralName tags from RFC 5280, which is how selfsigned types them:
    // 2 is dNSName, 7 is iPAddress.
    const dnsName = (value: string) => ({ type: 2 as const, value });
    const ipName = (ip: string) => ({ type: 7 as const, ip });

    const altNames = [
        dnsName("ausculta-host"),
        dnsName("localhost"),
        ipName("127.0.0.1"),
        ...localAddresses().map(ipName),
    ];

    // Ten years. The default is one, which for a pinned certificate would mean
    // re-pairing both machines every year for no security gained — the
    // fingerprint is the trust anchor, and rotating it is the thing that costs
    // the clinic a support call.
    const notBeforeDate = new Date();
    const notAfterDate = new Date(notBeforeDate.getTime() + 3650 * 86_400_000);

    const pems = await selfsigned.generate(
        [{ name: "commonName", value: "Ausculta Host" }],
        {
            keySize: 2048,
            algorithm: "sha256",
            notBeforeDate,
            notAfterDate,
            extensions: [{ name: "subjectAltName", altNames }],
        },
    );

    return {
        cert: pems.cert,
        key: pems.private,
        fingerprint: new X509Certificate(pems.cert).fingerprint256,
    };
}
