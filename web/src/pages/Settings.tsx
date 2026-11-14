import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AppWindow,
    ArrowDown,
    ArrowUp,
    Bell,
    ChevronDown,
    ChevronRight,
    Clapperboard,
    Copy,
    Cpu,
    DatabaseBackup,
    FileClock,
    Gamepad2,
    HardDrive,
    KeyRound,
    LibraryBig,
    Magnet,
    MonitorPlay,
    MonitorSmartphone,
    Moon,
    Network,
    Palette,
    Plus,
    Puzzle,
    RefreshCw,
    Save,
    Search as SearchIcon,
    Terminal,
    Trash2,
    Upload,
    Tv,
    Wifi,
    X,
} from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "@/lib/toast"
import { LetterboxdMark } from "@/components/LetterboxdDialog"
import { Badge, Button, EmptyState, Input, Select, Switch } from "@/components/ui"
import { UpdateBanner, versionName } from "@/components/UpdateBanner"
import { whatsNewStore } from "@/components/WhatsNew"
import { api, desktop, type DesktopPrefs } from "@/lib/api"
import { refreshSharing, useCheckUpdate, useSaveSettings, useSharing, useStatus, useUpdateStatus } from "@/lib/queries"
import { exampleMpvPath, installHint, installSource, platformName } from "@/lib/platform"
import type { Tool } from "@/lib/platform"
import { canInstallPrograms, useInstallPrograms, useWatchSetup } from "@/lib/programs"
import { useStore } from "@/lib/store"
import { useFadeBelow } from "@/lib/hooks"
import { activeHoliday, colorTheme, HOLIDAYS, ownAccent, themePreviewStore, themesOf, useClassic } from "@/lib/themes"
import { setSubStyle, SUB_BACKGROUNDS, SUB_POSITIONS, SUB_SIZES, subStyleStore, subStyleVars, type SubStyle } from "@/lib/subtitles"
import { systemNotifications } from "@/lib/alerts"
import { androidApp, setTvWidth, TV_WIDTHS, tv, tvWidth } from "@/lib/tv"
import { UploadDialog } from "@/components/UploadDialog"
import type { Settings, SharingPeer, Status } from "@/lib/types"
import { cn, compareVersions, copyText, formatBytes, HOME_SECTIONS, relativeTime } from "@/lib/utils"
import { LetterboxdSection } from "./settings/Letterboxd"
import { MetadataSection } from "./settings/Metadata"
import { NETWORK_PASSWORD_ID, networkIsOpen, OpenNetworkNotice } from "./settings/OpenNetworkNotice"
import {
    Collapsible,
    Detect,
    fold,
    Group,
    LinesInput,
    Locked,
    matches,
    Password,
    PathInput,
    Row,
    SearchContext,
    type SectionProps,
    Shown,
    Stack,
} from "./settings/parts"
import { ProvidersSection, TorrentSourcesSection } from "./settings/Sources"

type SectionId =
    | "appearance"
    | "notifications"
    | "updates"
    | "metadata"
    | "letterboxd"
    | "playback"
    | "mpv"
    | "transcode"
    | "discord"
    | "library"
    | "providers"
    | "torrents"
    | "extensions"
    | "devices"
    | "network"
    | "desktop"
    | "backup"
    | "logs"

type NavItem = {
    id: SectionId
    label: string
    icon: React.ReactNode
    // What it's for, under its title.
    description: string
    // Other words people look for it by (search).
    keywords?: string
}

// The settings' parts, each about one thing (search lists them one by one);
// PAGES puts them on ten pages.
const NAV: { title: string; items: NavItem[] }[] = [
    {
        title: "General",
        items: [
            { id: "appearance", label: "Appearance", icon: <Palette />, description: "Themes, colors and what's shown", keywords: "ui theme color dark classic look spoilers card size home rows" },
            { id: "notifications", label: "Notifications", icon: <Bell />, description: "Alerts for new episodes and finished downloads", keywords: "alerts notify" },
            { id: "updates", label: "Updates & about", icon: <RefreshCw />, description: "Version, updates and beta", keywords: "version beta about what's new" },
        ],
    },
    {
        title: "Accounts",
        items: [
            { id: "metadata", label: "Metadata (TMDB)", icon: <KeyRound />, description: "Where movie and show details come from", keywords: "tmdb api key language region" },
            { id: "letterboxd", label: "Letterboxd", icon: <LetterboxdMark className="w-4" />, description: "Your diary, watchlist and ratings on Letterboxd", keywords: "account login sync import export diary watchlist" },
        ],
    },
    {
        title: "Watching",
        items: [
            { id: "playback", label: "Playback", icon: <Clapperboard />, description: "Player, progress, audio and subtitles", keywords: "player video subtitles audio skip intro credits" },
            { id: "mpv", label: "mpv player", icon: <MonitorPlay />, description: "Play in mpv, a desktop media player", keywords: "external player" },
            { id: "transcode", label: "Video conversion", icon: <Cpu />, description: "Convert video the in-app player can't play", keywords: "transcoding direct play ffmpeg hardware gpu hevc" },
            { id: "discord", label: "Discord", icon: <Gamepad2 />, description: "Show what you're watching on Discord", keywords: "rich presence status" },
        ],
    },
    {
        title: "Movies & shows",
        items: [
            { id: "library", label: "Local library", icon: <LibraryBig />, description: "Your movie and show folders and how they're scanned", keywords: "folder files scan matching" },
            { id: "providers", label: "Streaming providers", icon: <Tv />, description: "Where movies and episodes stream from, and downloads", keywords: "online stream sites stremio addons media servers jellyfin plex downloads" },
            { id: "torrents", label: "Torrents", icon: <Magnet />, description: "Torrent sources, client and auto downloader", keywords: "qbittorrent transmission torznab jackett prowlarr rss provider client" },
            { id: "extensions", label: "Extensions", icon: <Puzzle />, description: "Where extensions come from", keywords: "marketplace plugins" },
        ],
    },
    {
        title: "Devices & network",
        items: [
            { id: "devices", label: "Other devices", icon: <MonitorSmartphone />, description: "Share, wake and sync with your other computers and TVs", keywords: "share sharing tv fire library wake sync" },
            { id: "network", label: "Network & web UI", icon: <Wifi />, description: "Use Moviko from a browser or other devices at home", keywords: "lan port password browser web" },
        ],
    },
    {
        title: "This computer",
        items: [
            { id: "desktop", label: "Desktop app & programs", icon: <AppWindow />, description: "Window, tray, start at login and installed programs", keywords: "tray background startup login ffmpeg yt-dlp mpv install" },
            { id: "backup", label: "Backup & data", icon: <DatabaseBackup />, description: "Back up, restore and the data folder", keywords: "restore export import folder" },
            { id: "logs", label: "Logs & cache", icon: <FileClock />, description: "Server logs and cached data", keywords: "debug clear" },
        ],
    },
]

// Not in Moviko's Android app (a TV's): it has no mpv, Discord, ffmpeg or
// desktop window.
const NOT_ON_ANDROID: SectionId[] = ["mpv", "transcode", "discord", "desktop"]
const SHOWN_NAV = androidApp ? NAV.map(g => ({ ...g, items: g.items.filter(i => !NOT_ON_ANDROID.includes(i.id)) })) : NAV
const NAV_ITEMS = SHOWN_NAV.flatMap(g => g.items)

// The pages, each with the parts on it (a page is named by its first part).
const PAGES: (NavItem & { parts: SectionId[] })[] = (
    [
        { id: "appearance", label: "Appearance", icon: <Palette />, description: "Themes, colors and what's shown", parts: ["appearance"] },
        { id: "metadata", label: "Accounts", icon: <KeyRound />, description: "TMDB, Letterboxd and notifications", parts: ["metadata", "letterboxd", "notifications"] },
        { id: "playback", label: "Playback", icon: <Clapperboard />, description: "Player, progress, audio, subtitles and Discord", parts: ["playback", "discord"] },
        { id: "mpv", label: "Players & conversion", icon: <MonitorPlay />, description: "The mpv player and video conversion", parts: ["mpv", "transcode"] },
        { id: "library", label: "Library", icon: <LibraryBig />, description: "Your movie and show folders and how they're scanned", parts: ["library"] },
        { id: "providers", label: "Streaming & torrents", icon: <Tv />, description: "Streaming providers, downloads, torrent sources and client", parts: ["providers", "torrents"] },
        { id: "extensions", label: "Extensions", icon: <Puzzle />, description: "Where extensions come from", parts: ["extensions"] },
        { id: "devices", label: "Devices & network", icon: <MonitorSmartphone />, description: "Your other computers and TVs, and browser access", parts: ["devices", "network"] },
        { id: "desktop", label: "App & data", icon: <AppWindow />, description: "Window, programs, backups, logs and cache", parts: ["desktop", "backup", "logs"] },
        { id: "updates", label: "Updates & about", icon: <RefreshCw />, description: "Version, updates and beta", parts: ["updates"] },
    ] satisfies (NavItem & { parts: SectionId[] })[]
)
    .map(pg => ({ ...pg, parts: pg.parts.filter(id => NAV_ITEMS.some(i => i.id === id)) }))
    .filter(pg => pg.parts.length > 0)
// Parts whose first group has their name already.
const TITLED: SectionId[] = ["mpv", "extensions"]
const pageOf = (part: string) => PAGES.find(pg => pg.parts.includes(part as SectionId))

