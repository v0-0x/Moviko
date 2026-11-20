import { useQueryClient } from "@tanstack/react-query"
import { Check, ExternalLink, Eye, FolderOpen, Info, Magnet, MoreHorizontal, Play, RefreshCw, Star } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "@/lib/toast"
import { Diary } from "@/components/entry/Diary"
import { DetailsPanel } from "@/components/entry/Details"
import { MovieLibrary, SeasonsPanel } from "@/components/entry/Episodes"
import { ListStatusButton, ProgressEditor, RatingBar } from "@/components/entry/ListEditor"
import { StreamPanel } from "@/components/entry/StreamPanel"
import { TorrentPanel } from "@/components/entry/TorrentPanel"
import { PluginActions, PluginSlot, usePluginDropdownActions } from "@/components/plugins/PluginSlot"
import { sendPluginEvent } from "@/components/plugins/PluginRenderer"
import { Badge, Button, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, EmptyState, Skeleton, Tabs, Tooltip } from "@/components/ui"
import { api } from "@/lib/api"
import { airedEpisodes, episodeIndex, episodeKeyOf, formatKey, MOVIE_EPISODE, mediaIsShow, nextEpisode } from "@/lib/ids"
import { usePlay } from "@/lib/play"
import { useEntry, useEpisodeMarker, useStatus } from "@/lib/queries"
import { useClassic } from "@/lib/themes"
import { tv } from "@/lib/tv"
import type { EntryView } from "@/lib/types"
import { airsIn, banner, cleanDescription, cn, externalLinks, img, originalTitle, poster, runtimeLabel, statusLabel, title, year } from "@/lib/utils"

type Tab = "episodes" | "overview" | "stream" | "torrents"

export default function EntryPage() {
    const [params, setParams] = useSearchParams()
    const id = Number(params.get("id"))
    const { data: entry, isLoading, error } = useEntry(id)
    const { data: status } = useStatus()

    useEffect(() => {
        document.getElementById("main-scroll")?.scrollTo({ top: 0 })
    }, [id])

    if (isLoading) return <EntrySkeleton />
    if (error || !entry) {
        return (
            <div className="p-10">
                <EmptyState icon={<Info className="size-6" />} title="Couldn't load this title">
                    {(error as Error)?.message ?? "Not found"}
                </EmptyState>
            </div>
        )
    }

    const show = mediaIsShow(entry.media)
    const online = status?.settings.onlineStream.enabled !== false
    const files = (entry.episodes ?? []).filter(e => e.hasFile).length
    // One slim row; a tab's count is a plain muted number (as on Library tools).
    const tabs: { value: Tab; label: React.ReactNode }[] = [
        ...(show
            ? [
                  {
                      value: "episodes" as Tab,
                      label: (
                          <>
                              Episodes
                              {files > 0 && <span className="font-normal text-subtle tabular-nums">{files}</span>}
                          </>
                      ),
                  },
              ]
            : []),
        { value: "overview", label: show ? "Details" : "Overview" },
        ...(online ? [{ value: "stream" as Tab, label: "Watch online" }] : []),
        { value: "torrents", label: "Torrents" },
    ]
    // Old links say "details"; a movie has no episodes tab.
    const raw = params.get("tab") === "details" ? "overview" : (params.get("tab") as Tab)
    const tab: Tab = tabs.some(t => t.value === raw) ? raw : show ? "episodes" : "overview"
    // episode: the one Watch online or Torrents opens on (a key).
    const setTab = (t: Tab, episode?: number) =>
        setParams(
            p => {
                p.set("tab", t)
                if (episode) p.set("episode", String(episode))
                return p
            },
            { replace: true },
        )

    return (
        <div className="relative min-h-full pb-24">
            <EntryHero entry={entry} onTab={setTab} />
            <div className="relative z-10 flex flex-col gap-6 px-6 md:px-8 xl:px-10">
                <PluginSlot slot="before-anime-entry-episode-list" />
                <Tabs variant="underline" value={tab} onChange={t => setTab(t)} tabs={tabs} />
                {/* Keyed by media too: panels keep per-title state (search results, chosen provider). */}
                <div key={`${entry.media.id}-${tab}`} className="fade-in">
                    {tab === "episodes" && <SeasonsPanel entry={entry} onStream={k => setTab("stream", k)} onTorrents={k => setTab("torrents", k)} />}
                    {tab === "overview" &&
                        (show ? (
                            <DetailsPanel media={entry.media} />
                        ) : (
                            <DetailsPanel
                                media={entry.media}
                                before={
                                    <>
                                        <MovieLibrary entry={entry} onStream={() => setTab("stream")} onTorrents={() => setTab("torrents")} />
                                        <Diary mediaId={entry.media.id} />
                                    </>
                                }
                            />
                        ))}
                    {tab === "stream" && <StreamPanel entry={entry} />}
                    {tab === "torrents" && <TorrentPanel entry={entry} episode={Number(params.get("episode")) || undefined} />}
                </div>
                <PluginSlot slot="after-anime-entry-episode-list" />
                <PluginSlot slot="after-anime-episode-list" />
                <PluginSlot slot="anime-screen-bottom" />
            </div>
        </div>
    )
}

