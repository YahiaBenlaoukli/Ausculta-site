
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initializeDatabase } from './db/db'
import { CHANNEL_TABLE, type ChannelEntry, type ChannelName } from './ipc/registry'
import { callRemote, remoteLogin, remoteCheckAuth, remoteLogout, remoteUploadDocument, remoteOpenDocument, remotePrintDocument, setStatusWindow } from './ipc/remote'
import { clearClientCache } from './server/files'
import { checkPermission } from './services/permissions'
import { getCurrentUser } from './services/session'
import { initializeUpdater } from './services/updater'
import { getNetworkConfig, ownsDatabase } from './services/networkConfig'
import { startServer, stopServer } from './server/server'
import { openQueueDisplay, closeQueueDisplay } from './services/queueDisplay'
import { APP_WINDOW_BACKGROUND } from '../theme/palette'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Registers one channel from the registry, behind the role check.
 *
 * Every channel goes through here, so there is exactly one place that asks
 * "may this user do this?" and exactly one place that admits the wire is
 * untyped. Adding a channel is an entry in `electron/ipc/registry.ts` plus a
 * decision in permissions.ts — the allowlist there refuses anything it has not
 * been told about, so forgetting costs a visible refusal, not a silent hole.
 */
function registerChannel(channel: ChannelName, entry: ChannelEntry) {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    const denial = checkPermission(channel, getCurrentUser())
    if (denial) return denial

    // Arguments arrive as whatever the preload wrapper sent — there is no
    // type to recover at a process boundary, and pretending otherwise would
    // just move the cast somewhere less obvious.
    const call = entry.fn as (...callArgs: unknown[]) => unknown
    return entry.withWindow ? call(...args, win) : call(...args)
  })
}

/**
 * Registers a channel that this seat answers by asking the host.
 *
 * The local permission check still runs, and it is the same function over the
 * same allowlist that the host will apply — so it cannot drift, and it saves a
 * round trip on a call that was never going to be allowed. The host remains
 * the authority; this is only about not asking.
 */
function registerRemoteChannel(channel: ChannelName, entry: ChannelEntry) {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    const denial = checkPermission(channel, getCurrentUser())
    if (denial) return denial
    return callRemote(channel, args, entry.fallback)
  })
}

/**
 * The three session channels, which a client answers differently.
 *
 * They are marked `local` because they manage THIS seat's session — the token
 * on this disk, this process's signed-in user — but on a client the password
 * check and the token verification can only happen where the users table is.
 * So the storage half stays here and the credential half goes to the host.
 */
const CLIENT_SESSION_OVERRIDES: Partial<Record<ChannelName, (...args: unknown[]) => unknown>> = {
  'login': (fullName, password, stayLogged) =>
    remoteLogin(fullName as string, password as string, stayLogged === true),
  'check-auth': () => remoteCheckAuth(),
  'logout': () => remoteLogout(),

  // The two channels that move bytes rather than JSON. Both name a path on the
  // machine that called them, which on a client is the wrong disk in opposite
  // directions: an upload reads a file that only exists here, and opening one
  // names a file that only exists on the host.
  'upload-document': (document) => remoteUploadDocument(document as Parameters<typeof remoteUploadDocument>[0]),
  'open-document': (filePath) => remoteOpenDocument(filePath as string),
  // Same shape: printing happens at this seat, but the document being printed
  // lives on the host and has to come across first.
  'print-document': (filePath) => remotePrintDocument(filePath as string),
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'logo.ico'),
    // What the compositor presents for any region the renderer has not painted
    // yet — during startup, a resize, or a route change that briefly empties the
    // content area. Left unset, those frames come out black on Windows, which
    // reads as a flicker when navigating.
    //
    // Shares one source with `--background` in src/index.css, which is what
    // keeps those moments seamless rather than a flash of the wrong colour;
    // `npm run check:palette` fails the build if the two ever drift.
    backgroundColor: APP_WINDOW_BACKGROUND,
    // Do not present the window until there is a painted frame to show.
    // Without this the window appears while the document is still blank, so
    // every launch starts with a flash of empty window.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.once('ready-to-show', () => win?.show())

  // The waiting-room board is a second window, and 'window-all-closed' below
  // only fires once EVERY window has gone. Without this, closing the app at the
  // end of the day would leave Ausculta running invisibly behind the TV — no
  // main window, no way back to it, and the process still holding the database.
  win.on('closed', () => { closeQueueDisplay() })

  // External links (target="_blank" / window.open) go to the default browser,
  // never a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Close the LAN socket before quitting, so the other seat gets a refused
    // connection it can report as "host unreachable" rather than a hang.
    stopServer()
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  const network = getNetworkConfig();

  // A client has no database of its own, and must not create one. Beyond the
  // empty file, initializeDatabase() runs the startup repairs and
  // syncMissedAppointments() — work that belongs to whoever owns the data, and
  // that a second machine doing it concurrently would only duplicate.
  if (ownsDatabase()) {
    // A database that refuses to open must not take the window down with it.
    // Unguarded, a throw here skips every channel registration AND
    // createWindow() below — so the app starts with no window and no message,
    // which from the outside is indistinguishable from a silent crash.
    // Registering the handlers anyway means the renderer's calls reject with a
    // real reason instead of hanging, and the window can at least say
    // something.
    try {
      initializeDatabase();
    } catch (error) {
      console.error('Fatal: the database could not be opened:', error);
      // No renderer exists yet, so there is no i18n to reach for; French is the
      // default locale for this market.
      dialog.showErrorBox(
        'Ausculta',
        `La base de données n'a pas pu être ouverte.\n\n${(error as Error).message}`
      );
    }
  }

  // Every channel, from the one table. What decides where a call goes is the
  // registry's `local` flag plus this seat's mode — never the channel name
  // spelled out somewhere, which is how the two transports would drift.
  const isClient = network.mode === 'client';
  for (const [name, entry] of Object.entries(CHANNEL_TABLE)) {
    const channel = name as ChannelName;
    const override = isClient ? CLIENT_SESSION_OVERRIDES[channel] : undefined;

    if (override) {
      registerChannel(channel, { ...entry, fn: override as ChannelEntry['fn'] });
    } else if (isClient && !entry.local) {
      registerRemoteChannel(channel, entry);
    } else {
      registerChannel(channel, entry);
    }
  }

  createWindow();

  // Needs the window: update progress is pushed to the renderer over IPC.
  if (win) initializeUpdater(win);
  // And so does the host-reachability banner.
  if (isClient) {
    setStatusWindow(win);
    // Fetched documents are copies, not the record. Clearing at startup rather
    // than at quit means a crash cannot leave patient files sitting in the
    // temp directory until someone notices.
    clearClientCache();
  }

  // The waiting-room TV comes back by itself. This is what lets the front desk
  // have a board at all: Settings is doctor-only, so if opening it were a manual
  // step, the assistant would have to fetch the doctor every morning.
  if (getNetworkConfig().queueDisplayEnabled) {
    const opened = openQueueDisplay();
    if (opened.status === 'fail') {
      // A TV that is switched off is not a startup failure.
      console.error('Waiting-room display could not open:', opened.message);
    }
  }

  // Serving the other seat comes last and never blocks the window. A host
  // whose port is taken is still a perfectly good standalone install for the
  // doctor sitting at it — the failure belongs in Settings, not in a dialog
  // over the app they just opened.
  if (network.mode === 'host') {
    const started = await startServer(win);
    if (started.status === 'fail') {
      console.error('Ausculta host could not start:', started.message);
    }
  }
})
