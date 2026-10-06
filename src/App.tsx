import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { musicServices } from "./services/music";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { setError, setLyrics, setSimilar, setTrack, startLoading } from "./store/musicSlice";
import type { LyricsSearchResult, Track } from "./types/music";

export default function App() {
  const dispatch = useAppDispatch();
  const { track, lyrics, similar, loading, error } = useAppSelector((s) => s.music);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [aiInsight, setAiInsight] = useState<import("./types/music").AiTrackInsight | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedLyrics, setExpandedLyrics] = useState<string | null>(null);
  const [yandexResult, setYandexResult] = useState<LyricsSearchResult["yandex"]>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const recognize = async (file: File, fromMicrophone = false) => {
    dispatch(startLoading());
    try {
      const result = fromMicrophone
        ? await musicServices.recognizeFromMicrophone(file)
        : await musicServices.recognize(file);
      dispatch(setTrack(result.track));
      setAiInsight(null);
      if (!result.track) dispatch(setError("Трек не найден. AcoustID и Gemini не смогли уверенно определить эту запись."));
    } catch (e) { dispatch(setError(e instanceof Error ? e.message : "Ошибка распознавания")); }
  };

  const onFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) return dispatch(setError("Выберите аудиофайл."));
    void recognize(file);
  };

  const searchLyrics = async () => {
    if (!query.trim() || loading) return;
    dispatch(startLoading());
    try {
      const result = await musicServices.searchLyrics(query);
      setYandexResult(result.yandex);
      dispatch(setLyrics(result.results));
      if (result.results.length === 0) dispatch(setError("По вашему запросу ничего не найдено в LRCLIB."));
    } catch (e) { dispatch(setError(e instanceof Error ? e.message : "Ошибка поиска текста")); }
  };

  const analyzeWithAi = async (source: Track) => {
    setAiLoading(true);
    try {
      setAiInsight(await musicServices.analyzeTrack(source));
    } catch (e) {
      dispatch(setError(e instanceof Error ? e.message : "Ошибка AI-анализа"));
    } finally {
      setAiLoading(false);
    }
  };

  const findSimilar = async (source: Track) => {
    dispatch(startLoading());
    try { dispatch(setSimilar(await musicServices.similarTracks(source))); }
    catch (e) { dispatch(setError(e instanceof Error ? e.message : "Ошибка поиска похожих треков")); }
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
        void recognize(new File([blob], "microphone.webm", { type: blob.type }), true);
        setRecording(false);
      };
      mediaRecorder.start(); setRecording(true);
      window.setTimeout(() => mediaRecorder.state === "recording" && mediaRecorder.stop(), 12000);
    } catch { dispatch(setError("Не удалось получить доступ к микрофону.")); }
  };

  const stopRecording = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files[0]); };
  const onInput = (e: ChangeEvent<HTMLInputElement>) => onFile(e.target.files?.[0]);

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><img className="brand-mark" src="/krolikov-logo.png" alt="" aria-hidden="true" /><span>krolikov.net</span></div>
      <span className="status">MUSIC SEARCH</span>
    </header>

    <section className="hero">
      <p className="eyebrow">AUDIO · LYRICS · DISCOVERY</p>
      <h1>Найди музыку<br /><span>по любому следу.</span></h1>
      <p className="subtitle">Загрузи фрагмент, запиши его с микрофона или найди песню по тексту.</p>

      <div className={`dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <input id="file-input" type="file" accept="audio/*" hidden onChange={onInput} />
        <label htmlFor="file-input" className="dropzone-content">
          <span className="upload-icon">↑</span>
          <strong>Перетащи аудиофайл сюда</strong><span>или нажми, чтобы выбрать файл</span>
        </label>
        <button className={`record ${recording ? "recording" : ""}`} onClick={recording ? stopRecording : startRecording}>
          <span className="record-dot" /> {recording ? "Остановить запись" : "Записать с микрофона"}
        </button>
      </div>

      <div className="divider"><span>или поиск по тексту</span></div>
      <form className="search" onSubmit={(e) => { e.preventDefault(); void searchLyrics(); }}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={"Название, исполнитель или строки из песни…\nМожно вставить несколько строк — каждая с новой строки"}
          rows={3}
          aria-label="Поиск по тексту песни"
        />
        <button type="submit" disabled={loading}>{loading ? "Ищем…" : "Найти"}</button>
      </form>

    </section>

    {error && <section className="message error">{error}</section>}

    {loading && <section className="message">Ищем музыку…</section>}

    {yandexResult && <section className="results">
      <div className="section-heading"><span>YANDEX AGENT</span><h2>Результат Yandex</h2></div>
      <div className="result-card">
        <div className="track-info">
          <span className="eyebrow">Yandex · confidence {Math.round(yandexResult.confidence * 100)}%</span>
          {yandexResult.artist && <p><strong>Исполнитель:</strong> {yandexResult.artist}</p>}
          {yandexResult.title && <p><strong>Название:</strong> {yandexResult.title}</p>}
          {!yandexResult.artist && !yandexResult.title && <p>Песня не определена.</p>}
        </div>
      </div>
    </section>}

    {track && <section className="results">
      <div className="result-card">
        {track.artworkUrl ? <img src={track.artworkUrl} alt="" className="cover" /> : <div className="cover placeholder">♪</div>}
        <div className="track-info">
          <span className="eyebrow">FOUND · {track.source}</span>
          <h2>{track.title}</h2><p>{track.artist}</p>
          {track.album && <small>{track.album}</small>}
          {track.timecode && <small>Фрагмент: {track.timecode}</small>}
          <div className="actions">
            <button onClick={() => void findSimilar(track)}>Похожие треки</button>
            <button onClick={() => void analyzeWithAi(track)} disabled={aiLoading}>
              {aiLoading ? "AI анализирует…" : "AI-анализ"}
            </button>
            {track.songUrl && <a href={track.songUrl} target="_blank" rel="noreferrer">Открыть трек ↗</a>}
          </div>
        </div>
      </div>
      {aiInsight && <div className="ai-card">
        <div className="section-heading"><span>GEMINI AI</span><h2>AI-анализ трека</h2></div>
        {aiInsight.summary && <p>{aiInsight.summary}</p>}
        <div className="ai-tags">
          {[...aiInsight.genres, ...aiInsight.mood].map((item) => <span key={item}>{item}</span>)}
        </div>
        {aiInsight.similarArtists.length > 0 && <p><strong>Похожие исполнители:</strong> {aiInsight.similarArtists.join(", ")}</p>}
        {aiInsight.recommendations.length > 0 && <ul>{aiInsight.recommendations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
      </div>}
    </section>}

    {lyrics.length > 0 && <section className="results">
      <div className="section-heading"><span>LYRICS</span><h2>Результаты по тексту</h2></div>
      <div className={"lyrics-grid " + (lyrics.length === 1 ? "is-single" : "")}>{lyrics.slice(0, 8).map((item, i) => {
        const key = item.artist + "-" + item.track + "-" + i;
        const isExpanded = expandedLyrics === key;
        const text = item.plainLyrics || item.syncedLyrics || "";
        const preview = text.length > 240 ? text.slice(0, 240) + "…" : text;

        return <article className={"lyrics-card " + (isExpanded ? "is-expanded" : "")} key={key}>
          {item.artworkUrl
            ? <img src={item.artworkUrl} alt="" className="lyrics-cover" />
            : <div className="lyrics-cover placeholder">♪</div>}
          <div className="lyrics-card-content">
            <h3>{item.track}</h3><p>{item.artist}</p>
            {item.album && <small>{item.album}</small>}
            {text && <div className="lyrics-preview">{isExpanded ? text : preview}</div>}
            {text.length > 240 && <button className="lyrics-toggle" onClick={() => setExpandedLyrics(isExpanded ? null : key)}>
              {isExpanded ? "Свернуть текст ↑" : "Показать весь текст ↓"}
            </button>}
          </div>
        </article>;
      })}</div>
    </section>}

    {similar.length > 0 && <section className="results">
      <div className="section-heading"><span>DISCOVERY</span><h2>Похожие треки</h2></div>
      <div className="similar-grid">{similar.map((item, i) =>
        <article className="similar-card" key={`${item.artist}-${item.title}-${i}`}>
          <span>{String(i + 1).padStart(2, "0")}</span><div><strong>{item.title}</strong><p>{item.artist}</p></div>
        </article>)}</div>
    </section>}

    <footer>Локальный frontend · Vite + React · nginx</footer>
  </main>;
}
