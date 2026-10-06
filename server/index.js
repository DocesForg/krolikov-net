import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import acoustid from "acoustid";
import { analyzeTrack, recognizeAudio } from "./gemini.js";
import { generativeSearch, identifyTrackFromLyrics } from "./yandex.js";

const app = express();
const upload = multer({
  dest: "/tmp/krolikov-audio",
  limits: { fileSize: 20 * 1024 * 1024 },
});
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const port = Number(process.env.PORT || 3001);
const acoustIdKey = (process.env.ACOUSTID_CLIENT_KEY || "").trim();
app.use(express.json({ limit: "1mb" }));

async function findArtwork(artist, title, album = null) {
  const searches = [];

  if (album) {
    searches.push(
      new URLSearchParams({
        query: `release:"${album}" AND artist:"${artist}"`,
        fmt: "json",
        limit: "3",
      }),
    );
  }

  searches.push(
    new URLSearchParams({
      query: `recording:"${title}" AND artist:"${artist}"`,
      fmt: "json",
      limit: "3",
    }),
  );

  for (const params of searches) {
    try {
      const response = await fetch(`https://musicbrainz.org/ws/2/${album && searches[0] === params ? "release" : "recording"}/?${params}`, {
        headers: { "User-Agent": "Krolikov/0.2.0 (music search app)" },
        signal: AbortSignal.timeout(7000),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const releaseId = album && searches[0] === params
        ? data?.releases?.[0]?.id
        : data?.recordings?.[0]?.releases?.[0]?.id;

      if (!releaseId) continue;

      const cover = await fetch(`https://coverartarchive.org/release/${releaseId}/front-500`, {
        signal: AbortSignal.timeout(7000),
      });

      if (cover.ok) return cover.url;
    } catch {
      // Переходим к следующему варианту поиска.
    }
  }

  return null;
}

function mapRecording(recording) {
  const artist = recording?.artists?.[0]?.name || "";
  const title = recording?.title || "";
  const album = recording?.releasegroups?.[0]?.title || null;
  if (!artist || !title) return null;
  return {
    artist,
    title,
    album,
    releaseDate: null,
    artworkUrl: null,
    songUrl: null,
    source: "AcoustID / MusicBrainz",
  };
}

app.post("/api/gemini/recognize", memoryUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Аудиофайл не передан" });

  try {
    const result = await recognizeAudio(req.file);
    const track = result?.found && result?.artist && result?.title
      ? {
          artist: String(result.artist),
          title: String(result.title),
          album: result.album ? String(result.album) : null,
          artworkUrl: await findArtwork(String(result.artist), String(result.title)),
          source: "Gemini Audio AI",
        }
      : null;
    res.json({ track, confidence: result?.confidence ?? null });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Gemini не смог распознать аудио",
    });
  }
});

async function enrichLyricsResults(items) {
  const results = (Array.isArray(items) ? items : []).slice(0, 20);

  // MusicBrainz ограничивает частоту запросов, поэтому не отправляем 20 запросов одновременно.
  // Первые 8 результатов соответствуют количеству карточек, которые показывает frontend.
  const enriched = [];
  for (let start = 0; start < results.length; start += 2) {
    const batch = results.slice(start, start + 2);
    const batchResults = await Promise.all(batch.map(async (item) => {
      const artist = String(item?.artistName || "").trim();
      const title = String(item?.trackName || "").trim();
      const album = String(item?.albumName || "").trim() || null;
      const artworkUrl = artist && title
        ? await findArtwork(artist, title, album).catch(() => null)
        : null;

      return {
        ...item,
        album: item?.albumName || null,
        artworkUrl,
      };
    }));

    enriched.push(...batchResults);
    if (enriched.length >= 8) {
      enriched.push(...results.slice(enriched.length));
      break;
    }
  }

  return enriched;
}

async function searchLrcLib(query) {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("q", query);

  let lastStatus = 503;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Krolikov/0.2.0 (https://github.com/DocesForg/krolikov-net)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(7000),
      });

      lastStatus = response.status;
      if (response.ok) {
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      }

      if (![429, 500, 502, 503, 504].includes(response.status)) break;

      const retryAfter = Number(response.headers.get("retry-after") || "0");
      const waitMs = Math.min(Math.max(retryAfter * 1000, 1000 * (attempt + 1)), 4000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    } catch {
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const error = new Error(`LRCLIB временно недоступен (HTTP ${lastStatus})`);
  error.code = lastStatus;
  throw error;
}

