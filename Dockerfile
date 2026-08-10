# syntax=docker/dockerfile:1

# ---- Stage 1: frontend build ---------------------------------------------
# Produces web/dist, which the Go build stage embeds (web/embed.go). The
# vendored drawing plugin (web/vendor/lightweight-charts-drawing) is a
# `file:` pnpm dependency with its dist/ already committed, so no build
# step is needed for it here — just the copy.
FROM node:22-alpine AS web-build
WORKDIR /app/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
COPY web/vendor ./vendor
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# ---- Stage 2: Go build -----------------------------------------------------
# Only cmd/, internal/, go.mod/go.sum and web/embed.go are needed — the Go
# build never touches the frontend source, only the built web/dist output.
FROM golang:1.26-alpine AS go-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY web/embed.go ./web/embed.go
COPY --from=web-build /app/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=linux go build -buildvcs=false -o /out/replay-server ./cmd/server

# ---- Stage 3: runtime -------------------------------------------------------
# Static binary (CGO_ENABLED=0, pure-Go modernc.org/sqlite) needs nothing
# beyond CA certs and a non-root user; mirrors deploy/replay.service's
# /srv/replay layout so the two deploy paths stay easy to reason about
# together.
FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates wget \
    && addgroup -S replay && adduser -S replay -G replay
WORKDIR /srv/replay
COPY --from=go-build /out/replay-server ./replay-server
RUN mkdir -p /srv/replay/data && chown -R replay:replay /srv/replay
USER replay

ENV HTTP_ADDR=:8080 \
    DATA_DIR=/srv/replay/data \
    DB_PATH=/srv/replay/data/app.db

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["./replay-server"]
