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

function cleanCandidate(value) {
  return String(value || "")
    .replace(/^[-*•\d.)]+\s*/, "")
    .replace(/^`{1,3}|`{1,3}$/g, "")
    .replace(/^[\"'«]+|[\"'»]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTrackFromText(content) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map(cleanCandidate)
    .filter(Boolean);

  // Сначала ищем строку, которая действительно похожа на
  // «Исполнитель - Название», даже если Yandex добавил перед ней
  // пояснение вроде «Вот что удалось найти...».
  for (const line of lines) {
    const separatorIndex = line.indexOf(" - ");

    if (separatorIndex <= 0 || separatorIndex >= line.length - 3) {
      continue;
    }

    const artist = line.slice(0, separatorIndex).trim();
    const title = line.slice(separatorIndex + 3).trim();

    // Не принимаем очевидные служебные строки.
    const lower = line.toLowerCase();
    if (
      lower.startsWith("вот что удалось") ||
      lower.startsWith("результат") ||
      lower.startsWith("исполнитель") ||
      lower.startsWith("название")
    ) {
      continue;
    }

    if (artist && title) {
      return { artist, title, raw: line };
    }
  }

  return {
    artist: "",
    title: "",
    raw: lines.join("\n"),
  };
}

export async function identifyTrackFromLyrics(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new Error("Поисковый запрос пуст");
  if (trimmed.length > 4000) throw new Error("Текст слишком длинный");

  const result = await callYandex([{
    role: "ROLE_USER",
    content: `Ты находишь существующую песню по фрагменту текста.

Используй веб-поиск Yandex, чтобы определить конкретную песню.
Нужно установить:
1. исполнителя или группу;
2. точное название песни.

Не придумывай песню. Если уверенно определить её нельзя, не угадывай.

Постарайся указать найденные данные отдельной строкой строго в формате:
ИСПОЛНИТЕЛЬ - НАЗВАНИЕ ПЕСНИ

Не используй формат «Вот что удалось найти».
Не добавляй к строке с исполнителем и названием источники, ссылки или пояснения.

Текст песни:
${trimmed}`,
  }]);

  const content = typeof result?.message?.content === "string"
    ? result.message.content.trim()
    : "";

  const parsed = parseTrackFromText(content);

  if (!parsed.artist || !parsed.title) {
    return {
      artist: "",
      title: "",
      confidence: 0,
      raw: parsed.raw || content,
    };
  }

  return {
    artist: parsed.artist,
    title: parsed.title,
    confidence: 1,
    raw: parsed.raw,
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
