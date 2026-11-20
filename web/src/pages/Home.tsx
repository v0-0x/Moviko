import { useQueryClient } from "@tanstack/react-query"
import {
    ArrowDownUp,
    ArrowLeftRight,
    ChevronLeft,
    ChevronRight,
    Dices,
    FolderOpen,
    FolderSync,
    HardDrive,
    Info,
    KeyRound,
    ListFilter,
    Minus,
    MoreVertical,
    Play,
    Plug,
    Puzzle,
    RefreshCw,
    RotateCcw,
    Settings2,
    X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { DevicePrompts } from "@/components/DevicePrompts"
import { EpisodeCard } from "@/components/EpisodeCard"
import { LetterboxdDialog, LetterboxdMark } from "@/components/LetterboxdDialog"
import { ListCardMenu } from "@/components/ListCardMenu"
import { Carousel, MediaCard, MediaCardSkeleton, MediaGrid } from "@/components/MediaCard"
import { useLibraryCardMenu } from "@/components/library/LibraryCardMenu"
import { NotificationsButton } from "@/components/Notifications"
import { PluginSlot } from "@/components/plugins/PluginSlot"
import { ProgramsNotice } from "@/components/ProgramsNotice"
import { SleepingHosts } from "@/components/SleepingHosts"
import { artButton, Backdrop, Button, Chip, ChipRow, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, EmptyState, IconButton, SectionHeader, Skeleton } from "@/components/ui"
import { UpdateBanner } from "@/components/UpdateBanner"
import { WatchPicker } from "@/components/WatchPicker"
import { api } from "@/lib/api"
import { usePersisted } from "@/lib/hooks"
import { episodeIndex, formatKey, mediaIsShow, totalEpisodes } from "@/lib/ids"
import { usePlay } from "@/lib/play"
import { resultSummary, useCollection, useDiscover, useLetterboxd, useScan, useStatus } from "@/lib/queries"
import { scanStore, useStore } from "@/lib/store"
import { useClassic } from "@/lib/themes"
import { toast } from "@/lib/toast"
import { tv } from "@/lib/tv"
import type { CollectionItem, CollectionView, ContinueItem, Media } from "@/lib/types"
import { banner, cn, cover, formatDuration, HOME_SECTIONS, img as imgUrl, title, year } from "@/lib/utils"

type SortKey = "activity" | "title" | "score" | "progress" | "airing"

const KNOWN = new Set(HOME_SECTIONS.map(s => s.id))
const CARD_WIDTH: Record<string, string> = { sm: "w-[130px]", md: "w-[160px]", lg: "w-[200px]" }

export default function HomePage() {
    const { data: status } = useStatus()
    const { data, isLoading, error } = useCollection()
    const tmdb = status?.tmdbConfigured !== false
    const { data: discover } = useDiscover(tmdb)
    const scan = useScan()
    const scanning = useStore(scanStore, s => s.running)
    const letterboxd = useLetterboxd()
    const [genre, setGenre] = useState<string | null>(null)
    const [onlyLocal, setOnlyLocal] = usePersisted("kumobox-home-only-local", false)
    const [sort, setSort] = usePersisted<SortKey>("kumobox-home-sort", "activity")
    const [letterboxdOpen, setLetterboxdOpen] = useState(false)
    const navigate = useNavigate()
    const libraryMenu = useLibraryCardMenu()
    const sections = (status?.settings.ui.homeSections ?? HOME_SECTIONS.map(s => s.id)).filter(id => KNOWN.has(id))
    const cardWidth = CARD_WIDTH[status?.settings.ui.cardSize ?? "md"] ?? CARD_WIDTH.md

    const continueItems = sections.includes("continue") ? (data?.continueWatching ?? []) : []
    const [heroIdx, setHeroIdx] = useState(0)
    // Removing items can leave the index past the end.
    const heroAt = Math.min(heroIdx, Math.max(0, continueItems.length - 1))
    const hero = continueItems[heroAt] ?? null
    const trending = (discover?.trending ?? []).find(m => m.bannerImage) ?? null

    const rows = useMemo(() => {
        const filter = (items: CollectionItem[]) => {
            let out = items
            if (genre) out = out.filter(i => i.media.genres?.includes(genre))
            if (onlyLocal) out = out.filter(i => i.localFiles > 0)
            const sorted = [...out]
            switch (sort) {
                case "title":
                    sorted.sort((a, b) => title(a.media).localeCompare(title(b.media)))
                    break
                case "score":
                    sorted.sort((a, b) => (b.listEntry?.score || b.media.averageScore || 0) - (a.listEntry?.score || a.media.averageScore || 0))
                    break
                case "progress":
                    sorted.sort((a, b) => episodeIndex(b.media, b.listEntry?.progress ?? 0) - episodeIndex(a.media, a.listEntry?.progress ?? 0))
                    break
                case "airing":
                    sorted.sort((a, b) => (a.media.nextAiringEpisode?.airingAt ?? Infinity) - (b.media.nextAiringEpisode?.airingAt ?? Infinity))
                    break
            }
            return sorted
        }
        const ls = data?.lists ?? []
        const of = (...st: string[]) => ls.filter(l => st.includes(l.status)).flatMap(l => l.items)
        const recent = (items: CollectionItem[]) => [...items].sort((a, b) => (b.listEntry?.updatedAt ?? 0) - (a.listEntry?.updatedAt ?? 0))
        const airing = of("CURRENT", "REPEATING", "PLANNING", "PAUSED")
            .filter(i => mediaIsShow(i.media) && i.media.status === "RELEASING")
            .sort((a, b) => (a.media.nextAiringEpisode?.airingAt ?? Infinity) - (b.media.nextAiringEpisode?.airingAt ?? Infinity))
        const all: Record<string, { name: string; subtitle?: string; items: CollectionItem[]; more: string }> = {
            watching: { name: "Watching", items: filter(of("CURRENT", "REPEATING")), more: "/lists?status=CURRENT" },
            airing: { name: "Airing shows", subtitle: "Shows on your list with new episodes", items: genre || onlyLocal ? filter(airing) : airing, more: "/schedule" },
            planning: { name: "Watchlist", items: filter(of("PLANNING")), more: "/lists?status=PLANNING" },
            completed: { name: "Recently watched", items: sort === "activity" ? recent(filter(of("COMPLETED"))) : filter(of("COMPLETED")), more: "/lists?status=COMPLETED" },
        }
        return all
    }, [data, genre, onlyLocal, sort])

    const sync = () => {
        if (!status?.letterboxd) {
            setLetterboxdOpen(true)
            return
        }
        const id = toast.loading("Syncing with Letterboxd…")
        letterboxd.sync.mutate(undefined, { onSuccess: r => toast.success(`Synced with Letterboxd: ${resultSummary(r)}`, { id }), onError: () => toast.dismiss(id) })
    }

    // Paired with another Moviko (a TV, a computer): Sync brings the watch
    // history from each to the other now, so Continue watching goes on from
    // where it stopped on any of them.
    const paired = status?.paired ?? []
    const [picking, setPicking] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const qc = useQueryClient()
    const syncDevices = async () => {
        setSyncing(true)
        const id = toast.loading(`Syncing with ${paired.join(", ")}…`)
        try {
            const res = await api.post<{ devices: string[]; unreachable: string[] | null; skipped?: string[] | null; updated: number }>("/api/sharing/sync")
            qc.invalidateQueries({ queryKey: ["collection"] })
            qc.invalidateQueries({ queryKey: ["entry"] })
            // What didn't go as it should, each with why (the server says).
            const notes = [...(res.unreachable ?? []).map(d => `Couldn't sync with ${d}.`), ...(res.skipped ?? []).map(d => `Not synced with ${d}.`)].join(" ")
            if (!res.devices?.length) {
                if (notes) toast.error(notes, { id })
                else toast.success("Nothing to sync", { id })
            } else {
                const what = res.updated > 0 ? `${res.updated} position${res.updated === 1 ? "" : "s"} updated` : "already up to date"
                toast.success(`Synced with ${res.devices.join(", ")}: ${what}.${notes ? " " + notes : ""}`, { id })
            }
        } catch (e: any) {
            toast.error(e.message, { id })
        } finally {
            setSyncing(false)
        }
    }

    const isEmpty = !isLoading && !error && (data?.lists ?? []).every(l => l.items.length === 0) && (data?.localOnly?.length ?? 0) === 0
    const filtered = !!genre || onlyLocal
    const listRowsEmpty = sections.filter(id => rows[id]).every(id => rows[id].items.length === 0)
    const clearFilters = () => {
        setGenre(null)
        setOnlyLocal(false)
    }
    const local = data?.localOnly ?? []

    return (
        <div className="relative min-h-full pb-24">
            <WatchPicker open={picking} onOpenChange={setPicking} />
            <UpdateBanner />
            <SleepingHosts />
            <DevicePrompts />
            {!!data?.incomplete && (
                <p className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-[13px] text-muted md:mx-8 xl:mx-10">
                    <RefreshCw className="size-3.5 shrink-0 animate-spin" />
                    {data.incomplete} {data.incomplete === 1 ? "title in your library is" : "titles in your library are"} still being looked up on TMDB.
                </p>
            )}
            <Hero
                item={hero}
                trending={hero ? null : trending}
                count={continueItems.length}
                index={heroAt}
                onIndex={setHeroIdx}
                loading={isLoading}
                toolbar={
                    <div className="glass flex items-center gap-0.5 rounded-lg p-1 [&_button]:text-white/80 [&_button:hover]:bg-white/10 [&_button:hover]:text-white [&_button[data-state=open]]:bg-white/10">
                        {/* What the sidebar has (the library, its tools, downloads) isn't repeated here. */}
                        <IconButton label="What should I watch?" size="sm" onClick={() => setPicking(true)}>
                            <Dices className="size-4" />
                        </IconButton>
                        <IconButton label="Refresh the library" size="sm" onClick={() => scan.mutate(false)} disabled={scanning || scan.isPending}>
                            <FolderSync className={cn("size-4", (scanning || scan.isPending) && "animate-pulse")} />
                        </IconButton>
                        {paired.length > 0 && (
                            <IconButton label={`Sync with ${paired.join(", ")}`} size="sm" onClick={syncDevices} disabled={syncing}>
                                <ArrowLeftRight className={cn("size-4", syncing && "animate-pulse")} />
                            </IconButton>
                        )}
                        <Dropdown>
                            <DropdownTrigger asChild>
                                <IconButton label="Show, sort and more" size="sm">
                                    <MoreVertical className="size-4" />
                                </IconButton>
                            </DropdownTrigger>
                            <DropdownContent>
                                <DropdownLabel>Show</DropdownLabel>
                                <DropdownItem icon={<HardDrive />} checked={onlyLocal} onSelect={() => setOnlyLocal(!onlyLocal)}>
                                    Only what's in my library
                                </DropdownItem>
                                <DropdownItem icon={<ListFilter />} checked={!onlyLocal} onSelect={() => setOnlyLocal(false)}>
                                    Everything on my list
                                </DropdownItem>
                                <DropdownSeparator />
                                <DropdownLabel>Sort by</DropdownLabel>
                                {(
                                    [
                                        ["activity", "Recent activity"],
                                        ["title", "Title"],
                                        ["score", "Rating"],
                                        ["progress", "Progress"],
                                        ["airing", "Next episode"],
                                    ] as [SortKey, string][]
                                ).map(([k, l]) => (
                                    <DropdownItem key={k} icon={<ArrowDownUp />} checked={sort === k} onSelect={() => setSort(k)}>
                                        {l}
                                    </DropdownItem>
                                ))}
                                <DropdownSeparator />
                                <DropdownItem icon={<Settings2 />} onSelect={() => navigate("/settings?tab=ui")}>
                                    Choose sections…
                                </DropdownItem>
                                <DropdownSeparator />
                                <DropdownItem icon={<RefreshCw />} onSelect={() => scan.mutate(true)}>
                                    Full rescan (re-match everything)
                                </DropdownItem>
                                <DropdownItem icon={<LetterboxdMark className="w-4" />} onSelect={sync}>
                                    {status?.letterboxd ? "Sync with Letterboxd" : "Connect Letterboxd"}
                                </DropdownItem>
                                {status?.client !== "lan" && (
                                    <DropdownItem icon={<FolderOpen />} onSelect={() => api.post("/api/open", { path: status?.settings.library.dir }).catch(e => toast.error(e.message))}>
                                        Open library folder
                                    </DropdownItem>
                                )}
                            </DropdownContent>
                        </Dropdown>
                    </div>
                }
            />

            <div className="relative z-10 -mt-20 flex flex-col gap-10 px-6 md:px-8 xl:px-10">
                <PluginSlot slot="after-home-screen-toolbar" />
                <ProgramsNotice />

                {isEmpty && (
                    <Welcome
                        tmdb={!!status?.tmdbConfigured}
                        letterboxd={!!status?.letterboxd}
                        hasDir={!!status?.settings.library.dir}
                        onLetterboxd={() => setLetterboxdOpen(true)}
                    />
                )}
                {error && (
                    <EmptyState icon={<RefreshCw className="size-6" />} title="Couldn't load your library">
                        {(error as Error).message}
                    </EmptyState>
                )}
                {isLoading && (
                    <>
                        <div className="flex gap-5">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <Skeleton key={i} className="aspect-video w-[400px]" />
                            ))}
                        </div>
                        <MediaGrid>
                            {Array.from({ length: 12 }).map((_, i) => (
                                <MediaCardSkeleton key={i} />
                            ))}
                        </MediaGrid>
                    </>
                )}

                {!isLoading &&
                    sections.map(id => {
                        if (id === "continue") return continueItems.length > 0 ? <ContinueRow key={id} items={continueItems} onFocus={setHeroIdx} /> : null
                        if (id === "genres") return (data?.genres?.length ?? 0) > 0 ? <GenreBar key={id} genres={data!.genres!} value={genre} onChange={setGenre} /> : null
                        const row = rows[id]
                        if (!row || row.items.length === 0) return null
                        return (
                            <section key={id} className="fade-in">
                                <SectionHeader
                                    title={
                                        <span className="flex items-baseline gap-2.5">
                                            {row.name}
                                            <span className="text-sm font-normal text-subtle tabular-nums">{row.items.length}</span>
                                        </span>
                                    }
                                    subtitle={row.subtitle}
                                    action={
                                        <Link to={row.more} className="text-[13px] font-medium text-muted transition-colors hover:text-fg">
                                            See all
                                        </Link>
                                    }
                                />
                                <Carousel itemClassName={cardWidth}>
                                    {row.items.map(it => (
                                        <MediaCard key={it.media.id} media={it.media} listEntry={it.listEntry} localCount={it.localFiles} downloaded={it.downloaded} />
                                    ))}
                                </Carousel>
                            </section>
                        )
                    })}

                {!isLoading && !error && !isEmpty && filtered && listRowsEmpty && (
                    <EmptyState
                        icon={<ListFilter className="size-6" />}
                        title="Nothing matches these filters"
                        action={
                            <Button icon={<X className="size-4" />} onClick={clearFilters}>
                                Clear filters
                            </Button>
                        }
                    >
                        {genre ? `Nothing ${onlyLocal ? "in your library" : "on your list"} is tagged ${genre}.` : "Nothing on your list is in your library yet."}
                    </EmptyState>
                )}

                {local.length > 0 && (
                    <section className="fade-in">
                        <SectionHeader title="In your library" subtitle="Files matched to movies and shows that aren't on your list" />
                        <MediaGrid size={status?.settings.ui.cardSize}>
                            {local.map(it => (
                                // Here only because of local files, which the menu acts on.
                                <MediaCard key={it.media.id} media={it.media} listEntry={it.listEntry} localCount={it.localFiles} downloaded={it.downloaded} menu={libraryMenu.menu(it.media)} />
                            ))}
                        </MediaGrid>
                    </section>
                )}

                {tmdb && discover && <DiscoverRows discover={[
                    { name: "Trending this week", items: discover.trending, more: "/discover" },
                    { name: "Popular movies", items: discover.popularMovies, more: "/search?type=MOVIE&sort=POPULARITY_DESC" },
                    { name: "Popular shows", items: discover.popularShows, more: "/search?type=TV&sort=POPULARITY_DESC" },
                ]} cardWidth={cardWidth} />}

                <PluginSlot slot="home-screen-bottom" />
            </div>
            <LetterboxdDialog open={letterboxdOpen} onOpenChange={setLetterboxdOpen} />
            {libraryMenu.dialog}
        </div>
    )
}

