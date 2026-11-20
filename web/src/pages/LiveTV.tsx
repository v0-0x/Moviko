import { useQueryClient } from "@tanstack/react-query"
import { Globe, ListPlus, RefreshCw, Search as SearchIcon, Settings2, ShieldCheck, Star, Trash2, Tv } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { LivePlayer } from "@/components/LivePlayer"
import { Button, Chip, ChipRow, Dialog, EmptyState, ErrorState, Field, IconButton, Input, Select, Switch, Tabs } from "@/components/ui"
import { api } from "@/lib/api"
import { usePersisted } from "@/lib/hooks"
import { groupsOf, iptvOrgCountry, liveCountries, useLiveChannels, useLiveFavourite, useLiveGuide, useLiveInfo, type LiveChannel, type LiveInfo, type LiveNow, type LiveSettings, type LiveSource } from "@/lib/livetv"
import { useStatus } from "@/lib/queries"
import { toast } from "@/lib/toast"
import { cn, img, relativeTime } from "@/lib/utils"

// Live TV: the channels of the sources added here (Moviko comes with none),
// by group, with what's on where the source has a guide. A channel plays
// over the window (components/LivePlayer). Sources are added on the
// computer Moviko runs on; any device watches.

// How many channels are drawn at first, and with each "Show more".
const PAGE = 240

type View = "all" | "favourites" | "recent"

