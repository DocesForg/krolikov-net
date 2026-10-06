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
  similarTracks: (track) => ai.findSimilarTracks(track),
  analyzeTrack: (track) => ai.analyzeTrack(track),
};
