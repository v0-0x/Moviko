// The Search page's kept searches: the ones saved, and the last ones made.
// On the server (GET/PUT /api/searches), so every device that uses it has
// them, and in this browser too: shown at once, and still there when the
// server can't be reached. Each is the page's address query, in one order
// ("genre=Drama&minScore=70&type=TV").

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "./api"
import { LANGUAGES, readLocal, writeLocal } from "./utils"

export type SavedSearch = { id: string; name: string; query: string }
export type RecentSearch = { query: string; at: number }
export type Searches = { saved: SavedSearch[]; recent: RecentSearch[] }

const LOCAL = "moviko-searches"
// Set once this browser's searches and the server's have been the same.
const SYNCED = "moviko-searches-synced"
const MAX_RECENT = 12
const EMPTY: Searches = { saved: [], recent: [] }

function local(): Searches {
    try {
        const v = JSON.parse(readLocal(LOCAL) ?? "null") as Partial<Searches> | null
        return { saved: Array.isArray(v?.saved) ? v.saved : [], recent: Array.isArray(v?.recent) ? v.recent : [] }
    } catch {
        return EMPTY
    }
}

// A search as it's kept: its parameters in one order, without the empty
// ones ("" when it searches nothing).
export function searchKey(params: URLSearchParams) {
    const all = [...params.entries()].filter(([, v]) => v !== "")
    all.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
    return new URLSearchParams(all).toString()
}

const TYPE: Record<string, string> = { MOVIE: "Movies", TV: "Shows" }
const STATUS: Record<string, string> = { RELEASING: "Out now", FINISHED: "Released", NOT_YET_RELEASED: "Upcoming" }
const SORT: Record<string, string> = { POPULARITY_DESC: "Popular", SCORE_DESC: "Top rated", TRENDING_DESC: "Trending", START_DATE_DESC: "Newest", START_DATE: "Oldest", TITLE: "By title" }

// What a search is called: the title looked for, then what it's narrowed to.
export function searchLabel(query: string) {
    const p = new URLSearchParams(query)
    const parts: string[] = []
    const q = p.get("q")
    if (q) parts.push(q)
    const type = TYPE[p.get("type") ?? ""]
    if (type) parts.push(type)
    for (const v of p.getAll("genre")) parts.push(v)
    if (p.get("year")) parts.push(p.get("year")!)
    const status = STATUS[p.get("status") ?? ""]
    if (status) parts.push(status)
    if (p.get("minScore")) parts.push(`${Number(p.get("minScore")) / 10}+`)
    const lang = p.get("lang")
    if (lang) parts.push(LANGUAGES.find(l => l.value === lang)?.label ?? lang)
    const sort = SORT[p.get("sort") ?? ""]
    if (sort) parts.push(sort)
    return parts.join(" · ") || "Everything"
}

// The same search but for what's typed: one is the other being typed.
function typedFurther(older: string, newer: string) {
    const a = new URLSearchParams(older)
    const b = new URLSearchParams(newer)
    const qa = (a.get("q") ?? "").toLowerCase()
    const qb = (b.get("q") ?? "").toLowerCase()
    a.delete("q")
    b.delete("q")
    return qa !== "" && qb.startsWith(qa) && searchKey(a) === searchKey(b)
}

export function useSearches() {
    const qc = useQueryClient()
    const { data } = useQuery({
        queryKey: ["searches"],
        queryFn: async () => {
            const kept = local()
            let got: Searches
            try {
                got = await api.get<Searches>("/api/searches")
            } catch {
                // The server can't be reached (or is one from before this): this browser's.
                return kept
            }
            // Made here before the server kept any: it gets them, the first
            // time only. After that, none on the server means they were
            // cleared (on another device) and they go from here too.
            if (!readLocal(SYNCED) && got.saved.length + got.recent.length === 0 && kept.saved.length + kept.recent.length > 0) {
                api.put("/api/searches", kept).then(() => writeLocal(SYNCED, "1"), () => {})
                return kept
            }
            writeLocal(SYNCED, "1")
            writeLocal(LOCAL, JSON.stringify(got))
            return got
        },
        initialData: local,
        initialDataUpdatedAt: 0,
        staleTime: 60_000,
    })
    const all = data ?? EMPTY
    // The whole of them as they are now, here and on the server.
    const keep = (change: (s: Searches) => Searches) => {
        const next = change(qc.getQueryData<Searches>(["searches"]) ?? local())
        qc.setQueryData(["searches"], next)
        writeLocal(LOCAL, JSON.stringify(next))
        api.put("/api/searches", next).catch(() => {})
    }
    return {
        saved: all.saved,
        recent: all.recent,
        // The last one made goes first; the same one, or the one it was typed from, isn't kept twice.
        addRecent: (query: string) =>
            keep(s => ({ ...s, recent: [{ query, at: Math.floor(Date.now() / 1000) }, ...s.recent.filter(r => r.query !== query && !typedFurther(r.query, query))].slice(0, MAX_RECENT) })),
        removeRecent: (query: string) => keep(s => ({ ...s, recent: s.recent.filter(r => r.query !== query) })),
        clearRecent: () => keep(s => ({ ...s, recent: [] })),
        save: (query: string) =>
            keep(s => (s.saved.some(v => v.query === query) ? s : { ...s, saved: [...s.saved, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: searchLabel(query), query }] })),
        unsave: (query: string) => keep(s => ({ ...s, saved: s.saved.filter(v => v.query !== query) })),
    }
}
