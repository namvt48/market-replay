package analytics

import (
	"testing"

	"market-replay/internal/model"
)

func TestExpectancy_ProfitFactorNoLosses(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", 0, 10, 100, 1000),
		newTrade("2", "long", 20, 30, 100, 2000),
	}
	stats := computeTradeStats(trades, Request{})
	exp := buildExpectancy(stats)
	if exp.ProfitFactor != nil {
		t.Fatalf("profitFactor = %v, want nil", *exp.ProfitFactor)
	}
	if exp.ProfitFactorNote != "no_losses" {
		t.Errorf("profitFactorNote = %q, want %q", exp.ProfitFactorNote, "no_losses")
	}
	if isNaNOrInf(exp.Value) {
		t.Errorf("expectancy value is NaN/Inf: %v", exp.Value)
	}
}

func TestExpectancy_ProfitFactorNoTrades(t *testing.T) {
	stats := computeTradeStats(nil, Request{})
	exp := buildExpectancy(stats)
	if exp.ProfitFactor != nil {
		t.Fatalf("profitFactor = %v, want nil", *exp.ProfitFactor)
	}
	if exp.ProfitFactorNote != "no_trades" {
		t.Errorf("profitFactorNote = %q, want %q", exp.ProfitFactorNote, "no_trades")
	}
	if exp.Value != 0 || exp.AverageWin != 0 || exp.AverageLoss != 0 {
		t.Errorf("empty expectancy should be all zero, got %+v", exp)
	}
}

func TestExpectancy_ProfitFactorComputed(t *testing.T) {
	trades := []model.Trade{
		newTrade("1", "long", 0, 10, 100, 2000),    // +$20
		newTrade("2", "short", 20, 30, 100, -1000), // -$10
	}
	stats := computeTradeStats(trades, Request{})
	exp := buildExpectancy(stats)
	if exp.ProfitFactor == nil {
		t.Fatalf("profitFactor is nil, want a value")
	}
	if *exp.ProfitFactor != 2.0 {
		t.Errorf("profitFactor = %v, want 2.0 (2000/1000)", *exp.ProfitFactor)
	}
	if exp.AverageWin != 20 {
		t.Errorf("averageWin = %v, want 20", exp.AverageWin)
	}
	if exp.AverageLoss != -10 {
		t.Errorf("averageLoss = %v, want -10", exp.AverageLoss)
	}
}
