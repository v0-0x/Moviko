import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ChevronDown, FlaskConical, Info, MoreVertical, Pencil, Play, Plus, RotateCcw, Rss, Search, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "@/lib/toast"
import { MediaPicker } from "@/components/MediaPicker"
import { Badge, Button, ContextArea, Dialog, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, EmptyState, Field, IconButton, Input, Select, Spinner, Switch } from "@/components/ui"
import { api } from "@/lib/api"
import { formatKey, mediaIsShow, mediaRef, seasonEpisodeCount, splitKey } from "@/lib/ids"
import { fetchEntry, useAutoItems, useAutoRules, useCollection, useRuleWanted, useSaveSettings, useStatus } from "@/lib/queries"
import { useClassic } from "@/lib/themes"
import type { AutoItem, AutoRule, AutoRunReport, Media } from "@/lib/types"
import { cn, entryUrl, formatBytes, poster, relativeTime, title } from "@/lib/utils"
import { PathInput } from "./settings/parts"

const RESOLUTIONS = [
    { value: "", label: "Any resolution" },
    { value: "2160", label: "2160p (4K)" },
    { value: "1080", label: "1080p" },
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
]

const newRule = (resolution: string): AutoRule => ({
    mediaId: 0,
    enabled: true,
    title: "",
    resolution,
    releaseGroups: [],
    mustContain: [],
    mustNotContain: [],
    minSeeders: 1,
    packs: true,
    destination: "",
    startFrom: 0,
})

// The shows of the list the auto downloader is for: those being watched
// and those on the watchlist.
function useListShows() {
    const { data } = useCollection()
    return useMemo(() => {
        const out: Media[] = []
        for (const l of data?.lists ?? []) {
            if (l.status !== "CURRENT" && l.status !== "PLANNING") continue
            for (const it of l.items) if (mediaIsShow(it.media) && !out.some(m => m.id === it.media.id)) out.push(it.media)
        }
        return out.sort((a, b) => title(a).localeCompare(title(b)))
    }, [data])
}

// A show by id: from the list, else its page (the title page's own query,
// which this shares).
function useShow(id: number, list: Media[]) {
    const inList = list.find(m => m.id === id)
    const { data } = useQuery({
        queryKey: ["entry", id],
        queryFn: () => fetchEntry(id),
        enabled: id > 0 && !inList,
        staleTime: 3600_000,
        retry: false,
    })
    return inList ?? data?.media
}

