import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env";
import type { AiTrackInsight, MusicRecognition, Track } from "../types/music";

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
    this.client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  }

  async recognizeAudio(file: File): Promise<MusicRecognition> {
    if (!env.geminiApiKey) {
      throw new Error("VITE_GEMINI_API_KEY не настроен");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    const response = await this.client.models.generateContent({
      model: env.geminiModel,
      contents: [{
        role: "user",
        parts: [
          {
            text: `Ты определяешь музыку по короткой аудиозаписи.
Если в записи слышна известная песня, определи максимально вероятные исполнителя и название.
Не угадывай уверенно, если музыка неразборчива или это не песня.

Верни строго JSON:
{
  "found": true,
  "artist": "исполнитель",
  "title": "название",
  "album": "альбом или пустая строка",
  "confidence": 0.0
}

confidence — число от 0 до 1. Если трек не удалось определить, верни found=false и пустые строки.`,
          },
          {
            inlineData: {
              mimeType: file.type || "audio/webm",
              data: btoa(binary),
            },
          },
        ],
      }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const text = response.text?.trim();
    if (!text) return { track: null };

    try {
      const parsed = JSON.parse(text) as {
        found?: boolean;
        artist?: string;
        title?: string;
        album?: string;
        confidence?: number;
      };

      if (!parsed.found || !parsed.artist || !parsed.title) {
        return { track: null };
      }

      const track: Track = {
        artist: parsed.artist,
        title: parsed.title,
        album: parsed.album || null,
        source: "Gemini Audio AI",
      };

      return { track };
    } catch {
      throw new Error("Gemini вернул некорректный ответ при распознавании аудио.");
    }
  }

  async analyzeTrack(track: Track): Promise<AiTrackInsight> {
    if (!env.geminiApiKey) {
      throw new Error("VITE_GEMINI_API_KEY не настроен");
    }

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
