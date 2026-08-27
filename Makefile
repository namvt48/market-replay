BINARY := bin/replay-server
# Optional overrides — left empty, pipeline/export_econ_duckdb.py falls back
# to config.yaml's pipeline.econ_duckdb / pipeline.econ_jsonl (the canonical
# source of these paths; see config.yaml).
ECON_DUCKDB ?=
ECON_JSONL ?=

.PHONY: build web-install web-build web-dev vet test test-race run deploy econ-import econ-reload clean

web-install:
	cd web && pnpm install

web-build: web-install
	cd web && pnpm build

web-dev:
	cd web && pnpm dev

# The Go binary embeds web/dist (web/embed.go) — it must exist and be
# current before `go build` runs, so the frontend always builds first.
build: web-build
	CGO_ENABLED=0 go build -buildvcs=false -o $(BINARY) ./cmd/server

vet:
	go vet ./...

test:
	go test ./...

test-race:
	go test -race ./...

run: build
	./$(BINARY)

# Build the production image and replace the local Compose service. The
# frontend is embedded into the Go binary by the Docker build, so this is the
# single deploy entrypoint for the server.
deploy:
	docker compose up -d --build
	docker compose ps

# Convert the normalized UTC DuckDB calendar into the spoiler-safe JSONL
# source consumed by internal/econ. The exporter replaces the shard atomically.
econ-import:
	python3 pipeline/export_econ_duckdb.py \
		$(if $(ECON_DUCKDB),--db "$(ECON_DUCKDB)") \
		$(if $(ECON_JSONL),--out "$(ECON_JSONL)")

# Import and hot-reload a running Compose service without rebuilding the image.
econ-reload: econ-import
	docker compose kill -s HUP app

clean:
	rm -f $(BINARY)