export default function AutoDownloaderPage() {
    const classic = useClassic()
    const { data: rules, isLoading } = useAutoRules()
    const { data: items } = useAutoItems()
    const { data: status } = useStatus()
    const save = useSaveSettings()
    const shows = useListShows()
    const [editing, setEditing] = useState<AutoRule | null>(null)
    const [running, setRunning] = useState(false)
    const [report, setReport] = useState<AutoRunReport | null>(null)
    const qc = useQueryClient()
    const settings = status?.settings
    const noClient = !settings?.torrent.defaultClient || settings.torrent.defaultClient === "none"

    const run = async () => {
        setRunning(true)
        try {
            const r = await api.post<AutoRunReport>("/api/autodownloader/run")
            setReport(r)
            if (r.busy) toast.info("The auto downloader is already checking")
            else toast.success(r.added ? `Sent ${r.added} torrent(s) to the torrent client` : r.wanted ? `Looked for ${r.wanted} episode(s), nothing found yet` : "Nothing to look for right now")
            qc.invalidateQueries({ queryKey: ["auto-items"] })
            qc.invalidateQueries({ queryKey: ["auto-rules"] })
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setRunning(false)
        }
    }

    const titles = useMemo(() => {
        const m = new Map<number, string>()
        for (const r of rules ?? []) if (r.title) m.set(r.mediaId, r.title)
        for (const s of shows) m.set(s.id, title(s))
        return m
    }, [rules, shows])

    return (
        <div className="min-h-full px-6 pt-8 pb-24 md:px-8 xl:px-10">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <h1 className="text-[1.75rem] font-semibold tracking-tight">Auto downloader</h1>
                <div className="flex items-center gap-2">
                    {settings && (
                        <label className="mr-1 flex items-center gap-2.5 text-sm text-muted">
                            Every {settings.torrent.autoDownloadMinutes} min
                            <Switch checked={settings.torrent.autoDownloader} onChange={v => save.mutate({ ...settings, torrent: { ...settings.torrent, autoDownloader: v } })} />
                        </label>
                    )}
                    <IconButton label="Check now" icon={<Play className="size-4" />} loading={running} onClick={run} disabled={!rules?.length} />
                    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing(newRule(settings?.torrent.preferredResolution ?? "1080"))}>
                        New rule
                    </Button>
                </div>
            </div>

            {noClient && (
                <p className={cn("mb-8 text-sm text-amber-200", classic ? "rounded-xl bg-amber-500/10 p-4" : "border-l border-amber-400 pl-3")}>
                    No torrent client yet. <Link to="/settings?tab=torrents" className="underline">Set one up</Link> first.
                </p>
            )}
            {settings && !settings.torrent.autoDownloader && (rules ?? []).some(r => r.enabled) && (
                <p className={cn("mb-8 text-sm text-muted", classic ? "rounded-xl bg-white/[0.04] p-4" : "border-l border-line-strong pl-3")}>It's off: rules only run on Check now.</p>
            )}
            {report && <RunSummary report={report} onClose={() => setReport(null)} />}

            {!isLoading && (rules ?? []).length === 0 && (
                <EmptyState icon={<Rss className="size-6" />} title="No rules yet">
                    A rule keeps a show's episodes downloaded, e.g. “1080p, NTb or FLUX first, no HDTV”.
                </EmptyState>
            )}
            {/* This look: rows on hairlines, not a box each. */}
            <div className={cn("grid xl:grid-cols-2", classic ? "gap-2" : cn("grid-cols-1 gap-x-8", (rules ?? []).length > 0 && "border-t border-line"))}>
                {(rules ?? []).map(r => (
                    <RuleCard key={r.id} rule={r} shows={shows} onEdit={() => setEditing(r)} />
                ))}
            </div>

            {(items ?? []).length > 0 && <History items={items!} titles={titles} />}
            {editing && <RuleDialog rule={editing} shows={shows} canPickFolder={status?.client !== "lan"} onClose={() => setEditing(null)} />}
        </div>
    )
}

