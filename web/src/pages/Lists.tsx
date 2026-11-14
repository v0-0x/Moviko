import { ArrowDownUp, Check, Heart, ListChecks, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { MediaCard, MediaCardSkeleton, MediaGrid } from "@/components/MediaCard"
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownTrigger, EmptyState, ErrorState, IconButton, Input, Tabs, Tooltip } from "@/components/ui"
import { usePersisted } from "@/lib/hooks"
import { episodeIndex } from "@/lib/ids"
import { useRawList, useStatus } from "@/lib/queries"
import type { ListEntry } from "@/lib/types"
import { cn, LIST_STATUS, releaseDateOf, title } from "@/lib/utils"

const ORDER = ["CURRENT", "PLANNING", "COMPLETED", "REPEATING", "PAUSED", "DROPPED"]
type Kind = "" | "MOVIE" | "TV"

const SORTS = [
    { value: "updated", label: "Last updated" },
    { value: "title", label: "Title" },
    { value: "rating", label: "Your rating" },
    { value: "tmdb", label: "TMDB rating" },
    { value: "release", label: "Release date" },
    { value: "progress", label: "Progress" },
]

export default function ListsPage() {
    const { data: status } = useStatus()
    const { data, isLoading, error, refetch, isFetching } = useRawList("")
    const [params, setParams] = useSearchParams()
    const [kind, setKind] = usePersisted<Kind>("kumobox-lists-kind", "")
    const [sort, setSort] = usePersisted("kumobox-lists-sort", "updated")
    const [liked, setLiked] = useState(false)
    const [q, setQ] = useState("")

    // Every entry once (custom lists repeat them), of the kind shown.
    const all = useMemo(() => {
        const seen = new Set<number>()
        const out: ListEntry[] = []
        for (const l of data?.lists ?? []) {
            if (l.isCustomList) continue
            for (const e of l.entries ?? []) {
                if (!e.media || seen.has(e.mediaId)) continue
                seen.add(e.mediaId)
                out.push(e)
            }
        }
        return out
    }, [data])
    const ofKind = useMemo(() => all.filter(e => !kind || e.media.type === kind), [all, kind])
    const counts = useMemo(() => {
        const c: Record<string, number> = {}
        for (const e of ofKind) c[e.status] = (c[e.status] ?? 0) + 1
        return c
    }, [ofKind])

    // The status from the address (Home's "See all"), else the first one
    // with something in it.
    const wanted = params.get("status") ?? ""
    const statusTab = ORDER.includes(wanted) ? wanted : (ORDER.find(s => counts[s]) ?? "PLANNING")
    const setStatus = (s: string) => setParams({ status: s }, { replace: true })

    const entries = useMemo(() => {
        const needle = q.trim().toLowerCase()
        const list = ofKind.filter(
            e =>
                e.status === statusTab &&
                (!liked || e.liked) &&
                (!needle || [title(e.media), e.media.title.english ?? "", e.media.title.native ?? ""].some(t => t.toLowerCase().includes(needle))),
        )
        list.sort((a, b) => {
            switch (sort) {
                case "title":
                    return title(a.media).localeCompare(title(b.media))
                case "rating":
                    return (b.score || 0) - (a.score || 0)
                case "tmdb":
                    return (b.media.averageScore || 0) - (a.media.averageScore || 0)
                case "release":
                    return releaseDateOf(b.media).localeCompare(releaseDateOf(a.media))
                case "progress":
                    return episodeIndex(b.media, b.progress) - episodeIndex(a.media, a.progress)
                default:
                    return (b.updatedAt || 0) - (a.updatedAt || 0)
            }
        })
        return list
    }, [ofKind, statusTab, liked, q, sort])

    const noun = kind === "MOVIE" ? "movies" : kind === "TV" ? "shows" : "movies and shows"

    return (
        <div className="min-h-full px-6 pt-8 pb-24 md:px-8 xl:px-10">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <h1 className="text-[1.75rem] font-semibold tracking-tight">My list</h1>
                <Tabs
                    value={kind}
                    onChange={setKind}
                    tabs={[
                        { value: "", label: "All", count: all.length },
                        { value: "MOVIE", label: "Movies", count: all.filter(e => e.media.type === "MOVIE").length },
                        { value: "TV", label: "Shows", count: all.filter(e => e.media.type === "TV").length },
                    ]}
                />
            </div>
            {/* One row: which list, the liked ones, a title filter, and the order in a menu. */}
            <div className="mb-8 flex flex-wrap items-center gap-3">
                <Tabs
                    value={statusTab}
                    onChange={setStatus}
                    tabs={ORDER.filter(s => counts[s] || s === statusTab || s === "PLANNING" || s === "COMPLETED").map(s => ({ value: s, label: LIST_STATUS[s], count: counts[s] ?? 0 }))}
                />
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:ml-auto sm:flex-none">
                    <Tooltip content={liked ? "Show everything" : "Only what you liked"}>
                        <IconButton onClick={() => setLiked(l => !l)} aria-label="Only what you liked" aria-pressed={liked} variant="subtle" className={cn("rounded-xl", liked && "text-[#ff8000] hover:text-[#ff8000]")}>
                            <Heart className={cn("size-4", liked && "fill-current")} />
                        </IconButton>
                    </Tooltip>
                    {/* Input's className only sizes the inner <input> (its own wrapper is w-full): size it from outside. */}
                    <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
                        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" aria-label="Filter by title" icon={<Search className="size-4" />} className="rounded-xl" />
                    </div>
                    <Dropdown>
                        <DropdownTrigger asChild>
                            <IconButton label={`Sort: ${SORTS.find(o => o.value === sort)?.label ?? "Last updated"}`} variant="subtle" className="rounded-xl">
                                <ArrowDownUp className="size-4" />
                            </IconButton>
                        </DropdownTrigger>
                        <DropdownContent>
                            <DropdownLabel>Sort by</DropdownLabel>
                            {SORTS.map(o => (
                                <DropdownItem key={o.value} icon={sort === o.value ? <Check /> : <span className="block size-4" />} onSelect={() => setSort(o.value)}>
                                    {o.label}
                                </DropdownItem>
                            ))}
                        </DropdownContent>
                    </Dropdown>
                </div>
            </div>
            {isLoading ? (
                <MediaGrid>
                    {Array.from({ length: 12 }).map((_, i) => (
                        <MediaCardSkeleton key={i} />
                    ))}
                </MediaGrid>
            ) : error && !data ? (
                <ErrorState title="Couldn't load your list" error={error} retrying={isFetching} onRetry={() => refetch()} />
            ) : entries.length === 0 ? (
                <EmptyState icon={<ListChecks className="size-6" />} title="Nothing here yet">
                    {q || liked ? "Nothing matches these filters." : `Add ${noun} to your ${LIST_STATUS[statusTab].toLowerCase()} from their page${statusTab === "COMPLETED" && !status?.letterboxd ? ", or connect Letterboxd to bring your diary" : ""}.`}
                </EmptyState>
            ) : (
                <MediaGrid size={status?.settings.ui.cardSize} start>
                    {entries.map(e => (
                        <MediaCard key={e.mediaId} media={e.media} listEntry={e} />
                    ))}
                </MediaGrid>
            )}
        </div>
    )
}
