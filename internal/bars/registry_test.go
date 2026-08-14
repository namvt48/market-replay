package bars

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"market-replay/internal/model"
)

// setupRegistryFixture writes a minimal dataDir/{bin,meta} layout: one
// symbol.tf.bin fixture plus a matching symbols.json (tick size 1/4=0.25,
// matching buildFixture's hardcoded tickNum/tickDen).
func setupRegistryFixture(t *testing.T, symbol, tf string, n int) string {
	t.Helper()
	dataDir := t.TempDir()
	binDir := filepath.Join(dataDir, "bin")
	metaDir := filepath.Join(dataDir, "meta")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(metaDir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(binDir, symbol+"."+tf+".bin"), simpleFixture(n, 1000, 60), 0o644); err != nil {
		t.Fatal(err)
	}
	symbols := []model.SymbolMeta{{Symbol: symbol, TickSize: 0.25, PointValue: 20}}
	b, err := json.Marshal(symbols)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(metaDir, "symbols.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}
	return dataDir
}

// writeSymbolsFixture rewrites symbols.json to register several symbols, for
// tests that need more than one dataset in the directory.
func writeSymbolsFixture(t *testing.T, dataDir string, names ...string) {
	t.Helper()
	symbols := make([]model.SymbolMeta, 0, len(names))
	for _, name := range names {
		symbols = append(symbols, model.SymbolMeta{Symbol: name, TickSize: 0.25, PointValue: 20})
	}
	b, err := json.Marshal(symbols)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "meta", "symbols.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRegistry_BasicLoadAndGet(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 5)
	reg, err := NewRegistry(dataDir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	defer reg.Close()

	var gotCount int
	err = reg.WithDataset("NQ", "1m", func(f *BarFile, cal *Calendar, _ string) error {
		gotCount = f.Count()
		return nil
	})
	if err != nil {
		t.Fatalf("WithDataset: %v", err)
	}
	if gotCount != 5 {
		t.Errorf("Count = %d, want 5", gotCount)
	}
	if len(reg.Symbols()) != 1 || reg.Symbols()[0].Symbol != "NQ" {
		t.Errorf("Symbols() = %+v, unexpected", reg.Symbols())
	}
}

func TestOpenDatasetReleasesResidentPagesAfterBuildingIndexes(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 5)
	binPath := filepath.Join(dataDir, "bin", "NQ.1m.bin")
	original := discardMappedPages
	calls := 0
	discardMappedPages = func(*BarFile) error {
		calls++
		return nil
	}
	t.Cleanup(func() { discardMappedPages = original })

	loaded := openDataset(binPath, model.SymbolMeta{Symbol: "NQ", TickSize: 0.25}, "NQ", "1m")
	if loaded.err != nil {
		t.Fatalf("openDataset: %v", loaded.err)
	}
	defer loaded.file.Close()
	if calls != 1 {
		t.Fatalf("discardMappedPages calls = %d, want 1", calls)
	}
}

func TestRegistry_UnknownSymbolTF(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 5)
	reg, err := NewRegistry(dataDir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	defer reg.Close()

	err = reg.WithDataset("ES", "1m", func(*BarFile, *Calendar, string) error { return nil })
	if !errors.Is(err, ErrUnknownSymbolTF) {
		t.Fatalf("err = %v, want ErrUnknownSymbolTF", err)
	}
}

func TestRegistry_TickSizeMismatchFailsFast(t *testing.T) {
	dataDir := t.TempDir()
	binDir := filepath.Join(dataDir, "bin")
	metaDir := filepath.Join(dataDir, "meta")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(metaDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "NQ.1m.bin"), simpleFixture(5, 1000, 60), 0o644); err != nil {
		t.Fatal(err)
	}
	// symbols.json claims a tick size that disagrees with the fixture's
	// hardcoded 1/4 (0.25).
	symbols := []model.SymbolMeta{{Symbol: "NQ", TickSize: 0.1}}
	b, err := json.Marshal(symbols)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(metaDir, "symbols.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := NewRegistry(dataDir); err == nil {
		t.Fatal("NewRegistry succeeded despite tick size mismatch, want error")
	}
}

