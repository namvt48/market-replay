package bars

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// rollCacheFixture writes a real .bin + .idx pair into a temp dir and returns
// the paths plus the fully indexed file they describe — the same inputs
// openDataset works from.
func rollCacheFixture(t *testing.T) (binPath, idxPath string, file *BarFile, calendar *Calendar) {
	t.Helper()
	const sessions, barsPerSession = 6, 24 * 60
	data := simpleFixture(sessions*barsPerSession, 1_700_000_000, 60)

	dir := t.TempDir()
	binPath = filepath.Join(dir, "ZZ.1m.bin")
	if err := os.WriteFile(binPath, data, 0o644); err != nil {
		t.Fatal(err)
	}
	raw := make(map[string]idxEntry, sessions)
	for i := 0; i < sessions; i++ {
		raw[fmt.Sprintf("2023-11-%02d", 14+i)] = idxEntry{Offset: i * barsPerSession, Count: barsPerSession}
	}
	idxPath = filepath.Join(dir, "ZZ.1m.idx")
	writeIdxFile(t, idxPath, raw)

	file, err := newIndexedBarFile(data, time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	if calendar, err = loadCalendar(idxPath); err != nil {
		t.Fatal(err)
	}
	if rejected := file.attachCalendarRollup(calendar, indexPlan{rollups: true, location: time.UTC}); rejected != "" {
		t.Fatalf("calendar rejected: %s", rejected)
	}
	if len(file.rollups.hourly) == 0 || len(file.rollups.rthHourly) == 0 || len(file.rollups.daily) == 0 {
		t.Fatalf("fixture produced an empty index (%d hourly, %d rth, %d daily)",
			len(file.rollups.hourly), len(file.rollups.rthHourly), len(file.rollups.daily))
	}
	return binPath, idxPath, file, calendar
}

func fixtureFingerprint(t *testing.T, binPath, idxPath string, file *BarFile) rollFingerprint {
	t.Helper()
	hash, err := file.scanTimestamps()
	if err != nil {
		t.Fatal(err)
	}
	fingerprint, err := newRollFingerprint(binPath, idxPath, file.Count(), hash, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	return fingerprint
}

func assertSameRollups(t *testing.T, got, want *rollups) {
	t.Helper()
	for _, index := range []struct {
		name      string
		got, want []rollupBar
	}{
		{"hourly", got.hourly, want.hourly},
		{"rthHourly", got.rthHourly, want.rthHourly},
		{"rthDaily", got.rthDaily, want.rthDaily},
		{"daily", got.daily, want.daily},
	} {
		if len(index.got) != len(index.want) {
			t.Fatalf("%s: %d entries, want %d", index.name, len(index.got), len(index.want))
		}
		for i := range index.want {
			if index.got[i] != index.want[i] {
				t.Fatalf("%s entry %d = %+v, want %+v", index.name, i, index.got[i], index.want[i])
			}
		}
	}
}

func TestRollupCacheRoundTrip(t *testing.T) {
	binPath, idxPath, file, calendar := rollCacheFixture(t)
	fingerprint := fixtureFingerprint(t, binPath, idxPath, file)
	cachePath := rollupCachePath(binPath)

	if reason := storeRollupCache(cachePath, fingerprint, file.rollups); reason != "" {
		t.Fatalf("store: %s", reason)
	}
	cached, reason := loadRollupCache(cachePath, fingerprint, file.Count(), len(calendar.dates))
	if reason != "" {
		t.Fatalf("load: %s", reason)
	}
	if cached == nil {
		t.Fatal("no rollups loaded from a cache just written")
	}
	assertSameRollups(t, cached, file.rollups)
}

func TestRollupCacheMissingFileIsSilent(t *testing.T) {
	binPath, idxPath, file, calendar := rollCacheFixture(t)
	fingerprint := fixtureFingerprint(t, binPath, idxPath, file)

	cached, reason := loadRollupCache(rollupCachePath(binPath), fingerprint, file.Count(), len(calendar.dates))
	if cached != nil {
		t.Fatal("loaded rollups from a cache that does not exist")
	}
	// A first run is not a data problem, so it must not reach the operator's
	// warning log.
	if reason != "" {
		t.Errorf("absent cache reported %q, want no warning", reason)
	}
}

// TestRollupCacheRejectsStaleInputs is the safety property the whole cache
// rests on: every input the rollups were derived from is fingerprinted, so
// changing any one of them makes the sidecar unusable rather than a source of
// bars that no longer exist.
func TestRollupCacheRejectsStaleInputs(t *testing.T) {
	cases := map[string]func(t *testing.T, binPath, idxPath string, want *rollFingerprint){
		"bin rewritten": func(t *testing.T, binPath, _ string, _ *rollFingerprint) {
			touch(t, binPath)
		},
		"idx rewritten": func(t *testing.T, _, idxPath string, _ *rollFingerprint) {
			touch(t, idxPath)
		},
		"idx removed": func(t *testing.T, _, idxPath string, _ *rollFingerprint) {
			if err := os.Remove(idxPath); err != nil {
				t.Fatal(err)
			}
		},
		"bar count changed": func(_ *testing.T, _, _ string, want *rollFingerprint) {
			want.barCount++
		},
		"timeline changed": func(_ *testing.T, _, _ string, want *rollFingerprint) {
			want.tsHash++
		},
		"session timezone changed": func(_ *testing.T, _, _ string, want *rollFingerprint) {
			want.sessionTz = "America/New_York"
		},
		"rth window changed": func(_ *testing.T, _, _ string, want *rollFingerprint) {
			want.rthCloseMinute = 15 * 60
		},
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			binPath, idxPath, file, calendar := rollCacheFixture(t)
			written := fixtureFingerprint(t, binPath, idxPath, file)
			cachePath := rollupCachePath(binPath)
			if reason := storeRollupCache(cachePath, written, file.rollups); reason != "" {
				t.Fatalf("store: %s", reason)
			}

			want := written
			mutate(t, binPath, idxPath, &want)
			// Re-stat after a mutation that touched the files themselves.
			restated, err := newRollFingerprint(binPath, idxPath, int(want.barCount), want.tsHash, want.sessionTz)
			if err != nil {
				t.Fatal(err)
			}
			restated.rthCloseMinute = want.rthCloseMinute
			restated.rthOpenMinute = want.rthOpenMinute

			cached, reason := loadRollupCache(cachePath, restated, file.Count(), len(calendar.dates))
			if cached != nil {
				t.Fatal("accepted a cache built from inputs that have since changed")
			}
			if reason == "" {
				t.Error("rejected the cache without saying why")
			}
			t.Log(reason)
		})
	}
}

