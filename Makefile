BINARY := bin/replay-server

.PHONY: build web-install web-build web-dev vet test test-race run clean

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

clean:
	rm -f $(BINARY)
