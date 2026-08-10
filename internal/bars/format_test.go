package bars

import (
	"encoding/binary"
	"errors"
	"testing"
)

func TestParseHeader_Valid(t *testing.T) {
	h, err := parseHeader(simpleFixture(3, 1000, 60))
	if err != nil {
		t.Fatalf("parseHeader: %v", err)
	}
	if h.Count != 3 || h.TickNum != 1 || h.TickDen != 4 {
		t.Errorf("header = %+v, unexpected", h)
	}
}

func TestParseHeader_BadMagic(t *testing.T) {
	data := simpleFixture(1, 1000, 60)
	copy(data[0:4], "XXXX")
	if _, err := parseHeader(data); !errors.Is(err, ErrBadMagic) {
		t.Fatalf("err = %v, want ErrBadMagic", err)
	}
}

func TestParseHeader_UnsupportedVersion(t *testing.T) {
	data := simpleFixture(1, 1000, 60)
	binary.LittleEndian.PutUint16(data[4:6], 2)
	if _, err := parseHeader(data); !errors.Is(err, ErrUnsupportedVersion) {
		t.Fatalf("err = %v, want ErrUnsupportedVersion", err)
	}
}

func TestParseHeader_PriceEncoding(t *testing.T) {
	data := simpleFixture(1, 1000, 60)
	binary.LittleEndian.PutUint16(data[6:8], 0) // clear bit0 (ticks flag)
	if _, err := parseHeader(data); !errors.Is(err, ErrPriceEncoding) {
		t.Fatalf("err = %v, want ErrPriceEncoding", err)
	}
}

func TestParseHeader_TruncatedHeader(t *testing.T) {
	if _, err := parseHeader(make([]byte, 10)); !errors.Is(err, ErrTruncatedHeader) {
		t.Fatalf("err = %v, want ErrTruncatedHeader", err)
	}
}

func TestParseHeader_EmptyFile(t *testing.T) {
	if _, err := parseHeader(simpleFixture(0, 1000, 60)); !errors.Is(err, ErrEmptyFile) {
		t.Fatalf("err = %v, want ErrEmptyFile", err)
	}
}
