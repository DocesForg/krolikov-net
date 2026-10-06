import type { MusicServices } from "../types/music";
import { AcoustIdRecognitionService } from "./acoustid";
import { GeminiMusicService } from "./gemini";
import { LrcLibLyricsService } from "./lrclib";

const recognition = new AcoustIdRecognitionService();
const lyrics = new LrcLibLyricsService();
const ai = new GeminiMusicService();

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
        track: string;
        artist: string;
        album?: string | null;
        artworkUrl?: string | null;
        source: string;
      }>;
    };

    if (!response.ok) {
      throw new Error(data.error || "Не удалось найти похожие треки");
    }

    return (data.results || []).map((item) => ({
      artist: item.artist,
      title: item.track,
      album: item.album ?? null,
      artworkUrl: item.artworkUrl ?? null,
      source: item.source || "Yandex Agent + LRCLIB",
    }));
  },
  analyzeTrack: (track) => ai.analyzeTrack(track),
};
