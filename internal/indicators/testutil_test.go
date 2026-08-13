package indicators

import (
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"market-replay/internal/bars"
	"market-replay/internal/model"
)

// barSpec is one synthetic bar's raw (already tick-scaled) OHLCV values —
// building fixtures from explicit specs, rather than a generated ramp,
// keeps every test's expected output hand-computable.
type barSpec struct {
	ts                     int64
	open, high, low, close int32
	volume                 uint32
}

// writeBinFixture writes a minimal valid RBR1 file directly to disk.
// Mirrors internal/httpapi/testutil_test.go's helper of the same name and
// byte layout — duplicated rather than shared, since it's an unexported
// test-only helper local to each package.
func writeBinFixture(t *testing.T, dataDir, symbol, tf string, specs []barSpec, tickNum, tickDen uint32) {
	t.Helper()
	n := len(specs)
	buf := make([]byte, 24+24*n)
	copy(buf[0:4], "RBR1")
	binary.LittleEndian.PutUint16(buf[4:6], 1)
	binary.LittleEndian.PutUint16(buf[6:8], 1) // priceAsTicksFlag
	binary.LittleEndian.PutUint32(buf[8:12], uint32(n))
	binary.LittleEndian.PutUint32(buf[12:16], tickNum)
	binary.LittleEndian.PutUint32(buf[16:20], tickDen)

	o := 24
	put := func(v uint32) { binary.LittleEndian.PutUint32(buf[o:], v); o += 4 }
	for _, s := range specs {
		put(uint32(s.ts))
	}
	for _, s := range specs {
		put(uint32(s.open))
	}
	for _, s := range specs {
		put(uint32(s.high))
	}
	for _, s := range specs {
		put(uint32(s.low))
	}
	for _, s := range specs {
		put(uint32(s.close))
	}
	for _, s := range specs {
		put(s.volume)
	}

	binDir := filepath.Join(dataDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, symbol+"."+tf+".bin"), buf, 0o644); err != nil {
		t.Fatal(err)
	}
}

// tickSizeToFraction converts a decimal tick size (1, 0.25, ...) into the
// RBR1 header's integer tickNum/tickDen fraction. Every fixture in this
// package uses a tick size that is exactly 1 or exactly 1/den, which is
// all this needs to cover.
func tickSizeToFraction(tickSize float64) (num, den uint32) {
	if tickSize >= 1 {
		return uint32(tickSize), 1
	}
	return 1, uint32(1/tickSize + 0.5)
}

// openFixtureFile builds a one-symbol, one-timeframe registry from specs
// under a fresh temp dir and returns the opened *bars.BarFile plus the
// SymbolMeta it was registered with. The registry (and its mmap) stays
// open for the test's lifetime via t.Cleanup.
func openFixtureFile(t *testing.T, symbol, tf string, specs []barSpec, meta model.SymbolMeta) *bars.BarFile {
	t.Helper()
	tickNum, tickDen := tickSizeToFraction(meta.TickSize)
	dataDir := t.TempDir()
	writeBinFixture(t, dataDir, symbol, tf, specs, tickNum, tickDen)

	meta.Symbol = symbol
	metaDir := filepath.Join(dataDir, "meta")
	if err := os.MkdirAll(metaDir, 0o755); err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal([]model.SymbolMeta{meta})
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

	var file *bars.BarFile
	if err := reg.WithDataset(symbol, tf, func(f *bars.BarFile, _ *bars.Calendar, _ string) error {
		file = f
		return nil
	}); err != nil {
		t.Fatalf("WithDataset: %v", err)
	}
	return file
}

// linearSpecs builds n one-minute-apart bars starting at startTs, each with
// a distinct, easily hand-computed OHLCV shape — enough to exercise window
// clamping and plot/draw plumbing without needing session-time semantics.
func linearSpecs(startTs int64, n int) []barSpec {
	specs := make([]barSpec, n)
	for i := range specs {
		specs[i] = barSpec{
			ts:   startTs + int64(i)*60,
			open: int32(1000 + i), high: int32(1005 + i),
			low: int32(995 + i), close: int32(1001 + i),
			volume: uint32(10 + i),
		}
	}
	return specs
}
