import { useQueryClient } from "@tanstack/react-query"
import {
    ArrowLeft,
    ChevronDown,
    Bell,
    BellOff,
    CalendarDays,
    ChartColumn,
    Compass,
    Download,
    FolderSearch,
    HardDrive,
    Home,
    ListChecks,
    ListVideo,
    Magnet,
    Plug,
    Puzzle,
    RefreshCw,
    Rss,
    Search,
    Server,
    Settings as SettingsIcon,
    Settings2,
    Unplug,
    UserRound,
    WifiOff,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { api, desktop } from "@/lib/api"
import { useMediaQuery, usePersisted } from "@/lib/hooks"
import { resultSummary, useCollection, useDownloads, useLetterboxd, useStatus } from "@/lib/queries"
import { notificationsMutedStore, torrentCountStore, useStore } from "@/lib/store"
import { holidayStore, useClassic } from "@/lib/themes"
import { tv } from "@/lib/tv"
import { cn, img } from "@/lib/utils"
import { HolidayOnLogo } from "./HolidayBadge"
import { LetterboxdDialog, LetterboxdMark } from "./LetterboxdDialog"
import { ThemesMenu } from "./ThemesMenu"
import { PluginTrays } from "./plugins/PluginTrays"
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, Tooltip } from "./ui"
import { toast as sonner } from "sonner"
import { toast } from "@/lib/toast"

const TILE =
    "M59.86 59.86C59.27 60.45 58.63 60.95 57.87 61.4C57.12 61.85 56.31 62.23 55.33 62.56C54.36 62.88 53.35 63.15 52.01 63.36C50.66 63.58 50.57 63.74 47.24 63.84C43.9 63.95 37.08 64 32 64C26.92 64 20.1 63.95 16.76 63.84C13.43 63.74 13.34 63.58 11.99 63.36C10.65 63.15 9.64 62.88 8.67 62.56C7.69 62.23 6.88 61.85 6.13 61.4C5.37 60.95 4.73 60.45 4.14 59.86C3.55 59.27 3.05 58.63 2.6 57.87C2.15 57.12 1.77 56.31 1.44 55.33C1.12 54.36 0.85 53.35 0.64 52.01C0.42 50.66 0.26 50.57 0.16 47.24C0.05 43.9 0 37.08 0 32C0 26.92 0.05 20.1 0.16 16.76C0.26 13.43 0.42 13.34 0.64 11.99C0.85 10.65 1.12 9.64 1.44 8.67C1.77 7.69 2.15 6.88 2.6 6.13C3.05 5.37 3.55 4.73 4.14 4.14C4.73 3.55 5.37 3.05 6.13 2.6C6.88 2.15 7.69 1.77 8.67 1.44C9.64 1.12 10.65 0.85 11.99 0.64C13.34 0.42 13.43 0.26 16.76 0.16C20.1 0.05 26.92 0 32 0C37.08 0 43.9 0.05 47.24 0.16C50.57 0.26 50.66 0.42 52.01 0.64C53.35 0.85 54.36 1.12 55.33 1.44C56.31 1.77 57.12 2.15 57.87 2.6C58.63 3.05 59.27 3.55 59.86 4.14C60.45 4.73 60.95 5.37 61.4 6.13C61.85 6.88 62.23 7.69 62.56 8.67C62.88 9.64 63.15 10.65 63.36 11.99C63.58 13.34 63.74 13.43 63.84 16.76C63.95 20.1 64 26.92 64 32C64 37.08 63.95 43.9 63.84 47.24C63.74 50.57 63.58 50.66 63.36 52.01C63.15 53.35 62.88 54.36 62.56 55.33C62.23 56.31 61.85 57.12 61.4 57.87C60.95 58.63 60.45 59.27 59.86 59.86Z"

