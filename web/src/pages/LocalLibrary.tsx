import { Check, CheckCheck, ChevronDown, FolderOpen, FolderSearch, FolderSync, HardDrive, Info, LayoutGrid, List as ListIcon, Play, RefreshCw, Search, Share2, SlidersHorizontal, Upload } from "lucide-react"
import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "@/lib/toast"
import { EpisodeCard } from "@/components/EpisodeCard"
import { Carousel, cardMinWidth, cardTextHeight, MediaCard, MediaCardSkeleton, MediaGrid } from "@/components/MediaCard"
import { useLibraryCardMenu } from "@/components/library/LibraryCardMenu"
import { UploadDialog, useUploadTargets } from "@/components/UploadDialog"
import { VirtualGrid, VirtualList } from "@/components/VirtualList"
import { Button, ContextArea, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, EmptyState, IconButton, Input, Progress, Tabs, Tooltip } from "@/components/ui"
import { api } from "@/lib/api"
import { fileKeys, fileLabel } from "@/lib/files"
import { usePersisted } from "@/lib/hooks"
import { episodeIndex, formatKey, mediaIsShow, splitKey, totalEpisodes } from "@/lib/ids"
import { usePlay } from "@/lib/play"
import { useCollection, useEpisodeMarker, useLibraryTitles, useScan, useSharedLibraries, useStatus } from "@/lib/queries"
import { scanStore, useStore } from "@/lib/store"
import { useClassic } from "@/lib/themes"
import { tv } from "@/lib/tv"
import type { LibraryTitle, LocalFile } from "@/lib/types"
import { cn, cover, entryUrl, formatBytes, formatLabel, LIST_STATUS, poster, relativeTime, title, year } from "@/lib/utils"

// "Local library": only movies and shows that have files on this computer
// (or on another Moviko sharing its library). The server sums each title's
// files up (GET /api/library/titles): episodes by season, size, quality,
// what's unwatched.

type StatusFilter = "ALL" | "CURRENT" | "PLANNING" | "COMPLETED" | "PAUSED" | "DROPPED" | "NONE"
type SortKey = "added" | "title" | "unwatched" | "episodes" | "size"
type View = "grid" | "list"
type Kind = "" | "MOVIE" | "TV"

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
    { value: "ALL", label: "All" },
    { value: "CURRENT", label: LIST_STATUS.CURRENT },
    { value: "PLANNING", label: LIST_STATUS.PLANNING },
    { value: "COMPLETED", label: LIST_STATUS.COMPLETED },
    { value: "PAUSED", label: LIST_STATUS.PAUSED },
    { value: "DROPPED", label: LIST_STATUS.DROPPED },
    { value: "NONE", label: "Not on my list" },
]

const SORTS: { value: SortKey; label: string }[] = [
    { value: "added", label: "Recently added" },
    { value: "title", label: "Title" },
    { value: "unwatched", label: "Most unwatched" },
    { value: "episodes", label: "Most episodes" },
    { value: "size", label: "Largest on disk" },
]
const KINDS: { value: Kind; label: string }[] = [
    { value: "", label: "All" },
    { value: "MOVIE", label: "Movies" },
    { value: "TV", label: "Shows" },
]

// A menu row's mark: a tick on the one that's chosen.
const tick = (on: boolean) => (on ? <Check /> : <span className="block size-4" />)

function statusOf(t: LibraryTitle): StatusFilter {
    const s = t.listEntry?.status
    if (!s) return "NONE"
    return s === "REPEATING" ? "CURRENT" : (s as StatusFilter)
}

// Episode keys as runs: [S01E01, S01E02, S01E03, S01E05, S02E01, S02E02]
// -> "S01E01–E03, E05, S02E01–E02" (as the server writes them).
function episodeRanges(keys: number[]) {
    const s = [...new Set(keys)].sort((a, b) => a - b)
    const out: string[] = []
    let season = -1
    for (let i = 0; i < s.length; ) {
        let j = i
        while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
        const [sn, a] = splitKey(s[i])
        const b = splitKey(s[j])[1]
        const first = sn === season ? `E${String(a).padStart(2, "0")}` : formatKey(s[i])
        out.push(i === j ? first : `${first}–E${String(b).padStart(2, "0")}`)
        season = sn
        i = j + 1
    }
    return out.join(", ")
}

