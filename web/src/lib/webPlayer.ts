import { createStore } from "./store"

// A web player (Watch online's VidSrc, Vidfast…: a streaming site's page
// that is nothing but its player) open over the app: components/WebPlayer.
// episode is the episode's key (1 for a movie).
export type WebPlayerRequest = {
    mediaId: number
    episode: number
    url: string
    provider: string
    providerName: string
}

export const webPlayerStore = createStore<WebPlayerRequest | null>(null)
