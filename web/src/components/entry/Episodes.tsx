import { CheckCheck, FolderInput, HardDrive, ListEnd, ListPlus, Magnet, MonitorPlay, Play, RotateCcw, Tv } from "lucide-react"
import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { EpisodeCard, WatchedToggle } from "@/components/EpisodeCard"
import { AddFromLibraryDialog, EntryFilesMenu } from "@/components/library/EntryFileTools"
import { AddToPlaylistDialog } from "@/components/PlaylistDialog"
import { episodeKey, episodeKeyOf, formatKey, MOVIE_EPISODE, nextEpisode, splitKey } from "@/lib/ids"
import { usePlay } from "@/lib/play"
import type { PlaylistItem } from "@/lib/playlist"
import { useEpisodeMarker, useEpisodes, useSeason, useStatus } from "@/lib/queries"
import type { EntryView, Episode, EpisodeView, LocalFile, Season } from "@/lib/types"
import { useClassic } from "@/lib/themes"
import { backdrop, banner, cleanDescription, cn, cover, formatBytes, formatDate, formatDuration, plural, title, today } from "@/lib/utils"
import { Badge, Button, DropdownItem, DropdownLabel, Progress, Select, Skeleton, Tabs } from "../ui"

// What a show's episodes are, from TMDB (season details) and the library
// (files, watched, resume positions) merged by episode key.
type Row = {
    key: number
    title: string
    image: string
    overview: string
    airDate: string
    runtime: number
    watched: boolean
    aired: boolean
    file: LocalFile | null
    resumeAt: number
    duration: number
}

function useLibraryEpisodes(entry: EntryView) {
    const { data } = useEpisodes(entry.media.id)
    return {
        episodes: data?.episodes ?? entry.episodes ?? [],
        extras: [...(data?.specials ?? entry.specials ?? []), ...(data?.others ?? entry.others ?? [])],
    }
}

// The seasons to pick from: regular ones in order, then the specials.
function seasonsOf(entry: EntryView, episodes: EpisodeView[]): Season[] {
    const listed = (entry.media.seasons ?? []).filter(s => s.episodeCount > 0)
    if (listed.length) return [...listed.filter(s => s.seasonNumber > 0).sort((a, b) => a.seasonNumber - b.seasonNumber), ...listed.filter(s => s.seasonNumber === 0)]
    // No season list (TMDB not reachable): the seasons the library has.
    const nums = [...new Set(episodes.map(e => splitKey(episodeKeyOf(e))[0]).filter(s => s > 0))].sort((a, b) => a - b)
    return (nums.length ? nums : [1]).map(n => ({ seasonNumber: n, name: `Season ${n}`, episodeCount: episodes.filter(e => splitKey(episodeKeyOf(e))[0] === n).length }))
}

const seasonName = (s: Season) => (s.seasonNumber === 0 ? "Specials" : s.name && !/^season \d+$/i.test(s.name) ? s.name : `Season ${s.seasonNumber}`)

