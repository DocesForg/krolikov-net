import type { Track } from "../types/music";

interface SpotifyResponse {
  tracks?: Track[];
  error?: string;
}

export class SpotifyRecommendationService {
  async similarTracksByArtists(artists: string[]): Promise<Track[]> {
    if (!artists.length) return [];

    const response = await fetch("/api/spotify/similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artists }),
    });

    const data = (await response.json()) as SpotifyResponse;
    if (!response.ok) throw new Error(data.error || `Spotify HTTP ${response.status}`);
    return data.tracks ?? [];
  }
}