// Moviko's logo: a clapperboard with a play button, on a dark tile. The
// same drawing is the app icon (packaging/icons/moviko.svg) and the favicon
// (public/moviko.svg).
export function MovikoLogo({ className }: { className?: string }) {
    const classic = useClassic()
    // In this look, drawn in the theme's ink: the tile an outline, the
    // clapperboard solid, its stripes and play button the page's color.
    if (!classic)
        return (
            <svg viewBox="0 0 64 64" className={cn("text-fg", className)} aria-hidden>
                <path d={TILE} transform="translate(1.2 1.2) scale(0.9625)" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path d="M17 27 H47 A4 4 0 0 1 51 31 V47 A4 4 0 0 1 47 51 H17 A4 4 0 0 1 13 47 V31 A4 4 0 0 1 17 27 Z" fill="currentColor" />
                <path d="M12.52 18.11 L47.06 9.50 L48.42 14.93 L13.87 23.55 Z" fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
                <path d="M18.00 16.13 L21.88 15.16 L20.62 22.48 L16.74 23.45 Z M25.76 14.19 L29.65 13.22 L28.38 20.55 L24.50 21.51 Z M33.53 12.26 L37.41 11.29 L36.14 18.61 L32.26 19.58 Z M41.29 10.32 L45.17 9.35 L43.90 16.68 L40.02 17.64 Z" fill="var(--bg)" />
                <path d="M29.70 34.90 L37.60 39.00 L29.70 43.10 Z" fill="var(--bg)" stroke="var(--bg)" strokeWidth="2.4" strokeLinejoin="round" />
            </svg>
        )
    return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden>
            <path d={TILE} fill="#141416" />
            <path d="M17 27 H47 A4 4 0 0 1 51 31 V47 A4 4 0 0 1 47 51 H17 A4 4 0 0 1 13 47 V31 A4 4 0 0 1 17 27 Z" fill="#ececee" />
            <path d="M12.52 18.11 L47.06 9.50 L48.42 14.93 L13.87 23.55 Z" fill="#ececee" stroke="#ececee" strokeWidth="2.4" strokeLinejoin="round" />
            <path d="M18.00 16.13 L21.88 15.16 L20.62 22.48 L16.74 23.45 Z M25.76 14.19 L29.65 13.22 L28.38 20.55 L24.50 21.51 Z M33.53 12.26 L37.41 11.29 L36.14 18.61 L32.26 19.58 Z M41.29 10.32 L45.17 9.35 L43.90 16.68 L40.02 17.64 Z" fill="#141416" />
            <path d="M29.70 34.90 L37.60 39.00 L29.70 43.10 Z" fill="#7c6cf2" stroke="#7c6cf2" strokeWidth="2.4" strokeLinejoin="round" />
        </svg>
    )
}

// "moviko", in rounded strokes like the logo's curves; in the text color.
export function MovikoWordmark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 159 40" className={className} aria-hidden>
            <g fill="none" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 36V14m0 7a7 7 0 0 1 14 0v15m0-15a7 7 0 0 1 14 0v15M71.5 14l10 22 10-22M100.5 14v22M109.5 3.5V36M124 14 109.5 26.5M115.5 21.3 124.5 36" />
                <circle cx="51.5" cy="25" r="11" />
                <circle cx="144.5" cy="25" r="11" />
            </g>
            <circle cx="100.5" cy="4.5" r="3.6" fill="currentColor" />
        </svg>
    )
}

type Item = NavItem

export type NavItem = { to: string; label: string; icon: React.ReactNode; badge?: number; hint?: string; match?: (p: string) => boolean }

// The app's pages, in their groups, with the counts shown on them (active
// downloads, unmatched files): the sidebar's, and the phone's tab bar's.
export function useNavGroups(): { label: string; items: NavItem[] }[] {
    const { data: status } = useStatus()
    const { data: coll } = useCollection()
    const { data: downloads } = useDownloads()
    const torrentCount = useStore(torrentCountStore)
    const settings = status?.settings
    const activeDownloads = (downloads ?? []).filter(d => ["queued", "resolving", "downloading"].includes(d.status)).length

    // Three groups: finding and watching (what's used most, first), getting
    // it, and looking after the library.
    return [
        {
            label: "Watch",
            items: [
                { to: "/", label: "Home", icon: <Home />, match: p => p === "/" },
                { to: "/search", label: "Search", icon: <Search />, hint: "Ctrl K" },
                { to: "/discover", label: "Discover", icon: <Compass /> },
                { to: "/local", label: "Local library", icon: <HardDrive /> },
                { to: "/lists", label: "My list", icon: <ListChecks /> },
                { to: "/schedule", label: "Calendar", icon: <CalendarDays /> },
            ],
        },
        {
            label: "Downloads",
            items: [
                { to: "/downloads", label: "Downloads", icon: <Download />, badge: activeDownloads },
                { to: "/torrent-list", label: "Torrents", icon: <Magnet />, badge: settings?.torrent.showActiveCount ? torrentCount : 0 },
                { to: "/auto-downloader", label: "Auto downloader", icon: <Rss /> },
            ],
        },
        {
            label: "Manage",
            items: [
                { to: "/library", label: "Library tools", icon: <FolderSearch />, badge: coll?.unmatchedCount ?? 0 },
                { to: "/extensions", label: "Providers & extensions", icon: <Puzzle /> },
                { to: "/playlists", label: "Playlists", icon: <ListVideo /> },
                { to: "/stats", label: "Stats", icon: <ChartColumn /> },
            ],
        },
    ]
}