export default function LiveTVPage() {
    const { data: status } = useStatus()
    const { data: info, error: infoError, refetch } = useLiveInfo()
    const has = (info?.sources ?? []).some(s => s.enabled)
    const { data: list, isLoading, error } = useLiveChannels(has)
    const { data: guide } = useLiveGuide(has)
    const favourite = useLiveFavourite()
    const lan = status?.client === "lan"

    const [view, setView] = usePersisted<View>("moviko-livetv-view", "all")
    const [group, setGroup] = useState("")
    const [source, setSource] = useState("")
    const [text, setText] = useState("")
    const [shown, setShown] = useState(PAGE)
    const [adding, setAdding] = useState(false)
    const [managing, setManaging] = useState(false)
    const [playing, setPlaying] = useState("")

    const all = useMemo(() => list?.channels ?? [], [list])
    const byKey = useMemo(() => new Map(all.map(c => [c.key, c])), [all])
    // The groups, the ones with the most channels first.
    const groups = useMemo(() => {
        const n = new Map<string, number>()
        for (const c of all) if (!source || c.source === source) for (const g of groupsOf(c)) n.set(g, (n.get(g) ?? 0) + 1)
        return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0])
    }, [all, source])
    const filtered = useMemo(() => {
        let out: LiveChannel[]
        if (view === "recent") out = (list?.recent ?? []).map(k => byKey.get(k)).filter((c): c is LiveChannel => !!c)
        else out = view === "favourites" ? all.filter(c => c.favourite) : all
        if (source) out = out.filter(c => c.source === source)
        if (group) out = out.filter(c => groupsOf(c).includes(group))
        const q = text.trim().toLowerCase()
        if (q) out = out.filter(c => c.name.toLowerCase().includes(q) || (guide?.[c.key]?.now?.title ?? "").toLowerCase().includes(q))
        return out
    }, [all, byKey, list, view, source, group, text, guide])
    useEffect(() => setShown(PAGE), [view, source, group, text])
    // A group that's gone (another source picked): none.
    useEffect(() => {
        if (group && !groups.includes(group)) setGroup("")
    }, [group, groups])

    const step = useCallback(
        (dir: number) => {
            const i = filtered.findIndex(c => c.key === playing)
            if (!filtered.length) return
            // Web pages open in the browser: not ones to zap onto.
            for (let n = 1; n <= filtered.length; n++) {
                const c = filtered[(i + dir * n + filtered.length * n) % filtered.length]
                if (!c.web) return setPlaying(c.key)
            }
        },
        [filtered, playing],
    )
    const close = useCallback(() => setPlaying(""), [])
    const current = byKey.get(playing)

    if (infoError) return <ErrorState className="m-10" title="Couldn't load Live TV" error={infoError} onRetry={() => refetch()} />
    if (!info) return <div className="m-10 card h-60 shimmer" />

    const header = (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <h1 className="text-[1.75rem] font-semibold tracking-tight">Live TV</h1>
            <div className="flex items-center gap-1">
                {info.check.running && (
                    <span className="mr-2 text-xs text-muted tabular-nums" title="Seeing which channels answer">
                        Checking {info.check.done.toLocaleString()} of {info.check.total.toLocaleString()}
                    </span>
                )}
                {info.sources.length > 0 && (
                    <Button icon={<Settings2 className="size-4" />} onClick={() => setManaging(true)}>
                        Sources
                    </Button>
                )}
                {!lan && (
                    <Button variant={info.sources.length ? undefined : "primary"} icon={<ListPlus className="size-4" />} onClick={() => setAdding(true)}>
                        Add a source
                    </Button>
                )}
            </div>
        </div>
    )
    const dialogs = (
        <>
            <AddSource open={adding} onOpenChange={setAdding} region={info.settings.country || status?.settings.tmdb?.region || ""} />
            <Sources open={managing} onOpenChange={setManaging} info={info} lan={lan} />
        </>
    )

    if (!info.sources.length)
        return (
            <div className="min-h-full px-6 pt-8 pb-24 md:px-8 xl:px-10">
                {header}
                <EmptyState icon={<Tv className="size-6" />} title="No channels yet">
                    {lan
                        ? "Add a source on the computer Moviko runs on: its channels then show here."
                        : "Moviko comes with no channels. Add your own: a playlist (M3U), an Xtream Codes login from your IPTV provider, or the free public channels of a country."}
                </EmptyState>
                {dialogs}
            </div>
        )

    const hidden = (list?.hiddenDown ?? 0) + (list?.hiddenLocked ?? 0)
    return (
        <div className="min-h-full px-6 pt-8 pb-24 md:px-8 xl:px-10">
            {header}
            <div className="mb-6 flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Tabs
                        value={view}
                        onChange={setView}
                        tabs={[
                            { value: "all", label: "All" },
                            { value: "favourites", label: "Favourites" },
                            { value: "recent", label: "Recent" },
                        ]}
                    />
                    <Input value={text} onChange={e => setText(e.target.value)} placeholder="Find a channel…" aria-label="Find a channel" icon={<SearchIcon className="size-4" />} className="h-9 w-full sm:w-64" />
                    {info.sources.filter(s => s.enabled).length > 1 && (
                        <Select className="w-full sm:w-52" value={source} onChange={setSource} options={[{ value: "", label: "Every source" }, ...info.sources.filter(s => s.enabled).map(s => ({ value: s.id, label: s.name }))]} />
                    )}
                </div>
                {groups.length > 1 && (
                    <ChipRow label="More groups">
                        <Chip on={!group} onClick={() => setGroup("")}>
                            All
                        </Chip>
                        {groups.slice(0, 80).map(g => (
                            <Chip key={g} on={group === g} onClick={() => setGroup(group === g ? "" : g)}>
                                {g}
                            </Chip>
                        ))}
                    </ChipRow>
                )}
            </div>

            {error ? (
                <ErrorState title="Couldn't load the channels" error={error} />
            ) : isLoading || !list ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-6">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="my-2 h-12 shimmer rounded-sm" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState icon={view === "favourites" ? <Star className="size-6" /> : <Tv className="size-6" />} title={view === "favourites" ? "No favourites yet" : view === "recent" ? "Nothing watched yet" : "No channels here"}>
                    {view === "favourites" ? "The star on a channel keeps it here." : view === "recent" ? "The channels you watch show here." : all.length ? "Nothing matches: try another group or name." : "Your sources have no channels to show."}
                </EmptyState>
            ) : (
                <>
                    <p className="mb-2 text-xs text-subtle tabular-nums">
                        {filtered.length.toLocaleString()} {filtered.length === 1 ? "channel" : "channels"}
                        {hidden > 0 && view === "all" && !group && !text && (
                            <>
                                {" · "}
                                <button className="underline decoration-fg/30 underline-offset-2 hover:text-fg" onClick={() => setManaging(true)}>
                                    {hidden.toLocaleString()} left out
                                </button>
                                {" (not working, or only for another country)"}
                            </>
                        )}
                    </p>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-6 border-t border-line">
                        {filtered.slice(0, shown).map((c, i) => (
                            <ChannelRow key={c.key} channel={c} guide={guide?.[c.key]} first={i === 0} onPlay={() => setPlaying(c.key)} onFavourite={() => favourite(c.key, !c.favourite)} />
                        ))}
                    </div>
                    {filtered.length > shown && (
                        <div className="mt-8 flex justify-center">
                            <Button onClick={() => setShown(n => n + PAGE)}>Show more</Button>
                        </div>
                    )}
                </>
            )}
            {current && <LivePlayer channel={current} guide={guide?.[current.key]} onClose={close} onStep={step} onFavourite={on => favourite(current.key, on)} />}
            {dialogs}
        </div>
    )
}