async function getLrcLibTrack(artist, title) {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", artist);
  url.searchParams.set("track_name", title);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Krolikov/0.2.0 (https://github.com/DocesForg/krolikov-net)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(7000),
  });

  if (!response.ok) return null;
  const item = await response.json();
  return item && typeof item === "object" ? item : null;
}


const LYRICS_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "in", "is", "it", "of", "on", "or", "that", "the", "to", "was", "we",
  "with", "you", "your", "i", "im", "ive", "ill", "id"
]);

function normalizeLyricsText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/&/g, " and ")
    .replace(/@/g, " at ")
    .replace(/\b(can['’]?t)\b/g, "cannot")
    .replace(/\b(won['’]?t)\b/g, "will not")
    .replace(/\b(don['’]?t)\b/g, "do not")
    .replace(/\b(doesn['’]?t)\b/g, "does not")
    .replace(/\b(didn['’]?t)\b/g, "did not")
    .replace(/\b(isn['’]?t)\b/g, "is not")
    .replace(/\b(aren['’]?t)\b/g, "are not")
    .replace(/\b(wasn['’]?t)\b/g, "was not")
    .replace(/\b(weren['’]?t)\b/g, "were not")
    .replace(/\b(i['’]?m)\b/g, "i am")
    .replace(/\b(i['’]?ve)\b/g, "i have")
    .replace(/\b(i['’]?ll)\b/g, "i will")
    .replace(/\b(i['’]?d)\b/g, "i would")
    .replace(/\b(you['’]?re)\b/g, "you are")
    .replace(/\b(you['’]?ve)\b/g, "you have")
    .replace(/\b(you['’]?ll)\b/g, "you will")
    .replace(/\b(we['’]?re)\b/g, "we are")
    .replace(/\b(we['’]?ve)\b/g, "we have")
    .replace(/\b(they['’]?re)\b/g, "they are")
    .replace(/\b(they['’]?ve)\b/g, "they have")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lyricsTokens(value, { meaningfulOnly = false } = {}) {
  const tokens = normalizeLyricsText(value).split(" ").filter(Boolean);
  return meaningfulOnly
    ? tokens.filter((token) => token.length > 1 && !LYRICS_STOP_WORDS.has(token))
    : tokens;
}

function damerauLevenshtein(a, b, maxDistance = Infinity) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previousPrevious = new Array(b.length + 1).fill(0);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1);
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = current[j - 1] + 1;
      const deletion = previous[j] + 1;

      let value = Math.min(substitution, insertion, deletion);

      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, previousPrevious[j - 2] + 1);
      }

      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > maxDistance) return maxDistance + 1;
    previousPrevious = previous;
    previous = current;
  }

  return previous[b.length];
}

function tokenSimilarity(a, b) {
  if (a === b) return 1;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength <= 2) return 0;

  const maxDistance = maxLength <= 5 ? 1 : maxLength <= 8 ? 2 : 3;
  const distance = damerauLevenshtein(a, b, maxDistance);
  if (distance > maxDistance) return 0;

  return 1 - distance / maxLength;
}

function fuzzyTokenMatch(queryToken, candidateToken) {
  if (queryToken === candidateToken) return 1;
  if (queryToken.length < 3 || candidateToken.length < 3) return 0;

  const similarity = tokenSimilarity(queryToken, candidateToken);
  if (similarity < 0.72) return 0;

  return similarity;
}

function fuzzySequenceScore(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;

  let best = 0;

  // Сравниваем последовательность целиком. Пропущенные слова допускаются,
  // но каждое пропускание заметно снижает итоговый результат.
  for (let start = 0; start < candidateTokens.length; start += 1) {
    let queryIndex = 0;
    let candidateIndex = start;
    let matched = 0;
    let skips = 0;
    let gaps = 0;

    while (queryIndex < queryTokens.length && candidateIndex < candidateTokens.length) {
      const similarity = fuzzyTokenMatch(queryTokens[queryIndex], candidateTokens[candidateIndex]);

      if (similarity >= 0.78) {
        matched += similarity;
        queryIndex += 1;
        candidateIndex += 1;
        continue;
      }

      let foundAhead = false;

      // Допускаем максимум два пропущенных слова, но не разрешаем
      // бесконтрольно перескакивать по тексту.
      for (let jump = 1; jump <= 2; jump += 1) {
        const next = candidateIndex + jump;
        if (next >= candidateTokens.length) break;

        const nextSimilarity = fuzzyTokenMatch(queryTokens[queryIndex], candidateTokens[next]);
        if (nextSimilarity >= 0.82) {
          gaps += jump;
          matched += nextSimilarity;
          candidateIndex = next + 1;
          queryIndex += 1;
          foundAhead = true;
          break;
        }
      }

      if (foundAhead) continue;

      skips += 1;
      queryIndex += 1;

      if (skips > Math.max(1, Math.floor(queryTokens.length * 0.15))) break;
      candidateIndex += 1;
    }

    const coverage = matched / queryTokens.length;
    const consumed = Math.max(1, candidateIndex - start);
    const density = matched / consumed;
    const gapPenalty = gaps / Math.max(queryTokens.length, 1);

    const score = coverage * 0.55 + density * 0.45 - gapPenalty * 0.2;
    best = Math.max(best, score);
  }

  return Math.max(0, Math.min(1, best));
}

function longestFuzzyRun(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;

  let best = 0;

  // Ищем самый длинный непрерывный фрагмент запроса в тексте кандидата.
  // Разрешаем только небольшие опечатки, но не перестановку слов и не
  // произвольные пропуски: это дополнительная проверка после совпадения строк.
  for (let start = 0; start < queryTokens.length; start += 1) {
    for (let candidateStart = 0; candidateStart < candidateTokens.length; candidateStart += 1) {
      let queryIndex = start;
      let candidateIndex = candidateStart;
      let run = 0;

      while (
        queryIndex < queryTokens.length &&
        candidateIndex < candidateTokens.length
      ) {
        const similarity = fuzzyTokenMatch(
          queryTokens[queryIndex],
          candidateTokens[candidateIndex],
        );

        if (similarity < 0.82) break;

        run += 1;
        queryIndex += 1;
        candidateIndex += 1;
      }

      best = Math.max(best, run);

      if (best >= queryTokens.length - start) break;
    }

    if (best >= queryTokens.length - start) break;
  }

  return best;
}

function normalizeLyricsLines(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeLyricsText(line))
    .filter((line) => line.length >= 2);
}

function bestLineMatch(queryLine, candidateLines) {
  const queryTokens = lyricsTokens(queryLine);
  if (queryTokens.length < 3) return 0;

  let best = 0;

  for (const candidateLine of candidateLines) {
    const candidateTokens = lyricsTokens(candidateLine);
    if (candidateTokens.length < 3) continue;

    const exact = candidateTokens.join(" ").includes(queryTokens.join(" "));
    if (exact) return 1;

    const fuzzy = fuzzySequenceScore(queryTokens, candidateTokens);

    // Не позволяем короткой строке получать высокий балл только потому,
    // что в ней встретились отдельные похожие слова.
    const lengthRatio = Math.min(queryTokens.length, candidateTokens.length) /
      Math.max(queryTokens.length, candidateTokens.length);

    const score = fuzzy * 0.8 + lengthRatio * 0.2;
    best = Math.max(best, score);
  }

  return best;
}

function scorePhrase(query, lyricsText) {
  const queryLines = normalizeLyricsLines(query);
  const candidateLines = normalizeLyricsLines(lyricsText);

  if (!queryLines.length || !candidateLines.length) return 0;

  // Главный критерий: совпадают ли целые строки.
  const lineScores = queryLines.map((line) => bestLineMatch(line, candidateLines));
  const sortedLines = [...lineScores].sort((a, b) => b - a);

  const strongLines = lineScores.filter((score) => score >= 0.72).length;
  const lineCoverage = lineScores.reduce((sum, value) => sum + value, 0) / lineScores.length;

  // Проверяем порядок строк. Если несколько соседних строк из запроса
  // находятся рядом в тексте кандидата, это гораздо сильнее случайных совпадений.
  let orderedRuns = 0;
  let bestOrderedRun = 0;
  let currentRun = 0;
  let previousCandidateIndex = -2;

  for (const queryLine of queryLines) {
    let bestIndex = -1;
    let bestScore = 0;

    for (let index = 0; index < candidateLines.length; index += 1) {
      const score = bestLineMatch(queryLine, [candidateLines[index]]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestScore >= 0.72 && bestIndex === previousCandidateIndex + 1) {
      currentRun += bestScore;
    } else if (bestScore >= 0.72) {
      currentRun = bestScore;
    } else {
      currentRun = 0;
    }

    bestOrderedRun = Math.max(bestOrderedRun, currentRun);
    previousCandidateIndex = bestIndex;
  }

  if (strongLines === 0) return 0;

  let score = lineCoverage * 55;
  score += (strongLines / queryLines.length) * 30;
  score += Math.min(15, bestOrderedRun * 5);

  // Один совпавший кусок не должен конкурировать с целым куплетом.
  if (queryLines.length >= 3 && strongLines === 1) score *= 0.55;
  if (queryLines.length >= 5 && strongLines < Math.ceil(queryLines.length * 0.4)) score *= 0.7;

  return Math.min(100, score);
}

function scoreLyricsMatch(item, query) {
  const candidateLyrics = [
    item?.plainLyrics || "",
    item?.syncedLyrics || "",
  ].filter(Boolean).join("\n");

  if (!candidateLyrics) return 0;

  const queryLines = normalizeLyricsLines(query);
  if (queryLines.length === 0) return 0;

  const fullScore = scorePhrase(query, candidateLyrics);

  // Дополнительная проверка длинного непрерывного фрагмента.
  const queryTokens = lyricsTokens(query);
  const candidateTokens = lyricsTokens(candidateLyrics);
  const fuzzyRun = longestFuzzyRun(queryTokens, candidateTokens);
  const runRatio = fuzzyRun / Math.max(queryTokens.length, 1);

  let score = fullScore * 0.8;

  // Непрерывность помогает только после того, как строки уже совпали.
  if (runRatio >= 0.85) score += 20;
  else if (runRatio >= 0.7) score += 12;
  else if (runRatio >= 0.55) score += 6;

  return Math.min(100, score);
}

function splitLyricsQuery(query) {
  const lines = String(query || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => lyricsTokens(line).length >= 3);

  if (!lines.length) return [];

  const phrases = [];

  // Сначала ищем целые строки. Это важно: LRCLIB получает контекст,
  // а не россыпь отдельных слов.
  for (const line of lines) {
    const tokens = lyricsTokens(line);
    if (tokens.length >= 3) {
      phrases.push(tokens.join(" "));
    }
  }

  // Затем соседние строки. Они хорошо идентифицируют конкретный куплет.
  for (let i = 0; i < lines.length - 1; i += 1) {
    const tokens = lyricsTokens(lines[i] + " " + lines[i + 1]);
    if (tokens.length >= 6) phrases.push(tokens.slice(0, 18).join(" "));
  }

  // Для очень длинных строк делаем умеренно короткие окна.
  for (const line of lines) {
    const tokens = lyricsTokens(line);
    if (tokens.length > 12) {
      for (let i = 0; i + 6 <= tokens.length; i += 5) {
        phrases.push(tokens.slice(i, Math.min(tokens.length, i + 8)).join(" "));
      }
    }
  }

  // Не больше нескольких наиболее характерных запросов.
  return [...new Set(phrases)].slice(0, 16);
}

function isDirectLrcLibQuery(query) {
  const normalized = String(query || "").replace(/\\s+/g, " ").trim();
  if (!normalized) return false;

  const tokens = normalized.split(" ").filter(Boolean);

  // Короткий запрос без переноса строк считаем поиском по исполнителю/названию.
  // В таком случае Yandex вообще не вызывается: сначала сразу LRCLIB.
  if (!normalized.includes("\n") && tokens.length <= 8 && normalized.length <= 120) {
    return true;
  }

  return false;
}

app.get("/api/lyrics/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) return res.status(400).json({ error: "Поисковый запрос пуст" });

  try {
    if (isDirectLrcLibQuery(query)) {
      // Короткий запрос: исполнитель/название → сразу LRCLIB.
      // Yandex и Gemini здесь не используются.
      const results = await searchLrcLib(query);

      return res.json(
        await enrichLyricsResults(
          results
            .slice(0, 20)
            .map((item) => ({
              ...item,
              textScore: 0,
            })),
        ),
      );
    }

    // Длинный текст/фрагмент песни: Yandex определяет исполнителя
    // и точное название, после чего найденная песня отправляется в LRCLIB.
    const identified = await identifyTrackFromLyrics(query);

    if (!identified.artist || !identified.title || identified.confidence < 0.45) {
      return res.json([]);
    }

    const exact = await getLrcLibTrack(identified.artist, identified.title);
    const results = exact
      ? [exact]
      : await searchLrcLib(`${identified.artist} ${identified.title}`);

    const ranked = results
      .map((item) => ({
        ...item,
        // Для Yandex-идентификации не отбрасываем результат из-за
        // несовпадения текста: Yandex уже определил конкретную песню.
        textScore: scoreLyricsMatch(item, query),
      }))
      .sort((a, b) => {
        if (b.textScore !== a.textScore) return b.textScore - a.textScore;
        return String(a.trackName || "").localeCompare(String(b.trackName || ""));
      })
      .slice(0, 20);

    return res.json(await enrichLyricsResults(ranked));
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error
        ? error.message
        : "Поиск текста временно недоступен. Попробуйте ещё раз.",
    });
  }
});

app.post("/api/yandex/generative", async (req, res) => {
  const query = String(req.body?.query || "").trim();
  if (!query) return res.status(400).json({ error: "Поисковый запрос пуст" });

  try {
    const result = await generativeSearch(query);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Yandex Search API не смог сформировать ответ";
    const status = /не настроен/.test(message) ? 500 : 502;
    res.status(status).json({ error: message });
  }
});

app.post("/api/gemini/analyze", async (req, res) => {
  try {
    const result = await analyzeTrack(req.body?.track || {});
    res.json(result);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Gemini не смог проанализировать трек",
    });
  }
});

app.post("/api/recognize/file", upload.single("file"), async (req, res) => {
  if (!acoustIdKey) return res.status(500).json({ error: "ACOUSTID_CLIENT_KEY не настроен" });
  if (!req.file) return res.status(400).json({ error: "Аудиофайл не передан" });

  try {
    const results = await new Promise((resolve, reject) => {
      acoustid(req.file.path, {
        key: acoustIdKey,
        meta: "recordings+releasegroups+compress",
      }, (error, data) => error ? reject(error) : resolve(data));
    });

    const candidates = Array.isArray(results) ? results : [];
    const best = candidates
      .filter((item) => item?.recordings?.length)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];

    const recording = best?.recordings?.[0];
    const track = mapRecording(recording);
    if (track) track.artworkUrl = await findArtwork(track.artist, track.title);

    res.json({
      track,
      score: best?.score ?? null,
      candidates: candidates.length,
    });
  } catch (error) {
    const raw = error && typeof error === "object" ? error : null;
    const apiCode = raw?.error?.code;
    const apiMessage = raw?.error?.message;

    res.status(502).json({
      error: apiCode === 4 || apiMessage === "invalid API key"
        ? "AcoustID отклонил API-ключ. Нужен Application/Client API Key, а не User API Key."
        : error instanceof Error ? error.message : "AcoustID не смог обработать файл",
    });
  } finally {
    await fs.rm(req.file.path, { force: true }).catch(() => undefined);
  }
});

const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
app.use(express.static(distPath));
app.use((req, res) => {
  if (req.method === "GET") return res.sendFile(path.join(distPath, "index.html"));
  res.status(404).json({ error: "Not found" });
});

app.listen(port, () => {
  console.log(`Krolikov server listening on :${port}`);
});