func TestRegistry_ReloadPicksUpNewData(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 5)
	reg, err := NewRegistry(dataDir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	defer reg.Close()

	newData := simpleFixture(8, 1000, 60)
	if err := os.WriteFile(filepath.Join(dataDir, "bin", "NQ.1m.bin"), newData, 0o644); err != nil {
		t.Fatal(err)
	}
	if errs := reg.Reload(); len(errs) != 0 {
		t.Fatalf("Reload errors: %v", errs)
	}

	var gotCount int
	if err := reg.WithDataset("NQ", "1m", func(f *BarFile, cal *Calendar, _ string) error {
		gotCount = f.Count()
		return nil
	}); err != nil {
		t.Fatalf("WithDataset: %v", err)
	}
	if gotCount != 8 {
		t.Errorf("Count after reload = %d, want 8", gotCount)
	}
}

func TestRegistry_ReloadKeepsOldDataOnCorruptFile(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 5)
	reg, err := NewRegistry(dataDir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	defer reg.Close()

	// Simulate a partial rsync: file now truncated/corrupt.
	if err := os.WriteFile(filepath.Join(dataDir, "bin", "NQ.1m.bin"), []byte("garbage"), 0o644); err != nil {
		t.Fatal(err)
	}
	errs := reg.Reload()
	if len(errs) != 1 {
		t.Fatalf("Reload errors = %v, want exactly 1", errs)
	}

	var gotCount int
	if err := reg.WithDataset("NQ", "1m", func(f *BarFile, cal *Calendar, _ string) error {
		gotCount = f.Count()
		return nil
	}); err != nil {
		t.Fatalf("WithDataset after failed reload: %v", err)
	}
	if gotCount != 5 {
		t.Errorf("Count after failed reload = %d, want 5 (old data preserved)", gotCount)
	}
}

// TestRegistry_ConcurrentReadDuringReload is the correctness test for the
// RWMutex-per-slot design. Run with -race: if Reload() ever closed
// (munmap'd) a file while a reader still held a slice into it, this would
// either crash the process outright or be flagged as a race.
func TestRegistry_ConcurrentReadDuringReload(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 100)
	reg, err := NewRegistry(dataDir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	defer reg.Close()

	var wg sync.WaitGroup
	stop := make(chan struct{})

	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				_ = reg.WithDataset("NQ", "1m", func(f *BarFile, cal *Calendar, _ string) error {
					var sink int64
					for i := 0; i < f.Count(); i++ {
						sink += f.TsAt(i) + int64(f.OpenAt(i)) + int64(f.HighAt(i)) + int64(f.LowAt(i)) + int64(f.CloseAt(i)) + int64(f.VolumeAt(i))
					}
					_ = sink
					return nil
				})
			}
		}()
	}

	for i := 0; i < 20; i++ {
		data := simpleFixture(100+i, 1000, 60)
		if err := os.WriteFile(filepath.Join(dataDir, "bin", "NQ.1m.bin"), data, 0o644); err != nil {
			t.Fatal(err)
		}
		if errs := reg.Reload(); len(errs) != 0 {
			t.Fatalf("Reload errors: %v", errs)
		}
	}
	close(stop)
	wg.Wait()
}

