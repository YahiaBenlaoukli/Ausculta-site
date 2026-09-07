# Running Ausculta on two machines

The doctor and the assistant work on separate computers against the same patient
record, over the clinic's own network. No server, no hosting, no patient data
leaving the practice.

This document is the install runbook and the reference for what to do when it
misbehaves. For *why* it is built this way, see the architecture notes in
`CLAUDE.md`.

---

## 1. How it works

One machine is the **host**. It holds the database and the documents, and serves
them to the other machine over the local network. The other machine is the
**client**: it runs the identical application but holds no data of its own, and
answers every screen by asking the host.

```
   Doctor's PC  (host)                              Assistant's PC  (client)
   ┌────────────────────────┐                       ┌────────────────────────┐
   │ cabinet-medicale.db    │   HTTPS, pinned cert  │ no database            │
   │ records/  (PDFs)       │◄─────────────────────►│ no initializeDatabase()│
   │ backups                │   POST /rpc/:channel  │ temp document cache    │
   │ https server :7317     │   Bearer <jwt>        │ print queue poller     │
   └────────────────────────┘                       └────────────────────────┘
```

Three modes exist, set per machine in Settings:

| Mode | Meaning |
|---|---|
| `standalone` | One machine, its own database, no network. **The default** — every existing install stays here until someone changes it. |
| `host` | Standalone *plus* a server. Same local database, additionally served to the other seat. |
| `client` | No database. Every data call goes to the host. |

**The host must be switched on and awake for the client to work at all.** This is
the single most important operational fact about the whole setup.

### What does not travel

Some things always run on the machine that asked, and are refused if a client
tries to send them over the wire. They are marked `local: true` in
`electron/ipc/registry.ts`:

- opening a document in the desktop viewer, and printing
- launching WhatsApp for an appointment reminder
- backup, restore, restarting the app
- application updates
- the licence and trial state — **each machine is licensed separately**
- the network settings themselves

Sign-in is a special case: the password is checked on the host (that is where the
users table is), but the resulting session belongs to the machine you are sitting
at.

---

## 2. Before you start

| | |
|---|---|
| Both machines | Windows 10 or 11 |
| Host | 8 GB RAM, **sleep disabled**, powered on during opening hours |
| Client | 4 GB RAM |
| Network | Both on the same LAN. Wired is more reliable than Wi-Fi. |
| Router | Reserve the host's IP address (DHCP reservation), or it will change and break the client |
| Licences | One activation per machine, same key, three allowed |
| Printer | Reachable from the client, if the desk is to print |

Install Ausculta on both machines first, from the same installer.

---

## 3. Set up the host (the doctor's PC)

1. Open Ausculta and sign in as the doctor.
2. **Paramètres → Sauvegarde & Données → Postes et réseau du cabinet.**
3. Choose **Poste principal**.
4. Check the port (default `7317`). Leave it unless something else uses it.
5. Press **Enregistrer**, then **Redémarrer maintenant**.
6. Reopen Settings on the same screen. You should now see:
   - **Le service est démarré.**
   - One or more addresses under *Adresses de ce poste*.
   - A **certificate fingerprint**.
7. Press **Autoriser dans le pare-feu** and accept the Windows UAC prompt.
   Without this the client's connection will simply time out.
8. **Write down** the address you will use and the fingerprint.

> Which address? A clinic PC often has several — Ethernet, Wi-Fi, and leftovers
> from a VPN or Hyper-V. Use the one on the same subnet as the other machine,
> usually `192.168.x.x`. If unsure, try one; the client's connection test will
> tell you immediately whether it was right.

### Create the assistant's account

Still on the host, as the doctor: **Paramètres → Sécurité & Session → Comptes du
cabinet → Ajouter un(e) assistant(e)**. Give a name and a password of at least
6 characters, and pass them on — the password is not shown again.

---

## 4. Set up the client (the assistant's PC)

A fresh client has no account and cannot sign in until it is paired, so the
network settings are reachable **from the login screen**.

1. Open Ausculta. On the login screen, click **Configurer ce poste** (under the
   footer line).
