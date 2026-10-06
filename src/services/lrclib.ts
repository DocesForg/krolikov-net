import type { Lyrics } from "../types/music";

interface LrcLibItem {
  trackName: string;
  artistName: string;
  albumName?: string | null;
  album?: string | null;
  artworkUrl?: string | null;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export class LrcLibLyricsService {
  async searchLyrics(query: string): Promise<Lyrics[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const url = new URL("/api/lyrics/search", window.location.origin);
    url.searchParams.set("q", trimmed);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json() as LrcLibItem[] | { error?: string; results?: LrcLibItem[]; yandexAnswer?: string };

      if (!response.ok) {
        throw new Error(
          typeof data === "object" && data && "error" in data && data.error
            ? data.error
            : `LRCLIB HTTP ${response.status}`,
        );
      }

      const results = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : []);

      if (!Array.isArray(data) && data.yandexAnswer) {\n        throw new Error("Yandex ответил: " + data.yandexAnswer);\n      }\n\n      return results.map((item) => ({
        track: item.trackName,
        artist: item.artistName,
        album: item.albumName ?? item.album ?? null,
        artworkUrl: item.artworkUrl ?? null,
        plainLyrics: item.plainLyrics,
        syncedLyrics: item.syncedLyrics,
        source: "LRCLIB",
      }));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Поиск текста занял слишком много времени. LRCLIB сейчас отвечает медленно.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
