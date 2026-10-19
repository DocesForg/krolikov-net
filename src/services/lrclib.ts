import type { LyricsSearchResult } from "../types/music";

interface LrcLibItem {
  trackName: string;
  artistName: string;
  albumName?: string | null;
  album?: string | null;
  artworkUrl?: string | null;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface LrcLibDebugResponse {
  error?: string;
  results?: LrcLibItem[];
  yandexAnswer?: string;
}

function mapLyrics(item: LrcLibItem) {
  return {
    track: item.trackName,
    artist: item.artistName,
    album: item.albumName ?? item.album ?? null,
    artworkUrl: item.artworkUrl ?? null,
    plainLyrics: item.plainLyrics,
    syncedLyrics: item.syncedLyrics,
    source: "LRCLIB",
  } as const;
}

export class LrcLibLyricsService {
  async searchLyrics(query: string): Promise<LyricsSearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return { yandex: null, results: [] };

    const url = new URL("/api/lyrics/search", window.location.origin);
    url.searchParams.set("q", trimmed);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json() as
        | LrcLibItem[]
        | (LrcLibDebugResponse & { yandex?: LyricsSearchResult["yandex"] });

      if (!response.ok) {
        throw new Error(
          typeof data === "object" && data && "error" in data && data.error
            ? data.error
            : `LRCLIB HTTP ${response.status}`,
        );
      }

      const results = Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : [];
      return {
        yandex: !Array.isArray(data) ? data.yandex ?? null : null,
        results: results.map(mapLyrics),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Поиск текста занял слишком много времени. LRCLIB сейчас отвечает медленно.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async loadArtwork(items: import("../types/music").Lyrics[]) {
    if (!items.length) return items;
    try {
      const response = await fetch("/api/lyrics/artwork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map((item) => ({
          artist: item.artist, track: item.track, album: item.album, artworkUrl: item.artworkUrl,
        })) }),
      });
      if (!response.ok) return items;
      const data = await response.json() as { results?: { index: number; artworkUrl?: string | null }[] };
      const artwork = new Map((data.results || []).map((item) => [item.index, item.artworkUrl || null]));
      return items.map((item, index) => ({
        ...item,
        artworkUrl: item.artworkUrl || artwork.get(index) || null,
      }));
    } catch {
      return items;
    }
  }

  async searchSimilarLyrics(artist: string, title: string) {
    const response = await fetch("/api/lyrics/similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist, title }),
    });

    const data = await response.json() as {
      error?: string;
      recommendations?: { artist: string; title: string }[];
      results?: LrcLibItem[];
    };

    if (!response.ok) {
      throw new Error(data.error || `LRCLIB HTTP ${response.status}`);
    }

    return {
      recommendations: data.recommendations || [],
      results: (data.results || []).map(mapLyrics),
    };
  }
  async searchByGenre(genre: string) {
    const response = await fetch("/api/lyrics/genre", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genre }),
    });

    const data = await response.json() as {
      error?: string;
      genre?: string;
      recommendations?: { artist: string; title: string }[];
      results?: LrcLibItem[];
    };

    if (!response.ok) {
      throw new Error(data.error || `LRCLIB HTTP ${response.status}`);
    }

    return {
      genre: data.genre || genre,
      recommendations: data.recommendations || [],
      results: (data.results || []).map(mapLyrics),
    };
  }


}
