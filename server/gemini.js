import { GoogleGenAI } from "@google/genai";

function getConfig() {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) throw new Error("GEMINI_API_KEY не настроен");
  return { apiKey, model: process.env.GEMINI_MODEL || "gemini-3.6-flash" };
}

function getClient() {
  return new GoogleGenAI({ apiKey: getConfig().apiKey });
}

export async function recognizeAudio(file) {
  const client = getClient();
  const buffer = file.buffer;
  const base64 = buffer.toString("base64");

  const response = await client.models.generateContent({
    model: getConfig().model,
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
            mimeType: file.mimetype || "audio/webm",
            data: base64,
          },
        },
      ],
    }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  return JSON.parse(response.text?.trim() || '{"found":false}');
}

export async function analyzeTrack(track) {
  const client = getClient();

  const response = await client.models.generateContent({
    model: getConfig().model,
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
  "recommendations": ["короткая причина, почему стоит послушать"],
  "similarTracks": [
    {"artist": "исполнитель", "title": "название", "reason": "почему похож"}
  ]
}

Не выдумывай факты, если не уверен. В каждом массиве максимум 5 элементов.`,
    config: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });

  const parsed = JSON.parse(response.text?.trim() || "{}");
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    genres: Array.isArray(parsed.genres) ? parsed.genres.slice(0, 5).map(String) : [],
    mood: Array.isArray(parsed.mood) ? parsed.mood.slice(0, 5).map(String) : [],
    similarArtists: Array.isArray(parsed.similarArtists) ? parsed.similarArtists.slice(0, 5).map(String) : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 5).map(String) : [],
    similarTracks: Array.isArray(parsed.similarTracks) ? parsed.similarTracks.slice(0, 8).map((item) => ({
      artist: String(item?.artist || ""),
      title: String(item?.title || ""),
      reason: String(item?.reason || ""),
    })).filter((item) => item.artist && item.title) : [],
  };
}
export async function identifyLyrics(query) {
  const client = getClient();

  const response = await client.models.generateContent({
    model: getConfig().model,
    contents: `Определи песню по фрагменту текста ниже.

Верни строго JSON:
{
  "artist": "исполнитель",
  "title": "название",
  "confidence": 0.0
}

Правила:
- Определи именно существующую песню, если узнаёшь её.
- Не придумывай исполнителя или название.
- confidence — число от 0 до 1.
- Если определить не удалось, верни пустые artist/title и confidence 0.

Фрагмент:
${query}`,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const parsed = JSON.parse(response.text?.trim() || "{}");
  return {
    artist: typeof parsed.artist === "string" ? parsed.artist.trim() : "",
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
  };
}