func TestRollupCacheRejectsDamagedFile(t *testing.T) {
	binPath, idxPath, file, calendar := rollCacheFixture(t)
	fingerprint := fixtureFingerprint(t, binPath, idxPath, file)
	cachePath := rollupCachePath(binPath)
	if reason := storeRollupCache(cachePath, fingerprint, file.rollups); reason != "" {
		t.Fatalf("store: %s", reason)
	}
	good, err := os.ReadFile(cachePath)
	if err != nil {
		t.Fatal(err)
	}

	cases := map[string]func(raw []byte) []byte{
		"empty":          func([]byte) []byte { return nil },
		"header only":    func(raw []byte) []byte { return raw[:rollHeaderFixed] },
		"truncated body": func(raw []byte) []byte { return raw[:len(raw)-rollEntrySize/2] },
		"bad magic":      func(raw []byte) []byte { out := clone(raw); copy(out[0:4], "XXXX"); return out },
		"future version": func(raw []byte) []byte {
			out := clone(raw)
			binary.LittleEndian.PutUint16(out[4:6], rollVersion+1)
			return out
		},
		"flipped bit": func(raw []byte) []byte { out := clone(raw); out[len(out)-9] ^= 0x40; return out },
		"inflated count": func(raw []byte) []byte {
			out := clone(raw)
			binary.LittleEndian.PutUint32(out[56:60], 1<<30)
			return out
		},
		"garbage":          func([]byte) []byte { return []byte("this is not a rollup index at all, not even close") },
		"tz len past body": func(raw []byte) []byte { out := clone(raw); binary.LittleEndian.PutUint16(out[6:8], 60000); return out },
	}

	for name, damage := range cases {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(cachePath, damage(good), 0o644); err != nil {
				t.Fatal(err)
			}
			cached, reason := loadRollupCache(cachePath, fingerprint, file.Count(), len(calendar.dates))
			if cached != nil {
				t.Fatal("accepted a damaged cache")
			}
			if reason == "" {
				t.Error("rejected a damaged cache without saying why")
			}
			t.Log(reason)
		})
	}
}

