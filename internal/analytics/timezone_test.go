package analytics

import (
	"testing"
	"time"
)

func TestLoadLocationSupportsFixedUTCOffsets(t *testing.T) {
	location, err := LoadLocation("UTC+07:30")
	if err != nil {
		t.Fatalf("LoadLocation fixed offset: %v", err)
	}
	_, offset := time.Date(2026, time.August, 7, 12, 0, 0, 0, location).Zone()
	if offset != 7*60*60+30*60 {
		t.Fatalf("offset = %d, want %d", offset, 7*60*60+30*60)
	}
	if _, err := LoadLocation("UTC+15:00"); err == nil {
		t.Fatal("LoadLocation accepted an out-of-range fixed offset")
	}
}
