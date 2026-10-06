import type { MusicServices } from "../types/music";
import { AcoustIdRecognitionService } from "./acoustid";
import { GeminiMusicService } from "./gemini";
import { LrcLibLyricsService } from "./lrclib";
import type { YandexGenerativeResult } from "../types/music";

const recognition = new AcoustIdRecognitionService();
const lyrics = new LrcLibLyricsService();
const ai = new GeminiMusicService();

export async function yandexGenerativeSearch(query: string): Promise<YandexGenerativeResult> {
  const response = await fetch("/api/yandex/generative", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await response.json() as Partial<YandexGenerativeResult> & { error?: string };
  if (!response.ok) throw new Error(data.error || `Yandex Search API HTTP ${response.status}`);

  return {
    answer: typeof data.answer === "string" ? data.answer : "",
    sources: Array.isArray(data.sources) ? data.sources.map((item) => ({
      title: String(item?.title || ""),
      url: String(item?.url || ""),
      used: Boolean(item?.used),
    })).filter((item) => item.title && item.url) : [],
    searchQueries: Array.isArray(data.searchQueries) ? data.searchQueries.map(String) : [],
    fixedQuery: typeof data.fixedQuery === "string" ? data.fixedQuery : null,
    rejected: Boolean(data.rejected),
  };
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
  similarTracks: (track) => ai.findSimilarTracks(track),
  analyzeTrack: (track) => ai.analyzeTrack(track),
};
