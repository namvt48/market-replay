package httpapi

import (
	"net/url"
	"testing"
)

func TestParamHelpersReadPreparsedValues(t *testing.T) {
	t.Parallel()

	query := url.Values{
		"symbol": {"NQ"},
		"at":     {"1700000000"},
		"before": {"9999"},
	}

	if got, err := requiredParam(query, "symbol"); err != nil || got != "NQ" {
		t.Fatalf("requiredParam = %q, %v; want NQ", got, err)
	}
	if got, err := parseInt64Required(query, "at"); err != nil || got != 1_700_000_000 {
		t.Fatalf("parseInt64Required = %d, %v", got, err)
	}
	if got, err := parseInt64(query, "to", 42); err != nil || got != 42 {
		t.Fatalf("parseInt64 default = %d, %v; want 42", got, err)
	}
	if got, err := parseIntClamped(query, "before", 240, 0, 2_000); err != nil || got != 2_000 {
		t.Fatalf("parseIntClamped = %d, %v; want 2000", got, err)
	}
}

func BenchmarkParamHelpersWithParsedValues(b *testing.B) {
	query := url.Values{
		"symbol": {"NQ"}, "tf": {"1M"}, "at": {"1700000000"},
		"before": {"240"}, "after": {"0"}, "to": {"1700000000"}, "session": {"rth"},
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_, _ = requiredParam(query, "symbol")
		_, _ = requiredParam(query, "tf")
		_, _ = parseInt64Required(query, "at")
		_, _ = parseIntClamped(query, "before", 240, 0, 2_000)
		_, _ = parseIntClamped(query, "after", 0, 0, 2_000)
		_, _ = parseInt64(query, "to", 1_700_000_000)
		_ = query.Get("session")
	}
}
