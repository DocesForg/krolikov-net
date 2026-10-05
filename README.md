# Krolikov

Сайт для поиска музыки по аудиофайлу, записи с микрофона и тексту песни.

## Архитектура

```
                    KROLIKOV
                       │
            ┌──────────┴──────────┐
            │                     │
         ФАЙЛ                  МИКРОФОН
            │                     │
            ↓                     ↓
       Chromaprint             Gemini
            │                 Audio AI
            ↓                     │
         AcoustID                  │
            │                     │
            └──────────┬──────────┘
                       ↓
                 Найденный трек
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       LRCLIB       MusicBrainz / Cover Art Archive      Gemini
        lyrics       tracks        AI
```

### Распознавание файла

Frontend отправляет файл на `/api/recognize/file`. Backend использует `fpcalc`/Chromaprint, затем отправляет fingerprint в AcoustID и получает связанные MusicBrainz recordings.

### Распознавание микрофона

Браузер записывает короткий фрагмент через `MediaRecorder` и передаёт аудио в Gemini Audio AI. Gemini возвращает наиболее вероятные artist/title в структурированном JSON.

### Похожие треки

Gemini определяет похожих исполнителей, после чего backend ищет реальные треки этих исполнителей через MusicBrainz / Cover Art Archive Web API. MusicBrainz / Cover Art Archive Client Secret хранится только на backend.

### Тексты

LRCLIB используется для поиска текста песни по названию, исполнителю или фрагменту текста.

## Стек

- Vite + React + TypeScript
- Redux Toolkit
- Chromaprint / fpcalc
- AcoustID + MusicBrainz
- Gemini API
- LRCLIB
- MusicBrainz / Cover Art Archive Web API
- Express backend
- Docker
- nginx config сохранён для возможного разделения frontend/API

## Запуск

```bash
cp .env.example .env
npm install
npm run dev
```

Для локального frontend API используется proxy Vite на `http://localhost:3001`. В отдельном терминале:

```bash
npm run server
```

Для распознавания файлов нужен `fpcalc` (Chromaprint).

## Переменные

Frontend:

- `VITE_GEMINI_API_KEY`
- `VITE_GEMINI_MODEL`
- `VITE_LRCLIB_API_URL`

Backend:

- `ACOUSTID_CLIENT_KEY`
- `MusicBrainz / Cover Art Archive_CLIENT_ID`
- `MusicBrainz / Cover Art Archive_CLIENT_SECRET`
- `MusicBrainz / Cover Art Archive_MARKET`

AcoustID требует зарегистрированный application API key. MusicBrainz / Cover Art Archive использует Client Credentials на сервере; секрет не должен быть переменной `VITE_*`.

## Docker

```bash
docker build -t krolikov-net .
docker run --rm -p 8080:80 \
  -e ACOUSTID_CLIENT_KEY=... \
  -e MusicBrainz / Cover Art Archive_CLIENT_ID=... \
  -e MusicBrainz / Cover Art Archive_CLIENT_SECRET=... \
  -e VITE_GEMINI_API_KEY=... \
  krolikov-net
```

Gemini и MusicBrainz / Cover Art Archive теперь вызываются через backend, поэтому их ключи не попадают в клиентский JavaScript.

## Возможности

1. Drag & drop аудиофайла.
2. Распознавание файла через Chromaprint + AcoustID.
3. Запись до 12 секунд с микрофона и распознавание через Gemini Audio AI.
4. Поиск текста через LRCLIB.
5. Поиск похожих треков через Gemini.
6. AI-анализ найденного трека.
7. Ссылки на MusicBrainz / Cover Art Archive и обложки, когда они доступны.