// Older links (and the names before the regrouping).
const ALIASES: Record<string, SectionId> = {
    app: "desktop",
    ui: "appearance",
    about: "updates",
    tmdb: "metadata",
    anicli: "providers",
    streaming: "providers",
    "online-streaming": "providers",
    downloads: "providers",
    "torrent-provider": "torrents",
    "torrent-sources": "torrents",
    "torrent-client": "torrents",
}
const SECTION_IDS: string[] = NAV_ITEMS.map(i => i.id)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Puts the fields edited in draft (compared with base, the server copy the
// draft was made from) on top of a newer server copy.
// The UI settings the Themes menu changes (saved at once).
const THEME_KEYS = ["colorTheme", "accentColor", "seasonal", "seasonalEffects", "classicLook"] as const

function rebase(draft: Settings, base: Settings, server: Settings): Settings {
    const out: Record<string, any> = structuredClone(server)
    const old: Record<string, any> = base
    for (const [key, value] of Object.entries(draft) as [string, any][]) {
        if (same(value, old[key])) continue
        if (value && typeof value === "object" && !Array.isArray(value) && old[key] && typeof old[key] === "object") {
            for (const field of Object.keys(value)) if (!same(value[field], old[key][field])) out[key] = { ...out[key], [field]: value[field] }
        } else out[key] = value
    }
    return out as Settings
}

export default function SettingsPage() {
    const { data: status } = useStatus()
    const [params, setParams] = useSearchParams()
    const raw = params.get("tab") ?? "appearance"
    const tab = ALIASES[raw] ?? raw
    // Unknown tabs (old links, typos) open the first page instead of
    // nothing; a part's name opens its page, at that part.
    const current = pageOf(tab) ?? PAGES[0]
    const section = current.id
    const part = SECTION_IDS.includes(tab) && tab !== current.parts[0] ? tab : ""
    const save = useSaveSettings()
    const server = status?.settings
    // draft is what the form edits, base the server copy it was made from.
    const [draft, setDraft] = useState<Settings | null>(null)
    // Search settings: every section's that match, at once.
    const [query, setQuery] = useState("")
    // The sections' list, when it's taller than the window.
    const asideFade = useFadeBelow()
    const [base, setBase] = useState<Settings | null>(null)
    const reset = (s: Settings) => {
        setDraft(structuredClone(s))
        setBase(s)
    }
    useEffect(() => {
        if (!server) return
        if (!draft || !base) {
            reset(server)
            return
        }
        if (same(server, base)) return
        // Saved somewhere else meanwhile (another tab or device, the auto
        // downloader switch…): follow it, keeping what was edited here so a
        // save doesn't put the old values back.
        const next = rebase(draft, base, server)
        // A theme picked in the sidebar's Themes menu is the latest choice:
        // it's shown here too, over one being tried here.
        const picked: string[] = THEME_KEYS.filter(k => !same(server.ui[k], base.ui[k]))
        for (const k of picked) (next.ui as Record<string, unknown>)[k] = (server.ui as Record<string, unknown>)[k]
        const onlyThemes = (Object.keys(server) as (keyof Settings)[]).every(k =>
            k === "ui" ? (Object.keys(server.ui) as (keyof Settings["ui"])[]).every(f => picked.includes(f) || same(server.ui[f], base.ui[f])) : same(server[k], base[k]),
        )
        if (!onlyThemes && !same(draft, base) && !same(next, draft)) toast.info("Settings changed elsewhere. Your unsaved changes were kept.")
        setDraft(next)
        setBase(server)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [server])
    const dirty = useMemo(() => !!draft && !!server && !same(draft, server), [draft, server])
    const classic = useClassic()

    // Preview the colors and holiday theme being edited; App shows the saved
    // ones again once the preview ends (Discard, leaving the page).
    const ui = draft?.ui
    useEffect(() => {
        themePreviewStore.set(ui ? { colorTheme: ui.colorTheme, accentColor: ui.accentColor, seasonal: ui.seasonal, seasonalEffects: ui.seasonalEffects, classicLook: ui.classicLook } : null)
    }, [ui?.colorTheme, ui?.accentColor, ui?.seasonal, ui?.seasonalEffects, ui?.classicLook])
    useEffect(() => () => themePreviewStore.set(null), [])

    // The open-network notice's button: to Settings › Network, its password
    // field focused once the section is there.
    const [focusPassword, setFocusPassword] = useState(false)
    useEffect(() => {
        if (!focusPassword || !current.parts.includes("network")) return
        setFocusPassword(false)
        const field = document.getElementById(NETWORK_PASSWORD_ID)
        field?.scrollIntoView({ block: "center", behavior: "smooth" })
        field?.focus({ preventScroll: true })
    }, [focusPassword, section])

    useEffect(() => {
        if (part && !focusPassword) document.getElementById(`settings-${part}`)?.scrollIntoView({ block: "start" })
        // Once the settings are here (the page is empty until then).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [part, section, !draft])

    if (!draft || !status) return null
    const set = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => setDraft(d => (d ? { ...d, [k]: { ...d[k], ...v } } : d))

    const onSave = () => {
        const oldPort = status.settings.server.port
        save.mutate(draft, {
            onSuccess: s => {
                reset(s)
                // The server moves to the new port; follow it.
                if (s.server.port !== oldPort && ["127.0.0.1", "localhost"].includes(location.hostname)) {
                    setTimeout(() => {
                        location.href = `${location.protocol}//${location.hostname}:${s.server.port}${location.pathname}${location.search}`
                    }, 1500)
                }
            },
        })
    }

    const sectionProps = { draft, set }
    const searching = query.trim() !== ""
    const navButton = (it: NavItem) => (
        <button
            key={it.id}
            onClick={() => {
                setQuery("")
                setParams({ tab: it.id }, { replace: true })
            }}
            aria-current={!searching && section === it.id ? "page" : undefined}
            // A TV's remote starts on the open section.
            data-tv-autofocus={(!searching && section === it.id) || undefined}
            className={cn(
                "focus-ring flex h-8 items-center gap-2.5 px-2.5 text-[13.5px] font-medium transition-colors [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:stroke-[1.75]",
                classic
                    ? cn("rounded-lg", !searching && section === it.id ? "bg-white/[0.07] text-fg [&>svg]:text-brand-strong" : "text-muted hover:bg-white/[0.05] hover:text-fg")
                    : // The open one: bright, a line at its left edge.
                      cn("rounded-none", !searching && section === it.id ? "text-fg shadow-[inset_1px_0_0_var(--text)]" : "text-muted shadow-[inset_1px_0_0_var(--line)] hover:text-fg"),
            )}
        >
            {it.icon}
            <span className="truncate">{it.label}</span>
        </button>
    )

    return (
        <div className="flex min-h-full flex-col gap-6 px-6 pt-8 pb-24 md:flex-row md:gap-8 md:px-8 lg:gap-12 xl:px-10">
            <aside ref={asideFade.ref} style={asideFade.style} className="no-scrollbar w-full shrink-0 md:sticky md:top-8 md:max-h-[calc(100vh-5rem)] md:w-56 md:self-start md:overflow-y-auto">
                <h1 className="mb-4 px-2.5 text-[1.75rem] font-semibold tracking-tight">Settings</h1>
                <div className="mb-4 md:px-0.5">
                    <Input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === "Escape" && setQuery("")}
                        placeholder="Search settings"
                        aria-label="Search settings"
                        icon={<SearchIcon className="size-4" />}
                    />
                </div>
                {/* A short list on a phone: the sections in a menu. */}
                <div className="md:hidden">
                    <Select
                        value={section}
                        onChange={v => {
                            setQuery("")
                            setParams({ tab: v }, { replace: true })
                        }}
                        options={PAGES.map(it => ({ value: it.id, label: it.label }))}
                    />
                </div>
                <nav aria-label="Settings sections" className="hidden flex-col gap-0.5 md:flex">
                    {PAGES.map(navButton)}
                </nav>
                <p className="mt-6 hidden px-2.5 text-xs text-subtle md:block">
                    Moviko {status.version} · {platformName(status.platform)} · {status.client === "desktop" ? "Desktop" : status.client === "lan" ? "LAN" : "Web UI"}
                </p>
            </aside>

            <section className="min-w-0 flex-1 lg:max-w-4xl">
                {networkIsOpen(status) && (
                    <OpenNetworkNotice
                        onSetPassword={() => {
                            setQuery("")
                            setParams({ tab: "network" }, { replace: true })
                            setFocusPassword(true)
                        }}
                    />
                )}
                {status.client === "lan" && (
                    <p className="mb-6 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-muted lg:mt-[3.75rem]">
                        Dimmed settings can only be changed on the computer Moviko runs on.
                    </p>
                )}
                {searching ? (
                    <SearchResults query={query} sectionProps={sectionProps} onOpen={id => {
                        setQuery("")
                        setParams({ tab: id }, { replace: true })
                    }} />
                ) : (
                    <>
                        <div className={cn("mb-7", status.client !== "lan" && !networkIsOpen(status) && "lg:mt-[3.75rem]")}>
                            <h2 className="text-xl font-semibold tracking-tight">{current.label}</h2>
                            <p className="mt-1 text-sm text-muted">{current.description}</p>
                        </div>
                        <div key={section} className="flex flex-col gap-8 fade-in">
                            {current.parts.map((id, i) => {
                                const it = NAV_ITEMS.find(n => n.id === id)!
                                return (
                                    <div key={id} id={`settings-${id}`} className={cn("flex scroll-mt-6 flex-col gap-8", i > 0 && "border-t border-line pt-8")}>
                                        {/* A page of several parts names each. */}
                                        {current.parts.length > 1 && it.label !== current.label && !TITLED.includes(id) && (
                                            <div>
                                                <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight [&>svg]:size-4 [&>svg]:text-muted">
                                                    {it.icon}
                                                    {it.label}
                                                </h3>
                                                <p className="mt-1 text-sm text-muted">{it.description}</p>
                                            </div>
                                        )}
                                        <SectionBody id={id} {...sectionProps} />
                                    </div>
                                )
                            })}
                        </div>
                    </>
                )}
                {/* Only while there's something to save. */}
                {dirty && (
                    <div className="sticky bottom-6 z-20 mt-8 flex justify-center">
                        <div className="flex items-center gap-2 rounded-full border border-line-strong bg-surface-2 py-1.5 pr-1.5 pl-4 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.7)] pop-in">
                            <span className="mr-1 text-[13px] text-muted">Unsaved changes</span>
                            <Button variant="ghost" size="sm" className="rounded-full" onClick={() => reset(status.settings)}>
                                Discard
                            </Button>
                            <Button variant="primary" size="sm" className="rounded-full" icon={<Save className="size-4" />} loading={save.isPending} onClick={onSave}>
                                Save
                            </Button>
                        </div>
                    </div>
                )}
            </section>
        </div>
    )
}

// One section's settings.
function SectionBody({ id, draft, set }: { id: SectionId } & SectionProps) {
    const props = { draft, set }
    switch (id) {
        case "appearance":
            return <UISection {...props} />
        case "notifications":
            return <AlertsGroup {...props} />
        case "updates":
            return <AboutSection />
        case "metadata":
            return <MetadataSection {...props} />
        case "letterboxd":
            return <LetterboxdSection {...props} />
        case "playback":
            return <PlaybackSection {...props} />
        case "mpv":
            return <MpvSection {...props} />
        case "transcode":
            return <TranscodeSection {...props} />
        case "discord":
            return <DiscordSection {...props} />
        case "library":
            return <LibrarySection {...props} />
        case "providers":
            return <ProvidersSection {...props} />
        case "torrents":
            return (
                <>
                    <TorrentSourcesSection {...props} />
                    <TorrentClientSection {...props} />
                </>
            )
        case "extensions":
            return <ExtensionsSection {...props} />
        case "devices":
            return <DevicesSection {...props} />
        case "network":
            return <NetworkSection {...props} />
        case "desktop":
            return <DesktopSection />
        case "backup":
            return <BackupSection />
        case "logs":
            return <LogsSection />
    }
}

// ---------------------------------------------------------------------------
// Search: every section at once, showing only the settings that match (by
// their names and descriptions, their group's or their section's). What's
// found can be changed right there. The settings decide for themselves
// whether they match (settings/parts.tsx).

// A section's matching settings; when none match but the section itself
// does (its name, what it's for, its other words), all of it.
function SearchSection({ item, words, sectionProps, onOpen }: { item: NavItem; words: string[]; sectionProps: SectionProps; onOpen: (id: SectionId) => void }) {
    const ref = useRef<HTMLDivElement>(null)
    const [all, setAll] = useState(false)
    useLayoutEffect(() => {
        if (!all && !ref.current?.querySelector("[data-setting]") && matches(words, item.label, item.description, item.keywords)) setAll(true)
    }, [all, words, item])
    return (
        <SearchContext.Provider value={{ words, all }}>
            <div ref={ref} data-section className="flex flex-col gap-6">
                <button onClick={() => onOpen(item.id)} className="focus-ring group -mb-2 flex items-center gap-2 self-start rounded-md text-left">
                    <span className="text-muted [&>svg]:size-4">{item.icon}</span>
                    <span className="text-lg font-semibold tracking-tight group-hover:underline">{item.label}</span>
                    <ChevronRight className="size-4 text-subtle" />
                </button>
                <SectionBody id={item.id} {...sectionProps} />
            </div>
        </SearchContext.Provider>
    )
}

function SearchResults({ query, sectionProps, onOpen }: { query: string; sectionProps: SectionProps; onOpen: (id: SectionId) => void }) {
    const words = useMemo(() => fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean), [query])
    const ref = useRef<HTMLDivElement>(null)
    const [found, setFound] = useState(true)
    // Found anything? Counted once drawn (each setting decides for itself).
    useLayoutEffect(() => {
        setFound(!!ref.current?.querySelector("[data-setting]"))
    })
    const sections = NAV_ITEMS.filter(it => it.id !== "logs")
    return (
        <div ref={ref} className="settings-search flex flex-col gap-10 lg:mt-[3.75rem]">
            {sections.map(it => (
                <SearchSection key={it.id + query} item={it} words={words} sectionProps={sectionProps} onOpen={onOpen} />
            ))}
            {!found && <EmptyState icon={<SearchIcon />} title="No settings match">Try other words, or pick a section on the left.</EmptyState>}
        </div>
    )
}

// Where other devices open Moviko, once LAN access is saved.
function LanAddresses({ status }: { status?: Status }) {
    const urls = status?.lanUrls ?? []
    if (!status?.settings.server.allowLan) return <p className="px-4 py-3.5 text-sm text-muted">Save to see the address for your other devices.</p>
    if (!urls.length)
        return (
            <p className="px-4 py-3.5 text-sm text-amber-200/80">
                Can't find this computer's network address. Check that it's connected to your router.
            </p>
        )
    return (
        <div className="px-4 py-3.5">
            <p className="text-sm font-medium">On your other devices, open</p>
            <div className="mt-2 flex flex-wrap gap-2">
                {urls.map(u => (
                    <button
                        key={u}
                        onClick={() => copyText(u).then(ok => (ok ? toast.success("Address copied") : toast.error("Couldn't copy it")))}
                        className="flex items-center gap-2 rounded-lg bg-black/30 px-3 py-1.5 font-mono text-sm transition hover:bg-black/45"
                        title="Copy"
                    >
                        {u}
                        <Copy className="size-3.5 text-subtle" />
                    </button>
                ))}
            </div>
            <p className="mt-2 text-xs text-subtle">
                Use http://, not https://. On a Mac, Chrome, Brave and Firefox need Local Network access in System Settings › Privacy & Security. A VPN on this
                computer can block other devices.
            </p>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Sections

function NetworkSection({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    const isDesktop = status?.client === "desktop"
    const lan = status?.client === "lan"
    return (
        <>
            <Group title="Web UI & network" description="Connections from the internet are always refused.">
                {/* The Android app is its own window, on its own port. */}
                {!androidApp && (
                    <Row
                        label="Web UI"
                        help={
                            status?.webUiForced
                                ? "Always on without the desktop app."
                                : `Open Moviko in a browser at http://127.0.0.1:${draft.server.port}`
                        }
                    >
                        <Switch checked={draft.server.webUi || !!status?.webUiForced} disabled={!isDesktop || status?.webUiForced} onChange={v => set("server", { webUi: v })} />
                    </Row>
                )}
                <Row label="Allow devices on my network" help="Open Moviko in a browser on phones, TVs and other computers at home.">
                    <Switch checked={draft.server.allowLan} disabled={lan} onChange={v => set("server", { allowLan: v, webUi: v ? true : draft.server.webUi })} />
                </Row>
                {draft.server.allowLan && <LanAddresses status={status} />}
                {draft.server.allowLan && (
                    <Stack label="Network password" help={lan ? "Set on the computer Moviko runs on." : "Asked once per device. Not needed on this computer."}>
                        <Password
                            id={NETWORK_PASSWORD_ID}
                            value={draft.server.password}
                            disabled={lan}
                            onChange={v => set("server", { password: v })}
                            placeholder={lan ? "" : "Leave empty for no password (anyone on your network can use Moviko)"}
                        />
                    </Stack>
                )}
                {!androidApp && (
                    <Row label="Port" help="Changes when you save. No restart needed.">
                        <Input type="number" className="w-28" disabled={lan} value={draft.server.port} onChange={e => set("server", { port: Number(e.target.value) })} />
                    </Row>
                )}
                {!isDesktop && !lan && !androidApp && <p className="px-4 py-3 text-xs text-amber-200/80">The Web UI can only be turned off from the desktop app.</p>}
            </Group>
        </>
    )
}

function ExtensionsSection({ draft, set }: SectionProps) {
    const navigate = useNavigate()
    return (
        <>
            <Group title="Extensions">
                <Locked>
                    <Stack label="Marketplace URL" help="Any compatible extension index works.">
                        <Input value={draft.extensions.marketplaceUrl} onChange={e => set("extensions", { marketplaceUrl: e.target.value })} />
                    </Stack>
                </Locked>
            </Group>
            <Group title="Your extensions">
                <Row label="Installed extensions and the marketplace" help="Manage them on the Extensions page." keywords="install update marketplace">
                    <Button size="sm" variant="ghost" onClick={() => navigate("/extensions")}>
                        Open
                    </Button>
                </Row>
            </Group>
        </>
    )
}

function DesktopSection() {
    return (
        <>
            <DesktopGroup />
            <ProgramsGroup />
        </>
    )
}

function BackupSection() {
    const { data: status } = useStatus()
    const lan = status?.client === "lan"
    return (
        <>
            {!androidApp && !lan && <BackupGroup />}
            <Group title="Data">
                <Row label="Data folder" help="Database, cache and extension storage" wide>
                    <code title={status?.dataDir} className="min-w-0 rounded-lg bg-black/30 px-2 py-1 text-xs break-all">
                        {status?.dataDir}
                    </code>
                </Row>
            </Group>
        </>
    )
}

// The desktop app's own settings, saved by the app itself (they take effect
// at once, no Save).
function DesktopGroup() {
    const bridge = desktop()
    const [prefs, setPrefs] = useState<DesktopPrefs | null>(null)
    useEffect(() => {
        bridge?.getPrefs?.().then(setPrefs, () => {})
    }, [bridge])
    if (!bridge?.setPref || !prefs) return null
    const mac = bridge.platform === "darwin"
    const win = bridge.platform === "win32"
    const change = async (name: keyof DesktopPrefs, value: boolean) => {
        setPrefs({ ...prefs, [name]: value })
        const res = await bridge.setPref!(name, value).catch(() => false as const)
        if (res !== true) {
            setPrefs(prefs)
            toast.error(typeof res === "object" && res.error ? res.error : "Couldn't change that setting")
        }
    }
    return (
        <Group title="Desktop app">
            <Row
                label="Keep running when the window is closed"
                help={
                    mac
                        ? "Streaming, downloads and the auto downloader keep going. Quit with Cmd+Q."
                        : "Streaming, downloads and the auto downloader keep going. Open or quit from the tray icon."
                }
            >
                <Switch checked={prefs.keepRunning} onChange={v => change("keepRunning", v)} />
            </Row>
            {prefs.startAtLogin !== undefined && (
                <Row
                    label="Start Moviko when you log in"
                    help={
                        prefs.keepRunning
                            ? "Starts in the background, without its window."
                            : "Opens its window. Turn on the setting above to start in the background."
                    }
                >
                    <Switch checked={prefs.startAtLogin} onChange={v => change("startAtLogin", v)} />
                </Row>
            )}
            {/* Linux doesn't tell apps the computer was locked. */}
            {(mac || win) && (
                <Row
                    label="Free memory while the computer is locked"
                    help="After 5 minutes locked. Not while a video or Settings is open."
                >
                    <Switch checked={prefs.freeWhenLocked} onChange={v => change("freeWhenLocked", v)} />
                </Row>
            )}
            {bridge.quit && (
                <Row label="Quit Moviko" help="Also stops streaming to other devices, downloads and sharing.">
                    <Button size="sm" variant="ghost" onClick={() => bridge.quit!()}>
                        Quit
                    </Button>
                </Row>
            )}
        </Group>
    )
}

function InstallProgramsButton() {
    const { data: status } = useStatus()
    const install = useInstallPrograms(status)
    return (
        <Button variant="primary" size="sm" loading={install.isPending} disabled={status?.setupRunning} onClick={() => install.mutate()}>
            {status?.setupRunning ? "Installing…" : "Install"}
        </Button>
    )
}

// What Moviko found of the programs it uses and, on Windows and macOS, the
// setup that installs them.
function ProgramsGroup() {
    const { data: status } = useStatus()
    useWatchSetup(status)
    const f = status?.features
    const programs: { tool: Tool; ok?: boolean; use: string }[] = [
        { tool: "ffmpeg", ok: f?.ffmpeg, use: "In-app player and downloads of streams" },
        { tool: "mpv", ok: f?.mpv, use: "External player" },
        { tool: "yt-dlp", ok: f?.ytDlp, use: "Faster, more reliable downloads of streams" },
    ]
    return (
        <Group title="Programs">
            {programs.map(p => (
                <Row
                    key={p.tool}
                    label={p.tool}
                    help={
                        p.ok || canInstallPrograms(status) ? (
                            p.use
                        ) : (
                            <>
                                {p.use}. {installSource(status?.platform)} <code className="rounded bg-black/30 px-1.5 py-0.5">{installHint(status?.platform, p.tool)}</code>
                            </>
                        )
                    }
                >
                    <Badge tone={p.ok ? "green" : "red"}>{p.ok ? "Found" : "Not found"}</Badge>
                </Row>
            ))}
            {canInstallPrograms(status) && (
                <Row
                    label="Install missing programs"
                    help={
                        status?.platform === "darwin"
                            ? "Opens a Terminal window. No Homebrew or password needed. mpv needs Homebrew."
                            : "Opens a PowerShell window and installs with Scoop. No administrator rights needed."
                    }
                >
                    <InstallProgramsButton />
                </Row>
            )}
        </Group>
    )
}

// Backup: the data of this Moviko as one file (settings, watch history, list,
// choices, matches made by hand, auto downloader rules, extensions), and
// back. A restore merges, then Moviko starts again.
function BackupGroup() {
    const classic = useClassic()
    const [logins, setLogins] = useState(false)
    const [restoring, setRestoring] = useState(false)
    const restore = async (file: File) => {
        let text: string
        let info: { moviko?: number; version?: string; createdAt?: number; computer?: string; logins?: boolean; history?: unknown[] }
        try {
            text = await file.text()
            info = JSON.parse(text)
        } catch {
            toast.error("That isn't a Moviko backup")
            return
        }
        if (!info?.moviko) {
            toast.error("That isn't a Moviko backup")
            return
        }
        const when = info.createdAt ? new Date(info.createdAt * 1000).toLocaleString() : "an unknown date"
        if (
            !confirm(
                `Restore the backup of ${info.computer || "a computer"} from ${when}?\n\n` +
                    "It's merged with what's here. Newer positions and list entries stay, and so do this computer's network and sharing settings. " +
                    "The current data is saved first in Moviko's data folder. Moviko restarts after.",
            )
        )
            return
        setRestoring(true)
        try {
            const res = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: text, credentials: "same-origin" })
            const sum = await res.json().catch(() => null)
            if (!res.ok) throw new Error(sum?.error || res.statusText)
            const parts = [sum.history && `${sum.history} positions`, sum.list && `${sum.list} list entries`, sum.extensions && `${sum.extensions} extensions`, sum.rules && `${sum.rules} auto downloader rules`].filter(Boolean)
            toast.success(`Restored${parts.length ? `: ${parts.join(", ")}` : ""}. Moviko is restarting…`, { duration: 15_000 })
            // Back once it answers again, with everything read afresh.
            await waitForRestart()
            location.reload()
        } catch (e: any) {
            toast.error(e.message)
            setRestoring(false)
        }
    }
    return (
        <Group title="Backup" description="Settings, watch history, list and diary, auto downloader rules, Stremio add-ons and extensions in one file.">
            <Row label="Include logins and passwords" help="TMDB key, Letterboxd login and torrent client passwords. Keep that backup private.">
                <Switch checked={logins} onChange={setLogins} />
            </Row>
            <Row label="Make a backup">
                <a href={`/api/backup?logins=${logins ? 1 : 0}`} download>
                    <Button size="sm">Download backup</Button>
                </a>
            </Row>
            <Row label="Restore a backup" help="Merged with what's here. Moviko restarts after.">
                <label>
                    <input type="file" accept=".json,application/json" className="sr-only" disabled={restoring} onChange={e => e.target.files?.[0] && restore(e.target.files[0])} />
                    <span className={cn("inline-flex h-8 cursor-pointer items-center px-3", classic ? "rounded-lg bg-white/[0.07] text-[13px] font-medium hover:bg-white/[0.12]" : "word label text-[10.5px] text-fg/85 transition-colors hover:text-fg", restoring && "pointer-events-none opacity-60")}>
                        {restoring ? "Restoring…" : "Choose a backup…"}
                    </span>
                </label>
            </Row>
        </Group>
    )
}

// waitForRestart waits for Moviko to go and answer again (a minute at most).
async function waitForRestart() {
    const answers = () =>
        fetch("/api/status", { cache: "no-store", credentials: "same-origin" })
            .then(r => r.ok)
            .catch(() => false)
    const until = Date.now() + 60_000
    let wentAway = false
    while (Date.now() < until) {
        await new Promise(r => setTimeout(r, 1000))
        const up = await answers()
        if (!up) wentAway = true
        else if (wentAway || Date.now() > until - 50_000) return
    }
}

// Alerts: an episode of a show being watched aired, a movie or episode is
// ready in the library. A toast, or a notification of the system when Moviko isn't in front
// (the desktop app's, also with its window closed; a browser's once allowed).
function AlertsGroup({ draft, set }: SectionProps) {
    const notify = draft.notify ?? { newEpisodes: true, downloads: true }
    const [permission, setPermission] = useState(systemNotifications)
    const desktopApp = !!desktop()
    return (
        <Group title="Alerts" description="The bell next to Settings mutes them.">
            <Row label="New episodes" help="For shows you're watching.">
                <Switch checked={notify.newEpisodes} onChange={v => set("notify", { ...notify, newEpisodes: v })} />
            </Row>
            <Row label="Ready to watch" help="When a download finishes or new movies or episodes reach your library.">
                <Switch checked={notify.downloads} onChange={v => set("notify", { ...notify, downloads: v })} />
            </Row>
            {!desktopApp && !androidApp && permission === "default" && (
                <Row label="Notifications of this browser" help="Show alerts when Moviko's tab is in the background.">
                    <Button size="sm" onClick={() => Notification.requestPermission().then(() => setPermission(systemNotifications()))}>
                        Allow
                    </Button>
                </Row>
            )}
            {!desktopApp && !androidApp && permission === "denied" && <p className="px-4 py-3 text-xs text-subtle">This browser blocks notifications. Allow them in the site's settings.</p>}
        </Group>
    )
}

// How the in-app player shows subtitles: this device's own choice (a TV
// across the room needs them bigger), applied at once.
function SubtitlesGroup() {
    const style = useStore(subStyleStore)
    return (
        <Group title="How subtitles look" description="In the in-app player, on this device. Adjust timing with z and x while playing.">
            <div className="px-4 py-4">
                <div className="relative flex h-28 items-end justify-center overflow-hidden rounded-lg bg-gradient-to-br from-sky-900 via-slate-700 to-amber-800 pb-3" aria-hidden>
                    <span
                        className="rounded px-1.5 font-semibold text-white"
                        style={{
                            fontSize: `${17 * (SUB_SIZES.find(o => o.value === style.size)?.scale ?? 1)}px`,
                            background: (subStyleVars(style) as Record<string, string>)["--sub-bg"],
                            textShadow: (subStyleVars(style) as Record<string, string>)["--sub-shadow"],
                            marginBottom: style.position === "raised" ? "1.75rem" : 0,
                        }}
                    >
                        This is how subtitles look.
                    </span>
                </div>
            </div>
            <Row label="Size">
                <Select className="w-40" value={style.size} onChange={v => setSubStyle({ size: v as SubStyle["size"] })} options={SUB_SIZES.map(o => ({ value: o.value, label: o.label }))} />
            </Row>
            <Row label="Background">
                <Select className="w-48" value={style.background} onChange={v => setSubStyle({ background: v as SubStyle["background"] })} options={SUB_BACKGROUNDS} />
            </Row>
            <Row label="Position" help="Raise them to clear a TV's edge or a video's own captions.">
                <Select className="w-40" value={style.position} onChange={v => setSubStyle({ position: v as SubStyle["position"] })} options={SUB_POSITIONS} />
            </Row>
        </Group>
    )
}

// How big everything is on the TV (this TV's own choice, see lib/tv.ts).
function TvSizeRow() {
    const [width, setWidth] = useState(tvWidth)
    return (
        <Row label="Size on the TV" help="Smaller fits more on the screen">
            <Select
                className="w-36"
                value={String(width)}
                onChange={v => {
                    setWidth(Number(v))
                    setTvWidth(Number(v))
                }}
                options={TV_WIDTHS.map(o => ({ value: String(o.value), label: o.label }))}
            />
        </Row>
    )
}

// The Classic look's, as they were.
const CLASSIC_ACCENTS = ["#7c6cf2", "#5b8cff", "#22c3a6", "#f2557a", "#f59e0b", "#e879f9", "#38bdf8", "#a3e635"]
// Not #7c6cf2: saved by every install as its default before 3.0, it stands
// for "the theme's own" (lib/themes.ts).
const ACCENTS = ["#8b7cf6", ...CLASSIC_ACCENTS.slice(1)]
const ACCENT_NAMES: Record<string, string> = {
    "#7c6cf2": "violet",
    "#8b7cf6": "violet",
    "#5b8cff": "blue",
    "#22c3a6": "teal",
    "#f2557a": "pink",
    "#f59e0b": "amber",
    "#e879f9": "orchid",
    "#38bdf8": "sky",
    "#a3e635": "lime",
}

function UISection({ draft, set }: SectionProps) {
    const seasonal = draft.ui.seasonal ?? "auto"
    // The one on now with these settings (or that would be, for the hint).
    const holiday = activeHoliday(seasonal)
    // The themes of the look being set, and the saved one as it draws it.
    const classicLook = !!draft.ui.classicLook
    const theme = colorTheme(draft.ui.colorTheme, classicLook)
    const own = ownAccent(draft.ui.accentColor, classicLook)
    return (
        <>
            <Group title="Theme">
                <Row label="Classic look" help="Moviko as it looked before 3.0: rounded panels and its own colors.">
                    <Switch checked={!!draft.ui.classicLook} onChange={v => set("ui", { classicLook: v })} />
                </Row>
                <Stack label="Colors">
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                        {themesOf(classicLook).map(t => {
                            const on = theme.id === t.id
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => set("ui", { colorTheme: t.id, accentColor: t.accent })}
                                    aria-pressed={on}
                                    className={cn(
                                        "focus-ring flex flex-col gap-2 rounded-lg border p-2 text-left transition",
                                        classicLook ? (on ? "border-white/70" : "border-line hover:border-white/25") : on ? "border-transparent outline-2 outline-offset-2 outline-fg" : "border-line-strong hover:border-white/45",
                                    )}
                                    style={{ background: t.palette.frame }}
                                >
                                    {/* The window in small: the sidebar, a page with panels, the accent. */}
                                    <span className="flex h-12 gap-1.5 overflow-hidden rounded-md" aria-hidden>
                                        <span className="flex w-4 flex-col gap-1 pt-1.5">
                                            <span className="h-1 rounded-full" style={{ background: t.accent }} />
                                            <span className="h-1 rounded-full" style={{ background: t.palette.s3 }} />
                                            <span className="h-1 rounded-full" style={{ background: t.palette.s3 }} />
                                        </span>
                                        <span className="flex flex-1 flex-col gap-1 rounded p-1.5" style={{ background: t.palette.bg }}>
                                            <span className="h-2 w-2/3 rounded-sm" style={{ background: t.palette.s3 }} />
                                            <span className="flex flex-1 gap-1">
                                                <span className="flex-1 rounded-sm" style={{ background: t.palette.s1 }} />
                                                <span className="flex-1 rounded-sm" style={{ background: t.palette.s2 }} />
                                                <span className="w-2 rounded-sm" style={{ background: t.accent }} />
                                            </span>
                                        </span>
                                    </span>
                                    <span className="px-0.5 text-[13px] font-medium" style={{ color: t.palette.text ?? "#ececee" }}>
                                        {t.name}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </Stack>
                <Stack label="Accent color" help={holiday ? `While the ${holiday.name} theme is on, its color is used instead.` : undefined}>
                    <div className="flex flex-wrap items-center gap-2.5">
                        {/* The theme's own ink (this look's themes have one each). */}
                        {!classicLook && (
                            <button
                                onClick={() => set("ui", { accentColor: theme.accent })}
                                className={cn("word label h-9 px-3 text-[10px] transition-colors", !own || own === theme.accent ? "text-fg" : "text-muted hover:text-fg")}
                                aria-pressed={!own || own === theme.accent}
                            >
                                Theme's own
                            </button>
                        )}
                        {(classicLook ? CLASSIC_ACCENTS : ACCENTS).map(c => (
                            <button
                                key={c}
                                onClick={() => set("ui", { accentColor: c })}
                                className={cn("size-9 rounded-full ring-2 ring-offset-2 ring-offset-[var(--surface-1)] transition", draft.ui.accentColor === c ? "ring-white" : "ring-transparent hover:ring-white/30")}
                                style={{ background: c }}
                                aria-label={`Accent ${ACCENT_NAMES[c] ?? c}`}
                                aria-pressed={draft.ui.accentColor === c}
                            />
                        ))}
                        <input
                            type="color"
                            value={draft.ui.accentColor}
                            onChange={e => set("ui", { accentColor: e.target.value })}
                            className="size-9 cursor-pointer rounded-full border border-line bg-transparent"
                            aria-label="Another color"
                        />
                    </div>
                </Stack>
                <Row
                    label="Holiday themes"
                    help={
                        seasonal === "auto"
                            ? `Each in its time: ${HOLIDAYS.map(h => `${h.name} ${h.when.replace(/^In /, "in ")}`).join(", ")}.${holiday ? ` ${holiday.name} is on now.` : ""}`
                            : seasonal === "off"
                              ? "No holiday colors, decorations or animations."
                              : `${holiday?.name ?? "It"}, whatever the date.`
                    }
                >
                    <Select
                        className="w-44"
                        value={seasonal}
                        onChange={v => set("ui", { seasonal: v })}
                        options={[{ value: "auto", label: "By the date" }, { value: "off", label: "Off" }, ...HOLIDAYS.map(h => ({ value: h.id, label: `Always ${h.name}` }))]}
                    />
                </Row>
                <Row label="Holiday animations" help={`${holiday ? holiday.effectName : "Snow, bats, hearts"} over the pages. Off with Reduce motion.`}>
                    <Switch checked={draft.ui.seasonalEffects ?? true} disabled={seasonal === "off"} onChange={v => set("ui", { seasonalEffects: v })} />
                </Row>
                <Row label="Card size">
                    <Select
                        className="w-36"
                        value={draft.ui.cardSize}
                        onChange={v => set("ui", { cardSize: v })}
                        options={[
                            { value: "sm", label: "Compact" },
                            { value: "md", label: "Comfortable" },
                            { value: "lg", label: "Large" },
                        ]}
                    />
                </Row>
                <Row label="Reduce motion" help="Turn off animations">
                    <Switch checked={draft.ui.reducedMotion} onChange={v => set("ui", { reducedMotion: v })} />
                </Row>
                {tv && androidApp && <TvSizeRow />}
            </Group>
            <HomeSectionsGroup draft={draft} set={set} />
            <Group title="Content">
                <Row label="Hide spoilers" help="Blur the stills and overviews of unwatched episodes">
                    <Switch checked={draft.ui.blurUnwatched} onChange={v => set("ui", { blurUnwatched: v })} />
                </Row>
                <Row label="Show adult content" help="Include 18+ entries in search and discover">
                    <Switch checked={draft.ui.showAdult} onChange={v => set("ui", { showAdult: v })} />
                </Row>
            </Group>
        </>
    )
}

// Which sections Home shows, in which order.
function HomeSectionsGroup({ draft, set }: SectionProps) {
    const on = draft.ui.homeSections ?? []
    const known = new Set(HOME_SECTIONS.map(s => s.id))
    // Shown ones in their order, then the hidden ones.
    const order = [...on.filter(id => known.has(id)), ...HOME_SECTIONS.map(s => s.id).filter(id => !on.includes(id))]
    const save = (ids: string[]) => set("ui", { homeSections: [...ids, ...on.filter(id => !known.has(id))] })
    const toggle = (id: string, v: boolean) => save(v ? order.filter(x => x === id || on.includes(x)) : on.filter(x => known.has(x) && x !== id))
    const move = (id: string, dir: -1 | 1) => {
        const shown = on.filter(x => known.has(x))
        const i = shown.indexOf(id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= shown.length) return
        const next = [...shown]
        ;[next[i], next[j]] = [next[j], next[i]]
        save(next)
    }
    return (
        <Group title="Home page" description="The rows of your list on Home, before your library and Discover's rows.">
            {order.map(id => {
                const s = HOME_SECTIONS.find(x => x.id === id)!
                const shown = on.includes(id)
                const at = on.filter(x => known.has(x)).indexOf(id)
                return (
                    <Shown key={id} text={`${s.label} ${s.help}`}>
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className={cn("min-w-0", !shown && "opacity-60")}>
                            <p className="text-sm font-medium">{s.label}</p>
                            <p className="mt-0.5 text-xs text-subtle">{s.help}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            {shown && (
                                <>
                                    <button disabled={at === 0} onClick={() => move(id, -1)} className="grid size-8 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg disabled:opacity-30" aria-label="Move up">
                                        <ArrowUp className="size-4" />
                                    </button>
                                    <button disabled={at === on.filter(x => known.has(x)).length - 1} onClick={() => move(id, 1)} className="grid size-8 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg disabled:opacity-30" aria-label="Move down">
                                        <ArrowDown className="size-4" />
                                    </button>
                                </>
                            )}
                            <span className="ml-2">
                                <Switch checked={shown} onChange={v => toggle(id, v)} />
                            </span>
                        </div>
                    </div>
                    </Shown>
                )
            })}
        </Group>
    )
}

// Library sharing with the Moviko apps on the other computers at home. Turning
// it on or off and the name are saved with the rest; who gets this
// computer's library changes at once.
function SharingGroup({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    const saved = status?.settings.sharing
    const trusted = status?.client !== "lan"
    const { data: sharing } = useSharing(!!saved?.enabled)
    const qc = useQueryClient()
    const [address, setAddress] = useState("")
    const [adding, setAdding] = useState(false)
    // The computer files are being uploaded to (UploadDialog), or none.
    const [uploadTo, setUploadTo] = useState<string | null>(null)
    const call = async (fn: () => Promise<unknown>) => {
        try {
            await fn()
            qc.invalidateQueries({ queryKey: ["sharing"] })
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    const add = async () => {
        if (!address.trim()) return
        setAdding(true)
        await call(async () => {
            const p = await api.post<SharingPeer>("/api/sharing/connect", { address })
            toast.success(`Found ${p.name}`)
            setAddress("")
        })
        setAdding(false)
    }
    const peers = sharing?.peers ?? []
    return (
        <Group
            title="Library sharing"
            description="Watch the libraries of Moviko on your other computers and TVs at home, and share yours. Watching updates the list of the computer you watch on."
        >
            <Row label="Library sharing" help="Turn it on on both computers.">
                <Switch checked={draft.sharing.enabled} disabled={!trusted} onChange={v => set("sharing", { enabled: v })} />
            </Row>
            {draft.sharing.enabled && (
                <Stack label="Name on the network" help="Shown to the other Moviko apps.">
                    <Input value={draft.sharing.name} disabled={!trusted} placeholder={sharing?.name || "This computer's name"} onChange={e => set("sharing", { name: e.target.value })} />
                </Stack>
            )}
            {draft.sharing.enabled && (
                <Row label="Sync watch history by itself" help="When a paired device comes back on the network. Sync on Home does it at once.">
                    <Switch checked={draft.sharing.autoSync ?? true} disabled={!trusted} onChange={v => set("sharing", { autoSync: v })} />
                </Row>
            )}
            {draft.sharing.enabled !== !!saved?.enabled && <p className="px-4 py-3 text-xs text-amber-200/80">Save to turn library sharing {draft.sharing.enabled ? "on" : "off"}.</p>}
            {saved?.enabled && sharing && (
                <>
                    <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-1">
                        <div>
                            <p className="text-sm font-medium">Moviko apps on this network</p>
                            <p className="mt-0.5 text-xs text-subtle">
                                Turn on <b>Share my library</b> for those that may watch this computer's movies and shows.
                                {sharing.addresses.length > 0 && <> This computer is at {sharing.addresses.join(", ")}.</>}
                            </p>
                        </div>
                        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => refreshSharing(qc)}>
                            Refresh
                        </Button>
                    </div>
                    {peers.length === 0 && (
                        <p className="px-4 py-3 text-sm text-muted">
                            {sharing.listening ? "Looking for Moviko apps… Turn on library sharing on the other computer too." : "Another program uses the network port. Add the others by address below."}
                        </p>
                    )}
                    {peers.map(p => (
                        <div key={p.id} className="px-4 py-3.5">
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="flex items-center gap-2 text-sm font-medium">
                                    <span className={cn("size-2 shrink-0 rounded-full", p.online ? "bg-emerald-400" : "bg-white/20")} />
                                    <span className="truncate">{p.name}</span>
                                </p>
                                <p className="mt-0.5 text-xs text-subtle">
                                    {[
                                        p.address,
                                        p.version && `Moviko ${p.version}${p.platform === "android" ? " for Android" : ""}`,
                                        !p.online && p.lastSeen > 0 && `seen ${relativeTime(p.lastSeen)}`,
                                        p.shares && `shares its library with you${p.files ? ` (${p.files} ${p.files === 1 ? "file" : "files"})` : ""}`,
                                        p.error,
                                        p.noBeacons && "found by address only, check its firewall or a network set to Public",
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </p>
                                <VersionNote peer={p} mine={status?.version} />
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                                {p.shares && p.takesDownloads && trusted && !tv && (
                                    <Button size="sm" variant="ghost" icon={<Upload className="size-4" />} onClick={() => setUploadTo(p.id)}>
                                        Upload
                                    </Button>
                                )}
                                {!p.online && p.canWake && (
                                    <Button size="sm" variant="ghost" icon={<Moon className="size-4" />} loading={p.waking} onClick={() => call(() => api.post(`/api/sharing/libraries/${p.id}/wake`))}>
                                        {p.waking ? "Waking…" : "Wake"}
                                    </Button>
                                )}
                                <span className="text-xs text-muted">Share my library</span>
                                <Switch checked={p.allowed} disabled={!trusted} onChange={v => call(() => api.post(`/api/sharing/peers/${p.id}`, { allowed: v }))} />
                                {!p.online && trusted && (
                                    <button
                                        onClick={() => confirm(`Remove ${p.name} from the list? It shows up again when it's back on the network.`) && call(() => api.del(`/api/sharing/peers/${p.id}`))}
                                        className="grid size-8 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-rose-300"
                                        aria-label={`Remove ${p.name}`}
                                        title="Remove"
                                    >
                                        <X className="size-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                        {/* With the library: downloading here. */}
                        {p.allowed && (
                            <div className="mt-3 ml-1 flex flex-col gap-3 border-l border-line pl-4">
                                <PeerGrant
                                    label="Let it download here"
                                    help="Its downloads, torrents and uploads go to this computer's library."
                                    checked={p.downloads}
                                    disabled={!trusted}
                                    onChange={v => call(() => api.post(`/api/sharing/peers/${p.id}`, { downloads: v }))}
                                />
                            </div>
                        )}
                        </div>
                    ))}
                    {peers.some(p => p.shares && p.takesDownloads) && (
                        <Row label="Downloads from this device go to">
                            <Select
                                className="w-48"
                                value={draft.sharing.downloadTo ?? ""}
                                disabled={!trusted}
                                onChange={v => set("sharing", { downloadTo: v })}
                                options={[{ value: "", label: "This device" }, ...peers.filter(p => p.shares && p.takesDownloads).map(p => ({ value: p.id, label: p.name }))]}
                            />
                        </Row>
                    )}
                    {trusted && (
                        <Stack label="Add by address" help="For computers that don't find each other. The address is in the other computer's settings.">
                            <div className="flex gap-2">
                                <Input value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="192.168.1.20:43311" />
                                <Button onClick={add} loading={adding} disabled={!address.trim()}>
                                    Add
                                </Button>
                            </div>
                        </Stack>
                    )}
                </>
            )}
            {uploadTo !== null && <UploadDialog open onOpenChange={v => !v && setUploadTo(null)} target={uploadTo} />}
        </Group>
    )
}

// The other Moviko runs another version than this one: some things (Sync,
// waking it up) need both up to date.
function VersionNote({ peer, mine }: { peer: SharingPeer; mine?: string }) {
    const c = compareVersions(peer.version, mine)
    if (!c) return null
    return (
        <p className="mt-1 text-xs text-amber-200/80">
            {c < 0
                ? `Older than this one (Moviko ${mine}). Update Moviko on ${peer.name} from its Home page.`
                : `Newer than this one (Moviko ${mine}). Update here in Settings › Updates & about.`}
        </p>
    )
}

function DevicesSection({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    const trusted = status?.client !== "lan"
    return (
        <>
            <SharingGroup draft={draft} set={set} />
            {/* A TV doesn't serve the others (and has nothing to keep awake). */}
            {!androidApp && (
                <Group title="While other devices watch">
                    <Row
                        label="Keep this computer awake"
                        help={
                            status?.keptAwake
                                ? "Staying awake now. Another device is playing from it."
                                : "While another device plays from it, and for 15 minutes after."
                        }
                    >
                        <Switch checked={draft.sharing.keepAwake ?? true} disabled={!trusted} onChange={v => set("sharing", { keepAwake: v })} />
                    </Row>
                </Group>
            )}
        </>
    )
}

function PeerGrant({ label, help, checked, disabled, onChange }: { label: string; help: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
                <p className="text-sm">{label}</p>
                <p className="mt-0.5 text-xs text-subtle">{help}</p>
            </div>
            <Switch checked={checked} disabled={disabled} onChange={onChange} />
        </div>
    )
}

function LibrarySection({ draft, set }: SectionProps) {
    const [, setSearchParams] = useSearchParams()
    const extra = draft.library.extraDirs ?? []
    const folders = [draft.library.dir, ...extra].filter(Boolean)
    const off = !!draft.library.off
    return (
        <>
            <Group title="Local library">
                <Locked>
                    <Row
                        label="A library on this computer"
                        help={
                            off
                                ? "Off. This computer plays only libraries shared with it. Its folders are kept."
                                : "Turn off to use only shared libraries. Nothing is deleted from the disk."
                        }
                    >
                        <Switch label="A library on this computer" checked={!off} onChange={v => set("library", { off: !v })} />
                    </Row>
                </Locked>
            </Group>
            {!off && (
                <>
                    <Group title="Folders">
                        <Locked>
                            <Stack label="Library directory" help="Like Movie (2010)/Movie (2010).mkv or Show/Season 01/Show S01E02.mkv">
                                <PathInput value={draft.library.dir} onChange={v => set("library", { dir: v })} placeholder="/mnt/media/Movies" />
                            </Stack>
                            <Stack label="Additional library directories">
                                <div className="flex flex-col gap-2">
                                    {extra.map((d, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <div className="flex-1">
                                                <PathInput value={d} onChange={v => set("library", { extraDirs: extra.map((x, j) => (j === i ? v : x)) })} />
                                            </div>
                                            <button onClick={() => set("library", { extraDirs: extra.filter((_, j) => j !== i) })} aria-label="Remove this folder" className="grid size-10 place-items-center rounded-xl text-muted hover:bg-white/[0.06] hover:text-rose-300">
                                                <X className="size-4" />
                                            </button>
                                        </div>
                                    ))}
                                    <button onClick={() => set("library", { extraDirs: [...extra, ""] })} className="grid size-9 place-items-center rounded-full bg-white/[0.07] text-fg hover:bg-white/[0.12]" aria-label="Add directory">
                                        <Plus className="size-4" />
                                    </button>
                                </div>
                            </Stack>
                            {folders.length > 1 && (
                                <Stack label="Downloads go to" help="For new movies and shows. One that already has a folder keeps it.">
                                    <Select
                                        value={folders.includes(draft.library.downloadDir ?? "") ? draft.library.downloadDir! : ""}
                                        onChange={v => set("library", { downloadDir: v })}
                                        options={[{ value: "", label: `${folders[0]} (the first folder)` }, ...folders.slice(1).map(f => ({ value: f, label: f }))]}
                                    />
                                </Stack>
                            )}
                        </Locked>
                    </Group>
                    <Group title="Scanning">
                        <Row label="Automatically refresh library" help="Pick up new and removed files as they change">
                            <Switch checked={draft.library.autoRefresh} onChange={v => set("library", { autoRefresh: v })} />
                        </Row>
                        <Row label="Refresh library on startup">
                            <Switch checked={draft.library.refreshOnStartup} onChange={v => set("library", { refreshOnStartup: v })} />
                        </Row>
                    </Group>
                </>
            )}
            <Group title="Library sharing">
                <Row label="Share this library with your other computers and TVs" help="Choose who gets it in Devices.">
                    <Button size="sm" variant="ghost" onClick={() => setSearchParams({ tab: "devices" })}>
                        Open
                    </Button>
                </Row>
            </Group>
            <Collapsible title="Advanced">
                <Stack label={`Matching threshold: ${Math.round(draft.library.matchThreshold * 100)}%`} help="How similar a file name must be to a TMDB title to match.">
                    <input type="range" min={0.3} max={0.95} step={0.05} value={draft.library.matchThreshold} onChange={e => set("library", { matchThreshold: Number(e.target.value) })} className="accent-[var(--brand)]" />
                </Stack>
                <Row label="Match movies and shows that aren't on my list" help="Search all of TMDB when a title isn't on your list">
                    <Switch checked={draft.library.matchOutsideList} onChange={v => set("library", { matchOutsideList: v })} />
                </Row>
                <Stack label="Ignore patterns" help="One glob per line, for file and folder names, like *sample* or *trailer*.">
                    <LinesInput value={draft.library.ignorePatterns ?? []} onChange={v => set("library", { ignorePatterns: v })} />
                </Stack>
            </Collapsible>
        </>
    )
}

const LANGS = [
    { value: "eng,en", label: "English" },
    { value: "spa,es", label: "Spanish" },
    { value: "por,pt", label: "Portuguese" },
    { value: "fre,fra,fr", label: "French" },
    { value: "ger,deu,de", label: "German" },
    { value: "ita,it", label: "Italian" },
    { value: "ara,ar", label: "Arabic" },
    { value: "rus,ru", label: "Russian" },
    { value: "jpn,ja", label: "Japanese" },
    { value: "kor,ko", label: "Korean" },
    { value: "chi,zho,zh", label: "Chinese" },
    { value: "hin,hi", label: "Hindi" },
    { value: "dut,nld,nl", label: "Dutch" },
    { value: "swe,sv", label: "Swedish" },
    { value: "pol,pl", label: "Polish" },
    { value: "tur,tr", label: "Turkish" },
    { value: "", label: "File default" },
]

function PlaybackSection({ draft, set }: SectionProps) {
    const p = draft.playback
    return (
        <>
            <Group title="Player">
                {!androidApp && (
                    <Row label="Default player for local files" help="mpv opens in its own window. The in-app player also works on other devices.">
                        <Select
                            className="w-48"
                            value={p.defaultPlayer}
                            onChange={v => set("playback", { defaultPlayer: v as "mpv" })}
                            options={[
                                { value: "builtin", label: "In-app player" },
                                { value: "mpv", label: "mpv" },
                            ]}
                        />
                    </Row>
                )}
                <Row label="Resume where I left off">
                    <Switch checked={p.resumePlayback} onChange={v => set("playback", { resumePlayback: v })} />
                </Row>
                <Row label="Auto play next episode">
                    <Switch checked={p.autoPlayNext} onChange={v => set("playback", { autoPlayNext: v })} />
                </Row>
                <Row label="Skip intros and recaps (chapters)" help="Chapters named intro, opening, title sequence or previously on">
                    <Switch checked={p.skipIntro} onChange={v => set("playback", { skipIntro: v })} />
                </Row>
                <Row
                    label="Skip end credits (chapters)"
                    help="Chapters named credits, ending or preview. Scenes after the credits still play."
                >
                    <Switch checked={p.skipCredits} onChange={v => set("playback", { skipCredits: v })} />
                </Row>
            </Group>
            <Group title="Progress">
                <Row label="Update progress automatically" help="Mark movies and episodes as watched when you finish them. Movies go in your diary.">
                    <Switch checked={p.autoUpdateProgress} onChange={v => set("playback", { autoUpdateProgress: v })} />
                </Row>
                <Stack label={`Count as watched at ${Math.round(p.completionThreshold * 100)}%`}>
                    <input type="range" min={0.5} max={1} step={0.01} value={p.completionThreshold} onChange={e => set("playback", { completionThreshold: Number(e.target.value) })} className="accent-[var(--brand)]" />
                </Stack>
            </Group>
            <Group
                title="Audio & subtitles"
                description="Movies and shows play in their original language, with forced subtitles when there are some."
            >
                <Row label="Remember my track choice per movie or show">
                    <Switch checked={p.rememberTracks} onChange={v => set("playback", { rememberTracks: v })} />
                </Row>
                <Row label="Preferred audio language" help="Play a dub in this language when the file has one">
                    <Select
                        className="w-44"
                        value={p.preferredAudioLang}
                        onChange={v => set("playback", { preferredAudioLang: v })}
                        options={LANGS.map(l => (l.value ? l : { ...l, label: "Original language" }))}
                    />
                </Row>
                <Row label="Preferred subtitle language" help="Your language for subtitles (English when not set)">
                    <Select
                        className="w-44"
                        value={p.preferredSubLang}
                        onChange={v => set("playback", { preferredSubLang: v })}
                        options={LANGS.map(l => (l.value ? l : { ...l, label: "Not set" }))}
                    />
                </Row>
                <Row
                    label="Subtitles only for foreign languages"
                    help="Off shows subtitles whenever your subtitle language has some."
                >
                    <Switch checked={p.subtitlesForForeign} onChange={v => set("playback", { subtitlesForForeign: v })} />
                </Row>
            </Group>
            <SubtitlesGroup />
        </>
    )
}

function MpvSection({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    return (
        <Group title="mpv">
            <Row label="Status">
                <Detect ok={status?.features.mpv} label="mpv" />
            </Row>
            <Locked>
                <Stack
                    label="Executable"
                    help={`Name or full path, like ${exampleMpvPath(status?.platform)}. Install with: ${installHint(status?.platform, "mpv")}`}
                >
                    <Input value={draft.mpv.path} onChange={e => set("mpv", { path: e.target.value })} icon={<Terminal className="size-4" />} />
                </Stack>
                <Stack label="Extra arguments" help="For example --profile=gpu-hq --hwdec=auto">
                    <Input value={draft.mpv.extraArgs} onChange={e => set("mpv", { extraArgs: e.target.value })} />
                </Stack>
            </Locked>
            <Row label="Start in fullscreen">
                <Switch checked={draft.mpv.fullscreen} onChange={v => set("mpv", { fullscreen: v })} />
            </Row>
        </Group>
    )
}

function TranscodeSection({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    const t = draft.transcode
    return (
        <>
            <Group title="In-app player" description="Formats the browser can't play are converted with ffmpeg.">
                <Row label="Status">
                    <div className="flex gap-2">
                        <Detect ok={status?.features.ffmpeg} label="ffmpeg" />
                        <Detect ok={status?.features.ffprobe} label="ffprobe" />
                    </div>
                </Row>
                <Row label="Mode">
                    <Select
                        className="w-56"
                        value={t.mode}
                        onChange={v => set("transcode", { mode: v })}
                        options={[
                            { value: "auto", label: "Automatic (recommended)" },
                            { value: "direct", label: "Always direct play" },
                            { value: "transcode", label: "Always transcode" },
                        ]}
                    />
                </Row>
                <Row label="Hardware acceleration">
                    <Select
                        className="w-56"
                        value={t.hwAccel}
                        onChange={v => set("transcode", { hwAccel: v })}
                        options={[
                            { value: "", label: "None (CPU, libx264)" },
                            { value: "vaapi", label: "VA-API (AMD / Intel)" },
                            { value: "nvenc", label: "NVENC (NVIDIA)" },
                            { value: "qsv", label: "Quick Sync (Intel)" },
                            { value: "v4l2m2m", label: "V4L2 (Raspberry Pi)" },
                        ]}
                    />
                </Row>
                {t.hwAccel === "vaapi" && (
                    <Locked>
                        <Stack label="VA-API device">
                            <Input value={t.vaapiNode} onChange={e => set("transcode", { vaapiNode: e.target.value })} />
                        </Stack>
                    </Locked>
                )}
                <Row label="x264 preset" help="Faster presets use less CPU">
                    <Select className="w-40" value={t.preset} onChange={v => set("transcode", { preset: v })} options={["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map(p => ({ value: p, label: p }))} />
                </Row>
            </Group>
            <Group title="Paths">
                <Locked>
                    <Stack label="ffmpeg">
                        <Input value={t.ffmpegPath} onChange={e => set("transcode", { ffmpegPath: e.target.value })} />
                    </Stack>
                    <Stack label="ffprobe">
                        <Input value={t.ffprobePath} onChange={e => set("transcode", { ffprobePath: e.target.value })} />
                    </Stack>
                </Locked>
            </Group>
        </>
    )
}

function ClientFields({ value, onChange, showTags }: { value: Settings["qbittorrent"]; onChange: (v: Partial<Settings["qbittorrent"]>) => void; showTags?: boolean }) {
    return (
        <div className="flex flex-col gap-4 p-4">
            <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Host</span>
                <Input value={value.host} onChange={e => onChange({ host: e.target.value })} />
            </label>
            <div className="grid gap-4 md:grid-cols-3">
                <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Username</span>
                    <Input value={value.username} onChange={e => onChange({ username: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Password</span>
                    <Password value={value.password} onChange={v => onChange({ password: v })} />
                </label>
                <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Port</span>
                    <Input type="number" value={value.port} onChange={e => onChange({ port: Number(e.target.value) })} />
                </label>
            </div>
            <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Executable</span>
                <Input value={value.executable} onChange={e => onChange({ executable: e.target.value })} placeholder="/usr/bin/qbittorrent" />
            </label>
            <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Tags</span>
                <Input value={value.tags} onChange={e => onChange({ tags: e.target.value })} />
                <span className="text-xs text-subtle">Comma separated, like moviko,movies</span>
            </label>
            {showTags && (
                <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Category</span>
                    <Input value={value.category} onChange={e => onChange({ category: e.target.value })} />
                </label>
            )}
            <label className="flex items-center gap-3 text-sm">
                <Switch checked={value.useHttps} onChange={v => onChange({ useHttps: v })} /> Use HTTPS
            </label>
        </div>
    )
}

function TorrentClientSection({ draft, set }: SectionProps) {
    const [open, setOpen] = useState<string>(draft.torrent.defaultClient === "transmission" ? "transmission" : "qbittorrent")
    const [testing, setTesting] = useState(false)
    const save = useSaveSettings()
    const test = async () => {
        setTesting(true)
        try {
            await save.mutateAsync(draft)
            const s = await api.get<{ connected: boolean; version: string; error?: string }>("/api/torrent-client/status")
            s.connected ? toast.success(`Connected, version ${s.version}`) : toast.error(s.error ?? "Not reachable")
        } finally {
            setTesting(false)
        }
    }
    return (
        <>
            <Group title="Torrent client" description="Moviko connects to the client's web interface.">
                <Row label="Use" keywords="default client qbittorrent transmission">
                    <Select
                        className="w-44"
                        value={draft.torrent.defaultClient}
                        onChange={v => set("torrent", { defaultClient: v })}
                        options={[
                            { value: "qbittorrent", label: "qBittorrent" },
                            { value: "transmission", label: "Transmission" },
                            { value: "none", label: "None" },
                        ]}
                    />
                </Row>
                {(["qbittorrent", "transmission"] as const).map(c => (
                    <Shown key={c} text={`${c === "qbittorrent" ? "qBittorrent" : "Transmission"} host port username password address connection`}>
                        <button onClick={() => setOpen(o => (o === c ? "" : c))} aria-expanded={open === c} className="flex w-full items-center justify-between px-4 py-3.5">
                            <span className="flex items-center gap-2.5 text-sm font-medium">
                                <HardDrive className="size-4 text-muted" />
                                {c === "qbittorrent" ? "qBittorrent" : "Transmission"} connection
                                {draft.torrent.defaultClient === c && <Badge tone="brand">In use</Badge>}
                            </span>
                            <ChevronDown className={cn("size-4 text-muted transition-transform duration-200", open === c && "rotate-180")} />
                        </button>
                        <Locked>
                            {open === c && (
                                <div className="divide-y divide-line border-t border-line">
                                    <ClientFields value={draft[c]} onChange={v => set(c, v)} showTags={c === "qbittorrent"} />
                                </div>
                            )}
                        </Locked>
                    </Shown>
                ))}
                <Row label="Check the connection" help="Saves your changes first.">
                    <Button size="sm" icon={<Network className="size-4" />} loading={testing} onClick={test} disabled={draft.torrent.defaultClient === "none"}>
                        Save & test
                    </Button>
                </Row>
            </Group>
            <Group title="Integration">
                <Row label="Show active torrent count" help="In the sidebar.">
                    <Switch checked={draft.torrent.showActiveCount} onChange={v => set("torrent", { showActiveCount: v })} />
                </Row>
                <Row label="Create a folder per movie or show" help="Inside the library, like Movie (2010)/">
                    <Switch checked={draft.torrent.createSubfolder} onChange={v => set("torrent", { createSubfolder: v })} />
                </Row>
                <Row label="Auto downloader" help="Looks for new episodes of your shows">
                    <Switch checked={draft.torrent.autoDownloader} onChange={v => set("torrent", { autoDownloader: v })} />
                </Row>
                <Row label="Check every (minutes)">
                    <Input type="number" min={5} className="w-24" value={draft.torrent.autoDownloadMinutes} onChange={e => set("torrent", { autoDownloadMinutes: Number(e.target.value) })} />
                </Row>
            </Group>
        </>
    )
}

function DiscordSection({ draft, set }: SectionProps) {
    return (
        <Group title="Rich presence" description="Uses the Discord app on this computer. Shows the title, its poster and the time left.">
            <Row label="Show what I'm watching">
                <Switch checked={draft.discord.richPresence} onChange={v => set("discord", { richPresence: v })} />
            </Row>
            <Locked>
                <Stack
                    label="Discord application ID"
                    help="From an application made at discord.com/developers. An Art Asset named moviko is its badge."
                >
                    <Input value={draft.discord.clientId} onChange={e => set("discord", { clientId: e.target.value })} />
                </Stack>
            </Locked>
        </Group>
    )
}

function LogsSection() {
    const { data: logs, refetch } = useQuery({ queryKey: ["logs"], queryFn: () => api.get<string[]>("/api/logs"), refetchInterval: 4000 })
    const { data: cache, refetch: refetchCache } = useQuery({ queryKey: ["cache-size"], queryFn: () => api.get<{ entries: number }>("/api/cache/size") })
    const { data: imgs, refetch: refetchImgs } = useQuery({ queryKey: ["image-cache"], queryFn: () => api.get<{ files: number; bytes: number }>("/api/images/stats") })
    const clear = async () => {
        try {
            await api.post("/api/cache/clear")
            toast.success("Cache cleared")
            refetchCache()
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    const clearImages = async () => {
        try {
            await api.post("/api/images/clear")
            toast.success("Artwork cache cleared. Posters will download again.")
            refetchImgs()
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    return (
        <>
            <Group title="Cache" description="TMDB data, season details and search results.">
                <Row label={`${cache?.entries ?? 0} cached entries`}>
                    <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} onClick={clear}>
                        Clear cache
                    </Button>
                </Row>
                <Row label={`Artwork: ${imgs?.files ?? 0} images (${formatBytes(imgs?.bytes ?? 0)})`} help="Posters, backdrops and episode stills">
                    <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} onClick={clearImages}>
                        Clear artwork
                    </Button>
                </Row>
            </Group>
            <div>
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">Server logs</h3>
                    <Button size="sm" variant="ghost" onClick={() => refetch()}>
                        Refresh
                    </Button>
                </div>
                <pre className="card max-h-[60vh] overflow-auto p-4 text-xs leading-relaxed text-fg/80">{(logs ?? []).slice(-400).join("\n") || "No logs yet."}</pre>
            </div>
        </>
    )
}

// The version, and Moviko's own updates: the Home page offers and installs
// them, this says where things stand.
function AboutSection() {
    const { data: status } = useStatus()
    const { data: u } = useUpdateStatus()
    const check = useCheckUpdate()
    const save = useSaveSettings()
    const beta = status?.settings.updates?.channel === "beta"
    const lan = status?.client === "lan"
    const commit = u?.current.commit
    const latest = versionName(u?.latest)
    const busy = ["downloading", "building", "installing"].includes(u?.state ?? "")
    let state: { tone: "green" | "brand" | "amber" | "gray"; label: string; help?: string }
    if (!u || u.checking) state = { tone: "gray", label: "Checking…" }
    else if (busy) state = { tone: "brand", label: `Updating to ${latest}`, help: u.message }
    else if (u.state === "ready") state = { tone: "green", label: `${latest} installed`, help: u.message }
    else if (u.available) state = { tone: "brand", label: `${latest} available`, help: lan || u.canApply ? undefined : u.applyNote }
    else if (u.latest) state = { tone: "green", label: "Up to date", help: u.note }
    else if (u.error) state = { tone: "amber", label: "Couldn't check" }
    else state = { tone: "gray", label: "Not checked yet", help: "Checked after Moviko starts, then every 6 hours." }
    if (u?.state === "failed" && !busy) state.help = [u.message, state.help].filter(Boolean).join(" ")
    return (
        <>
            <Group title="Moviko">
                <Row label="Version" help={`${platformName(status?.platform)} · ${status?.client === "desktop" ? "Desktop" : status?.client === "lan" ? "LAN" : "Web UI"}`}>
                    <span className="flex items-center gap-2 text-sm">
                        {status?.version}
                        {commit && (
                            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs" title={commit}>
                                {commit.slice(0, 7)}
                            </code>
                        )}
                    </span>
                </Row>
                <Row label="What's new">
                    <Button size="sm" variant="ghost" onClick={() => whatsNewStore.set("all")}>
                        Show
                    </Button>
                </Row>
            </Group>
            {/* Installing it, from here too (as on Home). */}
            {!lan && <UpdateBanner inSettings />}
            <Group title="Updates" description="New versions are offered here and on Home.">
                <Row
                    label="Beta updates"
                    help={
                        beta
                            ? "You get each new version first. Betas can have rough edges."
                            : "Get each new version first, before the stable release."
                    }
                >
                    <Locked>
                        <Switch
                            checked={beta}
                            disabled={!status || save.isPending}
                            onChange={v => status && save.mutate({ ...status.settings, updates: { channel: v ? "beta" : "stable" } })}
                        />
                    </Locked>
                </Row>
                <Row label="Status" help={state.help}>
                    <Badge tone={state.tone}>{state.label}</Badge>
                </Row>
                {u?.latest && (
                    <Row label="Newest version">
                        <a href={u.latest.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm hover:underline">
                            {latest}
                            {u.latest.commit && u.latest.version && <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">{u.latest.commit.slice(0, 7)}</code>}
                        </a>
                    </Row>
                )}
                <Row label="Last check" help={u?.checking ? "Checking now…" : u?.checkedAt ? `${relativeTime(u.checkedAt)}. Checked every 6 hours.` : "Never"}>
                    {!lan && (
                        <Button size="sm" icon={<RefreshCw className="size-4" />} loading={check.isPending || u?.checking} onClick={() => check.mutate()}>
                            Check for updates
                        </Button>
                    )}
                </Row>
                {u?.error && (
                    <div className="px-4 py-3.5 text-sm">
                        <p className="text-rose-300">{u.error}</p>
                        {u.hint && <p className={cn("mt-1 break-words", u.hint.startsWith("Details: ") ? "text-xs text-subtle" : "text-muted")}>{u.hint}</p>}
                    </div>
                )}
            </Group>
        </>
    )
}
