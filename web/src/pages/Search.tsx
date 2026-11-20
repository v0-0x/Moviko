import { Bookmark, BookmarkCheck, Search as SearchIcon, SlidersHorizontal, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ListCardMenu } from "@/components/ListCardMenu"
import { MediaCard, MediaCardSkeleton, MediaGrid } from "@/components/MediaCard"
import { Button, EmptyState, ErrorState, IconButton, Input, Popover, Select } from "@/components/ui"
import { useGenres, useSearch } from "@/lib/queries"
import { searchKey, searchLabel, useSearches } from "@/lib/searches"
import type { Media } from "@/lib/types"
import { useClassic } from "@/lib/themes"
import { cn, LANGUAGES } from "@/lib/utils"

const SORTS = [
    { value: "", label: "Best match / trending" },
    { value: "POPULARITY_DESC", label: "Popularity" },
    { value: "SCORE_DESC", label: "Rating" },
    { value: "TRENDING_DESC", label: "Trending" },
    { value: "START_DATE_DESC", label: "Newest" },
    { value: "START_DATE", label: "Oldest" },
    { value: "TITLE", label: "Title" },
]
const TYPES = [
    { value: "", label: "All" },
    { value: "MOVIE", label: "Movies" },
    { value: "TV", label: "Shows" },
]
const FILTERS = ["genre", "year", "status", "minScore", "lang"]

