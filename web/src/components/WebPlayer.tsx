import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Check, ExternalLink } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { api, desktop } from "@/lib/api"
import { formatKey, isShow } from "@/lib/ids"
import { openExternal } from "@/lib/play"
import { useEntry } from "@/lib/queries"
import { useStore } from "@/lib/store"
import { toast } from "@/lib/toast"
import { safeUrl, title } from "@/lib/utils"
import { webPlayerStore, type WebPlayerRequest } from "@/lib/webPlayer"

// A web player: a streaming site's own player page (VidSrc, Vidfast…),
// over the app, under a bar with Back, Mark as watched and Open in browser.
//
// In the desktop app the page gets a view of its own, placed over this
// one's stage (desktop/main.js, "Web players"): kept apart from Moviko, with
// no popups, and the app says how far its video is, so the position, the
// list and Continue watching follow as with Moviko's player. In a browser
// and on a TV it's a frame, which Moviko can't see into: marking the movie
// or episode watched is the button's job.
export function WebPlayerOverlay() {
    const req = useStore(webPlayerStore)
    if (!req) return null
    return <WebPlayer key={req.url} req={req} />
}

function WebPlayer({ req }: { req: WebPlayerRequest }) {
    const d = desktop()
    const native = !!d?.openWebPlayer
    const stage = useRef<HTMLDivElement>(null)
    const qc = useQueryClient()
    const { data: entry } = useEntry(req.mediaId)
    const name = title(entry?.media)
    const label = name && isShow(req.mediaId) ? `${name} · ${formatKey(req.episode)}` : name
    const [watched, setWatched] = useState(false)
    const sent = useRef({ ended: false, any: false })
    const url = safeUrl(req.url)

    const close = useCallback(() => webPlayerStore.set(null), [])

    const report = useCallback(
        (p: { position: number; duration: number; paused: boolean; ended: boolean }) =>
            api
                .post("/api/playback/progress", {
                    mediaId: req.mediaId,
                    episode: req.episode,
                    position: p.position,
                    duration: p.duration,
                    source: "stream",
                    ended: p.ended,
                    title: label,
                    paused: p.paused,
                    provider: req.provider,
                })
                .catch(() => {}),
        [req, label],
    )

    // The desktop app's view, over the stage, wherever the stage goes.
    useLayoutEffect(() => {
        const el = stage.current
        if (!native || !d || !el || !url) return
        const bounds = () => {
            const r = el.getBoundingClientRect()
            return { x: r.left, y: r.top, width: r.width, height: r.height }
        }
        let open = true
        d.openWebPlayer!(url, bounds()).then(ok => {
            if (!ok && open) {
                toast.error("This page couldn't be opened here")
                close()
            }
        })
        const move = () => d.moveWebPlayer?.(bounds())
        const ro = new ResizeObserver(move)
        ro.observe(el)
        window.addEventListener("resize", move)
        const off = d.onWebPlayerEscape?.(close)
        return () => {
            open = false
            ro.disconnect()
            window.removeEventListener("resize", move)
            off?.()
            d.closeWebPlayer?.()
        }
    }, [native, d, url, close])

    // How far the video is, every few seconds, and once more on the way out.
    useEffect(() => {
        if (!native || !d?.webPlayerProgress) return
        const look = async () => {
            const p = await d.webPlayerProgress!().catch(() => null)
            if (!p || !(p.duration > 0) || sent.current.ended) return
            // Ads and previews are short: a video is the movie or episode
            // from a few minutes up.
            if (p.duration < 180 || (p.position < 3 && !p.ended)) return
            sent.current.any = true
            if (p.ended) sent.current.ended = true
            await report(p)
        }
        const t = window.setInterval(look, 5000)
        return () => {
            window.clearInterval(t)
            void look()
        }
    }, [native, d, report])

    // What changed while it played shows once it's closed.
    useEffect(
        () => () => {
            if (sent.current.any) setTimeout(() => qc.invalidateQueries(), 500)
        },
        [qc],
    )

    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || document.fullscreenElement) return
            e.stopPropagation()
            close()
        }
        window.addEventListener("keydown", key, true)
        return () => window.removeEventListener("keydown", key, true)
    }, [close])

    const markWatched = async () => {
        sent.current = { ended: true, any: true }
        await report({ position: 1, duration: 1, paused: true, ended: true })
        setWatched(true)
        toast.success("Marked as watched")
    }

    return (
        <div data-player-overlay className="on-dark fixed inset-0 z-[80] flex flex-col bg-black fade-in">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3 text-sm text-white">
                <button type="button" autoFocus onClick={close} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium hover:bg-white/10 focus-visible:bg-white/15">
                    <ArrowLeft className="size-4" />
                    Back
                </button>
                <p className="min-w-0 flex-1 truncate px-1 text-white/70">
                    {label && <span className="font-medium text-white">{label}</span>}
                    {label && " · "}
                    {req.providerName}
                </p>
                <button
                    type="button"
                    disabled={watched}
                    onClick={markWatched}
                    title={native ? "Moviko follows the video by itself; this marks it watched now" : "Moviko can't see into this page: mark it watched here"}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium hover:bg-white/10 focus-visible:bg-white/15 disabled:opacity-50"
                >
                    <Check className="size-4" />
                    {watched ? "Watched" : "Mark as watched"}
                </button>
                <button type="button" onClick={() => openExternal(req.url)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium hover:bg-white/10 focus-visible:bg-white/15">
                    <ExternalLink className="size-4" />
                    Open in browser
                </button>
            </div>
            <div ref={stage} className="min-h-0 flex-1 bg-black">
                {!native && url && (
                    <iframe
                        src={url}
                        title={req.providerName}
                        className="size-full border-0"
                        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                        allowFullScreen
                        referrerPolicy="origin"
                    />
                )}
                {!url && <p className="p-6 text-sm text-white/70">This source has no page to open.</p>}
            </div>
        </div>
    )
}