// Back to the page before, when there's one in Moviko. Not on a TV: its
// remote has Back. In the desktop app, Alt+Left (⌘[ on a Mac) and a
// mouse's back button too, which a browser does by itself.
function BackButton({ wide }: { wide: boolean }) {
    const location = useLocation()
    const navigate = useNavigate()
    // React Router counts the pages it went through (history.state.idx).
    const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
    useEffect(() => {
        if (!canGoBack || !desktop()) return
        const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
        const onKey = (e: KeyboardEvent) => {
            const mac = navigator.platform.startsWith("Mac")
            if (((!mac && e.altKey && e.key === "ArrowLeft") || (mac && e.metaKey && e.key === "[")) && !typing(e.target)) {
                e.preventDefault()
                navigate(-1)
            }
        }
        const onMouse = (e: MouseEvent) => {
            if (e.button === 3) {
                e.preventDefault()
                navigate(-1)
            }
        }
        window.addEventListener("keydown", onKey)
        window.addEventListener("mouseup", onMouse)
        return () => {
            window.removeEventListener("keydown", onKey)
            window.removeEventListener("mouseup", onMouse)
        }
    }, [canGoBack, navigate, location.key])
    if (!canGoBack) return null
    return (
        <Tooltip content="Back" side={wide ? "bottom" : "right"}>
            <button
                onClick={() => navigate(-1)}
                aria-label="Back"
                className="focus-ring grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-fg"
            >
                <ArrowLeft className="size-[18px] stroke-[1.75]" />
            </button>
        </Tooltip>
    )
}

// Labels from 1024px wide; narrower, only the icons, named by tooltips.
const WIDE = "(min-width: 1024px)"
const FADE = "linear-gradient(to bottom, #000 calc(100% - 36px), transparent)"

