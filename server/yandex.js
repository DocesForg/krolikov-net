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
    content: `Ты находишь существующую песню по фрагменту текста.

Используй веб-поиск Yandex, чтобы точно определить песню.
Тебе нужны только:
1. название группы или исполнителя;
2. точное официальное название песни.

КРИТИЧЕСКИ ВАЖНО:
- Верни РОВНО ОДНУ строку.
- Формат ответа строго: ИСПОЛНИТЕЛЬ - НАЗВАНИЕ ПЕСНИ
- Между исполнителем и названием песни должен быть ровно разделитель " - ".
- Не добавляй кавычки.
- Не добавляй JSON.
- Не добавляй markdown.
- Не добавляй пояснения.
- Не добавляй источники, ссылки, confidence или другие данные.
- Не пиши слова "Исполнитель:", "Название:" и подобные подписи.
- Если не можешь достоверно определить песню, верни пустую строку.

Пример правильного ответа:
The Weeknd - Blinding Lights

Текст песни:
${trimmed}`,
  }]);

  const content = typeof result?.message?.content === "string"
    ? result.message.content.trim()
    : "";

  if (!content) {
    return { artist: "", title: "", confidence: 0 };
  }

  // Yandex иногда оборачивает короткий ответ в markdown/кавычки.
  // Убираем только техническое оформление, не меняя сами данные.
  const cleaned = content
    .replace(/^\`\`\`(?:text|txt)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .replace(/^["'«]+|["'»]+$/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)[0] || "";

  // Ожидаем единственный разделитель " - ".
  const separatorIndex = cleaned.indexOf(" - ");
  if (separatorIndex <= 0 || separatorIndex >= cleaned.length - 3) {
    return { artist: "", title: "", confidence: 0 };
  }

  const artist = cleaned.slice(0, separatorIndex).trim();
  const title = cleaned.slice(separatorIndex + 3).trim();

  if (!artist || !title) {
    return { artist: "", title: "", confidence: 0 };
  }

  return {
    artist,
    title,
    confidence: 1,
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
