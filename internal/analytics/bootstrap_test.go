package analytics

import (
	"context"
	"reflect"
	"testing"
)

func TestBootstrap_DeterministicForFixedSeedAndOrderedIntervals(t *testing.T) {
	values := []float64{1.4, -0.8, 2.1, -1, 0.7, 1.2}
	iterations := 400
	first, err := BootstrapAnalytics(context.Background(), values, BootstrapOptions{Iterations: &iterations, Seed: 42})
	if err != nil {
		t.Fatalf("BootstrapAnalytics: %v", err)
	}
	second, err := BootstrapAnalytics(context.Background(), values, BootstrapOptions{Iterations: &iterations, Seed: 42})
	if err != nil {
		t.Fatalf("BootstrapAnalytics: %v", err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("same seed/input produced different results:\nfirst=%+v\nsecond=%+v", first, second)
	}
	if first.TradeRSharpe == nil {
		t.Fatal("tradeRSharpe = nil, want a defined interval for variable returns")
	}
	for _, interval := range []ConfidenceInterval{first.ExpectancyR, first.MaxDrawdownR, *first.TradeRSharpe} {
		if interval.Lower > interval.Median {
			t.Errorf("interval.lower %v > median %v", interval.Lower, interval.Median)
		}
		if interval.Median > interval.Upper {
			t.Errorf("interval.median %v > upper %v", interval.Median, interval.Upper)
		}
	}
}

func TestBootstrap_EmptySampleIsStableZero(t *testing.T) {
	iterations := 100
	result, err := BootstrapAnalytics(context.Background(), nil, BootstrapOptions{Iterations: &iterations})
	if err != nil {
		t.Fatalf("BootstrapAnalytics: %v", err)
	}
	want := ConfidenceInterval{}
	if result.ExpectancyR != want {
		t.Errorf("expectancyR = %+v, want zero interval", result.ExpectancyR)
	}
	if result.MaxDrawdownR != want || result.TradeRSharpe != nil {
		t.Errorf("maxDrawdownR/sharpe not zero/null: %+v / %+v", result.MaxDrawdownR, result.TradeRSharpe)
	}
}

func TestBootstrap_DifferentSeedDiffersResult(t *testing.T) {
	values := []float64{1, -1, 2, -0.5, 0.3, 1.1, -0.2}
	iterations := 500
	a, err := BootstrapAnalytics(context.Background(), values, BootstrapOptions{Iterations: &iterations, Seed: 1})
	if err != nil {
		t.Fatalf("BootstrapAnalytics: %v", err)
	}
	b, err := BootstrapAnalytics(context.Background(), values, BootstrapOptions{Iterations: &iterations, Seed: 2})
	if err != nil {
		t.Fatalf("BootstrapAnalytics: %v", err)
	}
	if reflect.DeepEqual(a, b) {
		t.Fatalf("different seeds produced identical bootstrap results")
	}
}

func TestBootstrap_NoNaNOrInf(t *testing.T) {
	values := []float64{1, -1, 2, -0.5, 0.3, 1.1, -0.2, 0, 3, -2}
	iterations := 1000
	confidence := 0.9
	result, err := BootstrapAnalytics(context.Background(), values, BootstrapOptions{Iterations: &iterations, Confidence: &confidence, Seed: 20250816})
	if err != nil {
		t.Fatalf("BootstrapAnalytics: %v", err)
	}
	for _, interval := range []*ConfidenceInterval{&result.ExpectancyR, &result.MaxDrawdownR, result.TradeRSharpe} {
		if interval == nil {
			continue
		}
		if isNaNOrInf(interval.Lower) || isNaNOrInf(interval.Median) || isNaNOrInf(interval.Upper) {
			t.Errorf("interval has NaN/Inf: %+v", *interval)
		}
	}
}
func TestSharpeOfUsesSampleDeviationWithoutAnnualizing(t *testing.T) {
	got, ok := sharpeOf([]float64{1, 2})
	if !ok {
		t.Fatal("sharpeOf([1,2]) undefined, want defined")
	}
	if got < 2.1213203435-1e-9 || got > 2.1213203435+1e-9 {
		t.Errorf("Sharpe = %.12f, want mean/sampleStdDev = %.12f", got, 2.1213203435)
	}
	if _, ok := sharpeOf([]float64{1, 1}); ok {
		t.Error("constant returns produced a defined Sharpe; want undefined")
	}
}

func TestBootstrap_IterationsAndConfidenceClamped(t *testing.T) {
	tooFew, tooMany := 1, 1_000_000
	lowConf, highConf := 0.01, 0.999
	a, err := BootstrapAnalytics(context.Background(), []float64{1, -1}, BootstrapOptions{Iterations: &tooFew, Confidence: &lowConf, Seed: 1})
	if err != nil {
		t.Fatalf("BootstrapAnalytics: %v", err)
	}
	if a.Iterations != bootstrapMinIterations {
		t.Errorf("iterations = %d, want clamped to %d", a.Iterations, bootstrapMinIterations)
	}
	if a.Confidence != bootstrapMinConfidence {
		t.Errorf("confidence = %v, want clamped to %v", a.Confidence, bootstrapMinConfidence)
	}
	b, err := BootstrapAnalytics(context.Background(), []float64{1, -1}, BootstrapOptions{Iterations: &tooMany, Confidence: &highConf, Seed: 1})
	if err != nil {
		t.Fatalf("BootstrapAnalytics: %v", err)
	}
	if b.Iterations != bootstrapMaxIterations {
		t.Errorf("iterations = %d, want clamped to %d", b.Iterations, bootstrapMaxIterations)
	}
	if b.Confidence != bootstrapMaxConfidence {
		t.Errorf("confidence = %v, want clamped to %v", b.Confidence, bootstrapMaxConfidence)
	}
}

func TestBootstrap_CancellationStopsPromptlyWithError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	iterations := bootstrapMaxIterations
	_, err := BootstrapAnalytics(ctx, []float64{1, -1, 2, -0.5}, BootstrapOptions{Iterations: &iterations, Seed: 1})
	if err == nil {
		t.Fatal("err = nil, want context.Canceled")
	}
}