export function Sidebar() {
    const { data: status } = useStatus()
    const [letterboxdOpen, setLetterboxdOpen] = useState(false)
    const letterboxd = useLetterboxd()
    const location = useLocation()
    const navigate = useNavigate()
    const wide = useMediaQuery(WIDE)
    // The Classic look (before 3.0): rounded links, the open page a pill in
    // the accent. This look: words, the open page in brackets.
    const classic = useClassic()
    // Links that don't fit scroll: they fade out at the bottom while there
    // are more below, so they aren't taken for all of them.
    const navRef = useRef<HTMLElement>(null)
    const [more, setMore] = useState(false)
    useEffect(() => {
        const nav = navRef.current
        if (!nav) return
        const check = () => setMore(nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2)
        const ro = new ResizeObserver(check)
        ro.observe(nav)
        for (const group of nav.children) ro.observe(group)
        nav.addEventListener("scroll", check, { passive: true })
        check()
        return () => {
            ro.disconnect()
            nav.removeEventListener("scroll", check)
        }
    }, [])
    const holiday = useStore(holidayStore)

    const groups = useNavGroups()
    // What's used every day stays in sight; the rest folds under More (on
    // the TV too, whose screen is short; not in the icons-only sidebar).
    const all = groups.flatMap(g => g.items)
    const daily = new Set([...(groups[0]?.items ?? []).map(i => i.to), "/downloads"])
    const main = all.filter(i => daily.has(i.to))
    const rest = all.filter(i => !daily.has(i.to))
    const isActive = (it: Item) => (it.match ? it.match(location.pathname) : location.pathname.startsWith(it.to))
    const [moreOpen, setMoreOpen] = usePersisted("moviko-sidebar-more", false)
    const folds = wide
    const showRest = !folds || moreOpen || rest.some(isActive)
    const restBadge = rest.reduce((n, i) => n + (i.badge ?? 0), 0)
    const viewer = status?.letterboxd

    const sync = () => {
        const id = toast.loading("Syncing with Letterboxd…")
        letterboxd.sync.mutate(undefined, {
            onSuccess: r => toast.success(`Synced with Letterboxd: ${resultSummary(r)}`, { id }),
            onError: () => toast.dismiss(id),
        })
    }
    // Offline mode (Settings › Devices & network): this computer's, so not
    // switched from another device.
    const qc = useQueryClient()
    const offline = !!status?.settings.server.offline
    const canOffline = !!status && status.client !== "lan"
    const toggleOffline = async () => {
        const s = status?.settings
        if (!s) return
        try {
            await api.put("/api/settings", { ...s, server: { ...s.server, offline: !offline } })
            toast.success(offline ? "Back online" : "Offline mode: Moviko uses what it has here")
        } catch (e: any) {
            toast.error(e.message)
        }
        qc.invalidateQueries()
    }
    const offlineItem = canOffline && (
        <DropdownItem icon={<WifiOff />} checked={offline} onSelect={toggleOffline}>
            Offline mode
        </DropdownItem>
    )
    const disconnect = () => letterboxd.disconnect.mutate(undefined, { onSuccess: () => toast.success("Disconnected from Letterboxd") })

    const link = (it: Item) => {
        const active = isActive(it)
        const badge = it.badge && it.badge > 0 ? (it.badge > 99 ? "99+" : String(it.badge)) : ""
        const el = (
            <NavLink
                key={it.to}
                to={it.to}
                // Icons only (narrow): named for screen readers too.
                aria-label={wide ? undefined : it.label}
                className={cn(
                    "focus-ring relative flex h-9 shrink-0 items-center font-medium transition-colors duration-200 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:transition-colors [&>svg]:duration-200",
                    classic ? "rounded-full font-display text-[13.5px] [&>svg]:stroke-[1.75]" : "label rounded-sm [&>svg]:stroke-[1.5]",
                    wide ? (classic ? "gap-3 px-3" : "gap-1.5 px-3") : "w-10 justify-center",
                    // The page it's on: tinted with the accent.
                    classic
                        ? active
                            ? "bg-[color-mix(in_oklab,var(--brand)_20%,transparent)] text-fg [&>svg]:text-brand-strong" // the open page: a pill in the accent
                            : "text-muted hover:bg-white/[0.045] hover:text-fg"
                        : active
                          ? cn("text-fg", !wide && "shadow-[inset_0_-1px_0_var(--text)]") // the open page: in brackets (index.css's nav-label); a line under the icon alone
                          : "text-muted hover:text-fg",
                )}
            >
                {it.icon}
                {wide && <span className={cn("truncate", !classic && "nav-label")}>{it.label}</span>}
                {badge &&
                    (wide ? (
                        <span className={cn("ml-auto px-1.5 text-fg/80 tabular-nums", classic ? "rounded-md bg-white/[0.08] text-[11px] leading-[18px]" : "border border-line-strong text-[10px] leading-4")}>{badge}</span>
                    ) : (
                        <span className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-[color:var(--on-brand)] tabular-nums">{badge}</span>
                    ))}
            </NavLink>
        )
        return wide ? (
            el
        ) : (
            <Tooltip key={it.to} content={it.label} side="right">
                {el}
            </Tooltip>
        )
    }

    return (
        <aside className={cn("relative z-40 flex h-full shrink-0 flex-col py-3", wide ? "w-52 px-2.5" : "w-16 items-center px-2")}>
            <div className={cn("mb-4 flex", wide ? "items-center gap-1" : "flex-col items-center gap-1")}>
                {/* Home is the first link below: the remote skips this one. */}
                <button
                    onClick={() => navigate("/")}
                    data-tv-skip-nav
                    className={cn("focus-ring flex h-10 items-center gap-2.5 rounded-md", wide ? "min-w-0 flex-1 px-2" : "justify-center")}
                    aria-label="Moviko home"
                >
                    <span className="relative shrink-0">
                        <MovikoLogo className="size-8" />
                        <HolidayOnLogo holiday={holiday} />
                    </span>
                    {wide && (classic ? <MovikoWordmark className="h-[18px] w-auto text-fg" /> : <span className="font-display text-[19px] leading-none font-semibold tracking-tight">Moviko</span>)}
                </button>
                {!tv && <BackButton wide={wide} />}
            </div>

            <nav
                ref={navRef}
                className={cn("no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto", !wide && "items-center")}
                style={more ? { maskImage: FADE, WebkitMaskImage: FADE } : undefined}
            >
                <div className={cn("flex flex-col gap-0.5", !wide && "items-center")}>{main.map(link)}</div>
                {/* The pages used less: under More, closed until asked for (open on one of them). */}
                {rest.length > 0 && (
                    <div className={cn("flex flex-col gap-0.5 border-t pt-3", !wide && "items-center", classic ? "border-line/70" : "border-line")}>
                        {folds && (
                            <button
                                onClick={() => setMoreOpen(!moreOpen)}
                                aria-expanded={showRest}
                                className={cn(
                                    "focus-ring flex h-9 shrink-0 items-center text-muted transition-colors duration-200 hover:text-fg",
                                    classic ? "gap-3 rounded-[10px] px-2.5 text-[13.5px] font-medium hover:bg-white/[0.045]" : "label gap-1.5 rounded-sm px-3",
                                )}
                            >
                                <ChevronDown className={cn("size-[18px] shrink-0 transition-transform duration-200", classic ? "stroke-[1.75]" : "stroke-[1.5]", !showRest && "-rotate-90")} />
                                <span className={cn("truncate", !classic && "nav-label")}>More</span>
                                {!showRest && restBadge > 0 && (
                                    <span className={cn("ml-auto px-1.5 text-fg/80 tabular-nums", classic ? "rounded-md bg-white/[0.08] text-[11px] leading-[18px]" : "border border-line-strong text-[10px] leading-4")}>
                                        {restBadge > 99 ? "99+" : restBadge}
                                    </span>
                                )}
                            </button>
                        )}
                        {showRest && rest.map(link)}
                    </div>
                )}
            </nav>

            <div className={cn("flex flex-col gap-0.5 border-t border-line pt-3", !wide && "items-center")}>
                {status?.server && <ServerLink port={status.server.dashboardPort} wide={wide} />}
                {/* Themes, notifications and Settings: three icons in a row (one
                    under the other in the icons-only sidebar), named by tooltips.
                    The TV keeps its labelled rows. */}
                {tv ? (
                    <>
                        <ThemesMenu wide={wide} />
                        <PluginTrays />
                        <div className={cn("flex gap-0.5", wide ? "items-center" : "flex-col-reverse items-center")}>
                            <div className={wide ? "min-w-0 flex-1" : undefined}>{link({ to: "/settings", label: "Settings", icon: <SettingsIcon /> })}</div>
                            <MuteButton side={wide ? "top" : "right"} />
                        </div>
                    </>
                ) : (
                    <>
                        <PluginTrays />
                        <div className={cn("flex items-center gap-1", wide ? "justify-center gap-2" : "flex-col")}>
                            <ThemesMenu wide={false} />
                            <MuteButton side={wide ? "top" : "right"} />
                            <Tooltip content="Settings" side={wide ? "top" : "right"}>
                                <NavLink
                                    to="/settings"
                                    aria-label="Settings"
                                    className={cn(
                                        "focus-ring grid size-9 shrink-0 place-items-center transition-colors duration-200 [&>svg]:size-[18px]",
                                        classic ? "rounded-[10px] [&>svg]:stroke-[1.75]" : "rounded-sm [&>svg]:stroke-[1.5]",
                                        location.pathname.startsWith("/settings")
                                            ? classic
                                                ? "bg-white/[0.08] text-brand-strong"
                                                : "text-fg shadow-[inset_0_-1px_0_var(--text)]"
                                            : cn("text-muted hover:text-fg", classic && "hover:bg-white/[0.045]"),
                                    )}
                                >
                                    <SettingsIcon />
                                </NavLink>
                            </Tooltip>
                        </div>
                    </>
                )}
                <Dropdown>
                    <DropdownTrigger asChild>
                        <button
                            className={cn(
                                "focus-ring flex items-center gap-2.5 text-left transition-colors",
                                "mt-1.5 data-[state=open]:bg-white/[0.07]",
                                classic ? "rounded-[10px]" : "rounded-sm",
                                wide ? (classic ? "h-12 bg-white/[0.03] px-2 hover:bg-white/[0.055]" : "h-12 px-2 hover:bg-white/[0.05]") : "size-10 justify-center hover:bg-white/[0.05]",
                            )}
                            aria-label="Letterboxd account"
                        >
                            {viewer?.avatar?.large ? (
                                <img src={img(viewer.avatar.large)} alt="" className={cn("size-8 shrink-0 rounded-full object-cover", classic && "ring-1 ring-white/10")} />
                            ) : (
                                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-muted", classic ? "bg-surface-3 ring-1 ring-white/10" : "border border-line-strong")}>
                                    {viewer ? <LetterboxdMark className="w-4" /> : <UserRound className="size-4" />}
                                </span>
                            )}
                            {wide && (
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[13px] font-medium">{viewer ? viewer.name : "Letterboxd"}</span>
                                    <span className="block truncate text-[11px] text-subtle">{offline ? "Offline" : viewer ? "Letterboxd" : "Connect to sync"}</span>
                                </span>
                            )}
                        </button>
                    </DropdownTrigger>
                    <DropdownContent align="start" side="top" className="w-56">
                        <DropdownLabel>{viewer ? `${viewer.name} on Letterboxd` : "Letterboxd isn't connected"}</DropdownLabel>
                        {viewer ? (
                            <>
                                {/* A TV has no browser to open it in. */}
                                {viewer.letterboxd && !tv && (
                                    <DropdownItem icon={<UserRound />} onSelect={() => window.open(viewer.letterboxd, "_blank", "noopener")}>
                                        Letterboxd profile
                                    </DropdownItem>
                                )}
                                <DropdownItem icon={<RefreshCw />} disabled={letterboxd.sync.isPending} onSelect={sync}>
                                    Sync now
                                </DropdownItem>
                                <DropdownItem icon={<Settings2 />} onSelect={() => navigate("/settings?tab=letterboxd")}>
                                    Import & export
                                </DropdownItem>
                                {offlineItem}
                                {/* The account is managed on the computer Moviko runs on. */}
                                {status?.client !== "lan" && (
                                    <>
                                        <DropdownSeparator />
                                        <DropdownItem icon={<Unplug />} danger onSelect={disconnect}>
                                            Disconnect
                                        </DropdownItem>
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                <DropdownItem icon={<Plug />} onSelect={() => setLetterboxdOpen(true)}>
                                    Connect Letterboxd
                                </DropdownItem>
                                {offlineItem}
                            </>
                        )}
                    </DropdownContent>
                </Dropdown>
            </div>
            <LetterboxdDialog open={letterboxdOpen} onOpenChange={setLetterboxdOpen} />
        </aside>
    )
}

// Mutes notifications (toasts), all but errors (lib/toast.ts), or turns them
// back on.
function MuteButton({ side }: { side: "top" | "right" }) {
    const classic = useClassic()
    const muted = useStore(notificationsMutedStore)
    const label = muted ? "Unmute notifications" : "Mute notifications"
    const toggle = () => {
        if (!muted) sonner.dismiss() // what's on screen goes too
        notificationsMutedStore.set(!muted)
        // Shown past the mute: it says what just happened.
        sonner.message(muted ? "Notifications on" : "Notifications muted. Errors still show.", { duration: 2500 })
    }
    return (
        <Tooltip content={label} side={side}>
            <button
                onClick={toggle}
                aria-label={label}
                aria-pressed={muted}
                className={cn(
                    "focus-ring grid size-9 shrink-0 place-items-center rounded-md transition-colors [&>svg]:size-[18px]",
                    classic ? "hover:bg-white/[0.04] [&>svg]:stroke-[1.75]" : "[&>svg]:stroke-[1.5]",
                    muted ? "text-amber-300" : "text-muted hover:text-fg",
                )}
            >
                {muted ? <BellOff /> : <Bell />}
            </button>
        </Tooltip>
    )
}

// On a mediaserver (its movies side): back to its dashboard, where its anime
// side is too.
function ServerLink({ port, wide }: { port: number; wide: boolean }) {
    const classic = useClassic()
    const href = `${window.location.protocol}//${window.location.hostname}:${port}/`
    const el = (
        <a
            href={href}
            aria-label={wide ? undefined : "mediaserver dashboard"}
            className={cn(
                "focus-ring flex h-9 shrink-0 items-center font-medium text-muted transition-colors hover:text-fg [&>svg]:size-[18px] [&>svg]:shrink-0",
                classic ? "rounded-lg text-[13.5px] hover:bg-white/[0.045] [&>svg]:stroke-[1.75]" : "label rounded-sm [&>svg]:stroke-[1.5]",
                wide ? (classic ? "gap-3 px-2.5" : "gap-1.5 px-3") : "w-10 justify-center",
            )}
        >
            <Server />
            {wide && <span className={cn("truncate", !classic && "nav-label")}>mediaserver</span>}
        </a>
    )
    return wide ? (
        el
    ) : (
        <Tooltip content="mediaserver dashboard" side="right">
            {el}
        </Tooltip>
    )
}
