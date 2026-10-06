const RESPONSES_ENDPOINT = "https://ai.api.cloud.yandex.net/v1/responses";
const LEGACY_SEARCH_ENDPOINT = "https://searchapi.api.cloud.yandex.net/v2/gen/search";

function getApiKey() {
  const apiKey = (process.env.YANDEX_API_KEY || "").trim();
  if (!apiKey) throw new Error("YANDEX_API_KEY не настроен");
  return apiKey;
}

function getAgentId() {
  const agentId = (process.env.YANDEX_AGENT_ID || "").trim();
  if (!agentId) throw new Error("YANDEX_AGENT_ID не настроен");
  return agentId;
}

function getFolderId() {
  const folderId = (process.env.YANDEX_FOLDER_ID || "").trim();
  if (!folderId) throw new Error("YANDEX_FOLDER_ID не настроен");
  return folderId;
}

async function callAgent(input) {
  const response = await fetch(RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: {
        id: getAgentId(),
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
    }),,
    signal: AbortSignal.timeout(45000),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message || data?.message;
    throw new Error(message
      ? `Yandex Agent: ${message}`
      : `Yandex Agent HTTP ${response.status}`);
  }

  return data;
}

function parseAgentOutput(data) {
  const outputText = typeof data?.output_text === "string"
    ? data.output_text.trim()
    : "";

  let parsed = null;

  if (outputText) {
    try {
      parsed = JSON.parse(outputText);
    } catch {
      const jsonMatch = outputText.match(/\\{[\\s\\S]*\\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = null;
        }
      }
    }
  }

  if (!parsed && Array.isArray(data?.output)) {
    for (const item of data.output) {
      for (const content of Array.isArray(item?.content) ? item.content : []) {
        if (typeof content?.text !== "string") continue;
        try {
          parsed = JSON.parse(content.text);
          break;
        } catch {
          // Продолжаем искать JSON в других частях ответа.
        }
      }
      if (parsed) break;
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      artist: "",
      title: "",
      confidence: 0,
      raw: outputText,
    };
  }

  const artist = typeof parsed.artist === "string" ? parsed.artist.trim() : "";
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const confidence = Number(parsed.confidence);

  return {
    artist,
    title,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    found: Boolean(parsed.found),
    raw: outputText,
  };
}

export async function identifyTrackFromLyrics(query) {
  // ВАЖНО: передаём Yandex Agent исходный текст пользователя без изменений.
  // Не trim, не нормализуем пробелы, не меняем регистр, не удаляем строки
  // и не добавляем собственные инструкции в input. Инструкции находятся
  // в настройках самого Yandex Agent.
  const input = String(query ?? "");

  if (!input.trim()) throw new Error("Поисковый запрос пуст");
  if (input.length > 4000) throw new Error("Текст слишком длинный");

  const result = await callAgent(input);

  return parseAgentOutput(result);
}

// Оставлено для совместимости со старым диагностическим endpoint.
// Поиск песен через него больше не используется: /api/lyrics/search работает через Yandex Agent.
async function callLegacyYandex(messages) {
  const response = await fetch(LEGACY_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      folderId: getFolderId(),
      fixMisspell: true,
      enableNrfmDocs: false,
      enableRichStructuredAnswer: true,
      getPartialResults: false,
    }),
    signal: AbortSignal.timeout(30000),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || data?.error?.message;
    throw new Error(message
      ? `Yandex Search API: ${message}`
      : `Yandex Search API HTTP ${response.status}`);
  }

  return Array.isArray(data) ? data[0] : data;
}

export async function generativeSearch(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new Error("Поисковый запрос пуст");
  if (trimmed.length > 4000) throw new Error("Запрос слишком длинный");

  const result = await callLegacyYandex([{
    content: trimmed,
    role: "ROLE_USER",
  }]);

  const content = typeof result?.message?.content === "string"
    ? result.message.content.trim()
    : "";

  return {
    answer: content,
    sources: Array.isArray(result?.sources)
      ? result.sources
        .map((item) => ({
          title: typeof item?.title === "string" ? item.title.trim() : "",
          url: typeof item?.url === "string" ? item.url.trim() : "",
          used: Boolean(item?.used),
        }))
        .filter((item) => item.title && item.url)
        .slice(0, 10)
      : [],
    searchQueries: Array.isArray(result?.searchQueries)
      ? result.searchQueries
        .map((item) => typeof item?.text === "string" ? item.text.trim() : "")
        .filter(Boolean)
        .slice(0, 8)
      : [],
    fixedQuery: typeof result?.fixedMisspellQuery === "string"
      ? result.fixedMisspellQuery
      : null,
    rejected: Boolean(result?.isAnswerRejected),
  };
}
