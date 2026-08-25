package bars

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"market-replay/internal/model"
)

// ErrUnknownSymbolTF is returned when a request names a (symbol,tf) pair
// that isn't present under dataDir/bin.
var ErrUnknownSymbolTF = errors.New("bars: unknown symbol/timeframe")

type key struct {
	Symbol string
	Tf     string
}

// slot holds one (symbol,tf)'s live dataset behind a RWMutex. Readers
// RLock for the duration of one request — a binary search plus a handful
// of byte-range copies, sub-microsecond per docs' own benchmark (#12).
// Reload takes the write lock only long enough to swap the pointers.
//
// This has to be a real mutex, not just an atomic.Pointer swap: munmap'ing
// the old file while another goroutine still holds a slice into that
// mapping is a process-killing segfault at the OS level, not a Go-safe
// data race. An atomic pointer alone makes new Gets see new data, but
// does nothing to stop an in-flight reader from touching memory that just
// got unmapped out from under it. RWMutex's guarantee that Lock() cannot
// proceed while any RLock is outstanding is exactly the property needed:
// by the time Reload's Lock() succeeds, no reader can still be holding
// the old file, so closing it immediately is safe.
type slot struct {
	mu      sync.RWMutex
	file    *BarFile
	cal     *Calendar // nil if no .idx file was found alongside the .bin
	binPath string
	idxPath string
	// tag identifies the exact file currently mapped, so an HTTP cache
	// validator can survive a SIGHUP reload: the URL alone cannot express
	// "the bytes behind this changed".
	tag string
}

// Registry discovers and serves every (symbol,tf) dataset found under
// dataDir/bin, cross-referenced against dataDir/meta/symbols.json. It
// never hardcodes a symbol or timeframe (docs N5) — the key set is
// whatever's actually on disk at construction time.
type Registry struct {
	dataDir string
	slots   map[key]*slot

	// mu guards symbols and warnings, both of which Reload replaces. The
	// slice is swapped rather than mutated in place, so a reader that already
	// holds it keeps a consistent snapshot for as long as it needs one.
	mu       sync.RWMutex
	symbols  []model.SymbolMeta
	warnings []string
}

// loaded is one dataset opened off the disk, before it is published to a slot.
type loaded struct {
	symbol  string
	tf      string
	binPath string
	idxPath string
	file    *BarFile
	cal     *Calendar
	tag     string
	// warning is a non-fatal data-integrity note, e.g. an .idx the daily
	// index could not be built from.
	warning string
	err     error
}

// openDataset does all the per-file work: mmap, validate, index, load the
// companion calendar, and compute the cache validator. Everything here reads
// one (symbol,tf)'s own files and shares nothing, which is what lets the
// registry do several at once.
func openDataset(binPath string, meta model.SymbolMeta, symbol, tf string) loaded {
	out := loaded{symbol: symbol, tf: tf, binPath: binPath, idxPath: strings.TrimSuffix(binPath, ".bin") + ".idx"}

	file, err := openBarFile(binPath)
	if err != nil {
		out.err = err
		return out
	}
	if err := checkTickSize(file, meta); err != nil {
		file.Close()
		out.err = err
		return out
	}
	if _, statErr := os.Stat(out.idxPath); statErr == nil {
		if out.cal, err = loadCalendar(out.idxPath); err != nil {
			file.Close()
			out.err = err
			return out
		}
	}
	plan, err := planFor(tf, meta)
	if err != nil {
		file.Close()
		out.err = err
		return out
	}
	// Indexed before the file reaches a slot, so no reader can observe a
	// partially built index.
	if err := out.index(file, plan, meta); err != nil {
		file.Close()
		out.err = err
		return out
	}
	if out.tag, err = datasetTag(binPath, file.Count()); err != nil {
		file.Close()
		out.err = err
		return out
	}
	if err := discardMappedPages(file); err != nil {
		out.note("could not release mmap pages after indexing: %v", err)
	}
	out.file = file
	return out
}

