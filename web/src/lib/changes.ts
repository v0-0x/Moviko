// What's new in Moviko, newest first: shown once on each device after an
// update (components/WhatsNew). A new entry gets the next id.

export type Change = { title: string; text: string; to?: string }
export type Release = { id: number; title: string; changes: Change[] }

export const RELEASES: Release[] = [
    {
        id: 8,
        title: "Live TV",
        changes: [
            {
                title: "Channels from your own sources",
                text: "A playlist (M3U), an Xtream Codes login from your IPTV provider, or the free public channels of a country. Moviko comes with none: add them on the computer it runs on, watch on any device.",
                to: "/live",
            },
            {
                title: "What's on, favourites, and only what works",
                text: "The guide shows what's on now and next where a source has one. Channels are checked in the background and the dead ones left out; one that doesn't play is tried from your other lists. Up and Down change channel.",
                to: "/live",
            },
        ],
    },
    {
        id: 7,
        title: "Notifications, your year, and a sturdier Moviko",
        changes: [
            {
                title: "Notifications",
                text: "The bell on Home: episodes out for the shows you're watching and watchlist movies that came out, and what Moviko did (downloads, scans, the auto downloader, updates).",
                to: "/",
            },
            {
                title: "Year in review",
                text: "Your year in Moviko: hours, movies and episodes, month by month, the longest binge, the most watched and your highest rated. From Stats.",
                to: "/year",
            },
            {
                title: "Kept searches, and Because you watched…",
                text: "Save a search with the bookmark beside Filters; the last ones you made are under the box. Discover starts with recommendations from something on your list.",
                to: "/search",
            },
            {
                title: "Offline mode",
                text: "In the menu under your account, and Settings › Devices & network: nothing goes to the internet, Moviko uses what it has here. The other devices at home still work.",
            },
            {
                title: "A new device asks first",
                text: "When another Moviko offers its library, Home asks before this one uses it. The ones you already use stay as they are.",
                to: "/",
            },
            {
                title: "Providers",
                text: "Cinejoy works again at its new address, and the FreeFlix sites try again when a request is dropped. In the desktop app, the web players load without their ads and trackers.",
                to: "/extensions?tab=builtin",
            },
            {
                title: "Windows",
                text: "Moviko downloads the programs it uses (ffmpeg, yt-dlp, mpv) itself, into its own folder: no Scoop, no PowerShell.",
            },
            {
                title: "One look",
                text: "The Classic look is gone; a theme saved in it shows as its nearest here. Banners fade from one picture to the next and menus tick what's chosen.",
            },
        ],
    },
    {
        id: 6,
        title: "Moviko 3.0",
        changes: [
            {
                title: "A new look",
                text: "Fewer boxes, words you click, one ink on one ground: Black, White, Graphite, Paper, Phosphor, Amber, Ice and Rose (White and Paper are light). Right-click a movie, an episode or a row for its menu.",
                to: "/settings?tab=appearance",
            },
            {
                title: "Settings in ten pages",
                text: "Instead of eighteen, with shorter help. The search box still finds any setting by its name.",
                to: "/settings",
            },
            {
                title: "Playlists",
                text: "Queue movies and episodes (one, or the rest of a season; files and online ones) and play them in a row, from their menus and the Playlists page.",
                to: "/playlists",
            },
            {
                title: "Web players",
                text: "VidSrc, Vidfast, Vidlove, Aether, Vidrift, Vidnest, DeVideoSrc (German), Frembed (French) and KinoHub (Russian), the players of the Streambert app: each opens the site's own player in Moviko's window. Off until you turn them on in Providers & extensions › Built in.",
                to: "/extensions?tab=builtin",
            },
            {
                title: "In the player",
                text: "Image subtitles (PGS, VobSub) are drawn into the picture by the computer that has the file. In the menu: a subtitle file of your own, volume up to 300%, stats (i) and a screenshot (Shift+S).",
            },
            {
                title: "Torrents and downloads",
                text: "A TV streams a torrent through the computer its downloads go to. With several library folders, Settings › Library says which one downloads go to.",
                to: "/settings?tab=library",
            },
        ],
    },
    {
        id: 5,
        title: "KumoBox is now Moviko",
        changes: [
            {
                title: "A new name",
                text: "Moviko: movie, and ko, as in Aniko, its sibling, with the clapperboard it already had. Everything came along: your library, lists, diary, settings and logins, your other devices and the server. On Linux the app and its command are moviko now (kumobox still opens it).",
            },
        ],
    },
    {
        id: 4,
        title: "Stream torrents",
        changes: [
            {
                title: "Play a torrent as it downloads",
                text: "A torrent among a movie's or an episode's sources, or a result of its Torrents tab, now has Stream: it plays in a few seconds, the part being watched first, and seeking works. Movies and shows browsers can't play as they are (Matroska, HEVC...) are converted as they play, and mpv plays them too. What it downloads is only kept while it's played. Download still sends a torrent to your torrent client, into the library.",
            },
        ],
    },
    {
        id: 3,
        title: "Upload to your server",
        changes: [
            {
                title: "Send files and folders",
                text: "Movies, shows (whole folders of them) and their subtitles from this computer into a server's library: Local library › Upload, or Upload next to it in Settings › Other devices. An upload cut short carries on where it stopped. The server lets this device download there first (Let it download here, on it).",
                to: "/local",
            },
            {
                title: "mediaserver",
                text: "Moviko's home server, for a Raspberry Pi or any Linux computer that stays on, shares movies and shows with your Moviko apps (and anime with your Aniko apps): it shows up in Settings › Other devices.",
                to: "/settings?tab=devices",
            },
        ],
    },
    {
        id: 2,
        title: "Moviko 2.0",
        changes: [
            {
                title: "A new look",
                text: "Rounder panels, a sidebar in groups, a Back arrow, and a layout for phones with tabs along the bottom.",
                to: "/settings?tab=appearance",
            },
            {
                title: "Themes and holidays",
                text: "Pick the app's colors from the Themes button under the sidebar. Holiday themes come on by themselves (snow at Christmas, bats at Halloween), with a row of picks on Discover; turn them off in Settings › Appearance.",
                to: "/settings?tab=appearance",
            },
            {
                title: "Search in Settings",
                text: "Settings is regrouped, and the box at the top finds any setting by its name.",
                to: "/settings",
            },
            {
                title: "Alerts",
                text: "A notification when a new episode of a show you're watching comes out, and when a download is ready. Settings › Notifications.",
                to: "/settings?tab=notifications",
            },
            {
                title: "Beta updates",
                text: "Get each new version first, before everyone else: Settings › Updates & about › Beta updates. Off by default.",
                to: "/settings?tab=updates",
            },
            {
                title: "Backup and restore",
                text: "Your settings, watch history, list and diary, choices and extensions as one file, to keep or to move to another computer. Settings › Backup & data.",
                to: "/settings?tab=backup",
            },
            {
                title: "Clean up and missing episodes",
                text: "Library tools now shows how full the drive is, what you've watched and what's there twice, with a trash to put files back from; and the episodes missing from your shows, with their torrents a click away.",
                to: "/library?tab=cleanup",
            },
            {
                title: "Picture in picture",
                text: "In the desktop app, the player's new button (or p) keeps playing in a small window on top of the others.",
            },
            {
                title: "Subtitles your way",
                text: "Their size, background and position in Settings › Playback, and their timing while playing: z and x move them, kept for each movie or show.",
                to: "/settings?tab=playback",
            },
            {
                title: "Your other computers",
                text: "Moviko asks on Home whether to share with a new one, wakes a sleeping one to play its files, keeps this one awake while another plays from it, and syncs Continue watching when they meet again.",
                to: "/settings?tab=devices",
            },
            {
                title: "What should I watch?",
                text: "The dice on Home pick something from your list or your library.",
                to: "/",
            },
        ],
    },
    {
        id: 1,
        title: "More free streaming sites",
        changes: [
            {
                title: "Cinejoy, Vidlink, Hexa, Xpass, Mapple and Videasy",
                text: "Streaming sites from luffy and FreeFlix, built in and off by default: turn them on in Settings › Streaming providers.",
                to: "/settings?tab=providers",
            },
        ],
    },
]
