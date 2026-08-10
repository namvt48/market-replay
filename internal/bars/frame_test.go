package bars

import (
	"bytes"
	"net/http/httptest"
	"testing"
)

func TestWriteFrame_RoundTrip(t *testing.T) {
	f, err := newBarFile(simpleFixture(10, 1000, 60))
	if err != nil {
		t.Fatalf("newBarFile: %v", err)
	}

	win := Window{From: 2, To: 7}
	rec := httptest.NewRecorder()
	if err := WriteFrame(rec, f, win); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	got, err := newBarFile(rec.Body.Bytes())
	if err != nil {
		t.Fatalf("newBarFile(round-trip): %v", err)
	}
	if got.Count() != win.Len() {
		t.Fatalf("Count() = %d, want %d", got.Count(), win.Len())
	}
	for i := 0; i < got.Count(); i++ {
		orig := win.From + i
		if got.TsAt(i) != f.TsAt(orig) || got.OpenAt(i) != f.OpenAt(orig) ||
			got.HighAt(i) != f.HighAt(orig) || got.LowAt(i) != f.LowAt(orig) ||
			got.CloseAt(i) != f.CloseAt(orig) || got.VolumeAt(i) != f.VolumeAt(orig) {
			t.Errorf("bar %d mismatch after round-trip", i)
		}
	}

	if rec.Header().Get("Content-Type") != ContentType {
		t.Errorf("Content-Type = %q, want %q", rec.Header().Get("Content-Type"), ContentType)
	}
	if rec.Header().Get("X-Bars-Count") != "5" {
		t.Errorf("X-Bars-Count = %q, want 5", rec.Header().Get("X-Bars-Count"))
	}
}

func TestWriteFrameJSON(t *testing.T) {
	f, err := newBarFile(simpleFixture(3, 1000, 60))
	if err != nil {
		t.Fatalf("newBarFile: %v", err)
	}
	rec := httptest.NewRecorder()
	if err := WriteFrameJSON(rec, f, Window{From: 0, To: 3}); err != nil {
		t.Fatalf("WriteFrameJSON: %v", err)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"ts":1000`)) {
		t.Errorf("body missing expected ts field: %s", rec.Body.String())
	}
}
