package bars

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func writeIdxFixture(t *testing.T, raw map[string]idxEntry) string {
	t.Helper()
	b, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	path := filepath.Join(t.TempDir(), "test.idx")
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	return path
}

func TestCalendar_Resolve(t *testing.T) {
	f, err := newBarFile(simpleFixture(10, 1000, 60))
	if err != nil {
		t.Fatalf("newBarFile: %v", err)
	}

	path := writeIdxFixture(t, map[string]idxEntry{"2024-01-01": {Offset: 2, Count: 3}})
	cal, err := loadCalendar(path)
	if err != nil {
		t.Fatalf("loadCalendar: %v", err)
	}

	entry, err := cal.Resolve("2024-01-01", f)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if entry.Bars != 3 || entry.FirstTs != f.TsAt(2) || entry.LastTs != f.TsAt(4) {
		t.Errorf("entry = %+v, unexpected", entry)
	}
}

func TestCalendar_OutOfBounds(t *testing.T) {
	f, err := newBarFile(simpleFixture(10, 1000, 60))
	if err != nil {
		t.Fatalf("newBarFile: %v", err)
	}

	path := writeIdxFixture(t, map[string]idxEntry{"2024-01-01": {Offset: 8, Count: 5}}) // 8+5=13 > 10
	cal, err := loadCalendar(path)
	if err != nil {
		t.Fatalf("loadCalendar: %v", err)
	}

	if _, err := cal.Resolve("2024-01-01", f); !errors.Is(err, ErrIdxOutOfBounds) {
		t.Fatalf("err = %v, want ErrIdxOutOfBounds", err)
	}
}

func TestCalendar_Range(t *testing.T) {
	f, err := newBarFile(simpleFixture(20, 0, 60))
	if err != nil {
		t.Fatalf("newBarFile: %v", err)
	}
	path := writeIdxFixture(t, map[string]idxEntry{
		"2024-01-01": {Offset: 0, Count: 5},
		"2024-01-02": {Offset: 5, Count: 5},
		"2024-01-03": {Offset: 10, Count: 10},
	})
	cal, err := loadCalendar(path)
	if err != nil {
		t.Fatalf("loadCalendar: %v", err)
	}

	entries, err := cal.Range(f.TsAt(5), f.TsAt(9), f)
	if err != nil {
		t.Fatalf("Range: %v", err)
	}
	if len(entries) != 1 || entries[0].Date != "2024-01-02" {
		t.Fatalf("entries = %+v, want just 2024-01-02", entries)
	}
}

// TestCalendar_RangeBinarySearchMatchesScan pins the ordered fast path
// against the linear scan it replaces. Both calendars hold identical data;
// only `ordered` differs, so any disagreement is the binary search's fault.
func TestCalendar_RangeBinarySearchMatchesScan(t *testing.T) {
	const sessions, barsPerSession = 40, 90
	f, err := newBarFile(simpleFixture(sessions*barsPerSession, 1_700_000_000, 60))
	if err != nil {
		t.Fatalf("newBarFile: %v", err)
	}
	raw := make(map[string]idxEntry, sessions)
	for i := 0; i < sessions; i++ {
		raw[fmt.Sprintf("2024-%02d-%02d", 1+i/28, 1+i%28)] = idxEntry{Offset: i * barsPerSession, Count: barsPerSession}
	}
	cal, err := loadCalendar(writeIdxFixture(t, raw))
	if err != nil {
		t.Fatalf("loadCalendar: %v", err)
	}
	scan, err := loadCalendar(writeIdxFixture(t, raw))
	if err != nil {
		t.Fatalf("loadCalendar: %v", err)
	}
	f.attachCalendarRollup(cal)
	if !cal.ordered {
		t.Fatal("calendar not marked ordered; the fast path would never run")
	}
	if scan.ordered {
		t.Fatal("reference calendar must stay on the linear scan")
	}

	first, last := f.TsAt(0), f.TsAt(f.Count()-1)
	for _, window := range [][2]int64{
		{first, last},
		{first - 86_400, last + 86_400},
		{first, first},
		{last, last},
		{f.TsAt(barsPerSession), f.TsAt(barsPerSession * 5)},
		{f.TsAt(barsPerSession) + 30, f.TsAt(barsPerSession*5) - 30},
		{last + 1, last + 999},
		{first - 999, first - 1},
		{f.TsAt(10), f.TsAt(11)},
	} {
		got, err := cal.Range(window[0], window[1], f)
		if err != nil {
			t.Fatalf("Range(%d,%d): %v", window[0], window[1], err)
		}
		want, err := scan.Range(window[0], window[1], f)
		if err != nil {
			t.Fatalf("scan Range(%d,%d): %v", window[0], window[1], err)
		}
		if len(got) != len(want) {
			t.Fatalf("Range(%d,%d) len = %d, want %d", window[0], window[1], len(got), len(want))
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("Range(%d,%d)[%d] = %+v, want %+v", window[0], window[1], i, got[i], want[i])
			}
		}
	}
}
