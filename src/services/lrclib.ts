import type { Lyrics } from "../types/music";

interface LrcLibItem {
  trackName: string;
  artistName: string;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export class LrcLibLyricsService {
  async searchLyrics(query: string): Promise<Lyrics[]> {
    const url = new URL("/api/lyrics/search", window.location.origin);
    url.searchParams.set("q", query.trim());

    const response = await fetch(url);
    const data = await response.json() as LrcLibItem[] | { error?: string };

    if (!response.ok) {
      throw new Error(
        typeof data === "object" && data && "error" in data && data.error
          ? data.error
          : `LRCLIB HTTP ${response.status}`,
      );
    }

    return (data as LrcLibItem[]).map((item) => ({
      track: item.trackName,
      artist: item.artistName,
      plainLyrics: item.plainLyrics,
      syncedLyrics: item.syncedLyrics,
      source: "LRCLIB",
    }));
  }
}