// TestRegistry_CorrectsAdvertisedRanges — the .bin is the only real answer to
// "which bars exist"; symbols.json's ranges are derived metadata a pipeline run
// can leave stale. The client picks its opening window from that range, so a
// stale value sends it seeking outside the data with nothing on the server
// saying why.
func TestRegistry_CorrectsAdvertisedRanges(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 5)
	// Rewrite symbols.json with a range that does not match the fixture.
	metaPath := filepath.Join(dataDir, "meta", "symbols.json")
	raw, err := os.ReadFile(metaPath)
	if err != nil {
		t.Fatal(err)
	}
	var symbols []model.SymbolMeta
	if err := json.Unmarshal(raw, &symbols); err != nil {
		t.Fatal(err)
	}
	symbols[0].Ranges = map[string]model.Range{"1m": {From: 1, To: 2}}
	patched, err := json.Marshal(symbols)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(metaPath, patched, 0o644); err != nil {
		t.Fatal(err)
	}

	reg, err := NewRegistry(dataDir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	defer reg.Close()

	var wantFrom, wantTo int64
	if err := reg.WithDataset("NQ", "1m", func(f *BarFile, _ *Calendar, _ string) error {
		wantFrom, wantTo = f.TsAt(0), f.TsAt(f.Count()-1)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	got := reg.Symbols()[0].Ranges["1m"]
	if got.From != wantFrom || got.To != wantTo {
		t.Errorf("advertised range = %d..%d, want the file's %d..%d", got.From, got.To, wantFrom, wantTo)
	}
	warnings := reg.Warnings()
	if len(warnings) == 0 || !strings.Contains(warnings[0], "NQ/1m") {
		t.Errorf("warnings = %v, want the drift reported", warnings)
	}

	// Extending the dataset and reloading must re-advertise the new last bar,
	// or the client keeps opening at a window that is no longer the edge.
	if err := os.WriteFile(filepath.Join(dataDir, "bin", "NQ.1m.bin"), simpleFixture(9, 1000, 60), 0o644); err != nil {
		t.Fatal(err)
	}
	if errs := reg.Reload(); len(errs) != 0 {
		t.Fatalf("Reload: %v", errs)
	}
	if got := reg.Symbols()[0].Ranges["1m"]; got.To != 1000+8*60 {
		t.Errorf("range after reload = %d..%d, want the extended last bar %d", got.From, got.To, 1000+8*60)
	}
}

// TestRegistry_ReportsUnusableSessionIndex — a stale .idx used to be silent:
// the daily index was dropped and daily/weekly/monthly aggregation reverted to
// scanning raw bars, twenty times slower, with nothing anywhere saying so.
func TestRegistry_ReportsUnusableSessionIndex(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 5)
	// A session claiming bars past the end of a 5-bar file.
	idx := `{"2024-01-01":{"offset":0,"count":99}}`
	if err := os.WriteFile(filepath.Join(dataDir, "bin", "NQ.1m.idx"), []byte(idx), 0o644); err != nil {
		t.Fatal(err)
	}

	reg, err := NewRegistry(dataDir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	defer reg.Close()

	warnings := reg.Warnings()
	found := false
	for _, warning := range warnings {
		if strings.Contains(warning, "session index") && strings.Contains(warning, "NQ/1m") {
			found = true
		}
	}
	if !found {
		t.Fatalf("warnings = %v, want the unusable session index reported", warnings)
	}
}

// TestRegistry_LoadsDatasetsConcurrently checks the property parallel loading
// depends on: every dataset ends up in its own slot with its own data, however
// the goroutines interleaved.
func TestRegistry_LoadsDatasetsConcurrently(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 5)
	// A second and third symbol, each with a distinct bar count.
	writeSymbolsFixture(t, dataDir, "NQ", "ES", "YM")
	if err := os.WriteFile(filepath.Join(dataDir, "bin", "ES.1m.bin"), simpleFixture(7, 2000, 60), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "bin", "YM.1m.bin"), simpleFixture(11, 3000, 60), 0o644); err != nil {
		t.Fatal(err)
	}

	reg, err := NewRegistry(dataDir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	defer reg.Close()

	for symbol, wantCount := range map[string]int{"NQ": 5, "ES": 7, "YM": 11} {
		var got int
		if err := reg.WithDataset(symbol, "1m", func(f *BarFile, _ *Calendar, _ string) error {
			got = f.Count()
			return nil
		}); err != nil {
			t.Fatalf("WithDataset(%s): %v", symbol, err)
		}
		if got != wantCount {
			t.Errorf("%s has %d bars, want %d — a slot got another symbol's file", symbol, got, wantCount)
		}
	}
}

// TestRegistry_ReportsTheFirstFailureInPathOrder — with several datasets
// opening at once, the same broken directory has to produce the same error
// every time, not whichever goroutine happened to fail first.
func TestRegistry_ReportsTheFirstFailureInPathOrder(t *testing.T) {
	dataDir := setupRegistryFixture(t, "NQ", "1m", 5)
	writeSymbolsFixture(t, dataDir, "NQ", "ES", "YM")
	// Both are corrupt; ES sorts before YM, so ES must always be reported.
	for _, symbol := range []string{"ES", "YM"} {
		if err := os.WriteFile(filepath.Join(dataDir, "bin", symbol+".1m.bin"), []byte("garbage"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for attempt := 0; attempt < 20; attempt++ {
		_, err := NewRegistry(dataDir)
		if err == nil {
			t.Fatal("NewRegistry accepted corrupt files")
		}
		if !strings.Contains(err.Error(), "ES.1m.bin") {
			t.Fatalf("attempt %d reported %v, want the first path in order (ES)", attempt, err)
		}
	}
}
