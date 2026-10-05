import type { MusicServices } from "../types/music";
import { AuddRecognitionService } from "./audd";
import { GeminiMusicService } from "./gemini";
import { LrcLibLyricsService } from "./lrclib";
import { LastFmRecommendationService } from "./lastfm";

const recognition = new AuddRecognitionService();
const lyrics = new LrcLibLyricsService();
const recommendations = new LastFmRecommendationService();
const ai = new GeminiMusicService();

export const musicServices: MusicServices = {
  recognize: (file) => recognition.recognize(file),
  searchLyrics: (query) => lyrics.searchLyrics(query),
  similarTracks: (track) => recommendations.similarTracks(track),
  analyzeTrack: (track) => ai.analyzeTrack(track),
};
