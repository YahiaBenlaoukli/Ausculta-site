# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

"Ausculta" (appId `com.ausculta.cabinet`) is an Electron + React desktop app for managing a doctor's private practice (patients, appointments, prescriptions, documents, billing statistics). It is offline-first: all data lives in a local SQLite database inside the OS user-data directory, there is no backend server.

## Commands

- `npm run dev` — start Vite + Electron in dev mode (hot reload for both renderer and main process via `vite-plugin-electron`).
- `npm run build` — type-check (`tsc`), build the renderer + main/preload bundles, then package with `electron-builder`.
- `npm run lint` — ESLint over `.ts`/`.tsx` (`--max-warnings 0`, unused-disable-directives reported as errors).
- `npm run preview` — preview the built renderer.

There is no test runner configured in this repo (no `test` script, no test files).

## Architecture

### Process split

- `electron/main.ts` — Electron main process entry point. Creates the `BrowserWindow`, calls `initializeDatabase()` on `app.whenReady`, and registers every renderer↔main IPC channel via `ipcMain.handle(...)`. This file is the single source of truth for what IPC channels exist — grouped by domain with French comments (`//gestion des patients`, `//gestion des prescriptions`, etc.).
- `electron/preload.ts` — the only bridge between renderer and main. Exposes a flat `window.ipcRenderer` object via `contextBridge`, with one typed wrapper method per IPC channel (e.g. `getAllPatients()`, `bookAppointment(...)`). Renderer code never calls `ipcRenderer.invoke` directly; it calls these named methods.
- `electron/services/*.ts` — business logic run in the main process, one file per domain: `auth.ts`, `patient.ts`, `documents.ts`, `prescription.ts`, `appointments.ts`, `statistics.ts`. Each exported function is wired to exactly one IPC handler in `main.ts`.
- `electron/db/db.ts` — single `better-sqlite3` connection (`getDatabase()` / `initializeDatabase()`). Schema is created with `CREATE TABLE IF NOT EXISTS` directly in code (no migration framework); `user_version` pragma is bumped manually when the schema changes. WAL mode and `foreign_keys = ON` are set explicitly. `initializeDatabase()` also runs one-off data-repair logic (e.g. auto-linking legacy prescription documents) and `syncMissedAppointments()` (flips past `Scheduled` appointments to `No-Show`) on every startup.

**Adding a new capability that touches the DB** means touching four places in lockstep: the service function in `electron/services/`, the `ipcMain.handle` registration in `electron/main.ts`, the wrapper method in `electron/preload.ts`, and the type in `types/*.ts` used by both sides.

Service functions consistently return `{ status: "success" | "fail", data?, message? }` (or `"not_found"`) rather than throwing — callers in the renderer branch on `.status`.

### Renderer (`src/`)

- Routing is a flat `HashRouter` table in `src/main.tsx` (hash routing because the app is loaded via `file://` in production, not a web server). `/` is the login screen (`Authentification`); every other route is wrapped in `Layout` (sidebar + content area).
- `src/components/Layout/Layout.tsx` owns sidebar-collapsed state via a small context (`useLayout`) and flips `document.documentElement.dir`/`lang` for i18n/RTL.
- `src/pages/<Feature>/<Feature>.tsx` — one folder per route/feature (Dashboard, Patients, PatientDetails, Prescriptions, Documents, Appointments, Statistics, Parameters/Settings, Authentification). Pages call `window.ipcRenderer.<method>()` directly to talk to the main process — there is no separate API/service layer or state-management library in the renderer.
- `types/` (repo root, shared by both `src` and `electron` via the `tsconfig.json` `include`) defines the domain models: `patient.ts`, `doctor.ts` (includes `Prescription`, `DoctorProfile`), `documents.ts`, `user.ts`.

### i18n

`src/services/i18n.ts` configures `i18next` with inline JSON resources from `src/locales/{en,fr,ar}/translation.json`, browser language detection, and `en` fallback. Arabic implies RTL support is a first-class concern (see `Layout`'s `dir` handling) — check all three locale files when adding user-facing strings.

### Auth

JWT-based, but scoped to a single local user session rather than a network API: `electron/services/auth.ts` signs a JWT (`JWT_SECRET` from `electron/.env`, with an insecure fallback if unset) and, when "stay logged in" is checked, encrypts it at rest with Electron's `safeStorage` API into `token.enc` under the user-data dir. Passwords are hashed with `bcrypt`. `checkAuth()` re-validates the user still exists in the DB (handles the case where the DB was reset but a token/cookie survived).

### PDF generation

`electron/services/prescription.ts` uses `pdf-lib` to fill a prescription PDF template (see `public/ordonnance/`) with patient/doctor/medicine data, then persists it through `documents.ts` (`uploadDocument`) so generated prescriptions show up as patient documents.

### Packaging

`electron-builder.json` builds Windows (NSIS), macOS (dmg) and Linux (AppImage) targets from `dist` + `dist-electron`, bundling the `public/` folder as `extraResources`. `vite.config.ts` marks `better-sqlite3` and `bcrypt` as external for the main-process build since they're native modules.