function DiscoverRows({ discover, cardWidth }: { discover: { name: string; items: Media[] | null; more: string }[]; cardWidth: string }) {
    return (
        <>
            {discover
                .filter(r => (r.items?.length ?? 0) > 0)
                .map(r => (
                    <section key={r.name} className="fade-in">
                        <SectionHeader
                            title={r.name}
                            action={
                                <Link to={r.more} className="text-[13px] font-medium text-muted transition-colors hover:text-fg">
                                    See more
                                </Link>
                            }
                        />
                        <Carousel itemClassName={cardWidth}>
                            {r.items!.map(m => (
                                <MediaCard key={m.id} media={m} listEntry={m.mediaListEntry} menu={<ListCardMenu media={m} />} />
                            ))}
                        </Carousel>
                    </section>
                ))}
        </>
    )
}

function Hero({
    item,
    trending,
    count,
    index,
    onIndex,
    loading,
    toolbar,
}: {
    item: ContinueItem | null
    trending: Media | null
    count: number
    index: number
    onIndex: (i: number) => void
    loading: boolean
    toolbar: React.ReactNode
}) {
    const classic = useClassic()
    const play = useContinuePlay()
    const started = !!item && item.resumeAt > 0
    const left = !item ? 0 : item.duration > 0 ? Math.max(1, Math.round((item.duration - item.resumeAt) / 60)) : item.runtime
    // The sharp backdrop, like the entry page: episode stills can be small.
    const img = item ? (item.media.bannerImage ? banner(item.media) : imgUrl(item.image) || cover(item.media)) : trending ? banner(trending) : ""
    const show = item && mediaIsShow(item.media)
    return (
        <div className="relative h-[clamp(340px,50vh,540px)] w-full overflow-hidden max-sm:h-[440px]">
            {img ? <Backdrop src={img} className="absolute inset-0 size-full object-cover [mask-image:linear-gradient(to_bottom,#000_80%,transparent)]" /> : <div className="absolute inset-0 bg-surface-1" />}
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-bg/5" />
            <div className="absolute inset-0 bg-gradient-to-r from-bg/80 via-bg/25 to-transparent" />
            <div className="absolute top-4 right-4 z-20">{toolbar}</div>
            {/* Across from the toolbar, on its line; under it on a phone, where its buttons reach across. */}
            <div className="absolute top-4 left-4 z-20 max-sm:top-14">
                <NotificationsButton />
            </div>
            <div className="absolute inset-x-0 bottom-28 px-6 md:px-8 xl:px-10">
                {loading ? (
                    <Skeleton className="h-11 w-96" />
                ) : item ? (
                    // Clear of the arrows at its right on a phone.
                    <div key={item.media.id} className="max-w-3xl rise-in max-sm:pr-20">
                        <p className={cn(classic ? "text-sm font-medium" : "label", "text-white/65 max-sm:hidden")}>Continue watching</p>
                        {/* On a TV the cards below are what's picked (the banner follows them). */}
                        <Link to={`/entry?id=${item.media.id}`} data-tv-skip-nav className="mt-1.5 line-clamp-2 text-4xl leading-[1.1] font-semibold tracking-tight text-white transition-colors hover:text-white/85 md:text-[2.75rem]">
                            {title(item.media)}
                        </Link>
                        {/* What's next: which episode, how much is left, and play. */}
                        <p className="mt-2 line-clamp-1 text-[15px] text-white/80">
                            {show ? formatKey(item.episode) : year(item.media) || "Movie"}
                            {show && item.title && <span> · {item.title}</span>}
                            {left > 0 && (
                                <span className="text-white/50">
                                    {" "}
                                    · {left} min{started ? " left" : ""}
                                </span>
                            )}
                        </p>
                        {started && item.duration > 0 && (
                            <div className="mt-3 h-1 w-64 max-w-full overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label="Watched" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((item.resumeAt / item.duration) * 100)}>
                                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (item.resumeAt / item.duration) * 100)}%` }} />
                            </div>
                        )}
                        {!tv && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                <Button variant="white" icon={<Play className="size-4 fill-current" />} onClick={() => play(item)}>
                                    {started ? "Resume" : show ? `Play ${formatKey(item.episode)}` : "Play"}
                                </Button>
                                <Link to={`/entry?id=${item.media.id}`} className={classic ? "focus-ring inline-flex h-9 items-center rounded-full bg-white/10 px-4 font-display text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20" : artButton}>
                                    Details
                                </Link>
                            </div>
                        )}
                    </div>
                ) : trending ? (
                    <div key={trending.id} className="max-w-3xl rise-in">
                        <p className={cn(classic ? "text-sm font-medium" : "label", "text-white/65")}>Trending this week</p>
                        <Link to={`/entry?id=${trending.id}`} className="mt-1.5 block text-4xl leading-[1.1] font-semibold tracking-tight text-white transition-colors hover:text-white/85 md:text-[2.75rem]">
                            {title(trending)}
                            {year(trending) > 0 && <span className="ml-3 text-[0.55em] font-normal text-white/50">{year(trending)}</span>}
                        </Link>
                    </div>
                ) : (
                    <div className="rise-in">
                        <p className={cn(classic ? "text-sm font-medium" : "label", "text-white/65")}>Welcome to</p>
                        <h1 className="mt-1 text-4xl font-semibold tracking-tight">Moviko</h1>
                    </div>
                )}
            </div>
            {count > 1 && (
                <div data-tv-skip-nav className="absolute right-4 bottom-28 z-20 flex items-center gap-3 md:right-8 xl:right-10">
                    <div className="flex gap-1.5 max-sm:hidden">
                        {Array.from({ length: Math.min(count, 8) }).map((_, i) => (
                            <button
                                key={i}
                                aria-label={`Show ${i + 1}`}
                                onClick={() => onIndex(i)}
                                className={cn("h-1 rounded-full transition-all duration-300", i === index ? "w-5 bg-white" : "w-2.5 bg-white/30 hover:bg-white/50")}
                            />
                        ))}
                    </div>
                    <div className="flex gap-1">
                        <button aria-label="Previous" className="glass grid size-8 place-items-center rounded-full transition-colors hover:bg-black/70" onClick={() => onIndex((index - 1 + count) % count)}>
                            <ChevronLeft className="size-4" />
                        </button>
                        <button aria-label="Next" className="glass grid size-8 place-items-center rounded-full transition-colors hover:bg-black/70" onClick={() => onIndex((index + 1) % count)}>
                            <ChevronRight className="size-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

// Plays what a Continue watching item says: its file, else a stream.
function useContinuePlay() {
    const { playLocal, watch } = usePlay()
    return (it: ContinueItem) => {
        // From where the card says: the position shown, not one saved since
        // (the same episode watched further, or finished, on another device
        // after this page was loaded).
        if (it.hasFile && it.filePath) return playLocal(it.filePath, it.media.id, it.episode, it.resumeAt > 0 ? { start: it.resumeAt } : {})
        return watch(it.media.id, it.episode, null)
    }
}

function ContinueRow({ items, onFocus }: { items: ContinueItem[]; onFocus: (i: number) => void }) {
    const play = useContinuePlay()
    const { playLocal } = usePlay()
    const navigate = useNavigate()
    const qc = useQueryClient()
    const ref = useRef<HTMLDivElement>(null)
    // Arrows on a computer, when there's more that way (a TV moves with its
    // remote; a touch screen swipes).
    const [edges, setEdges] = useState({ left: false, right: false })
    const check = () => {
        const el = ref.current
        if (!el) return
        const left = el.scrollLeft > 2
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
        setEdges(e => (e.left === left && e.right === right ? e : { left, right }))
    }
    useEffect(check)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const ro = new ResizeObserver(check)
        ro.observe(el)
        el.addEventListener("scroll", check, { passive: true })
        return () => {
            ro.disconnect()
            el.removeEventListener("scroll", check)
        }
    }, [])
    // A card's width at a time (as many as fit), to a card's edge.
    const scroll = (dir: -1 | 1) => {
        const el = ref.current
        if (!el) return
        const card = el.firstElementChild as HTMLElement | null
        const step = card ? card.offsetWidth + 20 : 420
        el.scrollBy({ left: dir * Math.max(step, Math.floor(el.clientWidth / step) * step), behavior: "smooth" })
    }
    const arrow = (dir: -1 | 1) => (
        <button
            onClick={() => scroll(dir)}
            data-tv-skip-nav
            aria-label={dir < 0 ? "Back" : "More"}
            className={cn(
                "absolute top-[calc((min(82vw,400px)*9/16)/2)] z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/60 text-white/85 shadow-lg backdrop-blur transition-colors hover:bg-black/80 hover:text-white fade-in [@media(hover:none)]:hidden",
                dir < 0 ? "left-1" : "right-1",
            )}
        >
            {dir < 0 ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
        </button>
    )
    // The server hides it until it offers another episode or it's watched
    // again. This row and the hero both show the collection's list, so it is
    // edited right away (a refetch in flight would undo that).
    const remove = async (it: ContinueItem, at: number) => {
        const edit = (fn: (list: ContinueItem[]) => ContinueItem[]) =>
            qc.setQueryData<CollectionView>(["collection"], old => (old ? { ...old, continueWatching: fn(old.continueWatching ?? []) } : old))
        const refresh = () => qc.invalidateQueries({ queryKey: ["collection"] })
        await qc.cancelQueries({ queryKey: ["collection"] })
        edit(list => list.filter(x => x.media.id !== it.media.id))
        const hidden = api.post("/api/continue/hide", { mediaId: it.media.id, episode: it.episode })
        hidden.catch(e => toast.error(e.message)).finally(refresh)
        toast.success("Removed from Continue watching", {
            action: {
                label: "Undo",
                onClick: async () => {
                    await qc.cancelQueries({ queryKey: ["collection"] })
                    edit(list => (list.some(x => x.media.id === it.media.id) ? list : [...list.slice(0, at), it, ...list.slice(at)]))
                    await hidden.catch(() => {}) // unhide after the hide, never before
                    api.post("/api/continue/unhide", { mediaId: it.media.id })
                        .catch(e => toast.error(e.message))
                        .finally(refresh)
                },
            },
        })
    }
    return (
        <div className="relative">
            {!tv && edges.left && arrow(-1)}
            {!tv && edges.right && arrow(1)}
        <div ref={ref} className="stagger no-scrollbar -mx-2 -mt-1.5 flex snap-x scroll-px-2 gap-5 overflow-x-auto px-2 pt-1.5 pb-2">
            {items.map((it, i) => {
                const show = mediaIsShow(it.media)
                const total = totalEpisodes(it.media) || it.total
                const left = it.duration > 0 && it.resumeAt > 0 ? it.duration - it.resumeAt : 0
                return (
                    <div key={it.media.id} className="w-[min(82vw,400px)] shrink-0 snap-start" onMouseEnter={() => onFocus(i)} onFocus={() => onFocus(i)} data-tv-autofocus={i === 0 || undefined}>
                        <EpisodeCard
                            large
                            image={it.image || (show ? "" : it.media.bannerImage)}
                            label={show ? formatKey(it.episode) : "Movie"}
                            title={show ? it.title || formatKey(it.episode) : title(it.media)}
                            subtitle={
                                show ? (
                                    <span>
                                        <span className="text-fg/80">{formatKey(it.episode)}</span>
                                        {total > 0 && (
                                            <span className="text-subtle">
                                                {" "}
                                                · {it.index || episodeIndex(it.media, it.episode)} of {total}
                                            </span>
                                        )}
                                        <span className="text-subtle"> · {title(it.media)}</span>
                                    </span>
                                ) : (
                                    <span className="text-subtle">{left > 0 ? `${formatDuration(left)} left` : year(it.media) || "Movie"}</span>
                                )
                            }
                            runtime={it.runtime}
                            hasFile={it.hasFile}
                            progress={it.duration > 0 ? it.resumeAt / it.duration : 0}
                            resumeAt={it.resumeAt}
                            onClick={() => play(it)}
                            onRemove={() => remove(it, i)}
                            onInfo={() => navigate(`/entry?id=${it.media.id}`)}
                            // On a right-click, and under its "⋯".
                            menu={
                                <>
                                    <DropdownItem icon={<Play />} onSelect={() => play(it)}>
                                        {it.resumeAt > 0 ? "Resume" : "Play"}
                                    </DropdownItem>
                                    {it.hasFile && it.filePath && it.resumeAt > 0 && (
                                        <DropdownItem icon={<RotateCcw />} onSelect={() => playLocal(it.filePath!, it.media.id, it.episode, { start: 0 })}>
                                            Play from the beginning
                                        </DropdownItem>
                                    )}
                                    <DropdownItem icon={<Info />} onSelect={() => navigate(`/entry?id=${it.media.id}`)}>
                                        {show ? "Show page" : "Movie page"}
                                    </DropdownItem>
                                    <DropdownSeparator />
                                    <DropdownItem icon={<Minus />} onSelect={() => remove(it, i)}>
                                        Remove from Continue watching
                                    </DropdownItem>
                                </>
                            }
                        />
                    </div>
                )
            })}
        </div>
        </div>
    )
}

function GenreBar({ genres, value, onChange }: { genres: string[]; value: string | null; onChange: (g: string | null) => void }) {
    return (
        <ChipRow label="More genres">
            <Chip on={!value} onClick={() => onChange(null)}>
                All
            </Chip>
            {genres.map(g => (
                <Chip key={g} on={value === g} onClick={() => onChange(value === g ? null : g)}>
                    {g}
                </Chip>
            ))}
        </ChipRow>
    )
}

function Welcome({ tmdb, letterboxd, hasDir, onLetterboxd }: { tmdb: boolean; letterboxd: boolean; hasDir: boolean; onLetterboxd: () => void }) {
    const steps = [
        {
            done: tmdb,
            icon: <KeyRound className="size-5" />,
            title: "Add a TMDB key",
            text: "Free from themoviedb.org: posters, seasons and episodes.",
            action: (
                <Link to="/settings?tab=metadata">
                    <Button size="sm" variant="primary">
                        Set up TMDB
                    </Button>
                </Link>
            ),
        },
        {
            done: hasDir,
            icon: <FolderOpen className="size-5" />,
            title: "Choose your library folder",
            text: "Moviko scans it and matches your movies and episodes.",
            action: (
                <Link to="/settings?tab=library">
                    <Button size="sm">Open settings</Button>
                </Link>
            ),
        },
        {
            done: letterboxd,
            icon: <Plug className="size-5" />,
            title: "Connect Letterboxd",
            text: "Bring your diary, ratings and watchlist. Optional.",
            action: (
                <Button size="sm" onClick={onLetterboxd}>
                    Connect
                </Button>
            ),
        },
        {
            done: false,
            icon: <Puzzle className="size-5" />,
            title: "Add streaming providers",
            text: "Turn on the built-in ones, or add Stremio addons and extensions.",
            action: (
                <Link to="/extensions">
                    <Button size="sm">Providers & extensions</Button>
                </Link>
            ),
        },
    ]
    return (
        <div className="card overflow-hidden rise-in">
            <div className="p-7">
                <h2 className="text-xl font-semibold tracking-tight">Let’s set things up</h2>
                <p className="mt-1 text-sm text-muted">Four quick steps.</p>
                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {steps.map((s, i) => (
                        <div key={i} className={cn("flex flex-col gap-3 rounded-lg bg-white/[0.03] p-5", s.done && "opacity-60")}>
                            <div className="flex items-center gap-3">
                                <span className={cn("grid size-9 place-items-center rounded-lg [&_svg]:size-[18px]", s.done ? "bg-emerald-500/15 text-emerald-300" : "bg-white/[0.06] text-fg/80")}>{s.icon}</span>
                                <span className="text-xs text-subtle">
                                    Step {i + 1}
                                    {s.done ? " · done" : ""}
                                </span>
                            </div>
                            <p className="font-medium">{s.title}</p>
                            <p className="flex-1 text-sm text-muted">{s.text}</p>
                            {!s.done && <div>{s.action}</div>}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
