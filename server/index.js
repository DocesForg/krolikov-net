import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import acoustid from "acoustid";
import { analyzeTrack, recognizeAudio } from "./gemini.js";

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

function splitLyricsQuery(query) {
  const normalized = query
    .replace(/\\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\\s+/g, " ").trim())
    .filter(Boolean);

  const lines = [...new Set(normalized.filter((line) => line.length >= 4))];

  // LRCLIB лучше работает с ключевыми фразами, чем с огромным куском текста.
  // Берём не только отдельные строки, но и соседние фразы по 5–10 слов.
  const phrases = [];
  for (const line of lines) {
    const words = line.split(" ").filter(Boolean);

    if (words.length <= 10) {
      phrases.push(line);
      continue;
    }

    for (let i = 0; i < words.length; i += 6) {
      const phrase = words.slice(i, i + 10).join(" ");
      if (phrase.length >= 12) phrases.push(phrase);
    }
  }

  for (let i = 0; i < lines.length - 1; i += 1) {
    const combined = `${lines[i]} ${lines[i + 1]}`;
    const words = combined.split(" ").filter(Boolean);
    if (words.length >= 5) {
      phrases.push(words.slice(0, 10).join(" "));
    }
  }

  return [...new Set(phrases)].slice(0, 12);
}

function normalizeLyricsText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\\[[^\\]]*\\]/g, " ")
    .replace(/[^\\p{L}\\p{N}]+/gu, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function scoreLyricsMatch(item, queries) {
  const haystack = normalizeLyricsText(
    `${item?.plainLyrics || ""} ${item?.syncedLyrics || ""}`,
  );

  if (!haystack) return 0;

  let score = 0;
  for (const query of queries) {
    const normalized = normalizeLyricsText(query);
    if (!normalized) continue;

    if (haystack.includes(normalized)) {
      score += normalized.split(" ").length >= 6 ? 4 : 2;
      continue;
    }

    const words = normalized.split(" ").filter((word) => word.length >= 3);
    if (words.length < 3) continue;

    const matched = words.filter((word) => haystack.includes(word)).length;
    const ratio = matched / words.length;
    if (ratio >= 0.7) score += 2;
    else if (ratio >= 0.45) score += 1;
  }

  return score;
}

app.get("/api/lyrics/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) return res.status(400).json({ error: "Поисковый запрос пуст" });

  const queries = splitLyricsQuery(query);

  try {
    const matches = new Map();

    // Запрашиваем LRCLIB по нескольким характерным фразам.
    // Это позволяет искать целый куплет, не требуя от LRCLIB
    // поддержки полнотекстового совпадения всего куплета.
    for (let start = 0; start < queries.length; start += 3) {
      const batch = queries.slice(start, start + 3);

      const results = await Promise.all(batch.map(async (searchQuery) => {
        try {
          return await searchLrcLib(searchQuery);
        } catch {
          return [];
        }
      }));

      for (const items of results) {
        for (const item of items) {
          const key = [
            String(item?.artistName || "").trim().toLowerCase(),
            String(item?.trackName || "").trim().toLowerCase(),
            String(item?.albumName || "").trim().toLowerCase(),
          ].join("::");

          if (!key || key === "::") continue;

          const current = matches.get(key);
          if (current) {
            current.apiHits += 1;
          } else {
            matches.set(key, {
              ...item,
              apiHits: 1,
            });
          }
        }
      }
    }

    const ranked = [...matches.values()]
      .map((item) => ({
        ...item,
        textScore: scoreLyricsMatch(item, queries),
      }))
      .sort((a, b) => {
        if (b.textScore !== a.textScore) return b.textScore - a.textScore;
        if (b.apiHits !== a.apiHits) return b.apiHits - a.apiHits;
        return String(a.trackName || "").localeCompare(String(b.trackName || ""));
      })
      .slice(0, 20)
      .map(({ apiHits, textScore, ...item }) => item);

    if (ranked.length === 0) {
      return res.json([]);
    }

    return res.json(await enrichLyricsResults(ranked));
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error
        ? error.message
        : "LRCLIB временно недоступен. Попробуйте ещё раз через несколько секунд.",
    });
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
