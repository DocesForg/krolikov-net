import type { MusicServices } from "../types/music";
import { AuddRecognitionService } from "./audd";
import { LrcLibLyricsService } from "./lrclib";
import { LastFmRecommendationService } from "./lastfm";

export const musicServices: MusicServices = {
  recognize: (file) => new AuddRecognitionService().recognize(file),
  searchLyrics: (query) => new LrcLibLyricsService().searchLyrics(query),
  similarTracks: (track) => new LastFmRecommendationService().similarTracks(track),
};