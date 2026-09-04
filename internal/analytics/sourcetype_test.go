package analytics

import (
	"testing"

	"market-replay/internal/model"
)

func TestSourceTypeForKindLive(t *testing.T) {
	if got := SourceTypeForKind(model.SessionKindLive); got != SourceTypeLive {
		t.Fatalf("SourceTypeForKind(live) = %q, want %q", got, SourceTypeLive)
	}
}

func TestKindForSourceTypeLive(t *testing.T) {
	kind, ok := KindForSourceType(string(SourceTypeLive))
	if !ok || kind != model.SessionKindLive {
		t.Fatalf("KindForSourceType(live) = %q, %v; want %q, true", kind, ok, model.SessionKindLive)
	}
}

func TestKindForSourceTypeRejectsUnknown(t *testing.T) {
	if _, ok := KindForSourceType("mars"); ok {
		t.Fatal("KindForSourceType(mars) ok = true, want false")
	}
}
