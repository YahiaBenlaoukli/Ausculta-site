/**
 * LAN mode: how this installation gets at the practice's data.
 *
 * `standalone` is what every existing install is and stays until someone
 * changes it in Settings — one machine, its own database, no network at all.
 *
 * `host` is standalone plus a server: same local database, additionally served
 * to the other seat. `client` has no database of its own and answers every
 * data channel by asking the host.
 */
export type NetworkMode = 'standalone' | 'host' | 'client';

export interface NetworkConfig {
    mode: NetworkMode;
    /** Client only — the host's LAN address (IP, or a hostname that resolves). */
    hostAddress: string;
    /** Both roles; they must agree. */
    port: number;
    /**
     * Client only — the host's certificate in PEM, kept from the pairing.
     *
     * The whole certificate rather than its fingerprint, because this is handed
     * to Node as the `ca` for every subsequent connection: a self-signed
     * certificate is its own authority, so pinning it this way means Node's own
     * verification decides, rather than code of mine comparing hex strings
     * after a handshake it did not gate.
     *
     * The first connection is taken on faith — nothing vouches for a clinic's
     * self-signed host — and both screens show the fingerprint so it can be
     * compared. Every connection after that must present this certificate.
     * Re-pairing is deliberate in Settings, because clearing this is also
     * exactly what someone impersonating the host would need you to do.
     */
    pinnedCertificate: string | null;

    /**
     * Which printer this seat prints to, or null to open the OS viewer and let
     * the user press Ctrl+P.
     *
     * Machine-local by nature, which is why it lives here rather than in the
     * database: the desk and the consulting room have different printers, and a
     * shared setting could only ever be right for one of them.
     */
    printerName: string | null;

    /**
     * Whether this machine drives the waiting-room TV, and on which monitor.
     *
     * Here rather than in the database for the same reason as printerName, only
     * more so: a monitor is physically attached to one machine. The board is
     * reopened at every launch when enabled, which is what lets the front desk
     * have it without being able to reach Settings.
     */
    queueDisplayEnabled: boolean;
    /**
     * Electron display id, or null for "the first non-primary screen".
     *
     * A HINT, not an address. Display ids are not stable across reboots or
     * re-plugging, so this is resolved at open time and falls back rather than
     * being trusted — a TV that was off over the weekend must not strand the
     * board on coordinates that no longer exist.
     */
    queueDisplayId: number | null;
    /**
     * How much of a patient's name the waiting room TV shows.
     *
     * A public screen in a room full of strangers, so this is a real choice and
     * not a cosmetic one. Defaults to the full name, which is what most
     * practices expect and what this one asked for; the other two are here so
     * that decision can be revisited without a code change.
     */
    queueDisplayNameMode: QueueDisplayNameMode;
}

/** `initial` renders "Amine B."; `number` shows only the position in the queue. */
export type QueueDisplayNameMode = 'full' | 'initial' | 'number';

/** One monitor attached to this machine, for the Settings picker. */
export interface DisplayOption {
    id: number;
    label: string;
    bounds: { x: number; y: number; width: number; height: number };
    isPrimary: boolean;
}

/** What the host shows in Settings so the numbers can be typed into the client. */
export interface HostInfo {
    running: boolean;
    port: number;
    /** Every non-internal IPv4 address, so the doctor can pick the right one. */
    addresses: string[];
    /** SHA-256 fingerprint of this host's certificate, for verifying a pairing. */
    fingerprint: string | null;
    message?: string;
}

/** Result of the client's "Test connection" button. */
export interface ConnectionTest {
    status: 'success' | 'fail';
    /** True when this connection is the one that paired with the host. */
    paired?: boolean;
    /** Shown so it can be compared with what the host's Settings displays. */
    fingerprint?: string;
    appVersion?: string;
    code?: ConnectionErrorCode;
    message?: string;
}

/** Pushed to the renderer on the 'host-status' channel when reachability flips. */
export interface HostStatus {
    reachable: boolean;
    code?: ConnectionErrorCode;
}

export type ConnectionErrorCode =
    /** Nothing answered: wrong address, host asleep, firewall, cable. */
    | 'unreachable'
    /** Something answered but it is not an Ausculta host. */
    | 'not_ausculta'
    /**
     * Reached a host, but its certificate is not the one pinned. Either the
     * host was reinstalled — or this is not the machine you paired with.
     */
    | 'fingerprint_mismatch'
    | 'timeout'
    | 'server_error';
