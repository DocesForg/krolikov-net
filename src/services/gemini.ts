import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env";
import type { AiTrackInsight, Track } from "../types/music";

const emptyInsight: AiTrackInsight = {
  summary: "",
  genres: [],
  mood: [],
  similarArtists: [],
  recommendations: [],
};

export class GeminiMusicService {
  private readonly client: GoogleGenAI;

  constructor() {
    if (!env.geminiApiKey) {
      throw new Error("VITE_GEMINI_API_KEY не настроен");
    }
    this.client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  }

  async analyzeTrack(track: Track): Promise<AiTrackInsight> {
    const response = await this.client.models.generateContent({
      model: env.geminiModel,
      contents: `Ты музыкальный AI-помощник сайта Krolikov.
Проанализируй трек и верни строго JSON без markdown и пояснений.

Исполнитель: ${track.artist}
Название: ${track.title}
Альбом: ${track.album ?? "неизвестен"}
Дата: ${track.releaseDate ?? "неизвестна"}

Формат JSON:
{
  "summary": "2-3 предложения о треке",
  "genres": ["жанр"],
  "mood": ["настроение"],
  "similarArtists": ["исполнитель"],
  "recommendations": ["короткая причина, почему стоит послушать"]
}

Не выдумывай факты, если не уверен. В каждом массиве максимум 5 элементов.`,
      config: { responseMimeType: "application/json", temperature: 0.4 },
    });

    const text = response.text?.trim();
    if (!text) return emptyInsight;

    try {
      const parsed = JSON.parse(text) as Partial<AiTrackInsight>;
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        genres: Array.isArray(parsed.genres) ? parsed.genres.slice(0, 5).map(String) : [],
        mood: Array.isArray(parsed.mood) ? parsed.mood.slice(0, 5).map(String) : [],
        similarArtists: Array.isArray(parsed.similarArtists) ? parsed.similarArtists.slice(0, 5).map(String) : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 5).map(String) : [],
      };
    } catch {
      throw new Error("Gemini вернул некорректный ответ.");
    }
  }
}
