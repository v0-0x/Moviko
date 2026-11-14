// Exposes a tiny, safe bridge to the web UI.
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("movikoDesktop", {
    platform: process.platform,
    // Opens a web page (TMDB, Letterboxd, a provider's site…) in the system
    // browser.
    openExternal: url => ipcRenderer.send("moviko:open-external", url),
    // The desktop app's own settings (Settings › Desktop app & programs).
    getPrefs: () => ipcRenderer.invoke("moviko:get-prefs"),
    setPref: (name, value) => ipcRenderer.invoke("moviko:set-pref", name, value),
    // Quits Moviko, server and all.
    quit: () => ipcRenderer.send("moviko:quit"),
    // Picture in picture: the small player window (web/src/lib/pip.ts).
    openMiniPlayer: page => ipcRenderer.invoke("moviko:mini-open", page),
    closeMiniPlayer: () => ipcRenderer.send("moviko:mini-close"),
    expandMiniPlayer: req => ipcRenderer.send("moviko:mini-expand", req),
    // A web player (a streaming site's player page), shown over the page in
    // a view of its own, at bounds ({x, y, width, height} in the page's
    // pixels): web/src/components/WebPlayer.tsx. progress is how far its
    // video is ({position, duration, paused, ended}, or null).
    openWebPlayer: (url, bounds) => ipcRenderer.invoke("moviko:webplayer-open", url, bounds),
    moveWebPlayer: bounds => ipcRenderer.send("moviko:webplayer-bounds", bounds),
    closeWebPlayer: () => ipcRenderer.send("moviko:webplayer-close"),
    webPlayerProgress: () => ipcRenderer.invoke("moviko:webplayer-progress"),
    onWebPlayerEscape: fn => {
        const h = () => fn()
        ipcRenderer.on("moviko:webplayer-escape", h)
        return () => ipcRenderer.removeListener("moviko:webplayer-escape", h)
    },
    // An episode handed back by the small window, for this one to play.
    takePendingPlay: () => ipcRenderer.invoke("moviko:take-play"),
    onPlay: fn => ipcRenderer.on("moviko:play", (_e, req) => fn(req)),
})