// Watched up to (a key): everything for a title watched to the end.
const watchedUpTo = (t: LibraryTitle) => (t.listEntry?.status === "COMPLETED" ? Infinity : (t.listEntry?.progress ?? 0))

export default function LocalLibraryPage() {
    const classic = useClassic()
    const { data: status } = useStatus()
    const { data: coll } = useCollection()
    // The libraries other Moviko apps on the network share with this one.
    const { data: shared } = useSharedLibraries()
    const [source, setSource] = usePersisted<string>("kumobox-local-source", "local")
    // This computer's library off (Settings › Library): only the
    // shared ones, the first one to begin with.
    const off = !!status?.settings.library.off
    const host = off ? (shared?.find(l => l.host.id === source) ?? shared?.[0]) : source === "local" ? undefined : shared?.find(l => l.host.id === source)
    const { data: titlesData, isLoading: loading, error } = useLibraryTitles(host?.host.id ?? "")
    const scan = useScan()
    const scanning = useStore(scanStore, s => s.running)
    const scanState = useStore(scanStore)
    const { playLocal } = usePlay()
    const navigate = useNavigate()
    const libraryMenu = useLibraryCardMenu()

    const [filter, setFilter] = usePersisted<StatusFilter>("kumobox-local-filter", "ALL")
    const [kind, setKind] = usePersisted<Kind>("kumobox-local-kind", "")
    const [sort, setSort] = usePersisted<SortKey>("kumobox-local-sort", "added")
    const [view, setView] = usePersisted<View>("kumobox-local-view", "grid")
    const [q, setQ] = useState("")
    // The list's rows showing their files (kept here: a row scrolled far
    // away isn't rendered).
    const [openRows, setOpenRows] = useState<Set<number>>(() => new Set())
    const toggleRow = (id: number) =>
        setOpenRows(s => {
            const n = new Set(s)
            if (!n.delete(id)) n.add(id)
            return n
        })

    const titles = useMemo(() => titlesData ?? [], [titlesData])

    const counts = useMemo(() => {
        const c: Record<string, number> = { ALL: titles.length }
        for (const t of titles) c[statusOf(t)] = (c[statusOf(t)] ?? 0) + 1
        return c
    }, [titles])
    // Tabs with nothing in them are hidden, so a remembered filter may have no tab
    // any more: fall back to All.
    const activeFilter: StatusFilter = filter !== "ALL" && STATUS_TABS.some(t => t.value === filter) && counts[filter] > 0 ? filter : "ALL"

    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase()
        const out = titles.filter(t => {
            if (kind && t.media.type !== kind) return false
            if (activeFilter !== "ALL" && statusOf(t) !== activeFilter) return false
            if (!needle) return true
            const m = t.media
            return [m.title.userPreferred, m.title.romaji, m.title.english, m.title.native, ...(m.synonyms ?? [])].some(x => x?.toLowerCase().includes(needle))
        })
        out.sort((a, b) => {
            switch (sort) {
                case "title":
                    return title(a.media).localeCompare(title(b.media))
                case "unwatched":
                    return b.unwatched - a.unwatched || b.addedAt - a.addedAt
                case "episodes":
                    return b.episodes.length - a.episodes.length
                case "size":
                    return b.size - a.size
                default:
                    return b.addedAt - a.addedAt
            }
        })
        return out
    }, [titles, kind, activeFilter, sort, q])

    // Newest files on disk, one card per title and day (a season of 10
    // episodes shows up as "S01E01–E10", not ten cards).
    const recent = useMemo(() => {
        const files = titles.flatMap(t => t.files.filter(f => f.kind === "main" && f.episode > 0).map(f => ({ t, f })))
        files.sort((a, b) => b.f.modTime - a.f.modTime)
        const batches = new Map<string, { title: LibraryTitle; files: LocalFile[]; latest: number }>()
        for (const { t, f } of files) {
            const key = `${t.media.id}:${new Date(f.modTime * 1000).toDateString()}`
            const b = batches.get(key)
            if (b) b.files.push(f)
            else if (batches.size < 16) batches.set(key, { title: t, files: [f], latest: f.modTime })
        }
        return [...batches.values()].map(b => {
            b.files.sort((x, y) => x.episode - y.episode)
            const upTo = watchedUpTo(b.title)
            const keys = b.files.flatMap(fileKeys)
            return { ...b, keys, play: b.files.find(f => f.episode > upTo) ?? b.files[0], allWatched: keys.every(k => k <= upTo) }
        })
    }, [titles])

    const totals = useMemo(
        () => ({
            movies: titles.filter(t => !mediaIsShow(t.media)).length,
            shows: titles.filter(t => mediaIsShow(t.media)).length,
            episodes: titles.reduce((n, t) => n + (mediaIsShow(t.media) ? t.episodes.length : 0), 0),
            size: titles.reduce((n, t) => n + t.size, 0),
        }),
        [titles],
    )

    const libraryDir = off ? undefined : status?.settings.library.dir
    const trusted = status?.client !== "lan"
    const openFolder = (path?: string) => path && api.post("/api/open", { path }).catch(e => toast.error(e.message))
    const hostFiles = host?.files.length ?? 0
    // Files from this computer to a server (one that takes this device's
    // downloads), or, on mediaserver's pages, to it.
    const uploads = useUploadTargets(trusted && !tv)
    const [uploading, setUploading] = useState(false)
    const canUpload = !!uploads.data?.length
    const uploadButton = canUpload && (
        <IconButton label="Upload" variant="subtle" className="rounded-xl" onClick={() => setUploading(true)}>
            <Upload className="size-4" />
        </IconButton>
    )
    const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
    // The one line under the title: whose library it is, and how much is in it.
    const summary = [
        host ? `Shared by ${host.host.name}${host.host.online ? "" : ", not answering"}` : "",
        !loading && titles.length > 0
            ? [totals.movies ? count(totals.movies, "movie", "movies") : "", totals.shows ? `${count(totals.shows, "show", "shows")} · ${count(totals.episodes, "episode", "episodes")}` : "", formatBytes(totals.size)].filter(Boolean).join(" · ")
            : "",
    ]
        .filter(Boolean)
        .join(" · ")
    // Movies and shows in what's there: the choice is only offered with both.
    const bothKinds = totals.movies > 0 && totals.shows > 0

    return (
        <div className="min-h-full pb-24">
            {canUpload && <UploadDialog open={uploading} onOpenChange={setUploading} target={host?.host.id} />}
            <header className="flex flex-col gap-5 px-6 pt-8 md:px-8 xl:px-10">
                <div className="flex items-center justify-between gap-4">
                    <h1 className="min-w-0 truncate text-[1.75rem] font-semibold tracking-tight">Local library</h1>
                    {/* The library's tools are in the sidebar: not repeated here. */}
                    <div className="flex shrink-0 items-center gap-2">
                        {uploadButton}
                        {!host && !off && trusted && libraryDir && (
                            <IconButton label="Open library folder" variant="subtle" className="rounded-xl" onClick={() => openFolder(libraryDir)}>
                                <FolderOpen className="size-4" />
                            </IconButton>
                        )}
                        {!host && !off && (
                            <Tooltip content="Scan for new files">
                                <Button variant="primary" className="rounded-xl" loading={scanning || scan.isPending} icon={<FolderSync className="size-4" />} onClick={() => scan.mutate(false)}>
                                    {scanning ? "Scanning…" : "Scan"}
                                </Button>
                            </Tooltip>
                        )}
                    </div>
                </div>
                {(summary || !!coll?.incomplete || (!host && !!coll?.unmatchedCount)) && (
                    <div className="-mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
                        {summary && <p className="tabular-nums">{summary}</p>}
                        {!!coll?.incomplete && (
                            <p className="flex items-center gap-2">
                                <RefreshCw className="size-3.5 shrink-0 animate-spin" />
                                {coll.incomplete} still being looked up
                            </p>
                        )}
                        {!host && !!coll?.unmatchedCount && (
                            <Link to="/library?tab=unmatched" className="flex items-center gap-1.5 text-amber-200 transition-colors hover:text-amber-100">
                                <FolderSearch className="size-4" />
                                {coll.unmatchedCount} unmatched {coll.unmatchedCount === 1 ? "file" : "files"}
                            </Link>
                        )}
                    </div>
                )}
                {!!shared?.length && (!off || shared.length > 1) && (
                    <Tabs
                        className="self-start"
                        value={host ? host.host.id : "local"}
                        onChange={setSource}
                        tabs={[
                            ...(off ? [] : [{ value: "local", label: "This computer", icon: <HardDrive className="size-4" /> }]),
                            ...shared.map(l => ({ value: l.host.id, label: l.host.name, icon: <Share2 className="size-4" /> })),
                        ]}
                    />
                )}
            </header>

            <div className="flex flex-col gap-8 px-6 pt-8 md:px-8 xl:px-10">
                {error && <EmptyState title="Couldn't load your library">{(error as Error).message}</EmptyState>}

                {scanning && titles.length === 0 && (
                    <div className="card mx-auto w-full max-w-xl p-6 rise-in">
                        <div className="flex items-center gap-3">
                            <FolderSync className="size-5 animate-pulse text-brand-strong" />
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold">Scanning your library…</p>
                                <p className="truncate text-sm text-muted">{scanState.message || "Looking for video files…"}</p>
                            </div>
                        </div>
                        <Progress value={scanState.total > 0 ? scanState.done / scanState.total : 0} className={cn("mt-4 h-1.5", scanState.total === 0 && "animate-pulse")} />
                        <p className="mt-3 text-xs text-subtle">
                            A big first scan can take a few minutes.
                        </p>
                    </div>
                )}

                {host && !loading && titles.length === 0 && (
                    <EmptyState icon={<Share2 className="size-6" />} title="Nothing to show yet">
                        {host.host.name} shares {hostFiles} {hostFiles === 1 ? "file" : "files"}. Still looking them up on TMDB.
                    </EmptyState>
                )}

                {!host && off && !loading && (
                    <EmptyState
                        icon={<Share2 className="size-6" />}
                        title="This computer's library is off"
                        action={
                            <Button variant="primary" onClick={() => navigate("/settings?tab=devices")}>
                                Other devices
                            </Button>
                        }
                    >
                        No other device is sharing one right now.
                    </EmptyState>
                )}

                {!host && !off && !loading && !scanning && titles.length === 0 && !error && (
                    <EmptyState
                        icon={<HardDrive className="size-6" />}
                        title={libraryDir ? "Nothing in your library yet" : "Choose your library folder"}
                        action={
                            libraryDir ? (
                                <Button loading={scanning} icon={<FolderSync className="size-4" />} onClick={() => scan.mutate(false)}>
                                    Scan now
                                </Button>
                            ) : (
                                <Button variant="primary" onClick={() => navigate("/settings?tab=library")}>
                                    Open settings
                                </Button>
                            )
                        }
                    >
                        {libraryDir ? (
                            <>
                                Download movies and episodes, or copy video files to <span className="font-mono text-fg/80">{libraryDir}</span> (like <span className="font-mono text-fg/80">Movie (2010)/</span> or{" "}
                                <span className="font-mono text-fg/80">Show (2008)/Season 01/</span>).
                            </>
                        ) : (
                            "Pick the folder your movies and shows are in."
                        )}
                    </EmptyState>
                )}

                {recent.length > 0 && !q && (
                    <section className="rise-in" data-tv-autofocus>
                        <h2 className="mb-4 text-xl font-semibold tracking-tight">Recently added</h2>
                        <Carousel itemClassName="w-[300px]">
                            {recent.map(({ title: t, keys, latest, play, allWatched }) => {
                                const m = t.media
                                const show = mediaIsShow(m)
                                return (
                                    <EpisodeCard
                                        key={`${m.id}:${latest}`}
                                        image={m.bannerImage || cover(m)}
                                        label={show ? formatKey(play.episode) : "Movie"}
                                        title={title(m)}
                                        subtitle={`${show ? episodeRanges(keys) : year(m) || "Movie"} · added ${relativeTime(latest)}`}
                                        hasFile
                                        watched={allWatched}
                                        onClick={() => playLocal(play.path, m.id, play.episode)}
                                        // On a right-click, and under its "⋯".
                                        menu={
                                            <>
                                                <DropdownItem icon={<Play />} onSelect={() => playLocal(play.path, m.id, play.episode)}>
                                                    Play
                                                </DropdownItem>
                                                <DropdownItem icon={<Info />} onSelect={() => navigate(entryUrl(m))}>
                                                    Its page
                                                </DropdownItem>
                                            </>
                                        }
                                        actions={
                                            <IconButton label="Open its page" variant="ghost" size="xs" className="bg-black/70 text-white hover:bg-black/85 hover:text-white" onClick={e => (e.stopPropagation(), navigate(entryUrl(m)))}>
                                                <Info className="size-3.5" />
                                            </IconButton>
                                        }
                                    />
                                )
                            })}
                        </Carousel>
                    </section>
                )}

                {(loading || titles.length > 0) && (
                    <section>
                        {/* One row: the list they're on, a title filter, and the rest (kind, order, view) in one menu. */}
                        <div className="mb-6 flex flex-wrap items-center gap-3">
                            <Tabs value={activeFilter} onChange={setFilter} tabs={STATUS_TABS.filter(t => t.value === "ALL" || counts[t.value])} />
                            <div className="flex min-w-0 flex-1 items-center gap-2 sm:ml-auto sm:flex-none">
                                <div className="min-w-0 flex-1 sm:w-60 sm:flex-none">
                                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by title…" aria-label="Filter by title" icon={<Search className="size-4" />} className="rounded-xl" />
                                </div>
                                <Dropdown>
                                    <DropdownTrigger asChild>
                                        <IconButton label="Type, sort and view" variant="subtle" className={cn("rounded-xl", kind !== "" && (classic ? "text-brand-strong" : "border-b border-fg text-fg"))}>
                                            <SlidersHorizontal className="size-4" />
                                        </IconButton>
                                    </DropdownTrigger>
                                    <DropdownContent>
                                        {/* Only with both there (or to get out of a kind chosen before). */}
                                        {(bothKinds || kind !== "") && (
                                            <>
                                                <DropdownLabel>Type</DropdownLabel>
                                                {KINDS.map(k => (
                                                    <DropdownItem key={k.value} icon={tick(kind === k.value)} onSelect={() => setKind(k.value)}>
                                                        {k.label}
                                                        <span className="ml-auto pl-4 text-xs text-subtle tabular-nums">{k.value === "MOVIE" ? totals.movies : k.value === "TV" ? totals.shows : titles.length}</span>
                                                    </DropdownItem>
                                                ))}
                                                <DropdownSeparator />
                                            </>
                                        )}
                                        <DropdownLabel>Sort by</DropdownLabel>
                                        {SORTS.map(o => (
                                            <DropdownItem key={o.value} icon={tick(sort === o.value)} onSelect={() => setSort(o.value)}>
                                                {o.label}
                                            </DropdownItem>
                                        ))}
                                        <DropdownSeparator />
                                        <DropdownLabel>View</DropdownLabel>
                                        <DropdownItem icon={<LayoutGrid />} onSelect={() => setView("grid")}>
                                            Grid
                                            {view === "grid" && <Check className="ml-auto size-4 text-muted" />}
                                        </DropdownItem>
                                        <DropdownItem icon={<ListIcon />} onSelect={() => setView("list")}>
                                            List
                                            {view !== "grid" && <Check className="ml-auto size-4 text-muted" />}
                                        </DropdownItem>
                                    </DropdownContent>
                                </Dropdown>
                            </div>
                        </div>

                        {loading ? (
                            <MediaGrid>
                                {Array.from({ length: 12 }).map((_, i) => (
                                    <MediaCardSkeleton key={i} />
                                ))}
                            </MediaGrid>
                        ) : shown.length === 0 ? (
                            <EmptyState icon={<Search className="size-6" />} title="Nothing matches">
                                Try another filter or search.
                            </EmptyState>
                        ) : view === "grid" ? (
                            // Only the rows of cards near the screen are rendered:
                            // libraries can have thousands of titles.
                            <VirtualGrid
                                items={shown}
                                getKey={t => t.media.id}
                                minItemWidth={cardMinWidth(status?.settings.ui.cardSize)}
                                extraHeight={cardTextHeight}
                                renderItem={t => <MediaCard media={t.media} listEntry={t.listEntry} localCount={t.files.length} downloaded={t.episodes} menu={libraryMenu.menu(t.media)} />}
                            />
                        ) : (
                            // This look: rows on hairlines, not a box each.
                            <VirtualList
                                className={classic ? undefined : "border-t border-line"}
                                items={shown}
                                getKey={t => t.media.id}
                                estimateSize={classic ? 130 : 129}
                                gap={classic ? 12 : 0}
                                renderItem={t => (
                                    <LibraryRow
                                        item={t}
                                        menu={host ? undefined : libraryMenu.menu(t.media)}
                                        trusted={trusted && !host}
                                        open={openRows.has(t.media.id)}
                                        onToggle={() => toggleRow(t.media.id)}
                                        onOpen={openFolder}
                                        onPlay={f => playLocal(f.path, f.mediaId, f.episode)}
                                    />
                                )}
                            />
                        )}
                    </section>
                )}
            </div>
            {libraryMenu.dialog}
        </div>
    )
}

