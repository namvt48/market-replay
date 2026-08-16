package analytics

import (
	"context"
	"reflect"
	"testing"
)

func baseMonteCarloRequest() MonteCarloRequest {
	return MonteCarloRequest{
		SimulationCount:     10,
		TradesPerSimulation: 10,
		StartBalanceCents:   100_000_00,
		AverageGainCents:    500_00,
		AverageLossCents:    300_00,
		WinRatePercent:      50,
		Seed:                20250816,
	}
}

func TestMonteCarlo_SameSeedIsDeterministic(t *testing.T) {
	req := baseMonteCarloRequest()
	a, err := RunMonteCarlo(context.Background(), req)
	if err != nil {
		t.Fatalf("RunMonteCarlo: %v", err)
	}
	b, err := RunMonteCarlo(context.Background(), req)
	if err != nil {
		t.Fatalf("RunMonteCarlo: %v", err)
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("same seed/input produced different results:\na=%+v\nb=%+v", a, b)
	}
}

func TestMonteCarlo_DifferentSeedDiffersPaths(t *testing.T) {
	req := baseMonteCarloRequest()
	a, err := RunMonteCarlo(context.Background(), req)
	if err != nil {
		t.Fatalf("RunMonteCarlo: %v", err)
	}
	req.Seed = req.Seed + 1
	b, err := RunMonteCarlo(context.Background(), req)
	if err != nil {
		t.Fatalf("RunMonteCarlo: %v", err)
	}
	if reflect.DeepEqual(a.Paths, b.Paths) {
		t.Fatalf("different seeds produced identical paths")
	}
}

func TestMonteCarlo_WinRateZeroPercent(t *testing.T) {
	req := baseMonteCarloRequest()
	req.WinRatePercent = 0
	result, err := RunMonteCarlo(context.Background(), req)
	if err != nil {
		t.Fatalf("RunMonteCarlo: %v", err)
	}
	if result.Summary.TotalWins != 0 {
		t.Errorf("totalWins = %d, want 0", result.Summary.TotalWins)
	}
	wantLosses := req.SimulationCount * req.TradesPerSimulation
	if result.Summary.TotalLosses != wantLosses {
		t.Errorf("totalLosses = %d, want %d", result.Summary.TotalLosses, wantLosses)
	}
	if result.Summary.MaxConsecutiveWins != 0 {
		t.Errorf("maxConsecutiveWins = %d, want 0", result.Summary.MaxConsecutiveWins)
	}
	if result.Summary.MaxConsecutiveLosses != req.TradesPerSimulation {
		t.Errorf("maxConsecutiveLosses = %d, want %d (every trade loses)", result.Summary.MaxConsecutiveLosses, req.TradesPerSimulation)
	}
}

func TestMonteCarlo_WinRateHundredPercent(t *testing.T) {
	req := baseMonteCarloRequest()
	req.WinRatePercent = 100
	result, err := RunMonteCarlo(context.Background(), req)
	if err != nil {
		t.Fatalf("RunMonteCarlo: %v", err)
	}
	if result.Summary.TotalLosses != 0 {
		t.Errorf("totalLosses = %d, want 0", result.Summary.TotalLosses)
	}
	wantWins := req.SimulationCount * req.TradesPerSimulation
	if result.Summary.TotalWins != wantWins {
		t.Errorf("totalWins = %d, want %d", result.Summary.TotalWins, wantWins)
	}
	// Zero simulated losses -> profit factor must be nil+note, never +Inf.
	if result.Summary.AverageProfitFactor != nil {
		t.Errorf("averageProfitFactor = %v, want nil", *result.Summary.AverageProfitFactor)
	}
	if result.Summary.AverageProfitFactorNote != "no_losses" {
		t.Errorf("averageProfitFactorNote = %q, want %q", result.Summary.AverageProfitFactorNote, "no_losses")
	}
	wantEnding := req.StartBalanceCents + int64(req.TradesPerSimulation)*req.AverageGainCents
	if result.Summary.MaxEndingBalance != centsToDollars(wantEnding) {
		t.Errorf("maxEndingBalance = %v, want %v", result.Summary.MaxEndingBalance, centsToDollars(wantEnding))
	}
	if result.Summary.MinEndingBalance != centsToDollars(wantEnding) {
		t.Errorf("minEndingBalance = %v, want %v (every path identical at 100%% win rate)", result.Summary.MinEndingBalance, centsToDollars(wantEnding))
	}
}

func TestMonteCarlo_StreakDoesNotCrossPaths(t *testing.T) {
	// 1 trade per simulation can never itself prove a streak reset, but
	// across many single-trade paths the max streak must never exceed 1 —
	// if streaks leaked across paths it would compound past that.
	req := baseMonteCarloRequest()
	req.TradesPerSimulation = 1
	req.SimulationCount = 200
	req.WinRatePercent = 50
	result, err := RunMonteCarlo(context.Background(), req)
	if err != nil {
		t.Fatalf("RunMonteCarlo: %v", err)
	}
	if result.Summary.MaxConsecutiveWins > 1 || result.Summary.MaxConsecutiveLosses > 1 {
		t.Errorf("streak leaked across paths: maxConsecutiveWins=%d maxConsecutiveLosses=%d",
			result.Summary.MaxConsecutiveWins, result.Summary.MaxConsecutiveLosses)
	}
}

func TestMonteCarlo_BalancesShapeAndNoNaNOrInf(t *testing.T) {
	req := baseMonteCarloRequest()
	result, err := RunMonteCarlo(context.Background(), req)
	if err != nil {
		t.Fatalf("RunMonteCarlo: %v", err)
	}
	if len(result.Paths) != req.SimulationCount {
		t.Fatalf("paths = %d, want %d", len(result.Paths), req.SimulationCount)
	}
	for _, p := range result.Paths {
		if len(p.Balances) != req.TradesPerSimulation+1 {
			t.Errorf("path %d balances len = %d, want %d", p.SimulationIndex, len(p.Balances), req.TradesPerSimulation+1)
		}
		if p.Balances[0] != centsToDollars(req.StartBalanceCents) {
			t.Errorf("path %d balances[0] = %v, want start balance", p.SimulationIndex, p.Balances[0])
		}
		for _, b := range p.Balances {
			if isNaNOrInf(b) {
				t.Errorf("path %d has NaN/Inf balance", p.SimulationIndex)
			}
		}
	}
	if got := result.Summary.TotalWins + result.Summary.TotalLosses; got != req.SimulationCount*req.TradesPerSimulation {
		t.Errorf("totalWins+totalLosses = %d, want %d", got, req.SimulationCount*req.TradesPerSimulation)
	}
	if isNaNOrInf(result.Summary.AverageEndingBalance) || isNaNOrInf(result.Summary.MaxEndingBalance) || isNaNOrInf(result.Summary.MinEndingBalance) {
		t.Errorf("summary has NaN/Inf: %+v", result.Summary)
	}
}