2. Choose **Poste secondaire**.
3. Enter the host's address and the same port.
4. Press **Tester la connexion**.
5. On success it reports **Postes appariés** and shows a fingerprint.
   **Compare it with the one on the host.** They must match.
6. Press **Enregistrer**, then **Redémarrer maintenant**.
7. Sign in with the assistant's account.

### Activate the licence on this machine

**Each machine is licensed separately.** The client has its own 14-day trial and
will lock the desk out on day 15 if you forget. Same key; it consumes one of the
key's three activation slots.

Click the **"X jours restants · Activer"** pill at the bottom of the screen, type
the key, activate. This works whether or not anyone is signed in, and whichever
role is — the key is the credential, and it licenses the machine it is typed on.

> If the trial has already run out, the app opens straight onto the activation
> screen instead of the login screen. Same key, same result.

### Set the front-desk printer

This one **does** need the doctor, because it lives in Paramètres and an
assistant cannot open that page. Sign in as the doctor once on this machine —
their account works here, since sign-in is checked on the host — then:

**Paramètres → Sécurité & Session → Imprimante de ce poste.** Choose the desk
printer, or leave it on *Ouvrir le document* if you would rather press Ctrl+P;
the print queue works either way. Then sign out and hand the machine over.

---

## 5. Check it actually works

Do all of these before leaving the clinic.

- [ ] Create a patient on the client — it appears on the host.
- [ ] Book an appointment on the client — it appears in the host's calendar.
- [ ] Sign in as the assistant: **Statistiques**, **Ordonnances** and
      **Paramètres** are absent from the sidebar.
- [ ] Open a consultation as the assistant: only *Constantes*, *Documents* and
      *Facturation* steps are offered — no clinical step, no Terminer button.
- [ ] Scan or upload a document at the desk — the doctor can open it.
- [ ] Write a prescription on the host, press the print icon in the consultation's
      document list. The client's **Impressions** panel shows it; print it; the
      host shows it as printed and by whom.
- [ ] Switch the host off. The client shows a dark banner saying the main machine
      is unreachable, with a retry button — and does not lose typed data.
- [ ] Switch the host back on, press retry, and confirm the client recovers.
- [ ] Both machines show *Licence active* — neither is on trial. **Check the
      client explicitly**; it is the one people forget, and it fails two weeks
      later on a morning when the desk is busy.

---

## 6. Day-to-day

**Doctor.** Works as before. Sends a document to the desk with the printer icon
next to any document — in the consultation's document list, or on the Documents
page. Sees in the *Impressions* panel that it came out and who printed it.

**Assistant.** Patients, appointments, WhatsApp reminders, documents, taking
payment, checking patients in and recording their weight and blood pressure. The
*Impressions* panel shows what is waiting to print.

**Turning the host off at night is fine.** Turn it on before the desk opens.

---

## 7. When something is wrong

### The client says the main machine is unreachable

In order of likelihood:

1. The host is off, asleep, or Ausculta is not running on it.
2. The **firewall rule** was never added, or was removed. Redo step 3.7 on the host.
3. The host's **IP address changed** — this happens when the router hands out a
   new lease. Check the address in the host's Settings and update the client.
   Then reserve the address on the router so it stops happening.
4. Wrong port on one side. They must match.
5. The two machines are on different networks — for example one on Wi-Fi guest.

Quick check from the client, in a terminal:

```powershell
Test-NetConnection -ComputerName <host-ip> -Port 7317
```

`TcpTestSucceeded : True` means the network is fine and the problem is in the app.

### Red banner: the certificate has changed

The client is refusing to talk to a machine that is not the one it paired with.
**Do not re-pair reflexively.** This is expected only if the host was reinstalled
or its user-data folder was cleared. Otherwise treat it as a genuine warning.

To re-pair deliberately: on the client, Paramètres → *Oublier cet appariement*,
then **Tester la connexion**, and compare the fingerprint with the host's.

### "Cette action est réservée au médecin"

Working as intended. The assistant reached a doctor-only function. If it is
something the desk genuinely needs, the answer is to change the allowlist in
`electron/services/permissions.ts` — not to work around it.

### The client shows no data at all, and no error

