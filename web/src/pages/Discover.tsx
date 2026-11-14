import { ChevronLeft, ChevronRight, Compass, Play, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ListCardMenu } from "@/components/ListCardMenu"
import { Carousel, MediaCard, MediaCardSkeleton } from "@/components/MediaCard"
import { PluginSlot } from "@/components/plugins/PluginSlot"
import { artButton, Button, ChipRow, EmptyState, ErrorState, SectionHeader, Skeleton, Tabs } from "@/components/ui"
import { HolidayIcon } from "@/components/HolidayBadge"
import { usePersisted } from "@/lib/hooks"
import { useDiscover, useGenres, useSearch, useStatus } from "@/lib/queries"
import { useStore } from "@/lib/store"
import { holidayStore, useClassic } from "@/lib/themes"
import type { Discover, Media } from "@/lib/types"
import { banner, cn, formatLabel, title, year } from "@/lib/utils"

type Kind = "" | "MOVIE" | "TV"
type Row = { key: Exclude<keyof Discover, "fetchedAt">; title: string; more: string; kind: Kind }

const ROWS: Row[] = [
    { key: "trending", title: "Trending this week", more: "/search?sort=TRENDING_DESC", kind: "" },
    { key: "nowPlaying", title: "Now in theaters", more: "/search?type=MOVIE&status=RELEASING&sort=POPULARITY_DESC", kind: "MOVIE" },
    { key: "onTheAir", title: "On the air", more: "/search?type=TV&status=RELEASING&sort=POPULARITY_DESC", kind: "TV" },
    { key: "upcoming", title: "Coming soon", more: "/search?type=MOVIE&status=NOT_YET_RELEASED&sort=POPULARITY_DESC", kind: "MOVIE" },
    { key: "popularMovies", title: "Popular movies", more: "/search?type=MOVIE&sort=POPULARITY_DESC", kind: "MOVIE" },
    { key: "popularShows", title: "Popular shows", more: "/search?type=TV&sort=POPULARITY_DESC", kind: "TV" },
    { key: "topRatedMovies", title: "Top rated movies", more: "/search?type=MOVIE&sort=SCORE_DESC", kind: "MOVIE" },
    { key: "topRatedShows", title: "Top rated shows", more: "/search?type=TV&sort=SCORE_DESC", kind: "TV" },
]