// index brings file to the state a published slot needs: timestamps
// validated, rollups either restored from the .roll cache or built and then
// written to it, and the companion calendar's ranges checked.
func (l *loaded) index(file *BarFile, plan indexPlan, meta model.SymbolMeta) error {
	// Pass one reads the ts column and nothing else. It is the fail-fast
	// validation that has to run on every boot either way, and its hash is
	// what decides whether cached rollups still describe these exact bars —
	// so a cache hit never touches the five price/volume columns at all.
	tsHash, err := file.index(indexPlan{})
	if err != nil {
		return fmt.Errorf("bars: %s: %w", l.binPath, err)
	}
	if !plan.rollups {
		l.attachCalendar(file, plan)
		return nil
	}

	fingerprint, err := newRollFingerprint(l.binPath, l.idxPath, file.Count(), tsHash, meta.SessionTz)
	if err != nil {
		return err
	}
	cachePath := rollupCachePath(l.binPath)
	cached, reason := loadRollupCache(cachePath, fingerprint, file.Count(), l.sessionCount())
	if cached != nil {
		file.rollups = cached
		// The daily index came with the cache; the calendar still needs its
		// ranges verified, because Calendar.Range binary-searches on that.
		restored := plan
		restored.rollups = false
		l.attachCalendar(file, restored)
		return nil
	}
	if reason != "" {
		l.note("rebuilding the rollup index: %s", reason)
	}
	if _, err := file.index(plan); err != nil {
		return fmt.Errorf("bars: %s: %w", l.binPath, err)
	}
	l.attachCalendar(file, plan)
	if reason := storeRollupCache(cachePath, fingerprint, file.rollups); reason != "" {
		l.note("rollup index not cached, so the next restart rebuilds it: %s", reason)
	}
	return nil
}

func (l *loaded) attachCalendar(file *BarFile, plan indexPlan) {
	if rejected := file.attachCalendarRollup(l.cal, plan); rejected != "" {
		l.note("%s has no usable session index (%s); daily, weekly and monthly aggregation will scan raw bars instead",
			filepath.Base(l.idxPath), rejected)
	}
}

func (l *loaded) sessionCount() int {
	if l.cal == nil {
		return 0
	}
	return len(l.cal.dates)
}

// note records a non-fatal data-integrity problem against this dataset.
// Several can surface from one open, so they accumulate rather than
// overwriting each other.
func (l *loaded) note(format string, args ...any) {
	entry := fmt.Sprintf("%s/%s: %s", l.symbol, l.tf, fmt.Sprintf(format, args...))
	if l.warning == "" {
		l.warning = entry
		return
	}
	l.warning += "; " + entry
}

// openDatasets opens every path concurrently and returns the results in the
// same order, so behaviour never depends on which file happened to finish
// first.
//
// Concurrent because the expensive part — index()'s pass over the file — is a
// full read and nothing else, sharing no state between datasets. Serially that
// cost grows with every symbol added; in parallel it grows with the largest
// one, until it stops being CPU-bound at all and becomes a question of how
// many bytes the pass has to read. Which is why the two things that actually
// moved startup were reading fewer bytes, not reading them faster: skipping
// the indexes a sub-minute dataset can never serve, and reusing a previous
// run's via the .roll cache.
func openDatasets(paths []string, symbols []model.SymbolMeta) []loaded {
	results := make([]loaded, len(paths))
	// Bounded so a directory with dozens of datasets cannot put every one of
	// them in flight at once, thrashing the page cache against itself.
	limit := runtime.GOMAXPROCS(0)
	if limit > len(paths) {
		limit = len(paths)
	}
	if limit < 1 {
		limit = 1
	}
	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup
	for i, binPath := range paths {
		sym, tf, err := parseBinFilename(binPath)
		if err != nil {
			results[i] = loaded{binPath: binPath, err: err}
			continue
		}
		meta, ok := findSymbolMeta(symbols, sym)
		if !ok {
			results[i] = loaded{symbol: sym, tf: tf, binPath: binPath,
				err: fmt.Errorf("bars: %s has no entry in symbols.json (%s)", sym, binPath)}
			continue
		}
		wg.Add(1)
		go func(i int, binPath, sym, tf string, meta model.SymbolMeta) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[i] = openDataset(binPath, meta, sym, tf)
		}(i, binPath, sym, tf, meta)
	}
	wg.Wait()
	return results
}

