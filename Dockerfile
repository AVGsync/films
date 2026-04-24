FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download

COPY main.go index.html ./

RUN CGO_ENABLED=0 GOOS=linux go build -o films-server main.go

FROM alpine:3.20

WORKDIR /app

COPY --from=builder /app/films-server ./films-server
COPY --from=builder /app/index.html ./index.html

ENV PORT=8282

EXPOSE 8282

CMD ["./films-server"]
