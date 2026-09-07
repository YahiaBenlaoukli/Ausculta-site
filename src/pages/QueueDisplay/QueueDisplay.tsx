import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { WaitingRoom, WaitingRoomEntry } from "../../../types/waitingRoom"
import type { QueueDisplayNameMode } from "../../../types/network"
import { BOARD_BACKGROUND } from "../../../theme/palette"

/**
 * The waiting-room board — what the TV shows.
 *
 * Read-only, unattended, and read from across a room. It answers the question
 * the internal queue page does not: the patient's own. Am I next, and how much
 * longer?
 *
 * Rendered WITHOUT the app shell — see src/main.tsx, which branches on the
 * '#/display' hash before mounting the router. A waiting room TV showing an
 * update toast or a "host unreachable" banner would be worse than a blank one.
 */

const POLL_MS = 5_000
/** A TV listing fifteen people is unreadable and tells the person at the back nothing. */
const VISIBLE_ROWS = 5

const EMPTY: WaitingRoom = { waiting: [], inRoom: null, typicalMinutes: 20 }

/** The ground — the same constant the board's BrowserWindow is created with. */
const GROUND = BOARD_BACKGROUND

/**
 * How much of a name the room gets to see.
 *
 * `initial` keeps the given name and reduces the family name to a letter, which
 * is recognisable to the person waiting and much less so to a stranger reading
 * the screen. Arabic and French names alike are split on whitespace; a
 * single-word name is left whole rather than being reduced to one letter.
 */
function displayName(entry: WaitingRoomEntry, mode: QueueDisplayNameMode, position: number): string {
    if (mode === "number") return `${position}`
    const name = entry.patientName.trim()
    if (mode === "full" || !name) return name
    const parts = name.split(/\s+/)
    if (parts.length < 2) return name
    return `${parts.slice(0, -1).join(" ")} ${parts[parts.length - 1][0]}.`
}

