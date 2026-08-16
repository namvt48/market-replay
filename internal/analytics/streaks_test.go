package analytics

import (
	"testing"

	"market-replay/internal/model"
)

func TestConsecutiveRuns_MaxAndAverage(t *testing.T) {
	// W W L W W W B L L  (B=breakeven interrupts both streak types)
	trades := []model.Trade{
		newTrade("1", "long", 0, 1, 100, 100),
		newTrade("2", "long", 2, 3, 100, 100),
		newTrade("3", "long", 4, 5, 100, -100),
		newTrade("4", "long", 6, 7, 100, 100),
		newTrade("5", "long", 8, 9, 100, 100),
		newTrade("6", "long", 10, 11, 100, 100),
		newTrade("7", "long", 12, 13, 100, 0),
		newTrade("8", "long", 14, 15, 100, -100),
		newTrade("9", "long", 16, 17, 100, -100),
	}
	stats := computeTradeStats(trades, Request{})
	maxWin, avgWin := consecutiveRuns(stats, resultWinner)
	if maxWin != 3 {
		t.Errorf("max winner streak = %d, want 3", maxWin)
	}
	wantAvgWin := float64(2+3) / 2 // runs of length 2 and 3
	if avgWin != wantAvgWin {
		t.Errorf("avg winner streak = %v, want %v", avgWin, wantAvgWin)
	}
	maxLoss, avgLoss := consecutiveRuns(stats, resultLoser)
	if maxLoss != 2 {
		t.Errorf("max loser streak = %d, want 2", maxLoss)
	}
	wantAvgLoss := float64(1+2) / 2 // runs of length 1 (trade 3) and 2 (trades 8,9)
	if avgLoss != wantAvgLoss {
		t.Errorf("avg loser streak = %v, want %v", avgLoss, wantAvgLoss)
	}
}

func TestConsecutiveRuns_Empty(t *testing.T) {
	max, avg := consecutiveRuns(nil, resultWinner)
	if max != 0 || avg != 0 {
		t.Fatalf("empty input: got max=%d avg=%v, want 0/0", max, avg)
	}
}

func TestBuildWinnersStats_BestAndAveragePercent(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", 0, 100, 100, 2000),   // +$20, duration 100s
		newTrade("2", "long", 200, 500, 100, 1000), // +$10, duration 300s
		newTrade("3", "long", 600, 610, 100, -500), // loser, ignored
	}
	stats := computeTradeStats(trades, Request{})
	w := buildWinnersStats(stats, 100_000) // $1000 initial balance
	if w.Total != 2 {
		t.Fatalf("total = %d, want 2", w.Total)
	}
	if w.BestWinPercent != 2.0 { // $20 / $1000 * 100
		t.Errorf("bestWinPercent = %v, want 2.0", w.BestWinPercent)
	}
	wantAvg := (2.0 + 1.0) / 2
	if w.AverageWinPercent != wantAvg {
		t.Errorf("averageWinPercent = %v, want %v", w.AverageWinPercent, wantAvg)
	}
	wantDuration := (100.0 + 300.0) / 2
	if w.AverageDurationSeconds != wantDuration {
		t.Errorf("averageDurationSeconds = %v, want %v", w.AverageDurationSeconds, wantDuration)
	}
}