// describeRanges rewrites each symbol's advertised bar range from the data
// actually loaded, and reports the ones that had drifted.
//
// The .bin is the only real answer to "which bars exist"; symbols.json's
// ranges are derived metadata that a pipeline run can leave stale. The client
// picks its opening window from that range, so a stale value sends it seeking
// outside the data — a failure with no server-side signal at all. Correcting
// it here means the client is always told the truth, and the drift is
// reported rather than silently absorbed.
func describeRanges(symbols []model.SymbolMeta, datasets []loaded) ([]model.SymbolMeta, []string) {
	corrected := make([]model.SymbolMeta, len(symbols))
	for i, meta := range symbols {
		corrected[i] = meta
		corrected[i].Ranges = maps.Clone(meta.Ranges)
		if corrected[i].Ranges == nil {
			corrected[i].Ranges = map[string]model.Range{}
		}
	}
	var warnings []string
	for _, dataset := range datasets {
		if dataset.file == nil {
			continue
		}
		actual := model.Range{From: dataset.file.TsAt(0), To: dataset.file.TsAt(dataset.file.Count() - 1)}
		for i := range corrected {
			if corrected[i].Symbol != dataset.symbol {
				continue
			}
			if declared, ok := corrected[i].Ranges[dataset.tf]; !ok || declared != actual {
				warnings = append(warnings, fmt.Sprintf(
					"%s/%s: symbols.json declares range %d..%d but the file holds %d..%d; serving the file's",
					dataset.symbol, dataset.tf, declared.From, declared.To, actual.From, actual.To))
			}
			corrected[i].Ranges[dataset.tf] = actual
		}
	}
	return corrected, warnings
}

// NewRegistry loads symbols.json and opens+validates every *.bin file
// under dataDir/bin, several at a time. It fails fast: a missing
// symbols.json, a bin file that fails RBR1 validation, an unregistered
// symbol, or a tick-size mismatch between a .bin header and symbols.json all
// abort construction rather than serving a partially-broken registry.
//
// Non-fatal data problems — a stale advertised range, an .idx the session
// index could not be built from — are collected for Warnings() instead, so
// they reach the operator's log without taking the server down over data that
// still serves correctly.
func NewRegistry(dataDir string) (*Registry, error) {
	symbols, err := loadSymbols(filepath.Join(dataDir, "meta", "symbols.json"))
	if err != nil {
		return nil, err
	}

	binPaths, err := filepath.Glob(filepath.Join(dataDir, "bin", "*.bin"))
	if err != nil {
		return nil, fmt.Errorf("bars: glob bin dir: %w", err)
	}
	sort.Strings(binPaths)

	datasets := openDatasets(binPaths, symbols)
	// Report the first failure in path order, not whichever goroutine lost
	// the race, so the same broken directory always produces the same error.
	for _, dataset := range datasets {
		if dataset.err == nil {
			continue
		}
		for _, other := range datasets {
			if other.file != nil {
				other.file.Close()
			}
		}
		return nil, dataset.err
	}

	r := &Registry{dataDir: dataDir, slots: make(map[key]*slot)}
	for _, dataset := range datasets {
		r.slots[key{dataset.symbol, dataset.tf}] = &slot{
			file: dataset.file, cal: dataset.cal,
			binPath: dataset.binPath, idxPath: dataset.idxPath, tag: dataset.tag,
		}
		if dataset.warning != "" {
			r.warnings = append(r.warnings, dataset.warning)
		}
	}
	corrected, rangeWarnings := describeRanges(symbols, datasets)
	r.symbols = corrected
	r.warnings = append(r.warnings, rangeWarnings...)
	sort.Strings(r.warnings)
	return r, nil
}

// WithDataset calls fn with the current file+calendar for (symbol,tf) and
// that dataset's cache validator, holding a read lock for fn's duration. cal
// may be nil if the dataset has no companion .idx file. Returns
// ErrUnknownSymbolTF if no such dataset was found at startup.
//
// tag comes through the same lock as the file deliberately: fetching it
// separately would let a reload land in between, and the response would
// then advertise a validator describing bytes other than the ones it carries.
func (r *Registry) WithDataset(symbol, tf string, fn func(f *BarFile, cal *Calendar, tag string) error) error {
	s, ok := r.slots[key{symbol, tf}]
	if !ok {
		return fmt.Errorf("%w: %s/%s", ErrUnknownSymbolTF, symbol, tf)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return fn(s.file, s.cal, s.tag)
}

// Symbols returns symbols.json's contents (docs' single source of truth for
// tick size, point value, commission — N5), with each loaded dataset's bar
// range replaced by what the file actually holds.
//
// The returned slice is a snapshot: Reload swaps in a new one rather than
// editing this, so a caller may hold and serialize it without locking.
func (r *Registry) Symbols() []model.SymbolMeta {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.symbols
}

// Warnings returns the non-fatal data-integrity notes from the most recent
// load: an advertised range that had drifted from the file, or an .idx no
// session index could be built from. Callers should log them — each one is a
// data problem that otherwise only shows up as unexplained slowness or a
// client seeking outside the data.
func (r *Registry) Warnings() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]string(nil), r.warnings...)
}