function RunSummary({ report, onClose }: { report: AutoRunReport; onClose: () => void }) {
    const classic = useClassic()
    const [open, setOpen] = useState(true)
    const bad = report.errors.length > 0
    return (
        <div
            className={cn(
                "mb-8 text-sm",
                bad ? "text-amber-100" : "text-muted",
                classic ? cn("rounded-xl border px-4 py-3", bad ? "border-amber-500/25 bg-amber-500/10" : "border-line bg-white/[0.02]") : cn("border-l pl-3", bad ? "border-amber-400" : "border-line-strong"),
            )}
        >
            <div className="flex items-center gap-3">
                {bad && <AlertTriangle className="size-4 shrink-0 text-amber-300" />}
                <span className="flex-1">
                    {report.busy
                        ? "A check was already running."
                        : `Looked for ${report.wanted} episode${report.wanted === 1 ? "" : "s"}, sent ${report.added} torrent${report.added === 1 ? "" : "s"} to the client${bad ? `, ${report.errors.length} problem${report.errors.length === 1 ? "" : "s"}` : ""}.`}
                </span>
                {bad && (
                    <button className="flex items-center gap-1 text-xs hover:text-fg" onClick={() => setOpen(o => !o)}>
                        Details <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
                    </button>
                )}
                <button className="text-xs text-subtle hover:text-fg" onClick={onClose}>
                    Dismiss
                </button>
            </div>
            {bad && open && (
                <ul className="mt-2 flex flex-col gap-1 pl-7 text-xs">
                    {report.errors.map(e => (
                        <li key={e} className="break-words">
                            {e}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// "S02E03, S02E04 and 5 more".
function keysText(keys: number[], max = 4) {
    const shown = keys.slice(0, max).map(formatKey).join(", ")
    return keys.length > max ? `${shown} and ${keys.length - max} more` : shown
}

function RuleCard({ rule, shows, onEdit }: { rule: AutoRule; shows: Media[]; onEdit: () => void }) {
    const qc = useQueryClient()
    const media = useShow(rule.mediaId, shows)
    const { data: wanted, isLoading } = useRuleWanted(rule.id, rule.enabled)
    const toggle = async (enabled: boolean) => {
        try {
            await api.post("/api/autodownloader/rules", { ...rule, enabled })
            qc.invalidateQueries({ queryKey: ["auto-rules"] })
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    const del = async () => {
        if (!confirm(`Delete the rule for ${media ? title(media) : rule.title}?`)) return
        try {
            await api.del(`/api/autodownloader/rules/${rule.id}`)
            qc.invalidateQueries({ queryKey: ["auto-rules"] })
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    const name = media ? title(media) : rule.title || mediaRef(rule.mediaId)
    const classic = useClassic()
    const navigate = useNavigate()
    const [testing, setTesting] = useState(false)
    // What it takes, on one line.
    const facts = [
        rule.resolution ? `${rule.resolution}p` : "Any resolution",
        rule.releaseGroups.length > 0 && `Prefers ${rule.releaseGroups.join(", ")}`,
        rule.packs && "Season packs",
        rule.minSeeders > 1 && `≥ ${rule.minSeeders} seeders`,
        (rule.minSizeMb || rule.maxSizeMb) && `${rule.minSizeMb || 0}–${rule.maxSizeMb ? `${rule.maxSizeMb} MB` : "any size"}`,
        !!rule.delayMinutes && `Waits ${rule.delayMinutes} min`,
        ...rule.mustContain.map(w => `+${w}`),
        ...rule.mustNotContain.map(w => `−${w}`),
        rule.startFrom > 0 && `From ${formatKey(rule.startFrom)}`,
    ].filter(Boolean)
    // The "⋯" button's items, and a right-click's on the row.
    const menu = (
        <>
            <DropdownItem icon={<Pencil />} onSelect={onEdit}>
                Edit
            </DropdownItem>
            <DropdownItem icon={<FlaskConical />} onSelect={() => setTesting(true)}>
                Test
            </DropdownItem>
            <DropdownItem icon={<Info />} onSelect={() => navigate(entryUrl({ id: rule.mediaId }))}>
                Its page
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem danger icon={<Trash2 />} onSelect={del}>
                Delete
            </DropdownItem>
        </>
    )
    return (
        <>
        <ContextArea menu={menu} className={cn("flex items-center gap-4 fade-in", classic ? "card p-3" : "border-b border-line py-3")}>
            <Link to={entryUrl({ id: rule.mediaId })} className={cn("focus-ring shrink-0 rounded-lg transition-opacity", !rule.enabled && "opacity-60")}>
                {media ? <img {...poster(media, 44)} alt="" className="h-16 w-11 rounded-lg object-cover" /> : <div className="h-16 w-11 rounded-lg bg-white/[0.05]" />}
            </Link>
            <div className={cn("min-w-0 flex-1 transition-opacity", !rule.enabled && "opacity-60")}>
                <Link to={entryUrl({ id: rule.mediaId })} className="block truncate font-medium hover:underline">
                    {name}
                </Link>
                <p className="mt-0.5 truncate text-sm text-muted" title={facts.join(" · ")}>
                    {facts.join(" · ")}
                </p>
                <p className="mt-0.5 truncate text-xs text-subtle">
                    {!rule.enabled
                        ? "Paused"
                        : isLoading
                          ? "…"
                          : wanted
                            ? wanted.episodes.length
                                ? `Looking for ${keysText(wanted.episodes)}`
                                : "Up to date"
                            : "Couldn't work out what's missing"}
                    {rule.destination && ` · Saves to ${rule.destination}`}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <Switch checked={rule.enabled} onChange={toggle} label={`Rule for ${name} enabled`} />
                <Dropdown>
                    <DropdownTrigger asChild>
                        <IconButton aria-label="More">
                            <MoreVertical className="size-4" />
                        </IconButton>
                    </DropdownTrigger>
                    <DropdownContent>{menu}</DropdownContent>
                </Dropdown>
            </div>
        </ContextArea>
            {testing && rule.id !== undefined && <TestDialog id={rule.id} name={name} onClose={() => setTesting(false)} />}
        </>
    )
}

function History({ items, titles }: { items: AutoItem[]; titles: Map<number, string> }) {
    const classic = useClassic()
    const qc = useQueryClient()
    const [all, setAll] = useState(false)
    const forget = async (it: AutoItem) => {
        try {
            await api.del(`/api/autodownloader/items/${encodeURIComponent(it.key)}`)
            qc.invalidateQueries({ queryKey: ["auto-items"] })
            qc.invalidateQueries({ queryKey: ["auto-rules"] })
            toast.success(`${it.pack ? `Season ${splitKey(it.episode)[0]}` : formatKey(it.episode)} can be grabbed again`)
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    const shown = all ? items : items.slice(0, 30)
    return (
        <section className="mt-8">
            <h2 className={cn("text-sm font-medium text-muted", classic ? "mb-3" : "mb-1")}>
                {/* This look: a small capital label (in a span: a heading has its own face). */}
                <span className={classic ? undefined : "label"}>Grabbed</span>
            </h2>
            <div className={classic ? "card divide-y divide-line" : "divide-y divide-line border-y border-line"}>
                {shown.map(it => (
                    <ContextArea
                        key={it.key}
                        menu={
                            <DropdownItem icon={<RotateCcw />} onSelect={() => forget(it)}>
                                Forget (grab it again)
                            </DropdownItem>
                        }
                        className={cn("flex items-center gap-4 py-2.5 text-sm", classic && "px-4")}
                    >
                        <div className="min-w-0 flex-1">
                            <p className="truncate">
                                <Link to={entryUrl({ id: it.mediaId })} className="font-medium hover:underline">
                                    {titles.get(it.mediaId) ?? mediaRef(it.mediaId)}
                                </Link>
                                <span className="text-muted"> · {it.pack ? `Season ${splitKey(it.episode)[0]} pack` : formatKey(it.episode)}</span>
                            </p>
                            <p className="mt-0.5 truncate text-xs text-subtle" title={it.title}>
                                {it.title}
                            </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted">{relativeTime(it.createdAt)}</span>
                        <IconButton label="Forget (grab it again)" onClick={() => forget(it)} className="size-8">
                            <RotateCcw className="size-4" />
                        </IconButton>
                    </ContextArea>
                ))}
            </div>
            {items.length > 30 && !all && (
                <button className="mt-3 text-sm text-muted underline hover:text-fg" onClick={() => setAll(true)}>
                    Show all {items.length}
                </button>
            )}
        </section>
    )
}

// A comma-separated list as typed; only the cleaned-up list goes to the rule.
function WordsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
    const [text, setText] = useState(value.join(", "))
    return (
        <Input
            value={text}
            placeholder={placeholder}
            onChange={e => {
                setText(e.target.value)
                onChange(
                    e.target.value
                        .split(",")
                        .map(x => x.trim())
                        .filter(Boolean),
                )
            }}
            onBlur={() => setText(value.join(", "))}
        />
    )
}

function RuleDialog({ rule, shows, canPickFolder, onClose }: { rule: AutoRule; shows: Media[]; canPickFolder: boolean; onClose: () => void }) {
    const [r, setR] = useState<AutoRule>(rule)
    const [pick, setPick] = useState(false)
    const [picked, setPicked] = useState<Media | null>(null)
    const [busy, setBusy] = useState(false)
    const qc = useQueryClient()
    const listed = useShow(r.mediaId, picked ? [...shows, picked] : shows)
    const media = picked?.id === r.mediaId ? picked : listed
    const options = useMemo(() => {
        const out = shows.map(m => ({ value: String(m.id), label: title(m) }))
        if (r.mediaId && !out.some(o => o.value === String(r.mediaId))) out.unshift({ value: String(r.mediaId), label: media ? title(media) : r.title || mediaRef(r.mediaId) })
        return [{ value: "0", label: shows.length ? "Choose a show…" : "No shows on your list yet" }, ...out]
    }, [shows, r.mediaId, r.title, media])
    const seasons = (media?.seasons ?? []).filter(s => s.seasonNumber > 0).sort((a, b) => a.seasonNumber - b.seasonNumber)
    const [startSeason, startEpisode] = r.startFrom ? splitKey(r.startFrom) : [0, 0]

    const save = async () => {
        if (!r.mediaId) return toast.error("Pick a show first")
        setBusy(true)
        try {
            await api.post("/api/autodownloader/rules", { ...r, title: media ? title(media) : r.title })
            qc.invalidateQueries({ queryKey: ["auto-rules"] })
            toast.success("Rule saved")
            onClose()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(false)
        }
    }
    return (
        <Dialog
            open
            onOpenChange={v => !v && onClose()}
            title={rule.id ? "Edit rule" : "New rule"}
            description="The show, and the releases to take."
            className="w-[min(94vw,640px)]"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" loading={busy} onClick={save}>
                        Save rule
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <Field label="Show" help="Shows you're watching or have on your watchlist.">
                    <div className="flex gap-2">
                        <Select className="flex-1" value={String(r.mediaId)} onChange={v => setR({ ...r, mediaId: Number(v), startFrom: 0 })} options={options} />
                        <Button icon={<Search className="size-4" />} onClick={() => setPick(true)}>
                            Other…
                        </Button>
                    </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Resolution">
                        <Select value={r.resolution} onChange={v => setR({ ...r, resolution: v })} options={RESOLUTIONS} />
                    </Field>
                    <Field label="Minimum seeders">
                        <Input type="number" min={1} value={r.minSeeders} onChange={e => setR({ ...r, minSeeders: Math.max(0, Number(e.target.value)) })} />
                    </Field>
                    <Field label="Size (MB)">
                        <div className="flex gap-2">
                            <Input type="number" min={0} placeholder="Min" aria-label="Minimum size (MB)" value={r.minSizeMb || ""} onChange={e => setR({ ...r, minSizeMb: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                            <Input type="number" min={0} placeholder="Max" aria-label="Maximum size (MB)" value={r.maxSizeMb || ""} onChange={e => setR({ ...r, maxSizeMb: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                        </div>
                    </Field>
                    <Field label="Wait before grabbing" help="Minutes, for a release from a preferred group.">
                        <Input type="number" min={0} placeholder="0" value={r.delayMinutes || ""} onChange={e => setR({ ...r, delayMinutes: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                    </Field>
                    <Field label="Preferred release groups" help="Preferred first, comma separated.">
                        <WordsInput value={r.releaseGroups} onChange={v => setR({ ...r, releaseGroups: v })} placeholder="NTb, FLUX" />
                    </Field>
                    <Field label="Must contain" help="Comma separated, e.g. WEB-DL.">
                        <WordsInput value={r.mustContain} onChange={v => setR({ ...r, mustContain: v })} />
                    </Field>
                    <Field label="Must not contain" help="Comma separated, e.g. HDTV, x265.">
                        <WordsInput value={r.mustNotContain} onChange={v => setR({ ...r, mustNotContain: v })} />
                    </Field>
                    <Field label="Start from" help="Earlier and watched episodes are skipped.">
                        <div className="flex gap-2">
                            <Select
                                className="flex-1"
                                value={String(startSeason)}
                                onChange={v => setR({ ...r, startFrom: Number(v) ? Number(v) * 1000 + 1 : 0 })}
                                options={[{ value: "0", label: "After what I've watched" }, ...seasons.map(s => ({ value: String(s.seasonNumber), label: `Season ${s.seasonNumber}` }))]}
                            />
                            {startSeason > 0 && (
                                <Select
                                    className="w-28"
                                    value={String(startEpisode)}
                                    onChange={v => setR({ ...r, startFrom: startSeason * 1000 + Number(v) })}
                                    options={Array.from({ length: Math.max(seasonEpisodeCount(media, startSeason), startEpisode, 1) }, (_, i) => ({ value: String(i + 1), label: `Episode ${i + 1}` }))}
                                />
                            )}
                        </div>
                    </Field>
                </div>
                <label className="flex items-center justify-between gap-6">
                    <span>
                        <span className="block text-[13px] font-medium text-fg/90">Season packs</span>
                        <span className="text-xs text-subtle">The whole season at once, when several episodes of a finished season are missing.</span>
                    </span>
                    <Switch checked={r.packs} onChange={v => setR({ ...r, packs: v })} />
                </label>
                {canPickFolder && (
                    <Field label="Save to" help="Empty: the show's folder in your library.">
                        <PathInput value={r.destination} onChange={v => setR({ ...r, destination: v })} placeholder="Library folder" />
                    </Field>
                )}
            </div>
            <MediaPicker
                open={pick}
                onOpenChange={setPick}
                type="TV"
                heading="Choose a show"
                onPick={m => {
                    setPicked(m)
                    setR(x => ({ ...x, mediaId: m.id, title: title(m), startFrom: 0 }))
                }}
            />
        </Dialog>
    )
}

// What a rule's run would do now (POST /api/autodownloader/rules/{id}/test):
// each release found, grabbed or why it's left.
type Candidate = { episode: number; pack?: boolean; name: string; group: string; resolution: string; seeders: number; size: number; grab: boolean; reason?: string }

function TestDialog({ id, name, onClose }: { id: number; name: string; onClose: () => void }) {
    const { data, error, isFetching, refetch } = useQuery({
        queryKey: ["auto-test", id],
        queryFn: () => api.post<Candidate[]>(`/api/autodownloader/rules/${id}/test`),
        gcTime: 0,
        retry: false,
    })
    const grabs = (data ?? []).filter(c => c.grab).length
    return (
        <Dialog
            open
            onOpenChange={v => !v && onClose()}
            title={`Test: ${name}`}
            description={data && (grabs ? `Would grab ${grabs}` : "Nothing to grab")}
            className="w-[min(94vw,620px)]"
            footer={
                <>
                    <Button variant="ghost" loading={isFetching} onClick={() => refetch()}>
                        Again
                    </Button>
                    <Button variant="primary" onClick={onClose}>
                        Close
                    </Button>
                </>
            }
        >
            {isFetching && !data ? (
                <div className="grid place-items-center py-10">
                    <Spinner />
                </div>
            ) : error ? (
                <p className="text-sm text-rose-300">{(error as Error).message}</p>
            ) : (data ?? []).length === 0 ? (
                <p className="text-sm text-muted">No results</p>
            ) : (
                <ul className="-mx-2 flex flex-col">
                    {data!.map((c, i) => (
                        <li key={i} tabIndex={0} className={cn("focus-ring flex items-start gap-3 rounded-lg px-2 py-2", !c.grab && "opacity-70")}>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm [overflow-wrap:anywhere]">{c.name}</p>
                                <p className="mt-0.5 text-xs text-muted">
                                    {[c.pack ? "Season pack" : c.episode > 0 && formatKey(c.episode), c.group, c.resolution, `${c.seeders} seeders`, c.size > 0 && formatBytes(c.size)].filter(Boolean).join(" · ")}
                                </p>
                            </div>
                            <Badge tone={c.grab ? "green" : "gray"} className="mt-0.5 shrink-0">
                                {c.grab ? "Grab" : c.reason}
                            </Badge>
                        </li>
                    ))}
                </ul>
            )}
        </Dialog>
    )
}
