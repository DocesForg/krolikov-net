# krolikov.net

**Krolikov** — веб-приложение для поиска и распознавания музыки по аудиофайлу, записи с микрофона и тексту песни.

Проект использует комбинацию классического аудиофингерпринтинга, музыкальных каталогов и AI.

## Возможности

- 🎵 Распознавание музыки по загруженному аудиофайлу.
- 🎙️ Распознавание музыки по записи с микрофона.
- 📝 Поиск песни по тексту или фрагменту текста.
- 🤖 Определение исполнителя и названия через Yandex AI Agent для длинных текстовых запросов.
- 🔎 Поиск текста песни через LRCLIB.
- 🧠 AI-анализ найденного трека через Gemini.
- 🎧 Поиск похожих исполнителей и треков.
- 🖼️ Получение обложек через MusicBrainz и Cover Art Archive.
- 🌌 Тёмный интерфейс с анимированным фоновым свечением и лучами.
- 🐰 Логотип кролика в наушниках.

## Архитектура

```
                         KROLIKOV.NET
                              │
             ┌────────────────┼────────────────┐
             │                │                │
          АУДИОФАЙЛ         МИКРОФОН          ТЕКСТ
             │                │                │
             ↓                ↓                ↓
        Chromaprint        Gemini AI       ┌────┴────┐
          / fpcalc        Audio AI         │         │
             │                             │         │
             ↓                         <= 8 слов   Длинный
          AcoustID                         │        запрос
             │                             ↓           │
             ↓                           LRCLIB        ↓
        MusicBrainz                                  Yandex
             │                                     AI Agent
             │                                        │
             └───────────────┬────────────────────────┘
                             ↓
                    MusicBrainz / Cover Art
                             │
                             ↓
                       Результат трека
                             │
                       ┌─────┴─────┐
                       ↓           ↓
                    LRCLIB      Gemini
                    lyrics     анализ / похожие
```

## Распознавание аудиофайла

Frontend отправляет аудиофайл на:

```
POST /api/recognize/file
```

Backend:

1. принимает файл;
2. использует Chromaprint через `fpcalc`;
3. отправляет fingerprint в AcoustID;
4. получает связанные MusicBrainz recordings;
5. определяет лучший результат по score;
6. получает обложку через MusicBrainz + Cover Art Archive.

Максимальный размер загружаемого файла — **20 MB**.

## Распознавание с микрофона

Браузер записывает короткий аудиофрагмент и отправляет его на:

```
POST /api/gemini/recognize
```

Gemini Audio AI получает аудио и возвращает структурированный результат:

```json
{
  "found": true,
  "artist": "Исполнитель",
  "title": "Название",
  "album": "Альбом",
  "confidence": 0.95
}
```

После успешного распознавания Krolikov дополнительно ищет обложку через MusicBrainz и Cover Art Archive.

## Поиск по тексту песни

Поиск выполняется через endpoint:

```
GET /api/lyrics/search?q=...
```

### Короткий запрос

Короткий запрос без переноса строк (до **8 слов** и до 120 символов) отправляется напрямую в LRCLIB.

Yandex AI Agent при таком запросе не используется.

### Длинный текст / фрагмент песни

Для длинного текста сначала вызывается **Yandex AI Agent**.

Yandex Agent получает исходный пользовательский текст и обязательно использует встроенный `web_search`.

Схема:

```
Пользовательский текст
        ↓
Yandex AI Agent
        ↓
Исполнитель + название
        ↓
LRCLIB
        ↓
Точный трек / результаты
        ↓
MusicBrainz + Cover Art Archive
        ↓
Карточки результатов
```

Результат Yandex и результаты LRCLIB передаются frontend отдельно.

Yandex Agent настроен на ответ в формате:

```
Black Eyed Peas - Pump It
```

Backend также умеет обработать JSON-ответ, если формат агента будет изменён.

## AI-анализ трека

Для анализа используется Gemini.

Endpoint:

```
POST /api/gemini/analyze
```

AI возвращает:

- краткое описание трека;
- жанры;
- настроение;
- похожих исполнителей;
- рекомендации;
- похожие треки с объяснением сходства.

Количество элементов в основных списках ограничивается backend.

## Поиск похожих треков

Gemini определяет похожих исполнителей и треки на основе найденной композиции.

Результаты используются frontend для блока похожей музыки.

## Музыкальные данные и обложки

Для метаданных используется:

