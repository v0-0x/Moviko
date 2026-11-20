import Hls from "hls.js"
import { ChevronDown, ChevronUp, Star, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { LiveChannel, LiveNow, LivePlay } from "@/lib/livetv"
import { openExternal } from "@/lib/play"
import { cn, img } from "@/lib/utils"
import { IconButton, Spinner } from "./ui"

// How long a channel has to start before the next way is tried.
const START_TIMEOUT = 25_000

type Try = { play: LivePlay; mode: "hls" | "convert" }

const clock = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

// Live TV's player: a channel over the whole window. An HLS stream plays as
// it is (through the server's proxy, which sends the headers the channel
// wants); when that fails, and for any other kind of stream, the server
// converts it. A channel that doesn't play either way is tried from the
// other lists that have it, and then counted as not working. Up and Down
// (or the arrows on screen) change channel, Escape closes.
export function LivePlayer({
    channel,
    guide,
    onClose,
    onStep,
    onFavourite,
}: {
    channel: LiveChannel
    guide?: LiveNow
    onClose: () => void
    // The channel before (-1) or after (1) in the list shown.
    onStep: (dir: number) => void
    onFavourite: (on: boolean) => void
}) {
    const video = useRef<HTMLVideoElement>(null)
    const stage = useRef<HTMLDivElement>(null)
    const [attempt, setAttempt] = useState<Try | null>(null)
    const [error, setError] = useState("")
    const [started, setStarted] = useState(false)
    const [bar, setBar] = useState(true)
    // The backups still to try, and what to say when none plays.
    const left = useRef<string[]>([])
    // The channel open now: an answer for the one before is dropped.
    const current = useRef(channel.key)
    current.current = channel.key

    // The channel asked for: where it plays from.
    useEffect(() => {
        let gone = false
        setAttempt(null)
        setError("")
        setStarted(false)
        left.current = []
        api.post<LivePlay>("/api/livetv/play", { key: channel.key })
            .then(p => {
                if (gone) return
                if (p.action === "external") {
                    // A YouTube or Twitch page: the browser's.
                    if (p.url) openExternal(p.url)
                    onClose()
                    return
                }
                left.current = (p.backups ?? []).map(b => b.key)
                setAttempt({ play: p, mode: p.hls ? "hls" : "convert" })
            })
            .catch((e: Error) => !gone && setError(e.message))
        return () => {
            gone = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channel.key])

    // One way of playing it; a failure moves on to the next.
    useEffect(() => {
        const v = video.current
        if (!attempt || !v) return
        const { play, mode } = attempt
        let over = false
        let hls: Hls | null = null
        const key = channel.key
        const giveUp = (why: string) => {
            api.post("/api/livetv/report", { key, ok: false, why }).catch(() => {})
            setError(`${channel.name} isn't playing right now. The channel may be off the air, or only available in its own country.`)
        }
        // The same channel from another list, while there is one.
        const tryNext = (why: string) => {
            if (current.current !== key) return
            const next = left.current.shift()
            if (!next) return giveUp(why)
            api.post<LivePlay>("/api/livetv/play", { key: next })
                .then(p => {
                    if (current.current !== key) return
                    if (p.action === "play") setAttempt({ play: p, mode: p.hls ? "hls" : "convert" })
                    else tryNext(why)
                })
                .catch(() => tryNext(why))
        }
        const fail = (why: string) => {
            if (over) return
            over = true
            if (mode === "hls" && play.convert) setAttempt({ play, mode: "convert" })
            else tryNext(why)
        }
        const timer = setTimeout(() => fail("didn't start"), START_TIMEOUT)
        const onPlaying = () => {
            clearTimeout(timer)
            setStarted(true)
            api.post("/api/livetv/report", { key: play.key, ok: true }).catch(() => {})
        }
        const onError = () => fail("didn't play")
        v.addEventListener("playing", onPlaying)
        v.addEventListener("error", onError)
        if (mode === "hls" && play.hls) {
            if (Hls.isSupported()) {
                hls = new Hls({ maxBufferLength: 30, maxBufferSize: 30 * 1000 * 1000, backBufferLength: 30, manifestLoadingTimeOut: 12_000, liveSyncDurationCount: 3 })
                let recoveries = 0
                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (!data.fatal) return
                    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoveries++ < 2) {
                        hls?.recoverMediaError()
                        return
                    }
                    fail(data.details || "didn't play")
                })
                hls.loadSource(play.hls)
                hls.attachMedia(v)
            } else {
                // Safari plays HLS itself.
                v.src = play.hls
            }
        } else if (play.convert) {
            v.src = `${play.convert}&start=0`
        } else {
            fail("nothing to play")
        }
        v.play().catch(() => {})
        return () => {
            over = true
            clearTimeout(timer)
            v.removeEventListener("playing", onPlaying)
            v.removeEventListener("error", onError)
            hls?.destroy()
            v.removeAttribute("src")
            v.load()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt])

    // The bar hides while it plays, and comes back with the pointer or a key.
    useEffect(() => {
        if (!bar || !started || error) return
        const t = setTimeout(() => setBar(false), 4000)
        return () => clearTimeout(t)
    }, [bar, started, error])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            setBar(true)
            switch (e.key) {
                case "Escape":
                case "Backspace":
                case "BrowserBack":
                    if (document.fullscreenElement) return
                    e.preventDefault()
                    onClose()
                    break
                case "ArrowUp":
                case "PageUp":
                case "ChannelUp":
                    e.preventDefault()
                    onStep(-1)
                    break
                case "ArrowDown":
                case "PageDown":
                case "ChannelDown":
                    e.preventDefault()
                    onStep(1)
                    break
                case "f":
                    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
                    else stage.current?.requestFullscreen().catch(() => {})
                    break
                case "m":
                    if (video.current) video.current.muted = !video.current.muted
                    break
            }
        }
        window.addEventListener("keydown", onKey, true)
        return () => window.removeEventListener("keydown", onKey, true)
    }, [onClose, onStep])

    const playing = attempt?.play
    const backup = playing && playing.key !== channel.key
    return (
        <div ref={stage} data-player-overlay className="on-dark fixed inset-0 z-[80] bg-black fade-in" onPointerMove={() => setBar(true)}>
            <video ref={video} className="size-full bg-black" controls={started} autoPlay playsInline />
            {!started && !error && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <div className="flex flex-col items-center gap-3 text-white/80">
                        <Spinner />
                        <p className="text-sm">{attempt?.mode === "convert" && attempt.play.hls ? "Trying another way…" : backup ? `Trying ${playing?.source}…` : `Opening ${channel.name}…`}</p>
                    </div>
                </div>
            )}
            {error && (
                <div className="absolute inset-0 grid place-items-center px-6">
                    <div className="max-w-md text-center">
                        <p className="text-lg font-medium text-white">{error}</p>
                        <div className="mt-5 flex justify-center gap-2">
                            <button className="word label focus-ring h-9 px-3.5 text-white/80 hover:text-white" onClick={() => onStep(1)} data-tv-autofocus>
                                Next channel
                            </button>
                            <button className="word label focus-ring h-9 px-3.5 text-white/80 hover:text-white" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className={cn("absolute inset-x-0 top-0 flex items-start gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pt-3 pb-10 transition-opacity duration-300", bar || !started || error ? "opacity-100" : "pointer-events-none opacity-0")}>
                {channel.logo && <img src={img(channel.logo)} alt="" className="mt-0.5 size-10 shrink-0 rounded-sm bg-white/5 object-contain" />}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-white">{channel.name}</p>
                    <p className="truncate text-[13px] text-white/70">
                        {guide?.now ? `${guide.now.title} · until ${clock(guide.now.stop)}` : (channel.group ?? "").split(";").join(" · ")}
                        {guide?.next && <span className="text-white/45">{` · then ${guide.next.title}`}</span>}
                        {backup && <span className="text-white/45">{` · from ${playing?.source}`}</span>}
                    </p>
                </div>
                <IconButton label="Channel before" size="sm" onClick={() => onStep(-1)}>
                    <ChevronUp className="size-4" />
                </IconButton>
                <IconButton label="Next channel" size="sm" onClick={() => onStep(1)}>
                    <ChevronDown className="size-4" />
                </IconButton>
                <IconButton label={channel.favourite ? "Remove from favourites" : "Add to favourites"} aria-pressed={!!channel.favourite} size="sm" onClick={() => onFavourite(!channel.favourite)}>
                    <Star className={cn("size-4", channel.favourite && "fill-current")} />
                </IconButton>
                <IconButton label="Close" size="sm" onClick={onClose}>
                    <X className="size-4" />
                </IconButton>
            </div>
        </div>
    )
}
