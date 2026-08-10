// Command server runs the market-replay HTTP API and static frontend: a
// single process, reading pre-compiled bar data via mmap and persisting
// sessions/trades/watchlist/drawings to SQLite (docs §4.2 — zero other
// runtime dependency, zero calls out to any market data API).
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // Keep session-aware chart aggregation portable in the minimal container.

	"market-replay/internal/bars"
	"market-replay/internal/config"
	"market-replay/internal/econ"
	"market-replay/internal/httpapi"
	"market-replay/internal/storage/sqlite"
	"market-replay/web"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	reg, err := bars.NewRegistry(cfg.DataDir)
	if err != nil {
		log.Fatalf("bars: %v", err)
	}
	defer reg.Close()
	// Non-fatal data problems: a stale advertised range, or an .idx no session
	// index could be built from. Both serve correct bars, so they must not stop
	// the server — but neither may they stay invisible, since one sends the
	// client seeking outside the data and the other silently costs 20x on
	// daily/weekly/monthly aggregation.
	for _, warning := range reg.Warnings() {
		log.Printf("bars: %s", warning)
	}

	// Optional dataset: Open only fails on malformed content, never on a
	// missing directory, so an install without a calendar starts normally.
	calendar, err := econ.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("econ: %v", err)
	}

	store, err := sqlite.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("storage: %v", err)
	}
	defer store.Close()
	if err := store.Init(context.Background()); err != nil {
		log.Fatalf("storage init: %v", err)
	}

	srv := &httpapi.Server{Registry: reg, Store: store, Econ: calendar, WebFS: web.DistFS}
	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("market-replay listening on %s (data=%s)", cfg.HTTPAddr, cfg.DataDir)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()

	// SIGHUP triggers a zero-downtime data reload (docs §6.3): the owner
	// rsyncs new .bin files then signals the running process. A failed
	// reload logs every error and keeps serving whatever was already
	// loaded — it must never take the server down.
	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	go func() {
		for range hup {
			errs := reg.Reload()
			// The calendar reloads on the same signal: the pipeline appends
			// next week's releases alongside new bars, and a failure here
			// keeps the previously loaded calendar serving.
			if err := calendar.Reload(); err != nil {
				errs = append(errs, err)
			}
			for _, warning := range reg.Warnings() {
				log.Printf("reload: %s", warning)
			}
			if len(errs) == 0 {
				log.Printf("reload: ok")
				continue
			}
			for _, e := range errs {
				log.Printf("reload: %v", e)
			}
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
