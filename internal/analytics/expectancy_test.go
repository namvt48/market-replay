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

func TestExpectancy_MonetaryTotalsUsePnLSignsWithinBreakevenTolerance(t *testing.T) {
	trades := []model.Trade{
		newTrade("small-win", "long", 0, 10, 100, 1),
		newTrade("small-loss", "short", 20, 30, 100, -1),
	}
	stats := computeTradeStats(trades, Request{BreakevenThresholdCents: 5})
	if stats[0].result != resultBreakeven || stats[1].result != resultBreakeven {
		t.Fatalf("results = %q, %q, want both breakeven by tolerance", stats[0].result, stats[1].result)
	}
	exp := buildExpectancy(stats)
	if exp.Value != 0 || exp.AverageWin != 0.01 || exp.AverageLoss != -0.01 || exp.ProfitFactor == nil || *exp.ProfitFactor != 1 {
		t.Errorf("expectancy = %+v, want mean 0, signed averages ±$0.01, PF 1", exp)
	}
}

func TestExpectancy_AllZeroTradesDoNotReportNoLossesOnly(t *testing.T) {
	stats := []*tradeStat{{netPnlCents: 0}}
	exp := buildExpectancy(stats)
	if exp.ProfitFactor != nil || exp.ProfitFactorNote != "no_profits_or_losses" {
		t.Errorf("profit factor = %v (%q), want null with no_profits_or_losses", exp.ProfitFactor, exp.ProfitFactorNote)
	}
}

func TestExpectancy_OnlyLossesHaveZeroProfitFactor(t *testing.T) {
	stats := computeTradeStats([]model.Trade{newTrade("loss", "long", 0, 10, 100, -100)}, Request{})
	exp := buildExpectancy(stats)
	if exp.Value != -1 || exp.AverageWin != 0 || exp.AverageLoss != -1 || exp.ProfitFactor == nil || *exp.ProfitFactor != 0 {
		t.Errorf("expectancy = %+v, want -$1 mean/loss and PF 0", exp)
	}
}
