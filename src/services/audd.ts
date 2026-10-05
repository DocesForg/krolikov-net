import type { MusicRecognition, Track } from "../types/music";
import { env } from "../config/env";

interface AuddResponse {
  status: string;
  result: null | {
    artist: string; title: string; album?: string; release_date?: string; timecode?: string; song_link?: string;
    apple_music?: { artwork?: { url?: string }; url?: string };
    spotify?: { external_urls?: { spotify?: string }; album?: { images?: { url?: string }[] } };
  };
  error?: { error_code?: number; error_message?: string };
}

export class AuddRecognitionService {
  async recognize(file: File): Promise<MusicRecognition> {
    if (!env.auddApiToken) throw new Error("VITE_AUDD_API_TOKEN не настроен");
    const body = new FormData();
    body.append("api_token", env.auddApiToken);
    body.append("file", file);
    body.append("return", "apple_music,spotify");
    const response = await fetch(env.auddApiUrl, { method: "POST", body });
    if (!response.ok) throw new Error(`AudD HTTP ${response.status}`);
    const data = (await response.json()) as AuddResponse;
    if (data.status !== "success") throw new Error(data.error?.error_message || "AudD не смог распознать аудио");
    if (!data.result) return { track: null };
    const artwork = data.result.apple_music?.artwork?.url || data.result.spotify?.album?.images?.[0]?.url || null;
    const track: Track = {
      artist: data.result.artist, title: data.result.title, album: data.result.album || null,
      releaseDate: data.result.release_date || null, artworkUrl: artwork,
      songUrl: data.result.song_link || data.result.spotify?.external_urls?.spotify || null,
      timecode: data.result.timecode || null, source: "AudD",
    };
    return { track };
  }
}