export default function SearchPage() {
    const classic = useClassic()
    const [params, setParams] = useSearchParams()
    const q = params.get("q") ?? ""
    const [text, setText] = useState(q)
    const type = TYPES.find(t => t.value === params.get("type"))?.value ?? ""
    const genres = params.getAll("genre")
    const year = params.get("year") ?? ""
    const status = params.get("status") ?? ""
    const minScore = params.get("minScore") ?? ""
    const lang = params.get("lang") ?? ""
    const sort = params.get("sort") ?? ""
    const { data: allGenres } = useGenres()
    const [page, setPage] = useState(1)
    const [acc, setAcc] = useState<Media[]>([])

    // setParams hands its updater the params of the render it came from, which
    // are out of date in the debounced update below (or after two quick
    // clicks): always build on the URL as it is now.
    const update = (change: (p: URLSearchParams) => void) =>
        setParams(
            () => {
                const p = new URLSearchParams(window.location.search)
                change(p)
                return p
            },
            { replace: true },
        )
    const set = (k: string, v: string | string[] | null) =>
        update(p => {
            p.delete(k)
            if (Array.isArray(v)) v.forEach(x => p.append(k, x))
            else if (v) p.set(k, v)
        })

    // The box writes q to the URL after a pause in typing and follows q when
    // it changes from outside (Back/Forward, quick search). synced is the
    // last q written or seen, so our own writes don't reset what is typed.
    const synced = useRef(q)
    useEffect(() => {
        if (q === synced.current) return
        synced.current = q
        setText(q)
    }, [q])
    useEffect(() => {
        const t = setTimeout(() => {
            const next = text.trim()
            if (next === synced.current) return
            synced.current = next
            set("q", next || null)
        }, 350)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text])

    const query = useMemo(
        () => ({
            search: params.get("q") ?? undefined,
            type: type || undefined,
            genres: genres.length ? genres : undefined,
            year: year ? Number(year) : undefined,
            status: status || undefined,
            minScore: minScore ? Number(minScore) : undefined,
            language: lang || undefined,
            sort: sort ? [sort] : undefined,
            perPage: 36,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [params.toString()],
    )
    useEffect(() => {
        setPage(1)
        setAcc([])
    }, [query])
    const { data, isFetching, isPlaceholderData, error, refetch } = useSearch({ ...query, page })
    useEffect(() => {
        // The previous search's (or page's) results, shown while this one
        // loads, aren't this page's.
        if (!data?.media || isPlaceholderData) return
        const media = data.media
        setAcc(prev => {
            if (page === 1) return media
            // A page seen already comes back changed (a card's list status):
            // its titles are replaced where they are.
            const fresh = new Map(media.map(m => [m.id, m]))
            return [...prev.map(m => fresh.get(m.id) ?? m), ...media.filter(m => !prev.some(p => p.id === m.id))]
        })
    }, [data, page, isPlaceholderData])

    // Kept searches: the saved ones and the last ones made (lib/searches).
    const kept = useSearches()
    const key = searchKey(params)
    // Something is looked for: a title, or a filter (movies or shows alone, or a sort, isn't).
    const searching = q.trim().length >= 2 || FILTERS.some(k => params.has(k))
    const saved = kept.saved.some(s => s.query === key)
    // A search stays a moment before it counts as made (not each letter typed).
    const addRecent = useRef(kept.addRecent)
    addRecent.current = kept.addRecent
    useEffect(() => {
        if (!searching) return
        const t = setTimeout(() => addRecent.current(key), 2500)
        return () => clearTimeout(t)
    }, [key, searching])
    const go = (query: string) => setParams(new URLSearchParams(query))

    const years = Array.from({ length: new Date().getFullYear() - 1899 }, (_, i) => String(new Date().getFullYear() + 2 - i))
    const active = genres.length + (year ? 1 : 0) + (status ? 1 : 0) + (minScore ? 1 : 0) + (lang ? 1 : 0)
    // Those behind the Filters button; the year sits beside it.
    const tucked = active - (year ? 1 : 0)
    // A genre from a link that TMDB doesn't list still shows, to be turned off.
    const genreChips = [...(allGenres ?? []), ...genres.filter(g => !(allGenres ?? []).includes(g))]

    return (
        <div className="min-h-full px-6 pt-8 pb-24 md:px-8 xl:px-10">
            <div className="mb-8 flex flex-col gap-5">
                <div className="flex items-center justify-between gap-4">
                    <h1 className="text-[1.75rem] font-semibold tracking-tight">Search</h1>
                    <div className={cn("flex", classic ? "rounded-xl border border-white/10 bg-white/[0.045] p-0.5" : "gap-1")}>
                        {TYPES.map(t => (
                            <button
                                key={t.value}
                                aria-pressed={type === t.value}
                                onClick={() => set("type", t.value || null)}
                                className={cn(
                                    "h-8 px-3.5 font-medium transition-colors",
                                    classic ? "rounded-[10px] text-[13px]" : "word label focus-ring text-[10.5px]",
                                    type === t.value ? (classic ? "bg-white/[0.1] text-fg" : "text-fg") : "text-muted hover:text-fg",
                                )}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>
                <Input
                    autoFocus
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="Search movies and shows by title…"
                    aria-label="Search by title"
                    icon={<SearchIcon className="size-5" />}
                    className="h-14 rounded-2xl border-white/10 bg-white/[0.045] pr-4 pl-11 text-base"
                />
                {/* Two by two on a phone, one row from there up. */}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                    <Select className="sm:w-32" value={year} onChange={v => set("year", v)} options={[{ value: "", label: "Any year" }, ...years.map(y => ({ value: y, label: y }))]} />
                    <Select className="sm:w-52" value={sort} onChange={v => set("sort", v)} options={SORTS} />
                    <div className="flex min-w-0 items-center gap-1">
                        <Popover
                            side="bottom"
                            align="start"
                            className="w-[min(24rem,calc(100vw-1.5rem))]"
                            trigger={
                                <Button variant={classic ? "ghost" : "outline"} className={cn("min-w-0 flex-1 sm:flex-none", classic && "rounded-xl border border-white/10 bg-white/[0.045]")} icon={<SlidersHorizontal className="size-4" />}>
                                    Filters
                                    {tucked > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/15 px-1.5 text-xs font-semibold text-fg">{tucked}</span>}
                                </Button>
                            }
                        >
                            <div className="flex flex-col gap-4">
                                <div className="grid grid-cols-2 gap-2">
                                    <Select
                                        value={status}
                                        onChange={v => set("status", v)}
                                        options={[
                                            { value: "", label: "Any status" },
                                            { value: "RELEASING", label: type === "MOVIE" ? "In theaters" : type === "TV" ? "Airing" : "Airing / in theaters" },
                                            { value: "FINISHED", label: type === "TV" ? "Ended" : "Released" },
                                            { value: "NOT_YET_RELEASED", label: "Upcoming" },
                                        ]}
                                    />
                                    <Select
                                        value={minScore}
                                        onChange={v => set("minScore", v)}
                                        options={[{ value: "", label: "Any rating" }, ...[90, 80, 70, 60, 50].map(n => ({ value: String(n), label: `${(n / 10).toFixed(0)}+ on TMDB` }))]}
                                    />
                                    <Select className="col-span-2" value={lang} onChange={v => set("lang", v)} options={[{ value: "", label: "Any language" }, ...LANGUAGES]} />
                                </div>
                                <div>
                                    <p className="mb-2 text-xs font-medium text-subtle">Genres</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {genreChips.map(g => {
                                            const on = genres.includes(g)
                                            return (
                                                <button
                                                    key={g}
                                                    aria-pressed={on}
                                                    onClick={() =>
                                                        update(p => {
                                                            const cur = p.getAll("genre")
                                                            p.delete("genre")
                                                            for (const v of cur.includes(g) ? cur.filter(c => c !== g) : [...cur, g]) p.append("genre", v)
                                                        })
                                                    }
                                                    className={cn(
                                                        "h-8 px-3 font-medium transition-colors",
                                                        classic
                                                            ? cn("rounded-full text-[13px]", on ? "bg-white/20 text-fg" : "bg-white/[0.05] text-muted hover:bg-white/[0.09] hover:text-fg")
                                                            : cn("word label text-[10.5px]", on ? "text-fg" : "text-muted hover:text-fg"),
                                                    )}
                                                >
                                                    {g}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        </Popover>
                        {active > 0 && (
                            <IconButton label="Clear filters" onClick={() => update(p => FILTERS.forEach(k => p.delete(k)))}>
                                <X className="size-4" />
                            </IconButton>
                        )}
                        {searching && (
                            <IconButton label={saved ? "Remove from saved searches" : "Save this search"} aria-pressed={saved} onClick={() => (saved ? kept.unsave(key) : kept.save(key))}>
                                {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
                            </IconButton>
                        )}
                    </div>
                </div>
                {/* Before anything is looked for: the searches kept, each a click away (and its x takes it off). */}
                {!searching && (kept.saved.length > 0 || kept.recent.length > 0) && (
                    <div className="flex flex-col gap-2">
                        {kept.saved.length > 0 && (
                            <KeptRow label="Saved">
                                {kept.saved.map(s => (
                                    <KeptSearch key={s.id} name={s.name} onGo={() => go(s.query)} onRemove={() => kept.unsave(s.query)} />
                                ))}
                            </KeptRow>
                        )}
                        {kept.recent.length > 0 && (
                            <KeptRow
                                label="Recent"
                                action={
                                    <button onClick={kept.clearRecent} className="word label focus-ring h-8 shrink-0 px-2.5 text-[10.5px] text-muted transition-colors hover:text-fg">
                                        Clear
                                    </button>
                                }
                            >
                                {kept.recent.map(r => (
                                    <KeptSearch key={r.query} name={searchLabel(r.query)} onGo={() => go(r.query)} onRemove={() => kept.removeRecent(r.query)} />
                                ))}
                            </KeptRow>
                        )}
                    </div>
                )}
            </div>

            {acc.length === 0 && isFetching ? (
                <MediaGrid>
                    {Array.from({ length: 18 }).map((_, i) => (
                        <MediaCardSkeleton key={i} />
                    ))}
                </MediaGrid>
            ) : acc.length === 0 && error ? (
                <ErrorState title="Couldn't search TMDB" error={error} onRetry={() => refetch()} />
            ) : acc.length === 0 ? (
                <EmptyState icon={<SearchIcon className="size-6" />} title="Nothing found">
                    Try a different title or fewer filters.
                </EmptyState>
            ) : (
                <>
                    <MediaGrid>
                        {acc.map(m => (
                            <MediaCard key={m.id} media={m} listEntry={m.mediaListEntry} menu={<ListCardMenu media={m} />} />
                        ))}
                    </MediaGrid>
                    {error && page > 1 ? (
                        <ErrorState compact className="mt-6" title="Couldn't load more results" error={error} retrying={isFetching} onRetry={() => refetch()} />
                    ) : (
                        data?.pageInfo?.hasNextPage && (
                            <div className="mt-10 flex justify-center">
                                <Button loading={isFetching} onClick={() => setPage(p => p + 1)}>
                                    Load more
                                </Button>
                            </div>
                        )
                    )}
                </>
            )}
        </div>
    )
}

// A row of kept searches under its name: Saved, Recent.
function KeptRow({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-3">
            <span className="label w-14 shrink-0 pt-2.5 text-subtle">{label}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5">{children}</div>
            {action}
        </div>
    )
}

// One of them: its name runs it again, the x beside it takes it off.
function KeptSearch({ name, onGo, onRemove }: { name: string; onGo: () => void; onRemove: () => void }) {
    return (
        <span className="flex max-w-full items-center">
            <button onClick={onGo} className="word focus-ring h-8 max-w-72 truncate px-2.5 text-[13px] text-fg/85 transition-colors hover:text-fg">
                {name}
            </button>
            <button onClick={onRemove} aria-label={`Remove ${name}`} className="focus-ring grid size-6 shrink-0 place-items-center rounded-sm text-subtle transition-colors hover:text-fg">
                <X className="size-3" />
            </button>
        </span>
    )
}
