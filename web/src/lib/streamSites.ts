import type { StreamSite, StreamSiteSettings } from "./types"

// The streaming sites of the luffy and FreeFlix command-line apps, built in
// (server: providers/cinejoy and providers/freeflix), in the order they're
// asked. They find titles by their TMDB id.

export type StreamSiteKey = Exclude<keyof StreamSiteSettings, "decryptUrl">

export type StreamSiteInfo = {
    key: StreamSiteKey
    name: string
    // The app it comes from.
    app: "luffy" | "FreeFlix"
    help: string
    // Its own address (a mirror can replace it).
    url: string
    // Has enc-dec.app work out its keys.
    decrypts?: boolean
}

export const STREAM_SITES: StreamSiteInfo[] = [
    { key: "cinejoy", name: "Cinejoy", app: "luffy", help: "luffy's own source: HLS from several servers, each checked before it's listed.", url: "https://api.wing.st" },
    { key: "vidlink", name: "Vidlink", app: "FreeFlix", help: "HLS, or MP4 files in several qualities, with subtitles.", url: "https://vidlink.pro", decrypts: true },
    { key: "hexa", name: "Hexa", app: "FreeFlix", help: "HLS from several servers.", url: "https://themoviedb.hexa.su", decrypts: true },
    { key: "xpass", name: "Xpass", app: "FreeFlix", help: "HLS and MP4 from several playlists.", url: "https://play.xpass.top" },
    { key: "mapple", name: "Mapple", app: "FreeFlix", help: "HLS from up to eight sources.", url: "https://mapple.uk" },
    { key: "videasy", name: "Videasy", app: "FreeFlix", help: "Cineby's player: HLS and files from eight servers, with subtitles.", url: "https://api.videasy.net", decrypts: true },
]

export const DEFAULT_DECRYPT_URL = "https://enc-dec.app/api"

export const SITE_OFF: StreamSite = { enabled: false, url: "" }

// The web players of the Streambert app, built in (server:
// providers/webplayers), in the order they're asked. A stream of theirs is
// the site's player page, shown in the app's own window
// (components/WebPlayer.tsx); their provider ids are "web:" and the key.
export type WebPlayerInfo = {
    key: string
    name: string
    help: string
    // Its own address (a mirror can replace it).
    url: string
    // What it finds titles by, when not the TMDB id.
    by?: string
    movieOnly?: boolean
}

export const WEB_PLAYERS: WebPlayerInfo[] = [
    { key: "vidsrc", name: "VidSrc", help: "Several servers behind one player.", url: "https://vsembed.su" },
    { key: "vidfast", name: "Vidfast", help: "Asks for subtitles in your language.", url: "https://vidfast.vc" },
    { key: "vidlove", name: "Vidlove", help: "Several servers behind one player.", url: "https://player.vidlove.cc" },
    { key: "aether", name: "Aether", help: "Several audio languages.", url: "https://aether.ist" },
    { key: "vidrift", name: "Vidrift", help: "Several audio languages; asks for subtitles in your language.", url: "https://embed.vidrift.net" },
    { key: "vidnest", name: "Vidnest", help: "Movies and shows.", url: "https://vidnest.fun" },
    { key: "devideosrc", name: "DeVideoSrc", help: "German.", url: "https://devideosrc.co", by: "IMDb id" },
    { key: "frembed", name: "Frembed", help: "French.", url: "https://frembed.uno" },
    { key: "kinohub", name: "KinoHub", help: "Russian. Its Kinopoisk ids come from Wikidata.", url: "https://on.kinohub.vip", by: "Kinopoisk id", movieOnly: true },
]
