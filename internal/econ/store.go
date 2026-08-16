package econ

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// ErrBadImportance is returned for a filter naming a level that does not exist.
var ErrBadImportance = errors.New("econ: unknown importance")

// maxLineBytes bounds one JSONL record. Calendar entries are a few hundred
// bytes; the limit turns a corrupt or concatenated file into a clear parse
// error instead of an unbounded allocation. A var, not a const, so
// ApplyLimits can override it from config.yaml's limits.econ_line_bytes.
var maxLineBytes = 64 << 10

// ApplyLimits overrides maxLineBytes from startup config (cmd/server, from
// config.yaml's limits.econ_line_bytes). Call once before Open — Open and
// Reload both read this package var each time they scan a shard.
func ApplyLimits(maxLine int) {
	if maxLine > 0 {
		maxLineBytes = maxLine
	}
}

// Store holds the whole economic calendar in memory, ordered by release time.
// Its zero value is a valid, permanently empty calendar, which is what the
// HTTP layer serves when no calendar dataset is installed.
//
// In memory unconditionally: a decade of majors is tens of thousands of
// records — single-digit megabytes — so there is nothing to gain from an
// on-disk index, and a sorted slice makes a week lookup a binary search.
//
// The RWMutex exists for the same reason the bar registry has one: SIGHUP
// swaps the dataset under live readers.
type Store struct {
	dir    string
	mu     sync.RWMutex
	events []Event
}

// Meta describes what the calendar holds, so a client can decide whether to
// offer the feature at all and what to populate its filters with, without
// downloading every event first.
type Meta struct {
	Available bool     `json:"available"`
	Count     int      `json:"count"`
	FirstTs   int64    `json:"firstTs"`
	LastTs    int64    `json:"lastTs"`
	Countries []string `json:"countries"`
}

// WeekRequest is one week lookup.
//
// At and CursorTs are separate on purpose. At picks the week; CursorTs is
// where the replay actually stands, and decides which outcomes may be shown.
// Keeping them apart is what lets a client page to next week's schedule — a
// trader can read a schedule ahead — without that page revealing numbers
// that have not printed yet.
type WeekRequest struct {
	At            int64
	CursorTs      int64
	TimeZone      string
	MinImportance string
	Countries     []string
}

// Week is a calendar week plus the events inside it.
type Week struct {
	WeekStart int64 `json:"weekStart"`
	// WeekEnd is exclusive: it is the following Monday's midnight, so a
	// client can page forward by requesting at=weekEnd and back with
	// at=weekStart-1 without doing calendar arithmetic of its own.
	WeekEnd  int64       `json:"weekEnd"`
	TimeZone string      `json:"timeZone"`
	CursorTs int64       `json:"cursorTs"`
	Events   []EventView `json:"events"`
}

// Open loads dataDir/econ/*.jsonl.
//
// A missing directory is not an error — the calendar is an optional dataset,
// and an install without one has to keep working exactly as before. Malformed
// content is an error: a silently half-loaded calendar would show a trader a
// week with events missing from it and no indication why.
func Open(dataDir string) (*Store, error) {
	s := &Store{dir: filepath.Join(dataDir, "econ")}
	events, err := loadDir(s.dir)
	if err != nil {
		return nil, err
	}
	s.events = events
	return s, nil
}

// Reload re-reads the directory. On failure the previously loaded calendar
// keeps serving, matching how the bar registry treats a bad reload: a partial
// rsync must never take working data away.
func (s *Store) Reload() error {
	events, err := loadDir(s.dir)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.events = events
	s.mu.Unlock()
	return nil
}

func (s *Store) Meta() Meta {
	s.mu.RLock()
	defer s.mu.RUnlock()

	meta := Meta{Available: len(s.events) > 0, Count: len(s.events), Countries: []string{}}
	if len(s.events) == 0 {
		return meta
	}
	meta.FirstTs = s.events[0].Ts
	meta.LastTs = s.events[len(s.events)-1].Ts
	seen := make(map[string]struct{})
	for _, event := range s.events {
		if _, ok := seen[event.Country]; ok {
			continue
		}
		seen[event.Country] = struct{}{}
		meta.Countries = append(meta.Countries, event.Country)
	}
	sort.Strings(meta.Countries)
	return meta
}

// Week returns the events of the week containing req.At, projected for a
// replay cursor at req.CursorTs.
func (s *Store) Week(req WeekRequest) (Week, error) {
	loc, err := loadLocation(req.TimeZone)
	if err != nil {
		return Week{}, err
	}
	minRank := 0
	if req.MinImportance != "" {
		rank, ok := importanceRank[req.MinImportance]
		if !ok {
			return Week{}, fmt.Errorf("%w: %q", ErrBadImportance, req.MinImportance)
		}
		minRank = rank
	}
	countries := make(map[string]struct{}, len(req.Countries))
	for _, country := range req.Countries {
		countries[strings.ToUpper(strings.TrimSpace(country))] = struct{}{}
	}

	start, end := weekBounds(req.At, loc)
	week := Week{
		WeekStart: start,
		WeekEnd:   end,
		TimeZone:  loc.String(),
		CursorTs:  req.CursorTs,
		Events:    []EventView{},
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	first := sort.Search(len(s.events), func(i int) bool { return s.events[i].Ts >= start })
	for _, event := range s.events[first:] {
		if event.Ts >= end {
			break
		}
		if !event.knownAt(req.CursorTs) {
			continue
		}
		if importanceRank[event.Importance] < minRank {
			continue
		}
		if len(countries) > 0 {
			if _, ok := countries[strings.ToUpper(event.Country)]; !ok {
				continue
			}
		}
		week.Events = append(week.Events, event.viewAt(req.CursorTs))
	}
	return week, nil
}

func loadDir(dir string) ([]Event, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.jsonl"))
	if err != nil {
		return nil, fmt.Errorf("econ: glob %s: %w", dir, err)
	}
	if len(paths) == 0 {
		// Either no directory or no shards in it. Both mean "this install has
		// no calendar", which is a supported state, not a failure.
		return nil, nil
	}
	sort.Strings(paths)

	events := make([]Event, 0, 1024)
	byID := make(map[string]string) // id -> where it was first seen
	for _, path := range paths {
		fileEvents, err := loadFile(path, byID)
		if err != nil {
			return nil, err
		}
		events = append(events, fileEvents...)
	}
	sortEvents(events)
	return events, nil
}

func loadFile(path string, byID map[string]string) ([]Event, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("econ: open %s: %w", path, err)
	}
	defer file.Close()

	var events []Event
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64<<10), maxLineBytes)
	line := 0
	for scanner.Scan() {
		line++
		raw := strings.TrimSpace(scanner.Text())
		// Blank lines and #-comments keep a hand-maintained shard readable.
		if raw == "" || strings.HasPrefix(raw, "#") {
			continue
		}
		var event Event
		decoder := json.NewDecoder(strings.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&event); err != nil {
			// Unknown fields are rejected rather than ignored: a typo like
			// "improtance" would otherwise load as a silently low-importance
			// event that the trader's filter hides.
			return nil, fmt.Errorf("econ: %s:%d: %w", path, line, err)
		}
		if err := event.validate(); err != nil {
			return nil, fmt.Errorf("econ: %s:%d: %w", path, line, err)
		}
		if where, duplicate := byID[event.ID]; duplicate {
			return nil, fmt.Errorf("econ: %s:%d: duplicate id %q, first seen at %s", path, line, event.ID, where)
		}
		byID[event.ID] = fmt.Sprintf("%s:%d", path, line)
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("econ: read %s: %w", path, err)
	}
	return events, nil
}
