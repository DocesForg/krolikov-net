import type { MusicServices, Track } from "../types/music";
import { AcoustIdRecognitionService } from "./acoustid";
import { GeminiMusicService } from "./gemini";
import { LrcLibLyricsService } from "./lrclib";
import { SpotifyRecommendationService } from "./spotify";

const recognition = new AcoustIdRecognitionService();
const lyrics = new LrcLibLyricsService();
const spotify = new SpotifyRecommendationService();
const ai = new GeminiMusicService();

export const musicServices: MusicServices = {
  recognize: (file) => recognition.recognize(file),
  recognizeFromMicrophone: (file) => ai.recognizeAudio(file),
  searchLyrics: (query) => lyrics.searchLyrics(query),
  similarTracks: async (track: Track) => {
    const insight = await ai.analyzeTrack(track);
    return spotify.similarTracksByArtists(insight.similarArtists);
  },
  analyzeTrack: (track) => ai.analyzeTrack(track),
};
