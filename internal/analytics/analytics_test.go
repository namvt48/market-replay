package analytics

import (
	"context"
	"testing"
	"time"

	"market-replay/internal/model"
)

func TestBuildReport_EmptySource(t *testing.T) {
	report, err := BuildReport(context.Background(), Request{})
	if err != nil {
		t.Fatalf("BuildReport: %v", err)
	}
	if len(report.EquityCurve) != 1 {
		t.Fatalf("empty source equity curve length = %d, want 1 (the synthetic zero point)", len(report.EquityCurve))
	}
	if report.Overview.TotalTrades != 0 {
		t.Fatalf("totalTrades = %d, want 0", report.Overview.TotalTrades)
	}
	if isNaNOrInf(report.Overview.WinRate) || isNaNOrInf(report.Overview.PnlPercent) {
		t.Fatalf("empty overview has NaN/Inf: %+v", report.Overview)
	}
	if report.Expectancy.ProfitFactorNote != "no_trades" {
		t.Errorf("profitFactorNote = %q, want no_trades", report.Expectancy.ProfitFactorNote)
	}
	if len(report.BySession) != 4 {
		t.Errorf("bySession should still emit all 4 windows, got %d", len(report.BySession))
	}
	if len(report.ByDay) != 7 {
		t.Errorf("byDay should still emit all 7 weekdays, got %d", len(report.ByDay))
	}
	if len(report.ByTime.Pnl) != 24 {
		t.Errorf("byTime should still emit all 24 hours, got %d", len(report.ByTime.Pnl))
	}
}

func TestBuildReport_ContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := BuildReport(ctx, Request{})
	if err == nil {
		t.Fatal("expected an error for a cancelled context, got nil")
	}
	if err != context.Canceled {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}

func TestBuildReport_TwoHundredTradesAggregateInvariants(t *testing.T) {
	const n = 220
	trades := make([]model.Trade, 0, n)
	base := int64(1_700_000_000)
	for i := 0; i < n; i++ {
		side := "long"
		if i%3 == 0 {
			side = "short"
		}
		var pnl int64
		switch i % 5 {
		case 0:
			pnl = 0 // breakeven
		case 1, 2, 3:
			pnl = int64(100 + i) // winner
		case 4:
			pnl = -int64(50 + i) // loser
		}
		entry := base + int64(i)*3*daySeconds
		exit := entry + 3600
		trades = append(trades, newTrade(
			tradeID(i), side, entry, exit, 1000, pnl,
			withRMultiple(float64(pnl)/1000),
		))
	}

	report, err := BuildReport(context.Background(), Request{
		Trades:                  trades,
		Symbol:                  "NQ",
		Timeframe:               "1m",
		InitialBalanceCents:     10_000_000,
		BreakevenThresholdCents: 0,
		Location:                time.UTC,
	})
	if err != nil {
		t.Fatalf("BuildReport: %v", err)
	}

	ov := report.Overview
	if ov.TotalTrades != n {
		t.Fatalf("totalTrades = %d, want %d", ov.TotalTrades, n)
	}
	if ov.LongTrades+ov.ShortTrades != ov.TotalTrades {
		t.Fatalf("longTrades(%d)+shortTrades(%d) != totalTrades(%d)", ov.LongTrades, ov.ShortTrades, ov.TotalTrades)
	}
	if len(report.EquityCurve) != n+1 {
		t.Fatalf("equity curve length = %d, want %d", len(report.EquityCurve), n+1)
	}

	sideTotal := report.BySide.Buy.Trades + report.BySide.Sell.Trades
	if sideTotal != n {
		t.Fatalf("bySide trades sum = %d, want %d", sideTotal, n)
	}

	var byDayTotal int
	for _, d := range report.ByDay {
		byDayTotal += d.TotalTrades
	}
	if byDayTotal != n {
		t.Fatalf("byDay totalTrades sum = %d, want %d", byDayTotal, n)
	}

	var bySessionTotal int
	for _, s := range report.BySession {
		bySessionTotal += s.TotalTrades
	}
	if bySessionTotal != n {
		t.Fatalf("bySession totalTrades sum = %d, want %d", bySessionTotal, n)
	}

	var byMonthTotal int
	for _, m := range report.ByMonth {
		byMonthTotal += m.TotalTrades
	}
	if byMonthTotal != n {
		t.Fatalf("byMonth totalTrades sum = %d, want %d", byMonthTotal, n)
	}

	var calendarTotal int
	for _, d := range report.Calendar {
		calendarTotal += d.Trades
	}
	if calendarTotal != n {
		t.Fatalf("calendar trades sum = %d, want %d", calendarTotal, n)
	}

	if isNaNOrInf(ov.WinRate) || isNaNOrInf(ov.PnlPercent) || isNaNOrInf(ov.AccountBalance) {
		t.Fatalf("overview has NaN/Inf: %+v", ov)
	}
}

func tradeID(i int) string {
	digits := "0123456789abcdefghijklmnopqrstuvwxyz"
	return "trade-" + string(digits[i%len(digits)]) + string(digits[(i/len(digits))%len(digits)]) + string(digits[i/(len(digits)*len(digits))%len(digits)])
}
