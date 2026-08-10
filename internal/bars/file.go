package bars

import (
	"encoding/binary"
	"fmt"
	"os"
	"sort"

	"golang.org/x/sys/unix"
)

// BarFile is one mmap'd RBR1 file: a fixed-width, ts-sorted array of bars
// for one (symbol, timeframe). All reads go directly against the mmap'd
// bytes via encoding/binary at precomputed column offsets — no eager
// parse into Go structs, no allocation proportional to bar count.
type BarFile struct {
	header Header
	data   []byte // the full mmap'd region, including the 24-byte header

	tsOff, openOff, highOff, lowOff, closeOff, volOff int

	// rollups are derived aggregate indexes over this file's bars, built
	// once at open time so /chart-bars/at costs O(buckets returned) instead
	// of O(raw bars in the window). Never nil after newBarFile.
	rollups *rollups
}

// openBarFile mmaps path and validates it fail-fast: magic/version/flags,
// file size matching the header's declared count, and every ts strictly
// increasing. A corrupt or truncated file is rejected here, not discovered
// later via an out-of-range slice.
func openBarFile(path string) (*BarFile, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("bars: open %s: %w", path, err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("bars: stat %s: %w", path, err)
	}
	size := info.Size()
	if size == 0 {
		return nil, fmt.Errorf("bars: %s: %w", path, ErrEmptyFile)
	}
	if size < headerSize {
		return nil, fmt.Errorf("bars: %s: %w", path, ErrTruncatedHeader)
	}

	data, err := unix.Mmap(int(f.Fd()), 0, int(size), unix.PROT_READ, unix.MAP_SHARED)
	if err != nil {
		return nil, fmt.Errorf("bars: mmap %s: %w", path, err)
	}

	bf, err := newBarFile(data)
	if err != nil {
		_ = unix.Munmap(data)
		return nil, fmt.Errorf("bars: %s: %w", path, err)
	}
	return bf, nil
}

// newBarFile validates an already-loaded byte slice (mmap'd in production,
// a plain []byte in tests) and builds a BarFile over it in place.
func newBarFile(data []byte) (*BarFile, error) {
	h, err := parseHeader(data)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) != h.expectedFileSize() {
		return nil, fmt.Errorf("%w: have %d bytes, want %d for %d bars", ErrSizeMismatch, len(data), h.expectedFileSize(), h.Count)
	}

	n := int(h.Count)
	tsOff := headerSize
	openOff := tsOff + 4*n
	highOff := openOff + 4*n
	lowOff := highOff + 4*n
	closeOff := lowOff + 4*n
	volOff := closeOff + 4*n

	bf := &BarFile{
		header: h, data: data,
		tsOff: tsOff, openOff: openOff, highOff: highOff,
		lowOff: lowOff, closeOff: closeOff, volOff: volOff,
	}

	prev := int64(-1)
	for i := 0; i < n; i++ {
		ts := bf.TsAt(i)
		if ts <= prev {
			return nil, fmt.Errorf("%w: bar %d ts=%d <= previous %d", ErrNonMonotonicTs, i, ts, prev)
		}
		prev = ts
	}
	// Only index a file that already passed validation — buildRollups
	// assumes strictly increasing ts and in-range column offsets.
	bf.rollups = buildRollups(bf)
	return bf, nil
}

// Close unmaps the underlying file. Callers must not use the BarFile (or
// any byte range obtained from it) after Close returns.
func (f *BarFile) Close() error {
	return unix.Munmap(f.data)
}

func (f *BarFile) Count() int     { return int(f.header.Count) }
func (f *BarFile) TickNum() int32 { return f.header.TickNum }
func (f *BarFile) TickDen() int32 { return f.header.TickDen }

func (f *BarFile) TsAt(i int) int64 { return int64(binary.LittleEndian.Uint32(f.data[f.tsOff+4*i:])) }
func (f *BarFile) OpenAt(i int) int32 {
	return int32(binary.LittleEndian.Uint32(f.data[f.openOff+4*i:]))
}
func (f *BarFile) HighAt(i int) int32 {
	return int32(binary.LittleEndian.Uint32(f.data[f.highOff+4*i:]))
}
func (f *BarFile) LowAt(i int) int32 { return int32(binary.LittleEndian.Uint32(f.data[f.lowOff+4*i:])) }
func (f *BarFile) CloseAt(i int) int32 {
	return int32(binary.LittleEndian.Uint32(f.data[f.closeOff+4*i:]))
}
func (f *BarFile) VolumeAt(i int) uint32 { return binary.LittleEndian.Uint32(f.data[f.volOff+4*i:]) }

// IndexAtOrAfter returns the index of the first bar with ts >= target, or
// Count() if every bar is before target.
func (f *BarFile) IndexAtOrAfter(target int64) int {
	n := f.Count()
	return sort.Search(n, func(i int) bool { return f.TsAt(i) >= target })
}

// IndexAtOrBefore returns the index of the last bar with ts <= target, or
// -1 if every bar is after target.
func (f *BarFile) IndexAtOrBefore(target int64) int {
	return f.IndexAtOrAfter(target+1) - 1
}

// Window is a half-open bar-index range [From,To) into a BarFile.
type Window struct {
	From, To int
}

// Len reports the number of bars in the window.
func (w Window) Len() int { return w.To - w.From }

// RangeWindow returns the window of bars with ts in [fromTs,toTs]
// (inclusive), capped to at most limit bars kept from the start of the
// range. truncated reports whether the range held more bars than limit.
// fromTs must be <= toTs; callers validate this at the HTTP boundary.
func (f *BarFile) RangeWindow(fromTs, toTs int64, limit int) (win Window, truncated bool) {
	from := f.IndexAtOrAfter(fromTs)
	to := f.IndexAtOrAfter(toTs + 1) // toTs is inclusive
	if to < from {
		to = from
	}
	if to > from+limit {
		to = from + limit
		truncated = true
	}
	return Window{From: from, To: to}, truncated
}

// SeekWindow returns up to `before` bars ending at-or-before atTs, plus up
// to `after` bars following it. One call answers one seek (docs §6.3).
func (f *BarFile) SeekWindow(atTs int64, before, after int) Window {
	idx := f.IndexAtOrBefore(atTs)
	from := idx - before + 1
	if from < 0 {
		from = 0
	}
	to := idx + 1 + after
	if n := f.Count(); to > n {
		to = n
	}
	if to < from {
		to = from
	}
	return Window{From: from, To: to}
}

// Byte-range accessors for the wire-format writer (frame.go). Returning
// the raw mmap'd bytes lets WriteFrame copy columns straight to the
// response with no per-bar allocation or parsing.
func (f *BarFile) tsBytes(w Window) []byte    { return f.data[f.tsOff+4*w.From : f.tsOff+4*w.To] }
func (f *BarFile) openBytes(w Window) []byte  { return f.data[f.openOff+4*w.From : f.openOff+4*w.To] }
func (f *BarFile) highBytes(w Window) []byte  { return f.data[f.highOff+4*w.From : f.highOff+4*w.To] }
func (f *BarFile) lowBytes(w Window) []byte   { return f.data[f.lowOff+4*w.From : f.lowOff+4*w.To] }
func (f *BarFile) closeBytes(w Window) []byte { return f.data[f.closeOff+4*w.From : f.closeOff+4*w.To] }
func (f *BarFile) volBytes(w Window) []byte   { return f.data[f.volOff+4*w.From : f.volOff+4*w.To] }
