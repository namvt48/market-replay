package analytics

import (
	"testing"
	"time"

	"market-replay/internal/model"
)

// tsUTCMondayLateNight is 2024-01-01T23:30:00Z (a Monday, hour 23 UTC) —
// chosen because in Asia/Ho_Chi_Minh (UTC+7) the same instant falls on
// 2024-01-02 06:30 (a Tuesday, hour 6): shifting the request timezone must
// move both the hour-of-day and weekday bucket a trade lands in.
const tsUTCMondayLateNight int64 = 1704151800

func mustLoadLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("LoadLocation(%q): %v", name, err)
	}
	return loc
}

func TestByTime_TimezoneShiftsHourBucket(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", tsUTCMondayLateNight, tsUTCMondayLateNight+60, 100, 100),
	}
	stats := computeTradeStats(trades, Request{})

	utc := buildByTime(stats, 0, time.UTC)
	if utc.Pnl[23].TotalTrades != 1 {
		t.Fatalf("UTC hour 23 should have 1 trade, got %d", utc.Pnl[23].TotalTrades)
	}

	hcm := buildByTime(stats, 0, mustLoadLocation(t, "Asia/Ho_Chi_Minh"))
	if hcm.Pnl[6].TotalTrades != 1 {
		t.Fatalf("Asia/Ho_Chi_Minh hour 6 should have 1 trade, got %d", hcm.Pnl[6].TotalTrades)
	}
	if hcm.Pnl[23].TotalTrades != 0 {
		t.Fatalf("Asia/Ho_Chi_Minh hour 23 should be empty once the trade moved to hour 6")
	}
}

func TestByDay_TimezoneShiftsWeekday(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", tsUTCMondayLateNight, tsUTCMondayLateNight+60, 100, 100),
	}
	stats := computeTradeStats(trades, Request{})

	utc := buildByDay(stats, time.UTC)
	if utc[0].TotalTrades != 1 { // index 0 = Monday
		t.Fatalf("UTC Monday should have 1 trade, got %d", utc[0].TotalTrades)
	}

	hcm := buildByDay(stats, mustLoadLocation(t, "Asia/Ho_Chi_Minh"))
	if hcm[1].TotalTrades != 1 { // index 1 = Tuesday
		t.Fatalf("Asia/Ho_Chi_Minh Tuesday should have 1 trade, got %d", hcm[1].TotalTrades)
	}
	if hcm[0].TotalTrades != 0 {
		t.Fatalf("Asia/Ho_Chi_Minh Monday should be empty once the trade moved to Tuesday")
	}
}

func TestByDay_AlwaysEmitsSevenDays(t *testing.T) {
	stats := computeTradeStats(nil, Request{})
	days := buildByDay(stats, time.UTC)
	if len(days) != 7 {
		t.Fatalf("byDay length = %d, want 7", len(days))
	}
	want := []string{"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}
	for i, d := range days {
		if d.Day != want[i] {
			t.Errorf("day[%d] = %q, want %q", i, d.Day, want[i])
		}
	}
}

func TestByMonth_DoesNotMergeAcrossYears(t *testing.T) {
	const dec2023 int64 = 1702641600 // 2023-12-15T12:00:00Z
	const dec2024 int64 = 1734696000 // 2024-12-20T12:00:00Z
	trades := []model.Trade{
		newTrade("1", "long", dec2023-3600, dec2023, 100, 1000),
		newTrade("2", "long", dec2024-3600, dec2024, 100, 2000),
	}
	stats := computeTradeStats(trades, Request{})
	months := buildByMonth(stats, 100_000, time.UTC)
	if len(months) != 2 {
		t.Fatalf("expected 2 distinct month buckets, got %d: %+v", len(months), months)
	}
	if months[0].Month != "2023-12" || months[1].Month != "2024-12" {
		t.Fatalf("months = [%q, %q], want [2023-12, 2024-12] in chronological order", months[0].Month, months[1].Month)
	}
	if months[0].TotalTrades != 1 || months[1].TotalTrades != 1 {
		t.Fatalf("each December bucket should have exactly its own trade, got %+v", months)
	}
}

func TestCalendar_CrossesYearBoundary(t *testing.T) {
	const dec2023 int64 = 1702641600
	const jun2024 int64 = 1718884800 // 2024-06-20T12:00:00Z
	trades := []model.Trade{
		newTrade("1", "long", dec2023-3600, dec2023, 100, 1000),
		newTrade("2", "long", jun2024-3600, jun2024, 100, 2000),
	}
	stats := computeTradeStats(trades, Request{})
	days := buildCalendar(stats, 100_000, time.UTC)
	if len(days) != 2 {
		t.Fatalf("expected 2 calendar days, got %d: %+v", len(days), days)
	}
	if days[0].Date != "2023-12-15" || days[1].Date != "2024-06-20" {
		t.Fatalf("calendar dates = [%q, %q], want chronological across the year boundary", days[0].Date, days[1].Date)
	}
	// endingBalance must accumulate in chronological trade order regardless
	// of which map bucket each trade landed in.
	if days[0].EndingBalance != 1010.0 { // 1000 initial + $10
		t.Errorf("first day endingBalance = %v, want 1010", days[0].EndingBalance)
	}
	if days[1].EndingBalance != 1030.0 { // + $20 more
		t.Errorf("second day endingBalance = %v, want 1030", days[1].EndingBalance)
	}
}

func TestBySession_AlwaysEmitsFourWindows(t *testing.T) {
	stats := computeTradeStats(nil, Request{})
	sessions := buildBySession(stats)
	if len(sessions) != 4 {
		t.Fatalf("bySession length = %d, want 4", len(sessions))
	}
	want := []string{"Asia", "London", "New York", "Out of session"}
	for i, s := range sessions {
		if s.Session != want[i] {
			t.Errorf("session[%d] = %q, want %q", i, s.Session, want[i])
		}
		if s.TotalTrades != 0 {
			t.Errorf("session[%d] totalTrades = %d, want 0", i, s.TotalTrades)
		}
	}
}

func TestBySession_ClassificationIgnoresRequestTimezone(t *testing.T) {
	// tsUTCMondayLateNight is UTC hour 23 -> "Out of session" regardless of
	// what display timezone the request asks for (session windows are
	// fixed UTC, unlike bytime/byday's grouping).
	trades := []model.Trade{
		newTrade("1", "long", tsUTCMondayLateNight, tsUTCMondayLateNight+60, 100, 100),
	}
	stats := computeTradeStats(trades, Request{})
	sessions := buildBySession(stats)
	for _, s := range sessions {
		if s.Session == "Out of session" {
			if s.TotalTrades != 1 {
				t.Errorf("Out of session totalTrades = %d, want 1", s.TotalTrades)
			}
			continue
		}
		if s.TotalTrades != 0 {
			t.Errorf("%s totalTrades = %d, want 0", s.Session, s.TotalTrades)
		}
	}
}