// A channel: its logo, name and what's on (or its groups); a click plays it.
function ChannelRow({ channel: c, guide, first, onPlay, onFavourite }: { channel: LiveChannel; guide?: LiveNow; first: boolean; onPlay: () => void; onFavourite: () => void }) {
    const now = guide?.now
    // How far the programme is, as a hairline under the row.
    const done = now ? Math.min(100, Math.max(0, ((Date.now() / 1000 - now.start) / Math.max(1, now.stop - now.start)) * 100)) : 0
    return (
        <div className="group/ch relative flex items-center gap-1 border-b border-line">
            <button onClick={onPlay} data-tv-autofocus={first || undefined} className="focus-ring flex min-w-0 flex-1 items-center gap-3 py-2 text-left transition-colors hover:bg-white/[0.05]" title={c.down ? `Not working: ${c.down}` : undefined}>
                <span className="on-dark grid size-10 shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-2 text-subtle">
                    {c.logo ? <img src={img(c.logo)} alt="" loading="lazy" className="size-full object-contain p-0.5" /> : c.web ? <Globe className="size-4" /> : <Tv className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[13.5px] font-medium", c.down && "text-muted line-through decoration-fg/30")}>{c.name}</span>
                    <span className="block truncate text-xs text-muted">{now ? now.title : c.web ? `Opens on ${c.web}` : groupsOf(c).join(" · ") || c.country || " "}</span>
                </span>
            </button>
            <button
                onClick={onFavourite}
                aria-label={c.favourite ? `Remove ${c.name} from favourites` : `Add ${c.name} to favourites`}
                aria-pressed={!!c.favourite}
                className={cn("focus-ring grid size-8 shrink-0 place-items-center rounded-sm transition", c.favourite ? "text-fg" : "text-subtle opacity-0 group-hover/ch:opacity-100 focus-visible:opacity-100 hover:text-fg [@media(hover:none)]:opacity-100")}
            >
                <Star className={cn("size-4", c.favourite && "fill-current")} />
            </button>
            {now && <span aria-hidden className="absolute bottom-[-1px] left-0 h-px bg-fg/50" style={{ width: `${done}%` }} />}
        </div>
    )
}

type Kind = "country" | "m3u" | "xtream"

// Adding a source: the free public channels of a country (iptv-org's
// lists), a playlist's address, or an Xtream Codes login.
function AddSource({ open, onOpenChange, region }: { open: boolean; onOpenChange: (v: boolean) => void; region: string }) {
    const qc = useQueryClient()
    const countries = useMemo(liveCountries, [])
    const [kind, setKind] = useState<Kind>("country")
    const [country, setCountry] = useState("")
    const [url, setUrl] = useState("")
    const [name, setName] = useState("")
    const [epg, setEpg] = useState("")
    const [user, setUser] = useState("")
    const [pass, setPass] = useState("")
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        if (!open) return
        // iptv-org calls Great Britain "uk".
        const r = region.toUpperCase() === "GB" ? "UK" : region.toUpperCase()
        setCountry(c => c || (countries.some(x => x.value === r) ? r : "US"))
    }, [open, region, countries])

    const add = async () => {
        setBusy(true)
        try {
            const body =
                kind === "country"
                    ? { kind: "m3u", url: iptvOrgCountry(country), name: `Free channels: ${countries.find(c => c.value === country)?.label ?? country}` }
                    : kind === "m3u"
                      ? { kind: "m3u", url, name, epg }
                      : { kind: "xtream", url, name, epg, user, pass }
            const src = await api.post<LiveSource>("/api/livetv/sources", body)
            toast.success(`${src.name}: ${src.channels.toLocaleString()} ${src.channels === 1 ? "channel" : "channels"}`)
            qc.invalidateQueries({ queryKey: ["livetv"] })
            setUrl("")
            setName("")
            setEpg("")
            setUser("")
            setPass("")
            onOpenChange(false)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(false)
        }
    }
    const ready = kind === "country" ? !!country : kind === "m3u" ? url.trim().length > 3 : url.trim().length > 3 && !!user.trim() && !!pass
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title="Add a Live TV source"
            description="Moviko only plays what you add: you're responsible for having the right to watch it."
            footer={
                <>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button variant="primary" loading={busy} disabled={!ready} onClick={add}>
                        Add
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <Tabs
                    value={kind}
                    onChange={setKind}
                    tabs={[
                        { value: "country", label: "Free channels" },
                        { value: "m3u", label: "Playlist" },
                        { value: "xtream", label: "Xtream Codes" },
                    ]}
                />
                {kind === "country" && (
                    <Field label="Country" help="The public, free-to-air channels of a country, from the iptv-org project's lists. Some only play in their own country.">
                        <Select value={country} onChange={setCountry} options={countries} />
                    </Field>
                )}
                {kind === "m3u" && (
                    <>
                        <Field label="Playlist address" help="An M3U playlist's own address (it usually ends in .m3u or .m3u8).">
                            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/playlist.m3u" autoFocus />
                        </Field>
                        <Field label="Name">
                            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Optional" />
                        </Field>
                        <Field label="TV guide address" help="An XMLTV guide, when the playlist doesn't name its own.">
                            <Input value={epg} onChange={e => setEpg(e.target.value)} placeholder="Optional" />
                        </Field>
                    </>
                )}
                {kind === "xtream" && (
                    <>
                        <Field label="Server address" help="As your IPTV provider gave it, with its port.">
                            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="http://example.com:8080" autoFocus />
                        </Field>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Username">
                                <Input value={user} onChange={e => setUser(e.target.value)} autoComplete="off" />
                            </Field>
                            <Field label="Password">
                                <Input type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" />
                            </Field>
                        </div>
                        <Field label="Name">
                            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Optional" />
                        </Field>
                    </>
                )}
            </div>
        </Dialog>
    )
}

