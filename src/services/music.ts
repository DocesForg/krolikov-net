import type { MusicServices } from "../types/music";
import { AcoustIdRecognitionService } from "./acoustid";
import { GeminiMusicService } from "./gemini";
import { LrcLibLyricsService } from "./lrclib";

const recognition = new AcoustIdRecognitionService();
const lyrics = new LrcLibLyricsService();
const ai = new GeminiMusicService();

export const musicServices: MusicServices = {
  recognize: (file) => recognition.recognize(file),
  recognizeFromMicrophone: (file) => ai.recognizeAudio(file),
  searchLyrics: (query) => lyrics.searchLyrics(query),
  similarTracks: (track) => ai.findSimilarTracks(track),
  analyzeTrack: (track) => ai.analyzeTrack(track),
};