export default function QueueDisplay() {
    const { t, i18n } = useTranslation()
    const [room, setRoom] = useState<WaitingRoom>(EMPTY)
    const [nameMode, setNameMode] = useState<QueueDisplayNameMode>("full")
    const [heading, setHeading] = useState("")
    const [clock, setClock] = useState(() => new Date())
    // Distinguishes "nobody is waiting" from "we have not managed to ask yet".
    const [everLoaded, setEverLoaded] = useState(false)
    const polling = useRef(false)

    const locale = i18n.language || "fr"

    /* The board lives outside Layout, which is what normally owns direction. */
    useEffect(() => {
        const isRtl = i18n.dir() === "rtl"
        document.documentElement.dir = isRtl ? "rtl" : "ltr"
        document.documentElement.lang = i18n.language
    }, [i18n, i18n.language])

    /* html/body are painted light for the app; this window is dark. Set both, or
       the edges and any unpainted frame flash the wrong colour on open. */
    useEffect(() => {
        const previous = document.documentElement.style.background
        document.documentElement.style.background = GROUND
        document.body.style.background = GROUND
        return () => { document.documentElement.style.background = previous }
    }, [])

    useEffect(() => {
        const timer = setInterval(() => setClock(new Date()), 30_000)
        return () => clearInterval(timer)
    }, [])

    const refresh = useCallback(async () => {
        if (polling.current) return
        polling.current = true
        try {
            const data = await window.ipcRenderer.getWaitingRoom()
            if (data && Array.isArray(data.waiting)) {
                setRoom(data)
                setEverLoaded(true)
            }
        } catch {
            // Keep showing the last good queue. A board that blanks itself on one
            // dropped poll is worse than one that is five seconds stale.
        } finally {
            polling.current = false
        }
    }, [])

    useEffect(() => {
        void refresh()
        const timer = setInterval(() => void refresh(), POLL_MS)
        return () => clearInterval(timer)
    }, [refresh])

    /* The practice's name, for the header. Fetched once. */
    useEffect(() => {
        let alive = true
        void (async () => {
            try {
                const [profile, config] = await Promise.all([
                    window.ipcRenderer.getPracticeDoctorProfile(),
                    window.ipcRenderer.getNetworkConfig(),
                ])
                if (!alive) return
                if (profile.status === "success" && profile.data) {
                    setHeading(profile.data.clinicName?.trim() || profile.data.fullName || "")
                }
                if (config?.queueDisplayNameMode) setNameMode(config.queueDisplayNameMode)
            } catch {
                // Header text is decoration; the queue is the point.
            }
        })()
        return () => { alive = false }
    }, [])

    const visible = useMemo(() => room.waiting.slice(0, VISIBLE_ROWS), [room.waiting])
    const overflow = room.waiting.length - visible.length

    const eta = (entry: WaitingRoomEntry) => {
        if (entry.etaMinutes <= 0) return t("queue_display.up_next")
        if (entry.etaMinutes >= 60) {
            const hours = Math.floor(entry.etaMinutes / 60)
            const minutes = entry.etaMinutes % 60
            return `~ ${hours} h${minutes ? ` ${minutes}` : ""}`
        }
        return `~ ${t("queue_display.minutes", { count: entry.etaMinutes })}`
    }

    return (
        <div
            className="min-h-screen w-full flex flex-col text-white overflow-hidden"
            style={{ background: GROUND }}
        >
            {/* ── Header ── */}
            <header className="flex items-baseline justify-between px-[3vw] pt-[3vh] pb-[2vh] border-b border-white/10">
                <h1 className="font-bold tracking-tight" style={{ fontSize: "clamp(1.2rem, 2.4vw, 2.6rem)" }}>
                    {heading}
                </h1>
                <span className="font-bold text-white/50 tabular-nums" style={{ fontSize: "clamp(1.2rem, 2.4vw, 2.6rem)" }}>
                    {clock.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                </span>
            </header>

            <main className="flex-1 flex flex-col px-[3vw] py-[3vh] gap-[3vh] min-h-0">

                {/* ── In consultation — the largest thing on screen ── */}
                <section>
                    <h2
                        className="font-bold uppercase tracking-[0.2em] text-pink"
                        style={{ fontSize: "clamp(0.7rem, 1.3vw, 1.4rem)" }}
                    >
                        {t("queue_display.in_room")}
                    </h2>
                    <p
                        className="font-bold leading-tight mt-[1vh] truncate"
                        style={{ fontSize: "clamp(2rem, 7vw, 7.5rem)" }}
                    >
                        {room.inRoom
                            ? displayName(room.inRoom, nameMode, 0)
                            : <span className="text-white/25">{t("queue_display.nobody_in_room")}</span>}
                    </p>

                    {/* When it started, and how long it has been running. The
                        start time is the fixed fact people check against the
                        clock above; the elapsed figure is what tells someone
                        whether they are about to be called. */}
                    {room.inRoom?.calledAt && (
                        <p
                            className="text-white/45 font-semibold mt-[0.5vh] tabular-nums"
                            style={{ fontSize: "clamp(0.85rem, 1.8vw, 1.9rem)" }}
                        >
                            {t("queue_display.since", {
                                time: new Date(room.inRoom.calledAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
                            })}
                            {" · "}
                            {t("queue_display.minutes", { count: room.inRoom.inRoomMinutes })}
                        </p>
                    )}
                </section>

                {/* ── Up next ── */}
                <section className="flex-1 min-h-0 flex flex-col">
                    <h2
                        className="font-bold uppercase tracking-[0.2em] text-white/40 mb-[1.5vh]"
                        style={{ fontSize: "clamp(0.7rem, 1.3vw, 1.4rem)" }}
                    >
                        {t("queue_display.next")}
                    </h2>

                    {!everLoaded ? (
                        <p className="text-white/25" style={{ fontSize: "clamp(1rem, 2vw, 2rem)" }}>
                            {t("queue_display.starting")}
                        </p>
                    ) : visible.length === 0 ? (
                        <p className="text-white/25" style={{ fontSize: "clamp(1rem, 2.4vw, 2.4rem)" }}>
                            {t("queue_display.empty")}
                        </p>
                    ) : (
                        <ol className="flex flex-col gap-[1.2vh]">
                            {visible.map((entry, index) => (
                                <li
                                    key={entry.id}
                                    className="flex items-center gap-[2vw] rounded-2xl bg-white/[0.04] border border-white/10 px-[2vw] py-[1.4vh]"
                                >
                                    <span
                                        className="font-bold text-pink/70 tabular-nums shrink-0 text-center"
                                        style={{ fontSize: "clamp(1.1rem, 2.6vw, 2.8rem)", minWidth: "2ch" }}
                                    >
                                        {index + 1}
                                    </span>
                                    <span
                                        className="font-bold flex-1 truncate"
                                        style={{ fontSize: "clamp(1.1rem, 3vw, 3.2rem)" }}
                                    >
                                        {displayName(entry, nameMode, index + 1)}
                                    </span>
                                    <span
                                        className="font-semibold text-white/55 shrink-0 tabular-nums"
                                        style={{ fontSize: "clamp(0.9rem, 2vw, 2.1rem)" }}
                                    >
                                        {eta(entry)}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}

                    {overflow > 0 && (
                        <p className="text-white/30 mt-[1.5vh]" style={{ fontSize: "clamp(0.8rem, 1.5vw, 1.5rem)" }}>
                            {t("queue_display.and_more", { count: overflow })}
                        </p>
                    )}
                </section>
            </main>

            {/* The estimate is a projection from queue position, and saying so
                is the difference between a helpful board and one that gets
                argued with at the desk. */}
            <footer
                className="px-[3vw] pb-[2.5vh] text-white/30"
                style={{ fontSize: "clamp(0.65rem, 1.1vw, 1.1rem)" }}
            >
                {t("queue_display.estimate_note")}
            </footer>
        </div>
    )
}