// TestRollupCacheRejectsStructurallyImpossibleIndex covers the case the
// fingerprint and CRC cannot: a sidecar that is internally consistent but
// describes ranges the aggregator's binary searches would walk off the end
// of, or an hourly index that does not partition the file.
func TestRollupCacheRejectsStructurallyImpossibleIndex(t *testing.T) {
	binPath, idxPath, file, calendar := rollCacheFixture(t)
	fingerprint := fixtureFingerprint(t, binPath, idxPath, file)
	cachePath := rollupCachePath(binPath)

	cases := map[string]func(source *rollups) *rollups{
		"hourly out of bounds": func(source *rollups) *rollups {
			out := cloneRollups(source)
			out.hourly[len(out.hourly)-1].to = int32(file.Count() + 1)
			return out
		},
		"hourly gap": func(source *rollups) *rollups {
			out := cloneRollups(source)
			out.hourly = append(out.hourly[:2], out.hourly[3:]...)
			return out
		},
		"rth overlapping": func(source *rollups) *rollups {
			out := cloneRollups(source)
			out.rthHourly[3].from = out.rthHourly[2].from
			return out
		},
		"empty entry": func(source *rollups) *rollups {
			out := cloneRollups(source)
			out.rthDaily[1].to = out.rthDaily[1].from
			return out
		},
		"daily count disagrees with the calendar": func(source *rollups) *rollups {
			out := cloneRollups(source)
			out.daily = out.daily[:len(out.daily)-1]
			return out
		},
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			if reason := storeRollupCache(cachePath, fingerprint, mutate(file.rollups)); reason != "" {
				t.Fatalf("store: %s", reason)
			}
			cached, reason := loadRollupCache(cachePath, fingerprint, file.Count(), len(calendar.dates))
			if cached != nil {
				t.Fatal("accepted an index the aggregator cannot safely read")
			}
			if reason == "" {
				t.Error("rejected the index without saying why")
			}
			t.Log(reason)
		})
	}
}

func TestStoreRollupCacheOnReadOnlyDirectory(t *testing.T) {
	binPath, idxPath, file, _ := rollCacheFixture(t)
	fingerprint := fixtureFingerprint(t, binPath, idxPath, file)
	dir := filepath.Dir(binPath)
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0o700) })

	reason := storeRollupCache(rollupCachePath(binPath), fingerprint, file.rollups)
	if reason == "" {
		t.Fatal("writing into a read-only directory reported success")
	}
	t.Log(reason)
}

