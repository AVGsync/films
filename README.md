# Cinema Deck

Одностраничный Go-сервис для поиска фильмов по Kinopoisk и просмотра через два провайдера:

- `Alloha` как основной плеер
- `Collaps` как резервный плеер

## Что лежит где

- [main.go](/home/eugene/project-go/films/main.go) — весь backend: HTML, внутренние API, low-level proxy
- [index.html](/home/eugene/project-go/films/index.html) — весь frontend интерфейс
- [docker-compose.yml](/home/eugene/project-go/films/docker-compose.yml) — контейнеры приложения и Caddy
- [Caddyfile](/home/eugene/project-go/films/Caddyfile) — reverse proxy и TLS-конфиг
- [caddy-entrypoint.sh](/home/eugene/project-go/films/caddy-entrypoint.sh) — поиск сертификатов и запуск Caddy

## Захардкоженные токены

Сейчас токены по умолчанию зашиты в [main.go](/home/eugene/project-go/films/main.go) и могут быть переопределены через env:

- `KINOPOISK_API_KEY`
  - default: `8b110921-e522-41e4-8799-1571f43cd2ad`
- `ALLOHA_API_TOKEN`
  - default: `04941a9a3ca3ac16e2b4327347bbc1`
- `COLLAPS_API_TOKEN`
  - default: `eedefb541aeba871dcfc756e6b31c02e`

Это сделано специально под текущий приватный инстанс, чтобы убрать формы ввода ключей из интерфейса.

## Архитектура

### 1. Frontend

Фронтенд работает только со своими backend-эндпоинтами:

- `GET /api/search?q=...`
- `GET /api/film?kp=...`
- `GET /api/player?provider=alloha|collaps&kp=...`

Браузер больше не ходит напрямую в чужие JSON API. В итоге:

- токены не светятся в HTML и JS
- UI не зависит от CORS на стороне провайдеров
- проще контролировать логику резолва iframe

### 2. Search и film details

Поиск и карточка фильма идут через `kinopoiskapiunofficial.tech`.

Backend:

- подставляет `X-API-KEY`
- нормализует ответ Kinopoisk в компактный JSON для UI
- отдаёт готовые поля: название, постер, рейтинги, жанры, страны, описание
- если текущий Kinopoisk ключ отвечает `401`, backend автоматически переключает поиск и карточку фильма на fallback через Alloha

### 3. Alloha

Поток для Alloha такой:

1. frontend вызывает `GET /api/player?provider=alloha&kp=...`
2. backend идёт в `https://api.alloha.tv/?token=...&kp=...`
3. backend достаёт `data.iframe`
4. frontend вставляет этот URL напрямую в `iframe`

Почему не через `/proxy`:

- у `api.alloha.tv` просроченный TLS-сертификат, поэтому backend делает запрос с `InsecureSkipVerify` только для этого хоста
- для самого API при необходимости используется внешний upstream proxy `ALLOHA_UPSTREAM_PROXY_URL`
- но финальный плеер `stloadi.live` нельзя стабильно проксировать через наш `/proxy`: у него ломаются внутренние запросы плеера и появляются `403/404` на внутренних `bnsi/...` запросах

Итог:

- API Alloha проходит через backend
- финальный iframe Alloha открывается напрямую

### 4. Collaps

Поток для Collaps такой:

1. frontend вызывает `GET /api/player?provider=collaps&kp=...`
2. backend идёт в `https://api.bhcesh.me/franchise/details?token=...&kinopoisk_id=...`
3. backend достаёт `iframe_url`
4. frontend вставляет этот URL напрямую в `iframe`

Почему раньше было сломано:

- в ответе `Collaps` нужен именно `iframe_url`
- если искать абстрактный `iframe`, UI может не найти URL и показать весь JSON как ошибку

Сейчас это исправлено в backend-резолвере.

### 5. Где используется proxy

В проекте остаётся low-level роут `GET /proxy?url=...`.

Он нужен для трёх задач:

- ручная диагностика провайдеров
- точечная проксификация HTML/JS/медиа, если позже понадобится добавить нестабильный источник
- единая точка для подмены `Referer`, `Origin`, `User-Agent`, range-заголовков и других сетевых хаков

### 6. Нужен ли `/proxy` вообще

Для текущего основного UI — не для финального воспроизведения.

Сейчас нормальный пользовательский сценарий такой:

- поиск идёт через backend API
- резолв `Alloha` и `Collaps` тоже идёт через backend API
- итоговый iframe грузится браузером напрямую

То есть `/proxy` больше не участвует в стандартном playback flow, но остаётся как технический инструмент и запасной механизм для нестандартных провайдеров.

## Сетевые особенности

В [main.go](/home/eugene/project-go/films/main.go):

- для DNS используется внешний resolver `8.8.8.8`
- для `api.alloha.tv` включён skip TLS verify
- для `api.alloha.tv` и `stloadi.live` можно включить RU upstream proxy через `ALLOHA_UPSTREAM_PROXY_URL`
- для HTML через `/proxy` есть инъекция `<base>` и monkey-patch `fetch/XMLHttpRequest/Image.src`

## Docker и Caddy

### Docker

В [docker-compose.yml](/home/eugene/project-go/films/docker-compose.yml):

- приложение слушает `8282`
- Caddy слушает `80` и `4443`
- Redis поднимается отдельным сервисом
- DNS внутри контейнера выставлен как:
  - `8.8.8.8`
  - `1.1.1.1`

### Redis

Redis нужен для:

- cache upstream API-ответов
- history просмотров
- favorites

Env:

- `REDIS_ADDR`
- `REDIS_PASSWORD`
- `REDIS_DB`
- `LIBRARY_USER_ID`

Routes:

- `GET /api/library/history`
- `DELETE /api/library/history`
- `GET /api/library/favorites`
- `POST /api/library/favorites`
- `DELETE /api/library/favorites?kp=...`

### Caddy

В [Caddyfile](/home/eugene/project-go/films/Caddyfile):

- HTTP редиректится на HTTPS
- HTTPS сейчас поднят на порту `4443`
- backend проксируется на `films:8282`

Если вы в браузере открываете инстанс на `8443`, а compose у вас настроен на `4443`, значит вы смотрите не в этот compose или не в эту сборку.

## Запуск

Локально:

```bash
cd /home/eugene/project-go/films
go run .
```

Docker:

```bash
cd /home/eugene/project-go/films
docker compose up -d --build
```

## Что изменено по сравнению с прошлой версией

- убраны формы ввода API-ключей из интерфейса
- оставлены только `Alloha` и `Collaps`
- поиск и карточка фильма теперь идут через backend
- `Alloha` больше не грузит финальный iframe через `/proxy`
- `Collaps` теперь корректно берёт `iframe_url`
- UI переделан в более удобный single-page просмотрщик
