import type { AiTrackInsight, MusicRecognition, Track } from "../types/music";

export class GeminiMusicService {
  async recognizeAudio(file: File): Promise<MusicRecognition> {
    const body = new FormData();
    body.append("file", file);

    const response = await fetch("/api/gemini/recognize", {
      method: "POST",
      body,
    });

    const data = await response.json() as { track?: Track | null; error?: string };
    if (!response.ok) throw new Error(data.error || `Gemini HTTP ${response.status}`);
    return { track: data.track ?? null };
  }

  async analyzeTrack(track: Track): Promise<AiTrackInsight> {
    const response = await fetch("/api/gemini/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track }),
    });

    const data = await response.json() as Partial<AiTrackInsight> & { error?: string };
    if (!response.ok) throw new Error(data.error || `Gemini HTTP ${response.status}`);

    return {
      summary: typeof data.summary === "string" ? data.summary : "",
      genres: Array.isArray(data.genres) ? data.genres.slice(0, 5).map(String) : [],
      mood: Array.isArray(data.mood) ? data.mood.slice(0, 5).map(String) : [],
      similarArtists: Array.isArray(data.similarArtists) ? data.similarArtists.slice(0, 5).map(String) : [],
      recommendations: Array.isArray(data.recommendations) ? data.recommendations.slice(0, 5).map(String) : [],
    };
  }
}