// onStream opens Watch online, onTorrents the Torrents tab (on an episode,
// by key).
export function SeasonsPanel({ entry, onStream, onTorrents }: { entry: EntryView; onStream: (key?: number) => void; onTorrents: (key?: number) => void }) {
    const media = entry.media
    const { data: status } = useStatus()
    const { playLocal, watch, localPlayer, remote } = usePlay()
    const marker = useEpisodeMarker(media)
    const [params, setParams] = useSearchParams()
    const [adding, setAdding] = useState(false)
    const [onlyFiles, setOnlyFiles] = useState(false)
    // Episodes on their way to a playlist (its dialog open).
    const [toPlaylist, setToPlaylist] = useState<PlaylistItem[] | null>(null)
    const classic = useClassic()
    const lib = useLibraryEpisodes(entry)
    const seasons = useMemo(() => seasonsOf(entry, lib.episodes), [entry, lib.episodes])
    const progress = entry.listEntry?.progress ?? 0
    const completed = entry.listEntry?.status === "COMPLETED"

    // The season of the next episode to watch, unless one was picked.
    const upNext = (entry.nextEpisode && episodeKeyOf(entry.nextEpisode)) || nextEpisode(media, progress)
    const fallback = seasons.find(s => s.seasonNumber === splitKey(upNext)[0])?.seasonNumber ?? seasons[0]?.seasonNumber ?? 1
    const picked = Number(params.get("season"))
    const season = params.has("season") && seasons.some(s => s.seasonNumber === picked) ? picked : fallback
    const setSeason = (n: number) =>
        setParams(
            p => {
                p.set("season", String(n))
                return p
            },
            { replace: true },
        )
    const current = seasons.find(s => s.seasonNumber === season)
    const { data: detail, isLoading } = useSeason(media.id, season, seasons.length > 0)

    const rows = useMemo(() => {
        const byKey = new Map<number, EpisodeView>()
        for (const e of [...lib.episodes, ...lib.extras]) if (episodeKeyOf(e) > 0 && !byKey.has(episodeKeyOf(e))) byKey.set(episodeKeyOf(e), e)
        const day = today()
        const make = (key: number, meta?: Episode): Row => {
            const l = byKey.get(key)
            const airDate = meta?.airDate || l?.airDate || ""
            const hasFile = !!l?.hasFile
            return {
                key,
                title: meta?.title || l?.title || "",
                image: meta?.still || l?.image || "",
                overview: cleanDescription(meta?.overview || l?.summary),
                airDate,
                runtime: meta?.runtime || l?.runtime || 0,
                watched: l ? l.watched : season > 0 && (completed || key <= progress),
                aired: hasFile || !!l?.aired || (!!airDate && airDate <= day),
                file: l?.file ?? null,
                resumeAt: l?.resumeAt ?? 0,
                duration: l?.history?.duration ?? 0,
            }
        }
        const out = (detail?.episodes ?? []).map(ep => make(ep.key || episodeKey(ep.season, ep.number), ep))
        // Files the season details don't list (or no details at all).
        for (const k of byKey.keys()) if (splitKey(k)[0] === season && !out.some(r => r.key === k)) out.push(make(k))
        return out.sort((a, b) => a.key - b.key)
    }, [detail, lib, season, progress, completed])

    const shown = onlyFiles ? rows.filter(r => r.file) : rows
    const withFiles = lib.episodes.filter(e => e.hasFile)
    const hosts = [...new Set(withFiles.map(e => e.file?.hostName).filter((h): h is string => !!h))]
    // Specials numbered S00Exx show in the Specials season; the rest are extras.
    const hasSpecials = seasons.some(s => s.seasonNumber === 0)
    const extras = lib.extras.filter(e => e.file && !(hasSpecials && episodeKeyOf(e) > 0 && episodeKeyOf(e) < 1000))
    const watchedHere = rows.filter(r => r.watched).length
    const lastOfSeason = season > 0 ? rows.filter(r => r.aired).at(-1)?.key : undefined
    const online = status?.settings.onlineStream.enabled !== false

    // An episode with its file, as a playlist item.
    const playlistItem = (r: Row): PlaylistItem | null =>
        r.file ? { mediaId: media.id, episode: r.key, title: title(media), image: r.image || cover(media), play: { kind: "local", path: r.file.path } } : null
    const lastFile = rows.reduce((m, r) => (r.file ? Math.max(m, r.key) : m), 0)
    // This episode and the ones after it in the season with files.
    const restOf = (from: number) =>
        rows
            .filter(r => r.key >= from)
            .map(playlistItem)
            .filter((x): x is PlaylistItem => !!x)

    const play = (r: Row) => (r.file ? playLocal(r.file.path, media.id, r.key) : r.aired ? watch(media.id, r.key) : undefined)

    return (
        <div className="flex flex-col gap-6">
            {entry.localCount + (entry.sharedCount ?? 0) === 0 ? (
                <div className={cn("flex flex-wrap items-center gap-3 py-3", classic ? "rounded-lg bg-white/[0.03] px-4" : "border-y border-line")}>
                    <HardDrive className="size-4 text-subtle" />
                    <p className="mr-auto text-sm text-muted">No files yet</p>
                    {online && (
                        <Button size="sm" variant="ghost" icon={<Tv className="size-4" />} onClick={() => onStream()}>
                            Watch online
                        </Button>
                    )}
                    <Button size="sm" variant="ghost" icon={<Magnet className="size-4" />} onClick={() => onTorrents()}>
                        Find torrents
                    </Button>
                    <Button size="sm" variant="ghost" icon={<FolderInput className="size-4" />} onClick={() => setAdding(true)}>
                        Add from library
                    </Button>
                    <AddFromLibraryDialog open={adding} onOpenChange={setAdding} media={media} />
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <p className="min-w-0 text-muted">
                        <span className="tabular-nums">{plural(withFiles.length, "episode")}</span> {entry.localCount ? "downloaded" : "available"}
                        {hosts.length > 0 && ` · ${entry.localCount ? "some " : ""}on ${hosts.join(", ")}`}
                    </p>
                    <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
                        <button onClick={() => setOnlyFiles(s => !s)} aria-pressed={!onlyFiles} className="focus-ring rounded font-medium text-muted transition-colors hover:text-fg">
                            {onlyFiles ? "All episodes" : "Downloaded only"}
                        </button>
                        <EntryFilesMenu entry={entry} />
                    </div>
                </div>
            )}

            {seasons.length > 1 &&
                (seasons.length > 7 ? (
                    <Select className="w-64" value={String(season)} onChange={v => setSeason(Number(v))} options={seasons.map(s => ({ value: String(s.seasonNumber), label: `${seasonName(s)} · ${plural(s.episodeCount, "episode")}` }))} />
                ) : (
                    <Tabs className="self-start" value={String(season)} onChange={v => setSeason(Number(v))} tabs={seasons.map(s => ({ value: String(s.seasonNumber), label: seasonName(s), count: s.episodeCount }))} />
                ))}

            {current && (
                <div className="flex flex-wrap items-start gap-5">
                    <div className="min-w-0 flex-1">
                        <h3 className={classic ? "text-lg font-semibold tracking-tight" : "font-display text-lg font-semibold tracking-tight"}>{detail?.name || seasonName(current)}</h3>
                        <p className="mt-0.5 text-[13px] text-subtle">
                            {/* The year as written: a date parsed as UTC can be the year before in the Americas. */}
                            {[current.airDate?.slice(0, 4) ?? "", plural(current.episodeCount || rows.length, "episode"), season > 0 && rows.length ? `${watchedHere} watched` : ""]
                                .filter(Boolean)
                                .join(" · ")}
                        </p>
                        {detail?.overview && <p className="mt-2 line-clamp-3 max-w-3xl text-sm leading-relaxed text-muted">{cleanDescription(detail.overview)}</p>}
                    </div>
                    {lastOfSeason && lastOfSeason > progress && (
                        <Button size="sm" variant="subtle" icon={<CheckCheck className="size-4" />} disabled={marker.pending} onClick={() => marker.mark(lastOfSeason, true)}>
                            Mark season as watched
                        </Button>
                    )}
                </div>
            )}

            {isLoading && rows.length === 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-x-5 gap-y-6">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-video" />
                    ))}
                </div>
            ) : shown.length === 0 ? (
                <p className="py-6 text-sm text-muted">{onlyFiles ? "No downloaded episodes in this season." : "TMDB has no episodes for this season yet."}</p>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-x-5 gap-y-6">
                    {shown.map(r => {
                        const [, e] = splitKey(r.key)
                        const spoiler = !!status?.settings.ui.blurUnwatched && !r.watched
                        // The list's progress leaves specials out: they can't be marked.
                        const canMark = r.aired && season > 0
                        return (
                            <div key={r.key} className="flex flex-col gap-1.5">
                                <EpisodeCard
                                    image={r.image}
                                    label={formatKey(r.key)}
                                    epLabel={r.title ? `${e}.` : formatKey(r.key)}
                                    title={r.title || undefined}
                                    // Length · air date · the file's size and quality.
                                    facts={[
                                        !!r.runtime && `${r.runtime}m`,
                                        r.airDate ? (r.aired ? formatDate(r.airDate) : `Airs ${formatDate(r.airDate)}`) : !r.aired && !r.file && "Not aired",
                                        r.file && r.file.size > 0 && formatBytes(r.file.size),
                                        r.file?.parsed?.resolution,
                                        r.file?.hostName && `on ${r.file.hostName}`,
                                        r.resumeAt > 0 && `at ${formatDuration(r.resumeAt)}`,
                                    ]}
                                    watched={r.watched}
                                    hasFile={!!r.file}
                                    aired={r.aired}
                                    resumeAt={r.resumeAt}
                                    progress={r.duration ? r.resumeAt / r.duration : 0}
                                    blur={status?.settings.ui.blurUnwatched}
                                    onClick={() => play(r)}
                                    actions={canMark && <WatchedToggle watched={r.watched} disabled={marker.pending} onToggle={() => marker.mark(r.key, !r.watched)} />}
                                    menu={
                                        (r.aired || r.file) && (
                                            <>
                                                {r.file && (
                                                    <DropdownLabel>
                                                        <span className="block max-w-72 truncate" title={r.file.name}>
                                                            {r.file.name}
                                                        </span>
                                                    </DropdownLabel>
                                                )}
                                                <DropdownItem icon={<Play />} onSelect={() => play(r)}>
                                                    {r.file ? (r.resumeAt > 0 ? "Resume" : "Play") : "Watch online"}
                                                </DropdownItem>
                                                {r.file && !remote && (
                                                    <DropdownItem icon={<MonitorPlay />} onSelect={() => playLocal(r.file!.path, media.id, r.key, { player: localPlayer() === "mpv" ? "builtin" : "mpv" })}>
                                                        Play in {localPlayer() === "mpv" ? "the in-app player" : "mpv"}
                                                    </DropdownItem>
                                                )}
                                                {r.file && r.resumeAt > 0 && (
                                                    <DropdownItem icon={<RotateCcw />} onSelect={() => playLocal(r.file!.path, media.id, r.key, { start: 0 })}>
                                                        Play from the beginning
                                                    </DropdownItem>
                                                )}
                                                {!r.file && online && (
                                                    <DropdownItem icon={<Tv />} onSelect={() => onStream(r.key)}>
                                                        Choose a stream…
                                                    </DropdownItem>
                                                )}
                                                {!r.file && (
                                                    <DropdownItem icon={<Magnet />} onSelect={() => onTorrents(r.key)}>
                                                        Find torrents
                                                    </DropdownItem>
                                                )}
                                                {r.file && (
                                                    <DropdownItem icon={<ListPlus />} onSelect={() => setToPlaylist([playlistItem(r)!])}>
                                                        Add to playlist…
                                                    </DropdownItem>
                                                )}
                                                {r.file && r.key < lastFile && (
                                                    <DropdownItem icon={<ListEnd />} onSelect={() => setToPlaylist(restOf(r.key))}>
                                                        Add the rest of the season…
                                                    </DropdownItem>
                                                )}
                                                {season > 0 && (
                                                    <DropdownItem icon={<CheckCheck />} onSelect={() => marker.mark(r.key, !r.watched)}>
                                                        {r.watched ? "Mark as unwatched" : "Mark as watched (and everything before)"}
                                                    </DropdownItem>
                                                )}
                                            </>
                                        )
                                    }
                                />
                                {r.overview && !spoiler && <p className="line-clamp-2 px-0.5 text-xs leading-relaxed text-subtle">{r.overview}</p>}
                            </div>
                        )
                    })}
                </div>
            )}

            {extras.length > 0 && <Extras entry={entry} extras={extras} />}
            {entry.metadataNote && <p className="text-xs text-subtle">{entry.metadataNote}</p>}
            <AddToPlaylistDialog items={toPlaylist} onClose={() => setToPlaylist(null)} />
        </div>
    )
}