function EntryHero({ entry, onTab }: { entry: EntryView; onTab: (t: Tab) => void }) {
    const classic = useClassic()
    const media = entry.media
    const show = mediaIsShow(media)
    const list = entry.listEntry
    const { data: status } = useStatus()
    const { watch } = usePlay()
    const marker = useEpisodeMarker(media)
    const [expanded, setExpanded] = useState(false)
    const qc = useQueryClient()
    const dropdownActions = usePluginDropdownActions("anime-page-dropdown")
    const desc = cleanDescription(media.description)
    const score = media.averageScore ?? media.meanScore
    const bannerImg = entry.images?.fanart ? img(entry.images.fanart) : banner(media)
    const seasons = (media.seasons ?? []).filter(s => s.seasonNumber > 0).length
    const people = (media.crew ?? []).filter(c => (show ? c.job === "Creator" : c.job === "Director"))
    const progress = list?.progress ?? 0

    // What Play plays: the movie, or the show's next episode (the server's,
    // which knows the files and the history, else the one after progress).
    const episodes = entry.episodes ?? []
    const nextView = show ? entry.nextEpisode : (episodes.find(e => episodeKeyOf(e) === MOVIE_EPISODE) ?? entry.nextEpisode)
    const key = show ? (nextView && episodeKeyOf(nextView)) || nextEpisode(media, progress) : MOVIE_EPISODE
    const file = nextView && episodeKeyOf(nextView) === key ? nextView.file : null
    const resumeAt = nextView && episodeKeyOf(nextView) === key ? nextView.resumeAt : 0
    const available = !!file || (show ? key > 0 && (!!nextView?.aired || episodeIndex(media, key) <= airedEpisodes(media)) : media.status !== "NOT_YET_RELEASED")
    const watched = !show && list?.status === "COMPLETED"
    const playLabel = show
        ? `${resumeAt > 0 ? "Resume" : progress > 0 ? "Continue" : "Play"} ${formatKey(key)}`
        : resumeAt > 0
          ? "Resume"
          : watched
            ? "Watch again"
            : "Play"

    const refresh = async () => {
        try {
            await api.post(`/api/media/${media.id}/refresh`)
            qc.invalidateQueries({ queryKey: ["entry", media.id] })
            qc.invalidateQueries({ queryKey: ["season", media.id] })
            toast.success("Metadata refreshed")
        } catch (e: any) {
            toast.error(e.message)
        }
    }

    const facts = [
        media.certification ? <span className="rounded border border-white/30 px-1.5 text-xs leading-5 font-medium text-white/80">{media.certification}</span> : null,
        !show && media.duration ? <span>{runtimeLabel(media.duration)}</span> : null,
        show && seasons ? <span>{seasons === 1 ? "1 season" : `${seasons} seasons`}</span> : null,
        score ? (
            <Tooltip content={media.voteCount ? `${media.voteCount.toLocaleString()} votes on TMDB` : "TMDB rating"}>
                <span className="flex items-center gap-1 font-semibold text-white">
                    <Star className="size-3.5 fill-amber-300 text-amber-300" /> {(score / 10).toFixed(1)}
                </span>
            </Tooltip>
        ) : null,
        // The next one to air, here with the rest (the studios are under Details).
        show && media.nextAiringEpisode ? (
            <span className="font-medium text-brand-strong">
                {formatKey(media.nextAiringEpisode.episode)}
                {media.nextAiringEpisode.title ? ` “${media.nextAiringEpisode.title}”` : ""} {airsIn(media.nextAiringEpisode.airingAt)}
            </span>
        ) : null,
    ].filter(Boolean)

    return (
        <div className="relative">
            <div className="absolute inset-x-0 top-0 h-[460px] overflow-hidden">
                {bannerImg && <img src={bannerImg} alt="" className="size-full object-cover object-top opacity-80 fade-in [mask-image:linear-gradient(to_bottom,#000_80%,transparent)]" />}
                <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/75 to-bg/10" />
                <div className="absolute inset-0 bg-gradient-to-r from-bg/90 via-bg/30 to-transparent" />
            </div>
            {/* What it is and what to do with it, on one glass panel over its art (the Classic look's). */}
            <div className="relative z-10 px-6 pt-28 pb-8 md:px-8 xl:px-10">
            <div className={cn("flex flex-col gap-6 md:flex-row", classic ? "rounded-3xl border border-white/10 bg-black/35 p-5 shadow-[0_24px_60px_-28px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.08)] md:p-6" : "md:gap-8", !tv && classic && "backdrop-blur-2xl")}>
                <div className="w-32 shrink-0 md:w-44">
                    <div>
                        <img {...poster(media, 208)} alt="" className="aspect-[2/3] w-full rounded-lg object-cover shadow-2xl shadow-black/60 ring-1 ring-white/10 fade-in" />
                    </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-end gap-4 fade-in">
                    <div>
                        <h1 className="text-3xl leading-[1.1] font-semibold tracking-tight text-white md:text-[2.75rem]">
                            {title(media)}
                            {year(media) > 0 && <span className="ml-3 text-[0.6em] font-normal text-white/50">{year(media)}</span>}
                        </h1>
                        {originalTitle(media) && <p className="mt-2 text-base text-white/60">{originalTitle(media)}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-white/75">
                        {facts.map((el, k) => (
                            <span key={k} className="flex items-center gap-2">
                                {k > 0 && <span className="text-white/25">·</span>}
                                {el}
                            </span>
                        ))}
                        {(show || media.status !== "FINISHED") && (
                            <Badge tone={media.status === "RELEASING" ? "green" : media.status === "NOT_YET_RELEASED" ? "blue" : "gray"} className="ml-1">
                                {statusLabel(media.status, media.type)}
                            </Badge>
                        )}
                    </div>
                    {/* Its first genres, as words: each opens a search. */}
                    {!!media.genres?.length && (
                        <p className="text-sm text-white/55">
                            {media.genres.slice(0, 3).map((g, k) => (
                                <span key={g}>
                                    {k > 0 && " · "}
                                    <Link to={`/search?genre=${encodeURIComponent(g)}&type=${media.type}`} className="transition-colors hover:text-white">
                                        {g}
                                    </Link>
                                </span>
                            ))}
                        </p>
                    )}
                    {media.tagline && <p className="text-[15px] text-white/60 italic">{media.tagline}</p>}
                    {desc && (
                        <div className="max-w-3xl">
                            <p className={cn("text-[15px] leading-relaxed whitespace-pre-line text-white/70", !expanded && "line-clamp-2")}>{desc}</p>
                            {desc.length > 180 && (
                                <button onClick={() => setExpanded(e => !e)} className="mt-1 text-sm font-medium text-fg/80 transition-colors hover:text-fg">
                                    {expanded ? "Show less" : "Read more"}
                                </button>
                            )}
                        </div>
                    )}
                    {people.length > 0 && (
                        <p className="text-sm text-white/60">
                            {show ? "Created by " : "Directed by "}
                            <span className="font-medium text-white/85">{people.map(p => p.name).join(", ")}</span>
                        </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2.5">
                        {available && (
                            <Button variant="white" size="lg" icon={<Play className="size-4 fill-current" />} onClick={() => watch(media.id, key, file?.path)} data-tv-autofocus>
                                {playLabel}
                            </Button>
                        )}
                        {/* A watched movie says so on its list button (which can unmark it). */}
                        {!show ? (
                            !watched && (
                                <Button variant="subtle" size="lg" icon={<Eye className="size-4" />} disabled={marker.pending || media.status === "NOT_YET_RELEASED"} onClick={() => marker.mark(MOVIE_EPISODE, true)}>
                                    Mark watched
                                </Button>
                            )
                        ) : (
                            available && (
                                <Tooltip content={`Mark ${formatKey(key)} as watched`}>
                                    <Button variant="subtle" size="lg" icon={<Check className="size-4" />} disabled={marker.pending} onClick={() => marker.mark(key, true)}>
                                        Mark watched
                                    </Button>
                                </Tooltip>
                            )
                        )}
                        {/* The list's status and progress, and the rest: one quiet group. */}
                        <div className={classic ? "flex max-w-full flex-wrap items-center gap-0.5 rounded-xl border border-white/10 bg-white/[0.06] p-0.5 *:h-[38px]! *:rounded-[9px]! *:bg-transparent! [&>button:not([aria-label])]:px-3.5! [&>button]:text-sm! [&>button:hover]:bg-white/[0.08]! [&>button[data-state=open]]:bg-white/[0.08]!" : "flex max-w-full flex-wrap items-center gap-x-1 gap-y-2"}>
                        <ListStatusButton media={media} entry={list} />
                        {show && list && <ProgressEditor media={media} entry={list} />}
                        <Dropdown>
                            <DropdownTrigger asChild>
                                <Button variant="ghost" size="lg" className="w-[38px] px-0! text-fg" aria-label="More">
                                    <MoreHorizontal className="size-5" />
                                </Button>
                            </DropdownTrigger>
                            <DropdownContent align="start">
                                {entry.localCount > 0 && status?.client !== "lan" && (
                                    <DropdownItem icon={<FolderOpen />} onSelect={() => api.post("/api/library/open-folder", { mediaId: media.id }).catch(e => toast.error(e.message))}>
                                        Open folder
                                    </DropdownItem>
                                )}
                                {externalLinks(media).map(l => (
                                    <DropdownItem key={l.label} icon={<ExternalLink />} onSelect={() => window.open(l.url, "_blank", "noopener")}>
                                        View on {l.label}
                                    </DropdownItem>
                                ))}
                                <DropdownItem icon={<Magnet />} onSelect={() => onTab("torrents")}>
                                    Find torrents
                                </DropdownItem>
                                <DropdownItem icon={<RefreshCw />} onSelect={refresh}>
                                    Refresh metadata
                                </DropdownItem>
                                {dropdownActions.length > 0 && <DropdownSeparator />}
                                {dropdownActions.map(a => (
                                    <DropdownItem key={a.pluginId + a.id} onSelect={() => sendPluginEvent(a.pluginId, { kind: "action", actionId: a.id, mediaId: media.id })}>
                                        {String(a.props?.label ?? "")}
                                    </DropdownItem>
                                ))}
                            </DropdownContent>
                        </Dropdown>
                        </div>
                        <PluginActions kind="anime-page-button" mediaId={media.id} />
                    </div>
                    <div className="max-w-3xl">
                        <RatingBar media={media} entry={list} />
                    </div>
                </div>
            </div>
            </div>
        </div>
    )
}

function EntrySkeleton() {
    return (
        <div className="px-6 pt-[200px] md:px-8 xl:px-10">
            <div className="flex gap-8">
                <Skeleton className="aspect-[2/3] w-56" />
                <div className="flex flex-1 flex-col justify-end gap-4">
                    <Skeleton className="h-12 w-2/3" />
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-20 w-full max-w-3xl" />
                    <Skeleton className="h-12 w-72" />
                </div>
            </div>
        </div>
    )
}
