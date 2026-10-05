# Krolikov

Локальный frontend для поиска музыки по аудиофрагменту, микрофону и тексту песни.

## Стек

- Vite + React + TypeScript
- Redux Toolkit
- AudD — распознавание музыки
- LRCLIB — поиск текстов
- Last.fm — похожие треки
- Multi-stage Docker build
- nginx для раздачи статического `dist`

## Запуск

```bash
cp .env.example .env
npm install
npm run dev
```

Для распознавания звука укажите `VITE_AUDD_API_TOKEN`.

Для похожих треков укажите `VITE_LASTFM_API_KEY`.

## Docker

```bash
docker build -t krolikov-net .
docker run --rm -p 8080:80 krolikov-net
```

Важно: переменные `VITE_*` подставляются Vite во время сборки. API token, переданный в `VITE_*`, попадёт в клиентский JavaScript и поэтому не является секретом.

Если token должен оставаться секретным, следующий этап архитектуры — маленький backend/BFF между nginx и внешними API. Сам frontend при этом останется полностью статическим.

## Архитектура

UI не знает конкретные API. Входная точка `src/services/music.ts` реализует DI-композицию:

- `AuddRecognitionService`
- `LrcLibLyricsService`
- `LastFmRecommendationService`

Поэтому провайдера можно заменить без переписывания компонентов.

## Возможности MVP

1. Drag & drop аудиофайла.
2. Выбор локального аудиофайла.
3. Запись до 12 секунд с микрофона.
4. Распознавание исполнителя/названия.
5. Поиск по названию, исполнителю или строке текста.
6. Выдача похожих треков.
7. Ссылки на найденный трек и обложка, если провайдер их вернул.
