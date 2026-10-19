import type { MusicServices } from "../types/music";
import { AcoustIdRecognitionService } from "./acoustid";
import { GeminiMusicService } from "./gemini";
import { LrcLibLyricsService } from "./lrclib";

const recognition = new AcoustIdRecognitionService();
const lyrics = new LrcLibLyricsService();
const ai = new GeminiMusicService();

async function findPreviews(items: Array<{ artist: string; title: string }>) {
  if (!items.length) return [];
  try {
    const response = await fetch("/api/music/previews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.slice(0, 8) }),
    });
    const data = await response.json() as {
      error?: string;
      results?: Array<{ artist: string; title: string; previewUrl: string | null; trackUrl: string | null }>;
    };
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить предпрослушивания");
    return data.results || [];
  } catch (error) {
    console.warn("Предпрослушивания временно недоступны:", error);
    return items.slice(0, 8).map((item) => ({ ...item, previewUrl: null, trackUrl: null }));
  }
}

export const musicServices: MusicServices = {
  recognize: async (file) => {
    try {
      const result = await recognition.recognize(file);
      if (result.track) return result;
      return ai.recognizeAudio(file);
    } catch {
      return ai.recognizeAudio(file);
    }
  },
  recognizeFromMicrophone: (file) => ai.recognizeAudio(file),
  searchLyrics: (query) => lyrics.searchLyrics(query),
  loadArtwork: (items) => lyrics.loadArtwork(items),
  searchSimilarLyrics: (artist, title) => lyrics.searchSimilarLyrics(artist, title),
  searchByGenre: (genre) => lyrics.searchByGenre(genre),
  similarTracks: async (track) => {
    const response = await fetch("/api/lyrics/similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist: track.artist, title: track.title }),
    });

    const data = await response.json() as {
      error?: string;
      results?: Array<{
        track?: string;
        artist?: string;
        trackName?: string;
        artistName?: string;
        album?: string | null;
        albumName?: string | null;
        artworkUrl?: string | null;
        source?: string;
      }>;
    };

    if (!response.ok) {
      throw new Error(data.error || "Не удалось найти похожие треки");
    }

    // The similar endpoint returns raw LRCLIB fields (artistName/trackName),
    // while some service responses already use artist/track. Normalize both
    // shapes before rendering so undefined names cannot crash previewKey().
    return (data.results || [])
      .map((item) => ({
        artist: String(item.artist ?? item.artistName ?? "").trim(),
        title: String(item.track ?? item.trackName ?? "").trim(),
        album: item.album ?? item.albumName ?? null,
        artworkUrl: item.artworkUrl ?? null,
        source: item.source || "Yandex Agent + LRCLIB",
      }))
      .filter((item) => item.artist.length > 0 && item.title.length > 0);
  },
  findPreviews,
  analyzeTrack: (track) => ai.analyzeTrack(track),
};
