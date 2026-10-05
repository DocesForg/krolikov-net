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
const acoustIdKey = process.env.ACOUSTID_CLIENT_KEY || "";
app.use(express.json({ limit: "1mb" }));

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

    res.json({
      track,
      score: best?.score ?? null,
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "AcoustID не смог обработать файл",
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
