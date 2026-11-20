// Live TV: the channels of the IPTV sources added on this Moviko (M3U
// playlists, Xtream Codes logins, iptv-org's free lists by country), what's
// on them, and which of them work (the server's internal/livetv).
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "./api"

export type LiveSource = {
    id: string
    kind: "m3u" | "xtream"
    name: string
    url: string
    epg?: string
    user?: string
    enabled: boolean
    local?: boolean
    channels: number
    fetchedAt: number
    error?: string
}

export type LiveSettings = { hideNotWorking: boolean; hideRegionLocked: boolean; autoCheck: boolean; country: string }
export type LiveCheck = { running: boolean; done: number; total: number; working: number }
export type LiveInfo = { sources: LiveSource[]; settings: LiveSettings; check: LiveCheck }

export type LiveChannel = {
    key: string
    source: string
    name: string
    logo?: string
    // "Animation;Kids" is in both groups.
    group?: string
    epgId?: string
    country?: string
    number: number
    regionLocked?: boolean
    favourite?: boolean
    // A web page (YouTube, Twitch): it opens in the browser.
    web?: string
    // Why the last check found it not working.
    down?: string
}

export type LiveList = { channels: LiveChannel[]; hiddenDown: number; hiddenLocked: number; recent: string[] }
export type Programme = { start: number; stop: number; title: string; desc?: string }
export type LiveNow = { now?: Programme; next?: Programme }

// What POST /api/livetv/play answers: the proxy's address of an HLS stream,
// the converter's of any stream, and the same channel in the other lists.
export type LivePlay = {
    action: "play" | "external"
    key: string
    name: string
    logo?: string
    group?: string
    source: string
    hls?: string
    convert?: string
    backups?: { key: string; name: string; source: string }[]
    url?: string
    service?: string
}

export function useLiveInfo() {
    return useQuery({ queryKey: ["livetv", "info"], queryFn: () => api.get<LiveInfo>("/api/livetv"), staleTime: 30_000 })
}

export function useLiveChannels(enabled = true) {
    return useQuery({ queryKey: ["livetv", "channels"], queryFn: () => api.get<LiveList>("/api/livetv/channels"), enabled, staleTime: 60_000 })
}

// What's on now and next, by channel key (asked again every minute).
export function useLiveGuide(enabled = true) {
    return useQuery({ queryKey: ["livetv", "guide"], queryFn: () => api.get<Record<string, LiveNow>>("/api/livetv/guide"), enabled, staleTime: 50_000, refetchInterval: 60_000 })
}

export function useLiveFavourite() {
    const qc = useQueryClient()
    return (key: string, on: boolean) => {
        // Shown at once; the server's answer follows.
        qc.setQueryData<LiveList>(["livetv", "channels"], old => (old ? { ...old, channels: old.channels.map(c => (c.key === key ? { ...c, favourite: on } : c)) } : old))
        api.post("/api/livetv/favourite", { key, on })
            .catch(() => {})
            .finally(() => qc.invalidateQueries({ queryKey: ["livetv", "channels"] }))
    }
}

export const groupsOf = (c: LiveChannel) =>
    (c.group ?? "")
        .split(";")
        .map(g => g.trim())
        .filter(Boolean)

// iptv-org's free channels of a country (github.com/iptv-org/iptv), instead
// of its whole list (10,000 channels and more).
export const iptvOrgCountry = (code: string) => `https://iptv-org.github.io/iptv/countries/${code.toLowerCase()}.m3u`

const CODES =
    "AF AL DZ AD AO AR AM AU AT AZ BH BD BY BE BJ BO BA BR BG BF KH CM CA CL CN CO CR HR CU CY CZ CD DK DO EC EG SV EE ET FI FR GE DE GH GR GT HN HK HU IS IN ID IR IQ IE IL IT CI JM JP JO KZ KE XK KW KG LA LV LB LY LT LU MO MK MY ML MT MX MD MN ME MA MZ MM NP NL NZ NI NG NO OM PK PS PA PY PE PH PL PT PR QA RO RU RW SA SN RS SG SK SI SO ZA KR ES LK SD SE CH SY TW TJ TZ TH TN TR TM UG UA AE UK US UY UZ VE VN YE ZW".split(
        " ",
    )

// The countries iptv-org has a list for, by name.
export function liveCountries(): { value: string; label: string }[] {
    let names: Intl.DisplayNames | null = null
    try {
        names = new Intl.DisplayNames(["en"], { type: "region" })
    } catch {
        // an old browser: the codes
    }
    return CODES.map(code => {
        // iptv-org says "uk"; the region's code is GB.
        let label = code
        try {
            label = names?.of(code === "UK" ? "GB" : code) ?? code
        } catch {
            // a code this browser doesn't know
        }
        return { value: code, label }
    }).sort((a, b) => a.label.localeCompare(b.label))
}
