const ENDPOINT = "https://searchapi.api.cloud.yandex.net/v2/gen/search";

function getConfig() {
  const apiKey = (process.env.YANDEX_API_KEY || "").trim();
  const folderId = (process.env.YANDEX_FOLDER_ID || "").trim();

  if (!apiKey) throw new Error("YANDEX_API_KEY не настроен");
  if (!folderId) throw new Error("YANDEX_FOLDER_ID не настроен");

  return { apiKey, folderId };
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      title: typeof item?.title === "string" ? item.title.trim() : "",
      url: typeof item?.url === "string" ? item.url.trim() : "",
      used: Boolean(item?.used),
    }))
    .filter((item) => item.title && item.url)
    .slice(0, 10);
}

async function callYandex(messages) {
  const { apiKey, folderId } = getConfig();

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      folderId,
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

export async function identifyTrackFromLyrics(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new Error("Поисковый запрос пуст");
  if (trimmed.length > 4000) throw new Error("Текст слишком длинный");

  const result = await callYandex([{
    role: "ROLE_USER",
    content: `Ты определяешь существующую песню по фрагменту текста.

Найди песню, которой принадлежат эти строки. Используй веб-поиск Yandex, если это необходимо.
Нужны именно исполнитель и точное название песни. Не придумывай данные.

Верни ТОЛЬКО JSON без markdown:
{"artist":"исполнитель","title":"точное название песни","confidence":0.0}

Если определить нельзя:
{"artist":"","title":"","confidence":0.0}

Текст песни:
${trimmed}`,
  }]);

  const content = typeof result?.message?.content === "string"
    ? result.message.content.trim()
    : "";

  let parsed = null;
  try {
    parsed = JSON.parse(content.replace(/^\`\`\`json\s*/i, "").replace(/\s*\`\`\`$/i, ""));
  } catch {
    const match = content.match(/\{[\s\S]*"artist"[\s\S]*"title"[\s\S]*\}/i);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
    }
  }

  return {
    artist: typeof parsed?.artist === "string" ? parsed.artist.trim() : "",
    title: typeof parsed?.title === "string" ? parsed.title.trim() : "",
    confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0,
  };
}

export async function generativeSearch(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new Error("Поисковый запрос пуст");
  if (trimmed.length > 4000) throw new Error("Запрос слишком длинный");

  const result = await callYandex([{
    content: trimmed,
    role: "ROLE_USER",
  }]);
  const content = typeof result?.message?.content === "string"
    ? result.message.content.trim()
    : "";

  return {
    answer: content,
    sources: normalizeSources(result?.sources),
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
