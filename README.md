# Cinema Deck

Go SPA для поиска фильмов по Kinopoisk, просмотра через несколько iframe-плееров, регистрации пользователей, JWT-авторизации, избранного, истории и админ-панели.

## Структура

- [cmd/films/main.go](/home/eugene/project-go/films/cmd/films/main.go) — entrypoint
- [internal/app/apiserver](/home/eugene/project-go/films/internal/app/apiserver) — backend, auth, providers, Postgres/Redis logic
- [web/index.html](/home/eugene/project-go/films/web/index.html) — SPA frontend
- [migrations](/home/eugene/project-go/films/migrations) — auto migrations
- [docker-compose.yml](/home/eugene/project-go/films/docker-compose.yml) — Postgres, Redis, app, Caddy

## Плееры

Провайдеры перенесены из [token.html](/home/eugene/project-go/films/token.html):

- `Alloha` → `https://harald-as.newplayjj.com/?kp={id}&token=...`
- `Collaps` → `https://api.zenithjs.ws/embed/kp/{id}`
- `HDVB` → backend API resolve `https://apivb.com/api/videos.json?id_kp={id}&token=...`
- `VideoSeeD` → `https://tv-2-kinoserial.net/embed_auto/{id}/?token=...`
- `Vibix` → `https://675812196.videoframe2.com/embed-kp/{id}`
- `Трейлер` → `https://api.atomics.ws/embed/trailer-kp/{id}`

Frontend получает список через `GET /api/providers`, iframe URL через `GET /api/player?provider=...&kp=...`.

## Auth

Postgres хранит:

- пользователей
- email для входа
- роли `user` / `admin`
- избранное
- историю

JWT endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

Admin endpoints:

- `GET /api/admin/stats`
- `GET /api/admin/users`
- `PATCH /api/admin/users/{id}`
- `DELETE /api/admin/users/{id}`
- `GET /api/admin/library?type=favorites|history`

Админ создаётся/обновляется при старте из `.env`:

- `ADMIN_LOGIN`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## Миграции

При запуске backend:

1. подключается к `DATABASE_URL`
2. создаёт `schema_migrations`
3. применяет новые `.sql` из `MIGRATIONS_DIR`
4. создаёт/обновляет admin из env

## Запуск

Docker:

```bash
cd /home/eugene/project-go/films
docker compose up -d --build
```

Локально с Postgres из compose:

```bash
cd /home/eugene/project-go/films
docker compose up -d postgres
DATABASE_URL='postgres://films:films_password@localhost:5432/films?sslmode=disable' REDIS_ADDR='' go run ./cmd/films
```

Сайт: `http://localhost:8282`.
