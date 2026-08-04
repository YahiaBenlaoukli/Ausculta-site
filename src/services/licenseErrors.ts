import type { LicenseErrorCode } from '../../types/trial';

/**
 * Turns a machine-readable failure code from the main process into a
 * translation key. The activation server deliberately never sends prose — the
 * clinic may be running the app in fr, en or ar, and only the renderer knows
 * which.
 */
export function licenseErrorKey(code?: LicenseErrorCode): string {
    return `trial.error.${code ?? 'server_error'}`;
}