Its mode is probably still `standalone`, so it is reading its own empty database.
Check Paramètres → Postes et réseau, or read `network.json` directly.

### A print job never reaches the desk

- Both machines must be in `host`/`client` mode. The panel hides itself entirely
  on a standalone install.
- The doctor must have pressed the printer icon; generating a PDF does not queue it.
- The client polls every 5 seconds. Wait ten.

### Printing does nothing visible

With no printer chosen, the document **opens** instead of printing — press Ctrl+P.
Choose a printer in Settings to make it one click.

### The desk locked out after two weeks

The client's own trial expired — each machine is licensed separately. The app
now opens onto the activation screen; type the same key there. No sign-in is
needed, and it does not matter which role the person at the keyboard has.

---

## 8. Where things live

On the **host**, under `%APPDATA%\gestion-cabinet-medicale\`:

> The folder is named after `package.json`'s `name`, not after the product. The
> installer says *Ausculta*; the data folder does not.

| File | What it is |
|---|---|
| `cabinet-medicale.db` | The practice's data. This is the file to back up. |
| `records/` | Every document and generated PDF |
| `network.json` | Mode, port, pinned certificate, printer |
| `host-cert.pem` / `host-key.pem` | The host's TLS identity |
| `jwt-secret` | Signs sessions. Deleting it logs everyone out once. |
| `trial.enc` | Licence and trial state for **this machine** |

On the **client**, the same folder holds `network.json`, `trial.enc` and
`token.enc` — and no database. Fetched documents live in a temp cache that is
cleared at every startup.

`network.json` is plain JSON and can be read or repaired by hand:

```json
{
  "mode": "client",
  "hostAddress": "192.168.1.10",
  "port": 7317,
  "pinnedCertificate": "-----BEGIN CERTIFICATE-----\n…",
  "printerName": "HP LaserJet"
}
```

A malformed file degrades to `standalone` rather than crashing.

---

## 9. Lifecycle

**Replacing the assistant's PC.** Install, pair, activate. The old machine's
licence slot is not released automatically — that is what the third slot is for.

**Replacing the doctor's PC.** Back up from the old host first
(Paramètres → Sauvegarde & Données). Install on the new machine, restore, set it to `host`,
add the firewall rule. Then on the client: *Oublier cet appariement* → test →
compare the new fingerprint. The certificate legitimately changed here.

**Going back to one machine.** Set the host to `standalone`. Nothing is lost —
it is the same database either way. Set the client to `standalone` too, or it
will sit there unable to reach anything.

**Backups run on the host only**, and remain the clinic's responsibility.
Weekly at minimum; in practice, daily.

---

## 10. Do not do this

**Do not put `cabinet-medicale.db` on a shared network folder** and point both
machines at it. SQLite's file locking is unreliable over SMB, WAL mode does not
work across network shares at all, and concurrent writes will corrupt the file.
This is the obvious shortcut and it destroys data. The host/client split exists
precisely to avoid it.

**Do not expose port 7317 to the internet.** The firewall rule is scoped to the
private network profile on purpose. Nothing about this design is intended to
survive contact with the public internet.

---

## 11. Testing two "machines" on one PC

Two instances need two user-data directories, which is a Chromium switch rather
than anything this app provides. `npm run dev` spawns Electron itself and gives
you nowhere to pass it, so build once and run the built output twice:

```powershell
npm run build

# Terminal 1 — the host, using the normal data directory
& ".\release\1.1.1\win-unpacked\Ausculta.exe"

# Terminal 2 — a second instance with a data directory of its own
& ".\release\1.1.1\win-unpacked\Ausculta.exe" --user-data-dir="$env:TEMP\ausculta-client"
```

The second instance starts empty: register a doctor, set it to *Poste
secondaire*, point it at `127.0.0.1` and the host's port. Everything except the
physical network behaves identically — including certificate pinning, since the
host still presents a real certificate over a real TLS socket.

The integration suite exercises the whole client/server path in one process —
TLS handshake, certificate pinning, permissions, file transfer and the print
queue — but it has never proven that two *machines* talk to each other. The
checklist in section 5 is what proves that.
