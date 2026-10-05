import type { Track } from "../types/music";
import { env } from "../config/env";

interface LastFmSimilarResponse { similartracks?: { track?: Array<{ name: string; artist?: { name?: string } }> }; }

export class LastFmRecommendationService {
  async similarTracks(track: Track): Promise<Track[]> {
    if (!env.lastfmApiKey) throw new Error("VITE_LASTFM_API_KEY не настроен");
    const url = new URL(env.lastfmApiUrl);
    url.searchParams.set("method", "track.getsimilar");
    url.searchParams.set("artist", track.artist);
    url.searchParams.set("track", track.title);
    url.searchParams.set("api_key", env.lastfmApiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "12");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Last.fm HTTP ${response.status}`);
    const data = (await response.json()) as LastFmSimilarResponse;
    return (data.similartracks?.track || []).map((item) => ({ artist: item.artist?.name || "Unknown artist", title: item.name, source: "Last.fm" }));
  }
}