- **AcoustID** — аудиофингерпринт и сопоставление записи;
- **MusicBrainz** — исполнители, записи и релизы;
- **Cover Art Archive** — обложки;
- **LRCLIB** — тексты песен.

## API

Основные backend endpoints:

| Метод | Endpoint | Назначение |
|---|---|---|
| POST | `/api/recognize/file` | Распознавание аудиофайла через Chromaprint + AcoustID |
| POST | `/api/gemini/recognize` | Распознавание аудио через Gemini |
| GET | `/api/lyrics/search?q=...` | Поиск текста / определение песни |
| POST | `/api/gemini/analyze` | AI-анализ найденного трека |
| POST | `/api/yandex/generative` | Запрос к Yandex AI Agent |

## Стек

### Frontend

- React 19
- TypeScript
- Vite
- Redux Toolkit
- React Redux
- CSS

### Backend

- Node.js 22
- Express 5
- Multer
- `@google/genai`
- `openai` — OpenAI-compatible клиент для Yandex AI API
- `acoustid`
- dotenv

### Инфраструктура

- Docker
- Docker Compose
- Chromaprint / fpcalc
- ffmpeg

## Переменные окружения

Секретные ключи используются **только на backend**. Не добавляйте API-ключи с префиксом `VITE_`.

Скопируйте пример:

```bash
cp .env.example .env
```

### Frontend

```env
VITE_APP_NAME=Krolikov
VITE_THEME=dark
VITE_LRCLIB_API_URL=https://lrclib.net/api/
```

### Backend

```env
ACOUSTID_CLIENT_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash

YANDEX_API_KEY=
YANDEX_AGENT_ID=fvtm93a73klntd04lf7p
```

Yandex AI Agent использует backend-конфигурацию:

- Base URL: `https://ai.api.cloud.yandex.net/v1`
- OpenAI-compatible API;
- Project ID: `b1gfj3v8keh3qobuh6rv`;
- Agent ID: `fvtm93a73klntd04lf7p`;
- Web Search включён для запросов агента.

**Не публикуйте `.env` и API-ключи в GitHub.**

## Локальный запуск

Требуется Node.js 22+.

Установка зависимостей:

```bash
npm install
```

Запуск frontend:

```bash
npm run dev
```

Запуск backend в отдельном терминале:

```bash
npm run server
```

Сборка production:

```bash
npm run build
```

Предварительный просмотр production-сборки:

```bash
npm run preview
```

Для распознавания файлов локально должен быть установлен `fpcalc` из Chromaprint.

## Docker

Проект уже содержит Dockerfile и Docker Compose.

Сборка:

```bash
docker build -t krolikov-net .
```

Запуск:

```bash
docker run --rm -p 8080:80 --env-file .env krolikov-net
```

Или через Docker Compose:

```bash
docker compose up --build
```

После запуска Compose приложение доступно на:

```
http://localhost:3000
```

Docker-образ содержит:

- Node.js 22;
- ffmpeg;
- libchromaprint-tools;
- production-сборку Vite;
- Express backend.

## Логотип

Логотип сайта — кролик в наушниках.

Файл:

```
public/krolikov-logo.png
```

Frontend использует его как:

```html
<img src="/krolikov-logo.png" alt="" />
```

## Структура проекта

```
krolikov-net/
├── public/
│   └── krolikov-logo.png
├── server/
│   ├── gemini.js
│   ├── yandex.js
│   └── index.js
├── src/
│   ├── services/
│   │   └── lrclib.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── package.json
└── README.md
```

## Безопасность

API-ключи не должны попадать во frontend bundle.

Используемые секреты:

- AcoustID;
- Gemini;
- Yandex AI.

Они читаются backend из переменных окружения.

Не добавляйте реальные значения ключей в:

- `.env.example`;
- исходный код;
- frontend `VITE_*` переменные;
- README;
- Git history.

## Ограничения

- Качество распознавания зависит от качества аудио и наличия записи в AcoustID/MusicBrainz.
- Gemini может ошибаться при распознавании сильно зашумлённой записи.
- Yandex Agent может не определить песню, если текст недостаточно уникален.
- LRCLIB не гарантирует наличие текста для каждой композиции.
- Обложка отображается только если соответствующий релиз найден в MusicBrainz и Cover Art Archive доступен.

## Репозиторий

GitHub:

https://github.com/DocesForg/krolikov-net
