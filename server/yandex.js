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

export async function generativeSearch(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new Error("Поисковый запрос пуст");
  if (trimmed.length > 4000) throw new Error("Запрос слишком длинный");

  const { apiKey, folderId } = getConfig();

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{
        content: trimmed,
        role: "ROLE_USER",
      }],
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

  const result = Array.isArray(data) ? data[0] : data;
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