// The sources added, and what Live TV leaves out.
function Sources({ open, onOpenChange, info, lan }: { open: boolean; onOpenChange: (v: boolean) => void; info: LiveInfo; lan: boolean }) {
    const qc = useQueryClient()
    const [busy, setBusy] = useState("")
    const countries = useMemo(liveCountries, [])
    const call = async (id: string, fn: () => Promise<unknown>) => {
        setBusy(id)
        try {
            await fn()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy("")
            qc.invalidateQueries({ queryKey: ["livetv"] })
        }
    }
    const set = (change: Partial<LiveSettings>) => call("settings", () => api.put("/api/livetv/settings", { ...info.settings, ...change }))
    const check = info.check
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title="Live TV sources" className="max-w-2xl">
            <div className="flex flex-col gap-6">
                <div className="flex flex-col divide-y divide-line border-y border-line">
                    {info.sources.map(s => (
                        <div key={s.id} className="flex items-center gap-3 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{s.name}</p>
                                <p className="truncate text-xs text-subtle">
                                    {[s.kind === "xtream" ? "Xtream Codes" : "Playlist", `${s.channels.toLocaleString()} channels`, s.fetchedAt > 0 && !s.error && `updated ${relativeTime(s.fetchedAt)}`, s.local && "on your network"].filter(Boolean).join(" · ")}
                                </p>
                                {s.error && <p className="mt-0.5 text-xs text-rose-300">{s.error}</p>}
                            </div>
                            <IconButton label={`Fetch ${s.name}'s channels again`} size="sm" loading={busy === s.id} onClick={() => call(s.id, () => api.post(`/api/livetv/sources/${s.id}/refresh`))}>
                                <RefreshCw className="size-4" />
                            </IconButton>
                            <Switch checked={s.enabled} disabled={lan} label={`Show ${s.name}`} onChange={v => call(s.id, () => api.put(`/api/livetv/sources/${s.id}`, { enabled: v }))} />
                            {!lan && (
                                <IconButton label={`Remove ${s.name}`} size="sm" onClick={() => confirm(`Remove ${s.name} and its channels?`) && call(s.id, () => api.del(`/api/livetv/sources/${s.id}`))}>
                                    <Trash2 className="size-4" />
                                </IconButton>
                            )}
                        </div>
                    ))}
                </div>
                <div className="flex flex-col gap-4">
                    <Toggle label="Leave out channels that don't work" help="Public lists always carry dead links: the ones that didn't answer the last check, or didn't play." checked={info.settings.hideNotWorking} disabled={lan} onChange={v => set({ hideNotWorking: v })} />
                    <Toggle label="Check the channels by itself" help="In the background, each channel once a day." checked={info.settings.autoCheck} disabled={lan} onChange={v => set({ autoCheck: v })} />
                    <Toggle label="Leave out channels of other countries only" help="The ones their list marks as playing only in their own country." checked={info.settings.hideRegionLocked} disabled={lan} onChange={v => set({ hideRegionLocked: v })} />
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <p className="text-sm font-medium">Your country</p>
                            <p className="text-xs text-subtle">For the channels that only play in theirs.</p>
                        </div>
                        <Select className="w-52" disabled={lan} value={info.settings.country} onChange={v => set({ country: v })} options={[{ value: "", label: "As in Settings (TMDB)" }, ...countries.map(c => (c.value === "UK" ? { ...c, value: "GB" } : c))]} />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
                        <p className="min-w-0 text-xs text-muted tabular-nums">
                            {check.running
                                ? `Checking: ${check.done.toLocaleString()} of ${check.total.toLocaleString()}, ${check.working.toLocaleString()} working`
                                : check.total > 0
                                  ? `Last check: ${check.working.toLocaleString()} of ${check.done.toLocaleString()} working`
                                  : "A check opens every channel to see which answer."}
                        </p>
                        <Button icon={<ShieldCheck className="size-4" />} loading={busy === "check"} onClick={() => call("check", () => api.post("/api/livetv/check", { stop: check.running }))}>
                            {check.running ? "Stop" : "Check now"}
                        </Button>
                    </div>
                </div>
            </div>
        </Dialog>
    )
}

function Toggle({ label, help, checked, disabled, onChange }: { label: string; help: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-subtle">{help}</p>
            </div>
            <Switch checked={checked} disabled={disabled} label={label} onChange={onChange} />
        </div>
    )
}
