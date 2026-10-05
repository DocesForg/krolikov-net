import type { Lyrics } from "../types/music";
import { env } from "../config/env";

interface LrcLibItem { trackName: string; artistName: string; plainLyrics?: string | null; syncedLyrics?: string | null; }

export class LrcLibLyricsService {
  async searchLyrics(query: string): Promise<Lyrics[]> {
    const url = new URL("search", env.lrclibApiUrl);
    url.searchParams.set("q", query.trim());
    const response = await fetch(url);
    if (!response.ok) throw new Error(`LRCLIB HTTP ${response.status}`);
    const data = (await response.json()) as LrcLibItem[];
    return data.map((item) => ({ track: item.trackName, artist: item.artistName, plainLyrics: item.plainLyrics, syncedLyrics: item.syncedLyrics, source: "LRCLIB" }));
  }
}