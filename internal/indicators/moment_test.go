package indicators

import (
	"testing"
	"time"
)

const newYork = "America/New_York"

// TestMomentValue_DSTSpringForward pins a known historical transition
// (2023-03-12, US clocks jump from 01:59 EST straight to 03:00 EDT) so the
// expected NY-local hour comes from an external, independently-verifiable
// fact rather than from the same time package under test.
func TestMomentValue_DSTSpringForward(t *testing.T) {
	before := time.Date(2023, 3, 12, 6, 59, 0, 0, time.UTC).Unix() // 01:59 EST
	after := time.Date(2023, 3, 12, 7, 0, 0, 0, time.UTC).Unix()   // 03:00 EDT (02:00-03:00 skipped)

	m, err := newMomentValue(before).Tz(newYork)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	if got := m.Hour(); got != 1 || m.Minute() != 59 {
		t.Fatalf("before transition: got %02d:%02d, want 01:59", got, m.Minute())
	}

	m2, err := newMomentValue(after).Tz(newYork)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	if got := m2.Hour(); got != 3 || m2.Minute() != 0 {
		t.Fatalf("after transition: got %02d:%02d, want 03:00", got, m2.Minute())
	}
}

// TestMomentValue_DSTFallBack pins 2023-11-05, where US clocks fall from
// 01:59 EDT back to 01:00 EST (01:00-01:59 repeats).
func TestMomentValue_DSTFallBack(t *testing.T) {
	before := time.Date(2023, 11, 5, 5, 59, 0, 0, time.UTC).Unix() // 01:59 EDT
	after := time.Date(2023, 11, 5, 6, 0, 0, 0, time.UTC).Unix()   // 01:00 EST

	m, err := newMomentValue(before).Tz(newYork)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	if got := m.Hour(); got != 1 || m.Minute() != 59 {
		t.Fatalf("before transition: got %02d:%02d, want 01:59", got, m.Minute())
	}

	m2, err := newMomentValue(after).Tz(newYork)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	if got := m2.Hour(); got != 1 || m2.Minute() != 0 {
		t.Fatalf("after transition: got %02d:%02d, want 01:00", got, m2.Minute())
	}
}

// TestMomentValue_CloneIsIndependent proves the property
// getSessionStartTimestamp in the DSL scripts depends on: mutating a clone
// (via startOf/add) must never affect the moment it was cloned from.
func TestMomentValue_CloneIsIndependent(t *testing.T) {
	ts := time.Date(2024, 6, 15, 13, 45, 0, 0, time.UTC).Unix() // 09:45 EDT
	nyTime, err := newMomentValue(ts).Tz(newYork)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}

	clone := nyTime.Clone()
	if _, err := clone.StartOf("day"); err != nil {
		t.Fatalf("startOf: %v", err)
	}
	if _, err := clone.Add(9, "hours"); err != nil {
		t.Fatalf("add: %v", err)
	}
	if _, err := clone.Add(30, "minutes"); err != nil {
		t.Fatalf("add: %v", err)
	}

	if got := nyTime.Hour(); got != 9 || nyTime.Minute() != 45 {
		t.Fatalf("original mutated: got %02d:%02d, want 09:45", got, nyTime.Minute())
	}
	if got := clone.Hour(); got != 9 || clone.Minute() != 30 {
		t.Fatalf("clone: got %02d:%02d, want 09:30", got, clone.Minute())
	}
}

// TestMomentValue_ValueOfIsSeconds proves valueOf returns the same unit
// (epoch seconds) a bar timestamp already uses — a script that mixes the
// two directly (as the sample script's rectangle()/makeLine() calls do)
// must never see a 1000x scale mismatch.
func TestMomentValue_ValueOfIsSeconds(t *testing.T) {
	ts := time.Date(2024, 1, 2, 0, 0, 0, 0, time.UTC).Unix()
	m, err := newMomentValue(ts).Tz(newYork)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	if _, err := m.StartOf("day"); err != nil {
		t.Fatalf("startOf: %v", err)
	}
	if _, err := m.Add(9, "hours"); err != nil {
		t.Fatalf("add: %v", err)
	}
	got := m.ValueOf()
	// The UTC instant is Jan 2 00:00, which is Jan 1 19:00 local (EST is
	// UTC-5) — startOf('day') therefore lands on Jan 1 local, not Jan 2.
	want := time.Date(2024, 1, 1, 9, 0, 0, 0, mustLoadLocation(t, newYork)).Unix()
	if got != want {
		t.Fatalf("valueOf: got %d, want %d", got, want)
	}
}

func mustLoadLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load location %q: %v", name, err)
	}
	return loc
}

func TestMomentValue_UnsupportedUnitsError(t *testing.T) {
	m := newMomentValue(0)
	if _, err := m.StartOf("month"); err == nil {
		t.Fatal("startOf(month): want error, got nil")
	}
	if _, err := m.Add(1, "days"); err == nil {
		t.Fatal("add(_, days): want error, got nil")
	}
	if _, err := m.Tz("Not/ARealZone"); err == nil {
		t.Fatal("tz(bogus): want error, got nil")
	}
}
