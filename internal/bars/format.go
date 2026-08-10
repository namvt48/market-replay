// Package bars reads the RBR1 binary bar format (docs §6.2) directly from
// mmap'd files: a 24-byte header followed by six column-major arrays
// (ts, open, high, low, close, volume), little-endian. The on-disk bytes
// ARE the wire format, so the hot path never parses into Go structs — it
// reads individual fields via encoding/binary where needed (binary search)
// and copies raw byte ranges straight to the HTTP response otherwise.
package bars

import (
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	magic = "RBR1"

	// headerSize is the fixed 24-byte header: magic(4) version(2) flags(2)
	// count(4) tickNum(4) tickDen(4) reserved(4).
	headerSize = 24

	// bytesPerBar is the total body cost per bar across all six columns
	// (4 bytes each for ts,open,high,low,close,volume) — NOT a contiguous
	// per-bar record; the layout is column-major.
	bytesPerBar = 24

	// priceAsTicksFlag (bit 0) marks that open/high/low/close are int32
	// ticks, not raw floats. compile.py always sets it; this reader
	// refuses to interpret a file that doesn't (no other encoding is
	// implemented).
	priceAsTicksFlag = 1 << 0
)

var (
	ErrBadMagic           = errors.New("bars: bad magic")
	ErrUnsupportedVersion = errors.New("bars: unsupported version")
	ErrPriceEncoding      = errors.New("bars: prices are not int32 ticks (unsupported flags)")
	ErrTruncatedHeader    = errors.New("bars: file shorter than header")
	ErrSizeMismatch       = errors.New("bars: file size does not match header count")
	ErrNonMonotonicTs     = errors.New("bars: timestamps not strictly increasing")
	ErrEmptyFile          = errors.New("bars: empty file (zero bars)")
)

// Header is the RBR1 file header (docs §6.2).
type Header struct {
	Version  uint16
	Flags    uint16
	Count    uint32
	TickNum  int32
	TickDen  int32
	Reserved uint32
}

// parseHeader validates and decodes the first 24 bytes of an RBR1 file.
// It does not validate file size or ts monotonicity — those require the
// full body and are checked by openBarFile once mmap'd.
func parseHeader(b []byte) (Header, error) {
	if len(b) < headerSize {
		return Header{}, ErrTruncatedHeader
	}
	if string(b[0:4]) != magic {
		return Header{}, fmt.Errorf("%w: got %q", ErrBadMagic, b[0:4])
	}
	h := Header{
		Version:  binary.LittleEndian.Uint16(b[4:6]),
		Flags:    binary.LittleEndian.Uint16(b[6:8]),
		Count:    binary.LittleEndian.Uint32(b[8:12]),
		TickNum:  int32(binary.LittleEndian.Uint32(b[12:16])),
		TickDen:  int32(binary.LittleEndian.Uint32(b[16:20])),
		Reserved: binary.LittleEndian.Uint32(b[20:24]),
	}
	if h.Version != 1 {
		return Header{}, fmt.Errorf("%w: got %d", ErrUnsupportedVersion, h.Version)
	}
	if h.Flags&priceAsTicksFlag == 0 {
		return Header{}, ErrPriceEncoding
	}
	if h.Count == 0 {
		return Header{}, ErrEmptyFile
	}
	if h.TickDen == 0 {
		return Header{}, fmt.Errorf("bars: tickDen is zero")
	}
	return h, nil
}

// expectedFileSize is the exact byte length an RBR1 file with this header
// must have.
func (h Header) expectedFileSize() int64 {
	return int64(headerSize) + int64(h.Count)*int64(bytesPerBar)
}