// What a file that isn't an episode is: a movie's later part, a trailer, a
// featurette..., a special without a number.
function extraLabel(x: EpisodeView) {
    const extra = x.file?.parsed?.extra
    switch (x.kind) {
        case "part":
            return "Next part"
        case "special":
            return x.file?.hostName ? `Special · on ${x.file.hostName}` : "Special"
        case "extra":
            return extra ? extra[0].toUpperCase() + extra.slice(1) : "Extra"
    }
    return "No episode number"
}

// Featurettes, behind the scenes and other bonus files of the library.
function Extras({ entry, extras }: { entry: EntryView; extras: EpisodeView[] }) {
    const { playLocal, localPlayer, remote } = usePlay()
    const media = entry.media
    return (
        <section>
            <h3 className="mb-3 text-sm font-medium text-muted">Extras</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-x-5 gap-y-6">
                {extras.map(x => (
                    <EpisodeCard
                        // A file holding two specials is listed for each.
                        key={`${x.file!.path}#${episodeKeyOf(x)}`}
                        image={x.image || media.bannerImage || cover(media)}
                        title={x.title || x.file!.name}
                        epLabel={false}
                        facts={[extraLabel(x), x.file!.size > 0 && formatBytes(x.file!.size), x.file!.parsed?.resolution]}
                        hasFile
                        // A numbered special plays as itself (its resume position).
                        onClick={() => playLocal(x.file!.path, media.id, x.kind === "special" ? episodeKeyOf(x) : 0)}
                        menu={
                            <>
                                <DropdownLabel>
                                    <span className="block max-w-72 truncate" title={x.file!.name}>
                                        {x.file!.name}
                                    </span>
                                </DropdownLabel>
                                <DropdownItem icon={<Play />} onSelect={() => playLocal(x.file!.path, media.id, x.kind === "special" ? episodeKeyOf(x) : 0)}>
                                    Play
                                </DropdownItem>
                                {!remote && (
                                    <DropdownItem icon={<MonitorPlay />} onSelect={() => playLocal(x.file!.path, media.id, x.kind === "special" ? episodeKeyOf(x) : 0, { player: localPlayer() === "mpv" ? "builtin" : "mpv" })}>
                                        Play in {localPlayer() === "mpv" ? "the in-app player" : "mpv"}
                                    </DropdownItem>
                                )}
                            </>
                        }
                    />
                ))}
            </div>
        </section>
    )
}

