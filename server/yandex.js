import OpenAI from "openai";

const YANDEX_BASE_URL = "https://ai.api.cloud.yandex.net/v1";
const YANDEX_PROJECT_ID = "b1gfj3v8keh3qobuh6rv";
const YANDEX_AGENT_ID = "fvtm93a73klntd04lf7p";

function getApiKey() {
  const apiKey = (process.env.YANDEX_API_KEY || "").trim();
  if (!apiKey) throw new Error("YANDEX_API_KEY не настроен");
  return apiKey;
}

function getClient() {
  return new OpenAI({
    apiKey: getApiKey(),
    baseURL: YANDEX_BASE_URL,
    defaultHeaders: {
      "OpenAI-Project": YANDEX_PROJECT_ID,
    },
  });
}

function parseAgentOutput(outputText) {
  const text = typeof outputText === "string" ? outputText.trim() : "";
  if (!text) {
    return {
      found: false,
      artist: "",
      title: "",
      confidence: 0,
      raw: "",
    };
  }

  let parsed = null;

  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      found: false,
      artist: "",
      title: "",
      confidence: 0,
      raw: text,
    };
  }

  const artist = typeof parsed.artist === "string" ? parsed.artist.trim() : "";
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const confidence = Number(parsed.confidence);

  return {
    found: Boolean(parsed.found),
    artist,
    title,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
    raw: text,
  };
}

export async function identifyTrackFromLyrics(query) {
  // Передаём Yandex Agent исходный текст пользователя без изменений.
  // Инструкции находятся в настройках самого Agent.
  const input = String(query ?? "");

  if (!input.trim()) throw new Error("Поисковый запрос пуст");
  if (input.length > 4000) throw new Error("Текст слишком длинный");

  const response = await getClient().responses.create({
    prompt: {
      id: YANDEX_AGENT_ID,
    },
    input,
    tools: [
      {
        type: "web_search",
        filters: {
          allowed_domains: [],
        },
        search_context_size: "low",
      },
    ],
  });

  return parseAgentOutput(response.output_text);
}

// Совместимость с /api/yandex/generative.
// Старый Legacy Search API удалён: теперь запрос также идёт через Yandex Agent.
export async function generativeSearch(query) {
  const input = String(query ?? "").trim();

  if (!input) throw new Error("Поисковый запрос пуст");
  if (input.length > 4000) throw new Error("Запрос слишком длинный");

  const response = await getClient().responses.create({
    prompt: {
      id: YANDEX_AGENT_ID,
    },
    input,
    tools: [
      {
        type: "web_search",
        filters: {
          allowed_domains: [],
        },
        search_context_size: "low",
      },
    ],
  });

  return {
    answer: typeof response.output_text === "string"
      ? response.output_text.trim()
      : "",
    sources: [],
    searchQueries: [],
    fixedQuery: null,
    rejected: false,
  };
}
