import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { musicServices } from "./services/music";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { setError, setLyrics, setSimilar, setTrack, startLoading } from "./store/musicSlice";
import type { LyricsSearchResult, Track } from "./types/music";

const BASE_AMBIENT_COLORS: [string, string, string] = ["#7655ff", "#00b9d6", "#ec4d9b"];


function ArtworkPreview({ src, alt, previewUrl }: { src?: string | null; alt: string; previewUrl?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !previewUrl) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  return <div className={`artwork-preview ${src ? "" : "artwork-placeholder"}`}>
    {src ? <img src={src} crossOrigin="anonymous" alt={alt} className="cover" /> : <div className="cover placeholder" aria-hidden="true">♪</div>}
    {previewUrl && <>
      <audio ref={audioRef} src={previewUrl} preload="none" onEnded={() => {
        setPlaying(false);
        window.dispatchEvent(new CustomEvent("krolikov:playback", { detail: { playing: false, src, alt, audio: audioRef.current } }));
      }}
        onPause={() => {
          setPlaying(false);
          window.dispatchEvent(new CustomEvent("krolikov:playback", { detail: { playing: false, src, alt, audio: audioRef.current } }));
        }}
        onPlay={() => {
          setPlaying(true);
          window.dispatchEvent(new CustomEvent("krolikov:playback", { detail: { playing: true, src, alt, audio: audioRef.current } }));
        }} />
      <button type="button" className="artwork-play" onClick={() => void togglePlayback()} aria-label={playing ? `Поставить на паузу: ${alt}` : `Прослушать фрагмент: ${alt}`} title={playing ? "Пауза" : "Слушать 30 секунд"}>
        {playing ? <span className="pause-icon" aria-hidden="true" /> : <span className="play-icon" aria-hidden="true">▶</span>}
      </button>
      <span className="artwork-preview-label">30 сек.</span>
    </>}
    <img className="retro-artwork-corner" src="/winico/Arrow%20(up).ico" alt="" aria-hidden="true" />
  </div>;
}