// TestRegistryUsesTheRollupCache is the end-to-end property: a second
// NewRegistry over the same data reproduces the first one's indexes without
// rebuilding them, and its bars are identical.
func TestRegistryUsesTheRollupCache(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "meta"), 0o755); err != nil {
		t.Fatal(err)
	}
	const sessions, barsPerSession = 5, 24 * 60
	binPath := filepath.Join(dir, "bin", "ZZ.1m.bin")
	if err := os.WriteFile(binPath, simpleFixture(sessions*barsPerSession, 1_700_000_000, 60), 0o644); err != nil {
		t.Fatal(err)
	}
	raw := make(map[string]idxEntry, sessions)
	for i := 0; i < sessions; i++ {
		raw[fmt.Sprintf("2023-11-%02d", 14+i)] = idxEntry{Offset: i * barsPerSession, Count: barsPerSession}
	}
	writeIdxFile(t, filepath.Join(dir, "bin", "ZZ.1m.idx"), raw)
	writeSymbolsFile(t, filepath.Join(dir, "meta", "symbols.json"), `[{"symbol":"ZZ","name":"Fixture","kind":"future","tickSize":0.25,"sessionTz":"UTC"}]`)

	first, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("first NewRegistry: %v", err)
	}
	firstWarnings := first.Warnings()
	for _, warning := range firstWarnings {
		t.Logf("first load warning: %s", warning)
	}
	if _, err := os.Stat(rollupCachePath(binPath)); err != nil {
		t.Fatalf("first load wrote no rollup cache: %v", err)
	}

	var want *rollups
	if err := first.WithDataset("ZZ", "1m", func(f *BarFile, _ *Calendar, _ string) error {
		want = cloneRollups(f.rollups)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	first.Close()

	// The second load must not build anything: fail the test from inside the
	// builder itself rather than inferring it from a timing difference.
	var rebuilt atomic.Bool
	original := indexBuildHook
	indexBuildHook = func() { rebuilt.Store(true) }
	t.Cleanup(func() { indexBuildHook = original })

	second, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("second NewRegistry: %v", err)
	}
	defer second.Close()
	// Reading the cache must not add a warning of its own; whatever the data
	// itself warns about is expected to repeat verbatim.
	if got, want := second.Warnings(), firstWarnings; !equalStrings(got, want) {
		t.Errorf("cached load warnings = %v, want the same as the first load %v", got, want)
	}
	if rebuilt.Load() {
		t.Error("second load rebuilt the rollups instead of reading the cache")
	}
	if err := second.WithDataset("ZZ", "1m", func(f *BarFile, cal *Calendar, _ string) error {
		assertSameRollups(t, f.rollups, want)
		if cal == nil || !cal.ordered {
			t.Error("calendar not marked ordered on the cached path")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// TestRegistryRebuildsAfterDataChanges pins the other half: rewriting the
// .bin must invalidate the sidecar and produce a fresh one.
func TestRegistryRebuildsAfterDataChanges(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "meta"), 0o755); err != nil {
		t.Fatal(err)
	}
	binPath := filepath.Join(dir, "bin", "ZZ.1m.bin")
	if err := os.WriteFile(binPath, simpleFixture(2_000, 1_700_000_000, 60), 0o644); err != nil {
		t.Fatal(err)
	}
	writeSymbolsFile(t, filepath.Join(dir, "meta", "symbols.json"), `[{"symbol":"ZZ","name":"Fixture","kind":"future","tickSize":0.25,"sessionTz":"UTC"}]`)

	first, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	first.Close()

	// More bars, a different timeline, a new mtime: every fingerprint field
	// that guards the cache moves at once, the way a re-ingest moves them.
	if err := os.WriteFile(binPath, simpleFixture(3_000, 1_700_000_000, 60), 0o644); err != nil {
		t.Fatal(err)
	}

	var rebuilt atomic.Bool
	original := indexBuildHook
	indexBuildHook = func() { rebuilt.Store(true) }
	t.Cleanup(func() { indexBuildHook = original })

	second, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if !rebuilt.Load() {
		t.Error("served rollups from a cache built for different bars")
	}
	if err := second.WithDataset("ZZ", "1m", func(f *BarFile, _ *Calendar, _ string) error {
		last := f.rollups.hourly[len(f.rollups.hourly)-1]
		if int(last.to) != f.Count() {
			t.Errorf("hourly index ends at bar %d, file holds %d", last.to, f.Count())
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func touch(t *testing.T, path string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// A whole second later, so the change is visible even on a filesystem
	// that only records mtime at second granularity.
	later := time.Now().Add(2 * time.Second)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, later, later); err != nil {
		t.Fatal(err)
	}
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range want {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func clone(raw []byte) []byte {
	out := make([]byte, len(raw))
	copy(out, raw)
	return out
}

func cloneRollups(source *rollups) *rollups {
	out := &rollups{
		hourly:    make([]rollupBar, len(source.hourly)),
		rthHourly: make([]rollupBar, len(source.rthHourly)),
		rthDaily:  make([]rollupBar, len(source.rthDaily)),
		daily:     make([]rollupBar, len(source.daily)),
	}
	copy(out.hourly, source.hourly)
	copy(out.rthHourly, source.rthHourly)
	copy(out.rthDaily, source.rthDaily)
	copy(out.daily, source.daily)
	return out
}

func writeIdxFile(t *testing.T, path string, raw map[string]idxEntry) {
	t.Helper()
	body := "{"
	first := true
	for date, entry := range raw {
		if !first {
			body += ","
		}
		first = false
		body += fmt.Sprintf("%q:{\"offset\":%d,\"count\":%d}", date, entry.Offset, entry.Count)
	}
	body += "}"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeSymbolsFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
