BINARY := bin/replay-server
DEPLOY_HOST ?= root@194.163.187.250
DEPLOY_DIR ?= /root/market-replay
# Optional overrides — left empty, pipeline/export_econ_duckdb.py falls back
# to config.yaml's pipeline.econ_duckdb / pipeline.econ_jsonl (the canonical
# source of these paths; see config.yaml).
ECON_DUCKDB ?=
ECON_JSONL ?=

# desktop/ pins Electron and keeps its dependency cache inside the repository.
.PHONY: build web-install web-build web-dev vet test test-race run deploy deploy-local econ-import econ-reload clean desktop-build desktop-run

WEB_PNPM_STORE := $(CURDIR)/.cache/pnpm
DESKTOP_NPM_CACHE := $(CURDIR)/desktop/.npm-cache
DESKTOP_ELECTRON_CACHE := $(CURDIR)/.cache/electron

desktop-build: web-build
	CGO_ENABLED=0 go build -buildvcs=false -o $(BINARY) ./cmd/server
	cd desktop && npm ci --cache "$(DESKTOP_NPM_CACHE)"
	cd desktop && electron_config_cache="$(DESKTOP_ELECTRON_CACHE)" ./node_modules/.bin/install-electron --no

desktop-run: desktop-build
	cd desktop && npm start
web-install:
	cd web && pnpm install --store-dir "$(WEB_PNPM_STORE)"

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

# Deploy the tracked source to the VPS and replace its Compose service. Runtime
# data and the vendor submodule are deliberately left in place on the server.
deploy:
	rsync -az --exclude '.archcore/' --exclude '.claude/' --exclude '.codegraph/' --exclude '.impeccable/' --exclude '.omo/' --exclude '.git/' --exclude 'bin/' --exclude 'data/' --exclude 'web/node_modules/' --exclude 'web/dist/' --exclude 'web/vendor/lightweight-charts-drawing/' ./ $(DEPLOY_HOST):$(DEPLOY_DIR)/
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_DIR) && docker compose up -d --build && docker compose ps'

# Use this only when the current machine itself is the deployment host.
deploy-local:
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