// Reload re-opens and re-validates every known (symbol,tf)'s files fresh
// from disk, several at a time and independently. A slot whose new file fails
// validation keeps serving its previous data — one bad file (e.g. a partial
// rsync) never blocks reload of the others. Returns one error per failed slot
// (nil on full success); callers must log every error, not just the first, and
// should also log Warnings() afterwards.
func (r *Registry) Reload() []error {
	// Sorted so both the reload order and the resulting error order are
	// reproducible; map iteration alone would make a failing SIGHUP report its
	// problems in a different order every time.
	keys := make([]key, 0, len(r.slots))
	for k := range r.slots {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Symbol != keys[j].Symbol {
			return keys[i].Symbol < keys[j].Symbol
		}
		return keys[i].Tf < keys[j].Tf
	})

	paths := make([]string, len(keys))
	for i, k := range keys {
		paths[i] = r.slots[k].binPath
	}
	datasets := openDatasets(paths, r.Symbols())

	var errs []error
	var warnings []string
	for i, k := range keys {
		dataset := datasets[i]
		if dataset.err != nil {
			errs = append(errs, fmt.Errorf("reload %s/%s: %w", k.Symbol, k.Tf, dataset.err))
			continue
		}
		if dataset.warning != "" {
			warnings = append(warnings, dataset.warning)
		}

		s := r.slots[k]
		s.mu.Lock()
		oldFile := s.file
		s.file = dataset.file
		s.cal = dataset.cal
		s.tag = dataset.tag
		s.mu.Unlock()

		// Safe immediately: RWMutex guarantees no RLock holder can still
		// reference oldFile once our Lock() above has succeeded.
		if err := oldFile.Close(); err != nil {
			errs = append(errs, fmt.Errorf("reload %s/%s: close old file: %w", k.Symbol, k.Tf, err))
		}
	}

	// Ranges are re-derived from whatever actually loaded, so a reload that
	// extended a dataset immediately advertises the new last bar — the client
	// otherwise keeps opening at a window that no longer sits at the edge.
	corrected, rangeWarnings := describeRanges(r.symbols, datasets)
	warnings = append(warnings, rangeWarnings...)
	sort.Strings(warnings)
	r.mu.Lock()
	r.symbols = corrected
	r.warnings = warnings
	r.mu.Unlock()
	return errs
}

// Close unmaps every dataset. Best-effort: continues past individual
// close errors so one bad slot doesn't leak the rest.
func (r *Registry) Close() error {
	var firstErr error
	for _, s := range r.slots {
		if s.file == nil {
			continue
		}
		if err := s.file.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func loadSymbols(path string) ([]model.SymbolMeta, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("bars: read symbols.json: %w", err)
	}
	var symbols []model.SymbolMeta
	if err := json.Unmarshal(b, &symbols); err != nil {
		return nil, fmt.Errorf("bars: parse symbols.json: %w", err)
	}
	return symbols, nil
}

func findSymbolMeta(symbols []model.SymbolMeta, name string) (model.SymbolMeta, bool) {
	for _, s := range symbols {
		if s.Symbol == name {
			return s, true
		}
	}
	return model.SymbolMeta{}, false
}

// checkTickSize fails loud if a .bin header's price encoding disagrees
// with symbols.json — one of the two is wrong, and silently trusting
// either would corrupt every price the server serves for this symbol.
func checkTickSize(f *BarFile, meta model.SymbolMeta) error {
	got := float64(f.TickNum()) / float64(f.TickDen())
	if math.Abs(got-meta.TickSize) > 1e-9 {
		return fmt.Errorf("bars: %s tick size mismatch: .bin header implies %v, symbols.json says %v", meta.Symbol, got, meta.TickSize)
	}
	return nil
}

// datasetTag builds an opaque token for the exact file mapped at path. Size,
// modification time and bar count all change when the pipeline rewrites a
// dataset, which is what lets a client find out that a SIGHUP reload replaced
// the bars behind a URL it had already cached.
func datasetTag(path string, count int) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("bars: stat %s for cache tag: %w", path, err)
	}
	return fmt.Sprintf("%d-%d-%d", info.Size(), info.ModTime().UnixNano(), count), nil
}

// parseBinFilename extracts (symbol,tf) from a "SYMBOL.TF.bin" filename.
func parseBinFilename(path string) (symbol, tf string, err error) {
	base := filepath.Base(path)
	parts := strings.Split(base, ".")
	if len(parts) != 3 || parts[2] != "bin" {
		return "", "", fmt.Errorf("bars: unexpected bin filename %q (want SYMBOL.TF.bin)", base)
	}
	return parts[0], parts[1], nil
}
