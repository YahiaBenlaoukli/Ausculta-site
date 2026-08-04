/**
 * Stable, machine-readable reasons a license check or activation failed.
 * The renderer maps these onto `trial.error.<code>` translation keys, so the
 * server never has to know which of fr/en/ar the clinic is running.
 */
export type LicenseErrorCode =
    | "invalid_key"        // no such key
    | "revoked"            // key disabled by us
    | "license_expired"    // subscription lapsed
    | "limit_reached"      // all device slots in use
    | "released"           // this device was unregistered from the key
    | "invalid_token"      // stored token failed verification
    | "device_mismatch"    // token belongs to a different machine
    | "rate_limited"       // too many failed attempts
    | "offline"            // could not reach the activation server
    | "server_error"       // activation server failed
    | "bad_request";       // malformed request (should not reach users)

export type TrialStatus = {
    status: "success" | "fail";
    licensed: boolean;
    expired: boolean;
    daysRemaining: number;
    totalDays: number;
    tampered?: boolean;
    message?: string;
    /** Why the license is not active, when it isn't. */
    code?: LicenseErrorCode;

    /** 'perpetual' today; 'subscription' once the ERP tier exists. */
    plan?: "perpetual" | "subscription";
    /** ISO date a subscription runs out. Null/undefined for perpetual keys. */
    licenseExpiresAt?: string | null;
    /** Feature flags carried by the license, for future ERP modules. */
    features?: string[];
};

export type ActivationResult = {
    status: "success" | "fail";
    code?: LicenseErrorCode;
    message?: string;
    /** Device slots used / allowed, so the UI can say "2 of 3 devices". */
    devicesInUse?: number;
    maxActivations?: number;
    plan?: "perpetual" | "subscription";
    customerName?: string | null;
};
