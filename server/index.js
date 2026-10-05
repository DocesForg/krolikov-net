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
const spotifyClientId = process.env.SPOTIFY_CLIENT_ID || "";
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
const spotifyMarket = process.env.SPOTIFY_MARKET || "DE";

let spotifyToken = null;
let spotifyTokenExpiresAt = 0;

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

async function getSpotifyToken() {
  if (!spotifyClientId || !spotifyClientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET не настроены");
  }

  if (spotifyToken && Date.now() < spotifyTokenExpiresAt) return spotifyToken;

  const credentials = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) throw new Error(`Spotify token HTTP ${response.status}`);
  const data = await response.json();
  spotifyToken = data.access_token;
  spotifyTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000;
  return spotifyToken;
}

app.post("/api/spotify/similar", async (req, res) => {
  const artists = Array.isArray(req.body?.artists) ? req.body.artists : [];
  if (!artists.length) return res.json({ tracks: [] });

  try {
    const token = await getSpotifyToken();
    const uniqueArtists = [...new Set(artists.map(String).filter(Boolean))].slice(0, 6);
    const tracks = [];

    for (const artist of uniqueArtists) {
      const url = new URL("https://api.spotify.com/v1/search");
      url.searchParams.set("q", `artist:"${artist}"`);
      url.searchParams.set("type", "track");
      url.searchParams.set("market", spotifyMarket);
      url.searchParams.set("limit", "4");

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) continue;

      const data = await response.json();
      for (const item of data?.tracks?.items || []) {
        tracks.push({
          artist: item.artists?.map((a) => a.name).join(", ") || artist,
          title: item.name,
          album: item.album?.name || null,
          artworkUrl: item.album?.images?.[0]?.url || null,
          songUrl: item.external_urls?.spotify || null,
          source: "Spotify",
        });
      }
    }

    const unique = tracks.filter((track, index, list) =>
      index === list.findIndex((item) => item.artist === track.artist && item.title === track.title)
    );

    res.json({ tracks: unique.slice(0, 12) });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Spotify недоступен" });
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