// A movie's file in the library (or another Moviko's), and its extras.
export function MovieLibrary({ entry, onStream, onTorrents }: { entry: EntryView; onStream: () => void; onTorrents: () => void }) {
    const media = entry.media
    const { data: status } = useStatus()
    const { playLocal, localPlayer, remote } = usePlay()
    const [adding, setAdding] = useState(false)
    const [toPlaylist, setToPlaylist] = useState<PlaylistItem[] | null>(null)
    const classic = useClassic()
    const lib = useLibraryEpisodes(entry)
    const main = lib.episodes.find(e => episodeKeyOf(e) === MOVIE_EPISODE && e.file) ?? lib.episodes.find(e => e.file)
    const extras = lib.extras.filter(e => e.file)
    const online = status?.settings.onlineStream.enabled !== false

    if (!main?.file)
        return (
            <div className={cn("flex flex-wrap items-center gap-3 py-3", classic ? "rounded-lg bg-white/[0.03] px-4" : "border-y border-line")}>
                <HardDrive className="size-4 text-subtle" />
                <p className="mr-auto text-sm text-muted">Not in your library</p>
                {online && (
                    <Button size="sm" variant="ghost" icon={<Tv className="size-4" />} onClick={onStream}>
                        Watch online
                    </Button>
                )}
                <Button size="sm" variant="ghost" icon={<Magnet className="size-4" />} onClick={onTorrents}>
                    Find torrents
                </Button>
                <Button size="sm" variant="ghost" icon={<FolderInput className="size-4" />} onClick={() => setAdding(true)}>
                    Add from library
                </Button>
                <AddFromLibraryDialog open={adding} onOpenChange={setAdding} media={media} />
            </div>
        )

    const f = main.file
    const duration = main.history?.duration ?? 0
    return (
        <section className="flex flex-col gap-6">
            <div className="card flex flex-wrap items-center gap-4 p-3 pr-4">
                <button onClick={() => playLocal(f.path, media.id, MOVIE_EPISODE)} className="group relative aspect-video w-44 shrink-0 overflow-hidden rounded-md bg-surface-3" aria-label="Play">
                    {(banner(media) || cover(media)) && <img {...(media.bannerImage ? backdrop(media.bannerImage, 176) : { src: cover(media) })} alt="" className="size-full object-cover transition-[filter] group-hover:brightness-75" />}
                    <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="grid size-9 place-items-center rounded-full bg-white/95 text-neutral-950">
                            <Play className="ml-0.5 size-4 fill-current" />
                        </span>
                    </span>
                    {duration > 0 && main.resumeAt > 0 && <Progress value={main.resumeAt / duration} className="absolute inset-x-0 bottom-0 h-[3px] rounded-none" />}
                </button>
                <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                        <HardDrive className="size-4 shrink-0 text-subtle" />
                        {f.hostName ? `On ${f.hostName}` : "In your library"}
                    </p>
                    <p className="mt-1 truncate text-[13px] text-muted" title={f.path}>
                        {f.name}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {f.parsed?.resolution && <Badge>{f.parsed.resolution}</Badge>}
                        {f.parsed?.releaseGroup && <Badge tone="blue">{f.parsed.releaseGroup}</Badge>}
                        {f.size > 0 && <span className="text-xs text-subtle">{formatBytes(f.size)}</span>}
                        {main.resumeAt > 0 && <span className="text-xs text-subtle">· stopped at {formatDuration(main.resumeAt)}</span>}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button variant="primary" size="sm" icon={<Play className="size-4 fill-current" />} onClick={() => playLocal(f.path, media.id, MOVIE_EPISODE)}>
                        {main.resumeAt > 0 ? "Resume" : "Play"}
                    </Button>
                    {main.resumeAt > 0 && (
                        <Button size="sm" variant="subtle" onClick={() => playLocal(f.path, media.id, MOVIE_EPISODE, { start: 0 })}>
                            From the start
                        </Button>
                    )}
                    {!remote && (
                        <Button size="sm" variant="ghost" icon={<MonitorPlay className="size-4" />} onClick={() => playLocal(f.path, media.id, MOVIE_EPISODE, { player: localPlayer() === "mpv" ? "builtin" : "mpv" })}>
                            {localPlayer() === "mpv" ? "In-app player" : "mpv"}
                        </Button>
                    )}
                    {(
                        <Button size="sm" variant="ghost" icon={<ListPlus className="size-4" />} onClick={() => setToPlaylist([{ mediaId: media.id, episode: MOVIE_EPISODE, title: title(media), image: cover(media), play: { kind: "local", path: f.path } }])}>
                            Playlist
                        </Button>
                    )}
                    <EntryFilesMenu entry={entry} />
                </div>
            </div>
            {extras.length > 0 && <Extras entry={entry} extras={extras} />}
            {entry.metadataNote && <p className="text-xs text-subtle">{entry.metadataNote}</p>}
            <AddToPlaylistDialog items={toPlaylist} onClose={() => setToPlaylist(null)} />
        </section>
    )
}