// menu: the grid card's menu for the same title (its local files), after the row's own items.
function LibraryRow({
    item: t,
    trusted,
    open,
    onToggle,
    onOpen,
    onPlay,
    menu,
}: {
    item: LibraryTitle
    trusted: boolean
    open: boolean
    onToggle: () => void
    onOpen: (path: string) => void
    onPlay: (f: LocalFile) => void
    menu?: React.ReactNode
}) {
    const navigate = useNavigate()
    const classic = useClassic()
    const m = t.media
    const le = t.listEntry
    const total = totalEpisodes(m)
    const isMovie = !mediaIsShow(m)
    const marker = useEpisodeMarker(m)
    const upTo = watchedUpTo(t)
    // A right-click on the row: what its buttons do, then the card's menu.
    const rowMenu = (
        <>
            {t.next && (
                <DropdownItem icon={<Play />} onSelect={() => onPlay(t.next!)}>
                    {isMovie ? "Play" : `Play ${formatKey(t.next.episode)}`}
                </DropdownItem>
            )}
            <DropdownItem icon={<Info />} onSelect={() => navigate(entryUrl(m))}>
                Its page
            </DropdownItem>
            <DropdownItem icon={<ListIcon />} onSelect={onToggle}>
                {open ? "Hide files" : "Show files"}
            </DropdownItem>
            {menu ? (
                <>
                    <DropdownSeparator />
                    {menu}
                </>
            ) : (
                trusted &&
                t.dir && (
                    <DropdownItem icon={<FolderOpen />} onSelect={() => onOpen(t.dir)}>
                        Open folder
                    </DropdownItem>
                )
            )}
        </>
    )
    // What's on disk, as one line of words.
    const onDisk = isMovie ? "Movie" : t.seasons.map(s => `${s.ranges}${s.total > 0 && s.count < s.total ? ` (${s.count}/${s.total})` : ""}`).join(", ")

    return (
        <div className={classic ? "card overflow-hidden" : "border-b border-line"}>
            {/* On a phone the actions go under the text. */}
            <ContextArea menu={rowMenu} className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", classic ? "p-4" : "py-4")}>
                <Link to={entryUrl(m)} className="shrink-0">
                    <img {...poster(m, 64)} alt="" loading="lazy" decoding="async" className="h-24 w-16 rounded-xl object-cover ring-1 ring-white/10" style={{ backgroundColor: m.coverImage?.color || undefined }} />
                </Link>
                <div className="min-w-0 flex-1">
                    <Link to={entryUrl(m)} className="line-clamp-1 text-[15px] font-semibold hover:underline">
                        {title(m)}
                    </Link>
                    <p className="mt-1 line-clamp-1 text-[13px] text-muted">
                        {[formatLabel(m.format), year(m) || "", le ? (LIST_STATUS[le.status] ?? le.status) : "Not on your list", le && total > 0 && !isMovie ? `watched ${episodeIndex(m, le.progress)}/${total}` : ""].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-[13px] text-subtle">
                        <span className="text-fg/85">{onDisk}</span>
                        {t.unwatched > 0 && <span className="text-brand-strong"> · {isMovie ? "Unwatched" : `${t.unwatched} unwatched`}</span>}
                        {[t.specials > 0 ? `+${t.specials} specials` : "", t.extras > 0 ? `+${t.extras} extras` : "", ...t.resolutions.slice(0, 2), ...t.releaseGroups.slice(0, 2), formatBytes(t.size), `added ${relativeTime(t.addedAt)}`]
                            .filter(Boolean)
                            .map(x => ` · ${x}`)
                            .join("")}
                    </p>
                </div>
                <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                    {t.next && (
                        <Button size="sm" className="rounded-xl" icon={<Play className="size-4 fill-current" />} onClick={() => onPlay(t.next!)}>
                            {isMovie ? "Play" : formatKey(t.next.episode)}
                        </Button>
                    )}
                    {trusted && t.dir && (
                        <IconButton label="Open folder" size="sm" className="rounded-xl" onClick={() => onOpen(t.dir)}>
                            <FolderOpen className="size-4" />
                        </IconButton>
                    )}
                    <IconButton label={open ? "Hide files" : "Show files"} size="sm" className="rounded-xl" onClick={onToggle}>
                        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                    </IconButton>
                </div>
            </ContextArea>
            {open && (
                <div className={classic ? "bg-black/20 py-1" : "pb-2"}>
                    {t.files.map(f => {
                        const keys = fileKeys(f)
                        const episode = f.kind === "main" && keys.length > 0
                        const watched = episode && keys.every(k => k <= upTo)
                        const mark = () => marker.mark(watched ? keys[0] : keys[keys.length - 1], !watched)
                        const fileMenu = (
                            <>
                                <DropdownItem icon={<Play />} onSelect={() => onPlay(f)}>
                                    Play
                                </DropdownItem>
                                {episode && (
                                    <DropdownItem icon={<CheckCheck />} disabled={marker.pending} onSelect={mark}>
                                        {watched ? "Mark as unwatched" : "Mark as watched"}
                                    </DropdownItem>
                                )}
                            </>
                        )
                        return (
                            <ContextArea key={f.path} menu={fileMenu} className={cn("group/file flex w-full items-center gap-3 py-2 text-sm transition hover:bg-white/[0.04]", classic ? "px-4" : "px-2")}>
                                <button onClick={() => onPlay(f)} title={f.path} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                                    <span className={cn("grid size-7 shrink-0 place-items-center text-muted transition", classic ? "rounded-full bg-white/[0.06] group-hover/file:bg-brand group-hover/file:text-white" : "group-hover/file:text-fg")}>
                                        <Play className="ml-0.5 size-3 fill-current" />
                                    </span>
                                    <span className={cn("w-28 shrink-0 font-semibold tabular-nums", watched && "text-subtle")}>{fileLabel(f)}</span>
                                    <span className={cn("min-w-0 flex-1 truncate", watched ? "text-subtle" : "text-fg/85")}>{f.name}</span>
                                </button>
                                {f.parsed?.resolution && <span className="hidden shrink-0 text-xs text-subtle sm:inline">{f.parsed.resolution}</span>}
                                <span className="w-20 shrink-0 text-right text-xs text-subtle tabular-nums">{formatBytes(f.size)}</span>
                                {episode && (
                                    <Tooltip content={watched ? "Mark as unwatched" : "Mark as watched"}>
                                        <button
                                            aria-label={watched ? "Mark as unwatched" : "Mark as watched"}
                                            disabled={marker.pending}
                                            onClick={mark}
                                            className={cn(
                                                "grid size-7 shrink-0 place-items-center rounded-full transition disabled:opacity-50",
                                                watched ? (classic ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" : "text-emerald-300 hover:bg-white/[0.08]") : "text-subtle hover:bg-white/[0.08] hover:text-fg",
                                            )}
                                        >
                                            {watched ? <CheckCheck className="size-3.5" /> : <Check className="size-3.5" />}
                                        </button>
                                    </Tooltip>
                                )}
                            </ContextArea>
                        )
                    })}
                    {t.dir && <p className={cn("truncate py-2 font-mono text-[11px] text-subtle", classic ? "px-4" : "px-2")}>{t.dir}</p>}
                </div>
            )}
        </div>
    )
}
