package httpapi

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"market-replay/internal/bars"
	"market-replay/internal/econ"
	"market-replay/internal/indicators"
	"market-replay/internal/model"
	"market-replay/internal/storage/sqlite"
)

// writeEconFixture writes an economic-calendar shard under dataDir/econ.
// Callers pass whole JSONL lines so a test can include a deliberately
// malformed one.
func writeEconFixture(t *testing.T, dataDir string, lines ...string) {
	t.Helper()
	dir := filepath.Join(dataDir, "econ")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(filepath.Join(dir, "fixture.jsonl"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// writeBinFixture writes a minimal valid RBR1 file directly to disk, for
// httpapi tests that need a real (symbol,tf) dataset behind a
// bars.Registry — small and synthetic, not the real 129MB NQ fixture.
func writeBinFixture(t *testing.T, dataDir, symbol, tf string, n int, startTs uint32) {
	t.Helper()
	buf := make([]byte, 24+24*n)
	copy(buf[0:4], "RBR1")
	binary.LittleEndian.PutUint16(buf[4:6], 1)
	binary.LittleEndian.PutUint16(buf[6:8], 1) // priceAsTicksFlag
	binary.LittleEndian.PutUint32(buf[8:12], uint32(n))
	binary.LittleEndian.PutUint32(buf[12:16], 1) // tickNum
	binary.LittleEndian.PutUint32(buf[16:20], 4) // tickDen -> 1/4 = 0.25

	o := 24
	put := func(v uint32) { binary.LittleEndian.PutUint32(buf[o:], v); o += 4 }
	for i := 0; i < n; i++ {
		put(startTs + uint32(i)*60) // ts, one bar per minute
	}
	for i := 0; i < n; i++ {
		put(uint32(100 + i)) // open
	}
	for i := 0; i < n; i++ {
		put(uint32(102 + i)) // high
	}
	for i := 0; i < n; i++ {
		put(uint32(99 + i)) // low
	}
	for i := 0; i < n; i++ {
		put(uint32(101 + i)) // close
	}
	for i := 0; i < n; i++ {
		put(uint32(10 + i)) // volume
	}

	binDir := filepath.Join(dataDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, symbol+"."+tf+".bin"), buf, 0o644); err != nil {
		t.Fatal(err)
	}
}

// testFixtureStart/testFixtureN are the NQ/1m fixture's parameters, shared
// by every test in this package that needs to compute expected values.
const (
	testFixtureStart = uint32(1_600_000_000)
	testFixtureN     = 20
)

// newTestServer wires a Server against a small synthetic NQ/1m fixture
// (testFixtureN bars starting at testFixtureStart) plus a fresh SQLite
// store, both under t.TempDir().
func newTestServer(t *testing.T) *Server {
	t.Helper()
	server, _ := newTestServerWithDataDir(t)
	return server
}

// newTestServerWithDataDir is newTestServer plus the data directory, for
// tests that rewrite the dataset on disk and reload it.
func newTestServerWithDataDir(t *testing.T) (*Server, string) {
	t.Helper()
	return buildTestServer(t, nil)
}

// newEconTestServer is newTestServer with an economic-calendar shard, given
// as whole JSONL lines so a test can supply a deliberately malformed one.
func newEconTestServer(t *testing.T, econLines ...string) *Server {
	t.Helper()
	server, _ := buildTestServer(t, econLines)
	return server
}

func buildTestServer(t *testing.T, econLines []string) (*Server, string) {
	t.Helper()
	dataDir := t.TempDir()
	writeBinFixture(t, dataDir, "NQ", "1m", testFixtureN, testFixtureStart)
	if len(econLines) > 0 {
		writeEconFixture(t, dataDir, econLines...)
	}

	metaDir := filepath.Join(dataDir, "meta")
	if err := os.MkdirAll(metaDir, 0o755); err != nil {
		t.Fatal(err)
	}
	symbols := []model.SymbolMeta{{Symbol: "NQ", Name: "E-mini Nasdaq-100", TickSize: 0.25, PointValue: 20}}
	b, err := json.Marshal(symbols)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(metaDir, "symbols.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}

	reg, err := bars.NewRegistry(dataDir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	t.Cleanup(func() { reg.Close() })

	// Optional dataset: absent unless the caller supplied shard lines.
	calendar, err := econ.Open(dataDir)
	if err != nil {
		t.Fatalf("econ.Open: %v", err)
	}

	store, err := sqlite.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatalf("sqlite.Open: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Init(context.Background()); err != nil {
		t.Fatalf("Init: %v", err)
	}

	ind := indicators.NewEngine()
	if err := indicators.RegisterBuiltins(ind); err != nil {
		t.Fatalf("RegisterBuiltins: %v", err)
	}

	return &Server{Registry: reg, Store: store, Econ: calendar, Indicators: ind}, dataDir
}
