package bars

import (
	"errors"
	"testing"
)

func TestNewBarFile_Valid(t *testing.T) {
	f, err := newUTCIndexedBarFile(simpleFixture(5, 1000, 60))
	if err != nil {
		t.Fatalf("newUTCIndexedBarFile: %v", err)
	}
	if f.Count() != 5 {
		t.Fatalf("Count() = %d, want 5", f.Count())
	}
	if f.TsAt(0) != 1000 || f.TsAt(4) != 1240 {
		t.Errorf("TsAt boundary mismatch: %d, %d", f.TsAt(0), f.TsAt(4))
	}
}

func TestNewBarFile_SizeMismatch(t *testing.T) {
	data := simpleFixture(5, 1000, 60)
	truncated := data[:len(data)-4] // chop part of the volume column
	if _, err := newUTCIndexedBarFile(truncated); !errors.Is(err, ErrSizeMismatch) {
		t.Fatalf("err = %v, want ErrSizeMismatch", err)
	}
}

func TestNewBarFile_NonMonotonicTs(t *testing.T) {
	data := buildFixture(
		[]uint32{100, 100, 200}, // duplicate ts -> not strictly increasing
		[]int32{1, 1, 1}, []int32{2, 2, 2}, []int32{0, 0, 0}, []int32{1, 1, 1}, []uint32{1, 1, 1},
	)
	if _, err := newUTCIndexedBarFile(data); !errors.Is(err, ErrNonMonotonicTs) {
		t.Fatalf("err = %v, want ErrNonMonotonicTs", err)
	}
}

func TestIndexAtOrAfter_And_Before(t *testing.T) {
	f, err := newUTCIndexedBarFile(simpleFixture(5, 100, 100)) // ts: 100,200,300,400,500
	if err != nil {
		t.Fatalf("newUTCIndexedBarFile: %v", err)
	}

	tests := []struct {
		name                  string
		ts                    int64
		wantAfter, wantBefore int
	}{
		{"exact hit middle", 300, 2, 2},
		{"gap between bars", 250, 2, 1},
		{"before first", 0, 0, -1},
		{"after last", 10000, 5, 4},
		{"exact first", 100, 0, 0},
		{"exact last", 500, 4, 4},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := f.IndexAtOrAfter(tt.ts); got != tt.wantAfter {
				t.Errorf("IndexAtOrAfter(%d) = %d, want %d", tt.ts, got, tt.wantAfter)
			}
			if got := f.IndexAtOrBefore(tt.ts); got != tt.wantBefore {
				t.Errorf("IndexAtOrBefore(%d) = %d, want %d", tt.ts, got, tt.wantBefore)
			}
		})
	}
}

func TestSeekWindow(t *testing.T) {
	f, err := newUTCIndexedBarFile(simpleFixture(10, 0, 60)) // ts: 0,60,...,540
	if err != nil {
		t.Fatalf("newUTCIndexedBarFile: %v", err)
	}

	win := f.SeekWindow(300, 3, 1) // idx-at-or-before(300)=5; [5-3+1, 5+1+1) = [3,7)
	if win.From != 3 || win.To != 7 {
		t.Errorf("SeekWindow(300,3,1) = %+v, want {3,7}", win)
	}

	winStart := f.SeekWindow(60, 5, 0) // idx=1, from=1-5+1=-3 -> clamp 0
	if winStart.From != 0 {
		t.Errorf("SeekWindow clamp start: From=%d, want 0", winStart.From)
	}

	winEnd := f.SeekWindow(540, 1, 20) // idx=9 (last), to=9+1+20=30 -> clamp 10
	if winEnd.To != 10 {
		t.Errorf("SeekWindow clamp end: To=%d, want 10", winEnd.To)
	}
}

func TestRangeWindow_Truncation(t *testing.T) {
	f, err := newUTCIndexedBarFile(simpleFixture(10, 0, 60))
	if err != nil {
		t.Fatalf("newUTCIndexedBarFile: %v", err)
	}

	win, truncated := f.RangeWindow(0, 540, 5)
	if !truncated {
		t.Error("truncated = false, want true (10 bars in range, limit 5)")
	}
	if win.Len() != 5 {
		t.Errorf("Len() = %d, want 5", win.Len())
	}

	win2, truncated2 := f.RangeWindow(0, 540, 100)
	if truncated2 {
		t.Error("truncated = true, want false (limit exceeds available bars)")
	}
	if win2.Len() != 10 {
		t.Errorf("Len() = %d, want 10", win2.Len())
	}
}