export default function App() {
  const dispatch = useAppDispatch();
  const { track, lyrics, similar, loading, error } = useAppSelector((s) => s.music);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [expandedLyrics, setExpandedLyrics] = useState<string | null>(null);
  const [yandexResult, setYandexResult] = useState<LyricsSearchResult["yandex"]>(null);
  const [similarLyrics, setSimilarLyrics] = useState<import("./types/music").Lyrics[]>([]);
  const [similarLyricsLoading, setSimilarLyricsLoading] = useState(false);
  const [similarTracksLoading, setSimilarTracksLoading] = useState(false);
  const [genre, setGenre] = useState("");
  const [genreLyrics, setGenreLyrics] = useState<import("./types/music").Lyrics[]>([]);
  const [genreRecommendations, setGenreRecommendations] = useState<{ artist: string; title: string }[]>([]);
  const [genreLoading, setGenreLoading] = useState(false);
  const [previews, setPreviews] = useState<Record<string, { previewUrl: string; trackUrl: string }>>({});
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [ambientColors, setAmbientColors] = useState<[string, string, string]>(BASE_AMBIENT_COLORS);
  const [retroMode, setRetroMode] = useState(false);

  useEffect(() => {
    let activeAudio: HTMLAudioElement | null = null;

    const resetPalette = () => setAmbientColors(BASE_AMBIENT_COLORS);
    const handlePlayback = (event: Event) => {
      const detail = (event as CustomEvent<{ playing: boolean; src?: string | null; alt?: string; audio?: HTMLAudioElement | null }>).detail;
      const audio = detail.audio ?? null;

      if (!detail.playing) {
        // Ignore delayed pause events from an older preview after another track has started.
        if (audio && activeAudio && audio !== activeAudio) return;
        if (!audio || audio === activeAudio) {
          activeAudio = null;
          setIsPreviewPlaying(false);
          resetPalette();
        }
        return;
      }

      if (!audio) return;
      activeAudio = audio;
      setIsPreviewPlaying(true);

      // Only one preview may play at a time.
      document.querySelectorAll<HTMLAudioElement>(".artwork-preview audio").forEach((otherAudio) => {
        if (otherAudio !== audio && !otherAudio.paused) otherAudio.pause();
      });

      const artwork = Array.from(document.querySelectorAll<HTMLImageElement>(".artwork-preview img"))
        .find((img) => (detail.src && (img.currentSrc === detail.src || img.src === detail.src)) ||
          (detail.alt && img.alt === detail.alt && img.complete && img.naturalWidth > 0));
      if (artwork?.complete && artwork.naturalWidth > 0) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 32;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (context) {
            context.drawImage(artwork, 0, 0, 32, 32);
            const pixels = context.getImageData(0, 0, 32, 32).data;
            // Six hue buckets keep visually distinct colors (e.g. pink, green and blue)
            // separate instead of grouping every red/pink shade into one channel bucket.
            const buckets = Array.from({ length: 6 }, () => ({ r: 0, g: 0, b: 0, n: 0, score: 0 }));
            for (let i = 0; i < pixels.length; i += 4) {
              const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
              if (pixels[i + 3] < 150) continue;
              const max = Math.max(r, g, b), min = Math.min(r, g, b);
              const brightness = r * 0.299 + g * 0.587 + b * 0.114;
              const saturation = max === 0 ? 0 : (max - min) / max;
              if (brightness < 65 || max < 90 || saturation < 0.28 || max - min < 35) continue;
              if (brightness > 242 && saturation < 0.58) continue;
              const delta = max - min;
              let hue = 0;
              if (delta > 0) {
                if (max === r) hue = 60 * (((g - b) / delta) % 6);
                else if (max === g) hue = 60 * ((b - r) / delta + 2);
                else hue = 60 * ((r - g) / delta + 4);
              }
              if (hue < 0) hue += 360;
              const bucket = Math.floor(hue / 60) % 6;
              const weight = Math.pow(saturation, 1.7) * (0.45 + brightness / 255);
              buckets[bucket].r += r * weight;
              buckets[bucket].g += g * weight;
              buckets[bucket].b += b * weight;
              buckets[bucket].score += weight;
              buckets[bucket].n++;
            }
            const vivid = buckets.filter((x) => x.n && x.score > 0).map((x) => {
              const rgb = [x.r / x.score, x.g / x.score, x.b / x.score];
              const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
              let boosted = rgb.map((v) => avg + (v - avg) * 1.55);
              const peak = Math.max(...boosted);
              if (peak > 0) boosted = boosted.map((v) => Math.min(238, Math.max(0, v * Math.min(1.12, 225 / peak))));
              return { color: "#" + boosted.map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""), score: x.score };
            }).sort((a, b) => b.score - a.score);
            if (vivid.length) {
              const fallback = ["#8b5cf6", "#22d3ee", "#fb7185"];
              // Prefer three different hue families; use fallbacks only if the cover lacks enough colors.
              const selected = vivid.slice(0, 3).map((x) => x.color);
              setAmbientColors([
                selected[0] ?? fallback[0],
                selected[1] ?? fallback[1],
                selected[2] ?? fallback[2],
              ] as [string, string, string]);
            }
          }
        } catch {
          // If artwork pixels are blocked by CORS, keep the current palette.
        }
      }
    };

    window.addEventListener("krolikov:playback", handlePlayback);
    return () => {
      window.removeEventListener("krolikov:playback", handlePlayback);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ambient-a", ambientColors[0]);
    root.style.setProperty("--ambient-b", ambientColors[1]);
    root.style.setProperty("--ambient-c", ambientColors[2]);
    return () => {
      root.style.removeProperty("--ambient-a");
      root.style.removeProperty("--ambient-b");
      root.style.removeProperty("--ambient-c");
    };
  }, [ambientColors]);
  const previewKey = (artist: string, title: string) => `${artist.trim().toLocaleLowerCase()}::${title.trim().toLocaleLowerCase()}`;
  const requestPreviews = (items: Array<{ artist: string; title: string }>) => {
    if (!items.length) return;
    void musicServices.findPreviews(items).then((found) => {
      setPreviews((current) => {
        const next = { ...current };
        for (const item of found) {
          if (item.previewUrl && item.trackUrl) {
            next[previewKey(item.artist, item.title)] = { previewUrl: item.previewUrl, trackUrl: item.trackUrl };
          }
        }
        return next;
      });
    });
  };
  const renderPreview = (artist: string, title: string) => {
    const preview = previews[previewKey(artist, title)];
    if (!preview) return null;
    return <div className="preview-meta">
      <span>Фрагмент предоставлен iTunes</span>
      <a href={preview.trackUrl} target="_blank" rel="noreferrer">Открыть в iTunes ↗</a>
    </div>;
  };

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const artworkRequest = useRef(0);

  const recognize = async (file: File, fromMicrophone = false) => {
    dispatch(startLoading());
    try {
      const result = fromMicrophone
        ? await musicServices.recognizeFromMicrophone(file)
        : await musicServices.recognize(file);
      dispatch(setTrack(result.track));
      if (result.track) requestPreviews([{ artist: result.track.artist, title: result.track.title }]);
      if (!result.track) dispatch(setError("Трек не найден. AcoustID и Яндекс Агент не смогли определить эту запись."));
    } catch (e) { dispatch(setError(e instanceof Error ? e.message : "Ошибка распознавания")); }
  };

  const onFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) return dispatch(setError("Выберите аудиофайл."));
    void recognize(file);
  };

  const loadLyricsArtwork = (items: import("./types/music").Lyrics[]) => {
    const requestId = ++artworkRequest.current;
    void musicServices.loadArtwork(items).then((updated) => {
      if (requestId === artworkRequest.current && updated.some((item, index) => item.artworkUrl !== items[index]?.artworkUrl)) {
        dispatch(setLyrics(updated));
      }
    });
  };

  const searchLyrics = async () => {
    if (!query.trim() || loading) return;
    dispatch(startLoading());
    try {
      const result = await musicServices.searchLyrics(query);
      setYandexResult(result.yandex);
      if (result.yandex?.artist && result.yandex.title) requestPreviews([{ artist: result.yandex.artist, title: result.yandex.title }]);
      requestPreviews(result.results.map((item) => ({ artist: item.artist, title: item.track })));
      dispatch(setLyrics(result.results));
      loadLyricsArtwork(result.results);
      if (result.results.length === 0) dispatch(setError("По вашему запросу ничего не найдено в LRCLIB."));
    } catch (e) { dispatch(setError(e instanceof Error ? e.message : "Ошибка поиска текста")); }
  };

  const searchByGenre = async () => {
    const value = genre.trim();
    if (!value || genreLoading) return;

    setGenreLoading(true);
    setGenreLyrics([]);
    setGenreRecommendations([]);
    try {
      const result = await musicServices.searchByGenre(value);
      setGenreRecommendations(result.recommendations);
      requestPreviews(result.results.map((item) => ({ artist: item.artist, title: item.track })));
      requestPreviews(result.recommendations);
      setGenreLyrics(result.results);
      void musicServices.loadArtwork(result.results).then(setGenreLyrics);
      if (result.results.length === 0) {
        dispatch(setError("Yandex подобрал песни, но тексты для них не найдены в LRCLIB."));
      }
    } catch (e) {
      dispatch(setError(e instanceof Error ? e.message : "Ошибка поиска песен по жанру"));
    } finally {
      setGenreLoading(false);
    }
  };

  const showTrackLyrics = async (source: Track) => {
    if (!source.title || loading) return;

    dispatch(startLoading());
    try {
      const result = await musicServices.searchLyrics(source.title);
      setYandexResult(null);
      requestPreviews(result.results.map((item) => ({ artist: item.artist, title: item.track })));
      dispatch(setLyrics(result.results));
      loadLyricsArtwork(result.results);
      if (result.results.length === 0) {
        dispatch(setError("Текст этого трека не найден в LRCLIB."));
      }
    } catch (e) {
      dispatch(setError(e instanceof Error ? e.message : "Ошибка поиска текста"));
    }
  };

  const findSimilarLyrics = async (item: import("./types/music").Lyrics) => {
    setSimilarLyricsLoading(true);
    try {
      const result = await musicServices.searchSimilarLyrics(item.artist, item.track);
      setSimilarLyrics(result.results);
      requestPreviews(result.results.map((item) => ({ artist: item.artist, title: item.track })));
      void musicServices.loadArtwork(result.results).then(setSimilarLyrics);
      if (result.results.length === 0) {
        dispatch(setError("Похожие треки найдены, но тексты для них не найдены в LRCLIB."));
      }
    } catch (e) {
      dispatch(setError(e instanceof Error ? e.message : "Ошибка поиска похожих текстов"));
    } finally {
      setSimilarLyricsLoading(false);
    }
  };

  const findSimilar = async (source: Track) => {
    if (similarTracksLoading) return;
    setSimilarTracksLoading(true);
    setSimilarLyrics([]);
    dispatch(setSimilar([]));
    try {
      // Reuse the same LRCLIB mapping and enrichment flow as “Показать похожие”
      // on text-search cards, so these results include lyrics and album artwork.
      const result = await musicServices.searchSimilarLyrics(source.artist, source.title);
      setSimilarLyrics(result.results);
      requestPreviews(result.results.map((item) => ({ artist: item.artist, title: item.track })));
      void musicServices.loadArtwork(result.results).then(setSimilarLyrics);
      if (result.results.length === 0) dispatch(setError("Похожие треки найдены, но тексты для них не найдены в LRCLIB."));
    }
    catch (e) { dispatch(setError(e instanceof Error ? e.message : "Ошибка поиска похожих треков")); }
    finally { setSimilarTracksLoading(false); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      chunks.current = []; recorder.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        void recognize(new File([blob], "microphone-recording.webm", { type: blob.type }), true);
        setRecording(false);
      };
      mediaRecorder.start(); setRecording(true);
      window.setTimeout(() => mediaRecorder.state === "recording" && mediaRecorder.stop(), 12000);
    } catch { dispatch(setError("Не удалось получить доступ к микрофону.")); }
  };

  const stopRecording = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files[0]); };
  const onInput = (e: ChangeEvent<HTMLInputElement>) => onFile(e.target.files?.[0]);

  return <main className={`app-shell ${isPreviewPlaying ? "is-preview-playing" : ""} ${retroMode ? "retro-mode" : ""}`}>
    <header className="topbar">
      <div className="brand"><img className="brand-mark" src="/krolikov-logo.png" alt="" aria-hidden="true" /><span>krolikov.net</span></div>
      <button type="button" className={`theme-floppy ${retroMode ? "is-active" : ""}`} onClick={() => setRetroMode((current) => !current)} aria-pressed={retroMode} title={retroMode ? "Вернуться к обычному дизайну" : "Включить ретро-дизайн Windows"}>
        <span className="floppy-icon" aria-hidden="true">▣</span><span>{retroMode ? "Обычный вид" : "Ретро-режим"}</span>
      </button>
    </header>

    <section className="hero">
      <p className="eyebrow">AUDIO · LYRICS · DISCOVERY</p>
      <h1><img className="retro-inline-icon music-disc-icon" src="/winico/Music%20Disc.ico" alt="" aria-hidden="true" />Найди музыку<br /><span>по любому следу.</span></h1>
      <p className="subtitle">Загрузи фрагмент, запиши его с микрофона или найди песню по тексту.</p>

      <div className={`dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <input id="file-input" type="file" accept="audio/*" hidden onChange={onInput} />
        <label htmlFor="file-input" className="dropzone-content">
          <span className="upload-icon"><img className="retro-inline-icon folder-icon" src="/winico/Opened%20Folder.ico" alt="" aria-hidden="true" /><span className="upload-fallback">↑</span></span>
          <strong>Перетащи аудиофайл сюда</strong><span>или нажми, чтобы выбрать файл</span>
        </label>
        <button className={`record ${recording ? "recording" : ""}`} onClick={recording ? stopRecording : startRecording}>
          <span className="record-dot" /> {recording ? "Остановить запись" : "Записать с микрофона"}
        </button>
      </div>

      <div className="divider"><span>или поиск по тексту</span></div>
      <form className="search" onSubmit={(e) => { e.preventDefault(); void searchLyrics(); }}>
        <img className="scrap-mascot" src="/scrap.gif" alt="" aria-hidden="true" />
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={"Название, исполнитель или строки из песни…\nМожно вставить несколько строк — каждая с новой строки"}
          rows={3}
          aria-label="Поиск по тексту песни"
        />
        <button type="submit" disabled={loading}>{loading ? "Ищем…" : "Найти"}</button>
      </form>

      <div className="divider"><span>или подобрать песни по жанру</span></div>
      <form className="search genre-search" onSubmit={(e) => { e.preventDefault(); void searchByGenre(); }}>
        <img className="scrap-mascot" src="/scrap.gif" alt="" aria-hidden="true" />
        <input
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="Например: synthwave, рок, джаз…"
          aria-label="Жанр для поиска песен"
        />
        <button type="submit" disabled={genreLoading}>{genreLoading ? "Ищем…" : "Найти"}</button>
      </form>


    </section>

    {error && <section className="message error">{error}</section>}

    {loading && <section className="message">Ищем музыку…</section>}

    {yandexResult && <section className="results">
      <div className="section-heading"><span>YANDEX AGENT</span><div className="retro-window-controls" aria-hidden="true"><span>_</span><span>□</span><span>×</span></div><h2><img className="retro-inline-icon sound-computer-icon" src="/winico/Sound%20computer.ico" alt="" aria-hidden="true" />Результат Yandex</h2></div>
      <div className="result-card">
        <div className="track-info">
          <span className="eyebrow">Yandex · confidence {Math.round(yandexResult.confidence * 100)}%</span>
          {yandexResult.artist && <p><strong>Исполнитель:</strong> {yandexResult.artist}</p>}
          {yandexResult.title && <p><strong>Название:</strong> {yandexResult.title}</p>}
          {!yandexResult.artist && !yandexResult.title && <p>Песня не определена.</p>}
          {yandexResult.artist && yandexResult.title && renderPreview(yandexResult.artist, yandexResult.title)}
        </div>
      </div>
    </section>}

    {track && <section className="results">
      <div className="result-card">
        <ArtworkPreview src={track.artworkUrl} alt={`${track.title} — ${track.artist}`} previewUrl={previews[previewKey(track.artist, track.title)]?.previewUrl} />
        <div className="track-info">
          <span className="eyebrow">FOUND · {track.source}</span>
          <h2>{track.title}</h2><p>{track.artist}</p>
          {track.album && <small>{track.album}</small>}
          {track.timecode && <small>Фрагмент: {track.timecode}</small>}
          {renderPreview(track.artist, track.title)}
          <div className="actions">
            <button type="button" onClick={() => void findSimilar(track)} disabled={similarTracksLoading}>{similarTracksLoading ? "Ищем похожие…" : "Похожие треки"}</button>
            <button type="button" onClick={() => void showTrackLyrics(track)} disabled={loading}>
              {loading ? "Ищем текст…" : "Показать текст"}
            </button>
            {track.songUrl && <a href={track.songUrl} target="_blank" rel="noreferrer">Открыть трек ↗</a>}
          </div>
        </div>
      </div>

    </section>}

    {lyrics.length > 0 && <section className="results">
      <div className="section-heading"><span>LYRICS</span><div className="retro-window-controls" aria-hidden="true"><span>_</span><span>□</span><span>×</span></div><h2>Результаты по тексту</h2></div>
      <div className={"lyrics-grid " + (lyrics.length === 1 ? "is-single" : "")}>{lyrics.slice(0, 8).map((item, i) => {
        const key = item.artist + "-" + item.track + "-" + i;
        const isExpanded = expandedLyrics === key;
        const text = item.plainLyrics || item.syncedLyrics || "";
        const preview = text.length > 240 ? text.slice(0, 240) + "…" : text;

        return <article className={"lyrics-card " + (isExpanded ? "is-expanded" : "")} key={key}>
          <ArtworkPreview src={item.artworkUrl} alt={`${item.track} — ${item.artist}`} previewUrl={previews[previewKey(item.artist, item.track)]?.previewUrl} />
          <div className="lyrics-card-content">
            <h3>{item.track}</h3><p>{item.artist}</p>
            {item.album && <small>{item.album}</small>}
            {renderPreview(item.artist, item.track)}
            {text && <div className="lyrics-preview">{isExpanded ? text : preview}</div>}
            <div className="lyrics-actions">
              {text.length > 240 && <button className="lyrics-toggle" onClick={() => setExpandedLyrics(isExpanded ? null : key)}>
                {isExpanded ? "Свернуть текст ↑" : <><img className="retro-inline-icon button-icon" src="/winico/Notepad%20document.ico" alt="" aria-hidden="true" />Показать весь текст ↓</> }
              </button>}
              <button className="lyrics-toggle" onClick={() => void findSimilarLyrics(item)} disabled={similarLyricsLoading}>
                {similarLyricsLoading ? "Ищем похожие…" : <><img className="retro-inline-icon button-icon" src="/winico/Search%20on%20Earth.ico" alt="" aria-hidden="true" />Показать похожие</> }
              </button>
            </div>
          </div>
        </article>;
      })}</div>
    </section>}

    {genreLyrics.length > 0 && <section className="results">
      <div className="section-heading"><span>YANDEX · LRCLIB</span><div className="retro-window-controls" aria-hidden="true"><span>_</span><span>□</span><span>×</span></div><h2>Песни в жанре «{genre}»</h2></div>
      {genreRecommendations.length > 0 && <div className="genre-recommendations">
        {genreRecommendations.map((item, i) => <span key={`${item.artist}-${item.title}-${i}`}>{item.artist} — {item.title}</span>)}
      </div>}
      <div className="lyrics-grid">
        {genreLyrics.map((item, i) => {
          const key = `genre-${item.artist}-${item.track}-${i}`;
          const text = item.plainLyrics || item.syncedLyrics || "";
          const isExpanded = expandedLyrics === key;
          const preview = text.length > 240 ? text.slice(0, 240) + "…" : text;
          return <article className={`lyrics-card ${isExpanded ? "is-expanded" : ""}`} key={key}>
            <ArtworkPreview src={item.artworkUrl} alt={`${item.track} — ${item.artist}`} previewUrl={previews[previewKey(item.artist, item.track)]?.previewUrl} />
            <div className="lyrics-card-content">
              <h3>{item.track}</h3><p>{item.artist}</p>
              {item.album && <small>{item.album}</small>}
              {renderPreview(item.artist, item.track)}
              {text && <div className="lyrics-preview">{isExpanded ? text : preview}</div>}
              {text.length > 240 && <button className="lyrics-toggle" onClick={() => setExpandedLyrics(isExpanded ? null : key)}>
                {isExpanded ? "Свернуть текст ↑" : <><img className="retro-inline-icon button-icon" src="/winico/Notepad%20document.ico" alt="" aria-hidden="true" />Показать весь текст ↓</> }
              </button>}
            </div>
          </article>;
        })}
      </div>
    </section>}

    {similarLyrics.length > 0 && <section className="results">
      <div className="section-heading"><span>SIMILAR LYRICS</span><div className="retro-window-controls" aria-hidden="true"><span>_</span><span>□</span><span>×</span></div><h2>Похожие треки с текстом</h2></div>
      <div className="lyrics-grid">
        {similarLyrics.map((item, i) => {
          const key = `similar-${item.artist}-${item.track}-${i}`;
          const text = item.plainLyrics || item.syncedLyrics || "";
          const isExpanded = expandedLyrics === key;
          const preview = text.length > 240 ? text.slice(0, 240) + "…" : text;
          return <article className={`lyrics-card ${isExpanded ? "is-expanded" : ""}`} key={key}>
            <ArtworkPreview src={item.artworkUrl} alt={`${item.track} — ${item.artist}`} previewUrl={previews[previewKey(item.artist, item.track)]?.previewUrl} />
            <div className="lyrics-card-content">
              <h3>{item.track}</h3><p>{item.artist}</p>
              {item.album && <small>{item.album}</small>}
              {renderPreview(item.artist, item.track)}
              {text && <div className="lyrics-preview">{isExpanded ? text : preview}</div>}
              {text.length > 240 && <button className="lyrics-toggle" onClick={() => setExpandedLyrics(isExpanded ? null : key)}>
                {isExpanded ? "Свернуть текст ↑" : <><img className="retro-inline-icon button-icon" src="/winico/Notepad%20document.ico" alt="" aria-hidden="true" />Показать весь текст ↓</> }
              </button>}
            </div>
          </article>;
        })}
      </div>
    </section>}

    {similar.length > 0 && <section className="results">
      <div className="section-heading"><span>DISCOVERY</span><div className="retro-window-controls" aria-hidden="true"><span>_</span><span>□</span><span>×</span></div><h2>Похожие треки</h2></div>
      <div className="similar-grid">{similar.map((item, i) =>
        <article className="similar-card" key={`${item.artist}-${item.title}-${i}`}>
          <ArtworkPreview src={item.artworkUrl} alt={`${item.title} — ${item.artist}`} previewUrl={previews[previewKey(item.artist, item.title)]?.previewUrl} />
          <span>{String(i + 1).padStart(2, "0")}</span><div className="similar-card-content"><strong>{item.title}</strong><p>{item.artist}</p>{renderPreview(item.artist, item.title)}</div>
        </article>)}</div>
    </section>}

    <footer>Локальный frontend · Vite + React · nginx</footer>
  </main>;
}