export default function DiscoverPage() {
    const { data: status } = useStatus()
    const tmdb = status?.tmdbConfigured !== false
    const { data, isLoading, error, refetch, isFetching } = useDiscover(tmdb)
    const { data: genres } = useGenres()
    const [kind, setKind] = usePersisted<Kind>("kumobox-discover-kind", "")
    const items = (k: Row["key"]) => (data?.[k] ?? []).filter(m => !kind || m.type === kind)
    const featured = items("trending")
        .filter(m => m.bannerImage)
        .slice(0, 6)
    // The holiday theme's row (Halloween's horror...), when it has one.
    const holiday = useStore(holidayStore)
    const picks = holiday?.picks
    const { data: pickData } = useSearch({ ...picks?.params, perPage: 20 }, !!picks && tmdb)
    const pickMedia = picks ? (pickData?.media ?? []).filter(m => !kind || m.type === kind) : []
    const [i, setI] = useState(0)
    // Not while the focus is on it (a TV remote's): its buttons would go.
    const [hold, setHold] = useState(false)
    useEffect(() => setI(0), [kind])
    useEffect(() => {
        if (featured.length < 2 || hold) return
        const t = setInterval(() => setI(x => (x + 1) % featured.length), 9000)
        return () => clearInterval(t)
    }, [featured.length, hold, kind])

    if (!tmdb)
        return (
            <div className="p-10">
                <EmptyState icon={<Compass className="size-6" />} title="Discover needs TMDB" action={<Link to="/settings?tab=metadata"><Button variant="primary">Set up TMDB</Button></Link>}>
                    Add a free TMDB API key to browse trending, popular and upcoming movies and shows.
                </EmptyState>
            </div>
        )
    if (error)
        return (
            <div className="p-10">
                <ErrorState title="Couldn't reach TMDB" error={error} retrying={isFetching} onRetry={() => refetch()} />
            </div>
        )

    const rows = ROWS.filter(r => !kind || !r.kind || r.kind === kind)
    // TMDB can come back with nothing at all (it couldn't be reached and
    // nothing is cached): skip empty rows instead of showing bare headers.
    const shown = isLoading ? rows : rows.filter(r => items(r.key).length > 0)
    const current = featured[Math.min(i, featured.length - 1)]
    const hero = isLoading || !!current

    return (
        <div className="min-h-full pb-24">
            {isLoading ? <Skeleton className="h-[clamp(340px,50vh,540px)] rounded-none max-sm:h-[440px]" /> : current && <Featured media={current} index={i} count={featured.length} onIndex={setI} onHold={setHold} />}
            {/* Without a hero banner there is nothing to overlap. */}
            <div className={cn("relative z-10 flex flex-col gap-10 px-6 md:px-8 xl:px-10", hero ? "-mt-14" : "pt-8")}>
                <PluginSlot slot="after-discover-screen-header" />
                <Tabs
                    value={kind}
                    onChange={setKind}
                    tabs={[
                        { value: "", label: "All" },
                        { value: "MOVIE", label: "Movies" },
                        { value: "TV", label: "Shows" },
                    ]}
                />
                {shown.length === 0 && (
                    <EmptyState
                        icon={<Compass className="size-6" />}
                        title="Nothing to discover right now"
                        action={
                            <Button icon={<RefreshCw className="size-4" />} loading={isFetching} onClick={() => refetch()}>
                                Try again
                            </Button>
                        }
                    >
                        TMDB returned nothing. Check your connection and your API key.
                    </EmptyState>
                )}
                {holiday && picks && pickMedia.length > 0 && (
                    <section>
                        <SectionHeader
                            title={
                                <span className="flex items-center gap-2.5">
                                    <HolidayIcon id={holiday.id} className="size-6" />
                                    {picks.title}
                                </span>
                            }
                            action={
                                picks.more && (
                                    <Link to={picks.more} className="text-[13px] font-medium text-muted transition-colors hover:text-fg">
                                        See all
                                    </Link>
                                )
                            }
                        />
                        <Carousel>{pickMedia.map(m => <MediaCard key={m.id} media={m} listEntry={m.mediaListEntry} menu={<ListCardMenu media={m} />} />)}</Carousel>
                    </section>
                )}
                {shown.map(r => (
                    <section key={r.key}>
                        <SectionHeader
                            title={r.title}
                            action={
                                <Link to={r.more} className="text-[13px] font-medium text-muted transition-colors hover:text-fg">
                                    See all
                                </Link>
                            }
                        />
                        {isLoading ? (
                            <div className="flex gap-4 overflow-hidden">
                                {Array.from({ length: 7 }).map((_, k) => (
                                    <div key={k} className="w-[160px] shrink-0">
                                        <MediaCardSkeleton />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <Carousel>
                                {items(r.key).map(m => (
                                    <MediaCard key={m.id} media={m} listEntry={m.mediaListEntry} menu={<ListCardMenu media={m} />} />
                                ))}
                            </Carousel>
                        )}
                    </section>
                ))}
                {/* Last: the rows above are what most come for. */}
                {(genres ?? []).length > 0 && (
                    <section>
                        <SectionHeader title="Genres" />
                        <ChipRow label="More genres">
                            {(genres ?? []).map(g => (
                                <Link
                                    key={g}
                                    to={`/search?genre=${encodeURIComponent(g)}${kind ? `&type=${kind}` : ""}`}
                                    className="flex h-9 shrink-0 items-center rounded-xl border border-white/10 bg-white/[0.045] px-4 text-[13px] font-medium text-fg/80 transition-colors hover:bg-white/[0.09] hover:text-fg"
                                >
                                    {g}
                                </Link>
                            ))}
                        </ChipRow>
                    </section>
                )}
            </div>
        </div>
    )
}

function Featured({ media, index, count, onIndex, onHold }: { media: Media; index: number; count: number; onIndex: (i: number) => void; onHold: (on: boolean) => void }) {
    const classic = useClassic()
    const score = media.averageScore ?? media.meanScore
    // One line: rating, format, year, then its first genres.
    const facts = [score ? (score / 10).toFixed(1) : "", formatLabel(media.format), year(media) || "", media.genres?.slice(0, 3).join(", ") ?? ""].filter(Boolean)
    return (
        <div
            className="relative h-[clamp(340px,50vh,540px)] overflow-hidden max-sm:h-[440px]"
            onFocus={() => onHold(true)}
            onBlur={e => !e.currentTarget.contains(e.relatedTarget as Node | null) && onHold(false)}
        >
            <img key={media.id} src={banner(media)} alt="" className="absolute inset-0 size-full object-cover fade-in [mask-image:linear-gradient(to_bottom,#000_80%,transparent)]" />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-bg/5" />
            <div className="absolute inset-0 bg-gradient-to-r from-bg/80 via-bg/25 to-transparent" />
            <div key={media.id + "t"} className="absolute inset-x-0 bottom-24 max-w-3xl px-6 rise-in md:px-8 xl:px-10">
                <p className={cn(classic ? "text-sm font-medium" : "label", "text-white/65")}>Trending #{index + 1}</p>
                <h1 className="mt-1.5 line-clamp-2 text-4xl leading-[1.1] font-semibold tracking-tight text-white md:text-[2.75rem]">{title(media)}</h1>
                <p className="mt-2 line-clamp-1 text-[15px] text-white/80">{facts.join(" · ")}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/entry?id=${media.id}`}>
                        <Button variant="white" icon={<Play className="size-4 fill-current" />}>
                            Watch now
                        </Button>
                    </Link>
                    <Link to={`/entry?id=${media.id}&tab=overview`} className={classic ? "focus-ring inline-flex h-9 items-center rounded-lg bg-white/10 px-3.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20" : artButton}>
                        Details
                    </Link>
                </div>
            </div>
            {count > 1 && (
                // On a phone, up in the corner: clear of the buttons below.
                <div className="absolute right-6 bottom-24 flex items-center gap-3 max-sm:top-4 max-sm:right-4 max-sm:bottom-auto md:right-8 xl:right-10">
                    <div className="flex gap-1.5 max-sm:hidden">
                        {Array.from({ length: count }).map((_, k) => (
                            <button
                                key={k}
                                aria-label={`Show ${k + 1}`}
                                onClick={() => onIndex(k)}
                                className={cn("h-1 rounded-full transition-all duration-300", k === index ? "w-5 bg-white" : "w-2.5 bg-white/30 hover:bg-white/50")}
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
