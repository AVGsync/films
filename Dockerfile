FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY migrations ./migrations
COPY web ./web

RUN CGO_ENABLED=0 GOOS=linux go build -o films-server ./cmd/films

FROM alpine:3.20

WORKDIR /app

COPY --from=builder /app/films-server ./films-server
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/web ./web

ENV PORT=8282
ENV WEB_DIR=web
ENV MIGRATIONS_DIR=migrations

EXPOSE 8282

CMD ["./films-server"]
