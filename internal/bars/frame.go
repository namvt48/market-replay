package bars

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
)

// ContentType is the media type for the RBR1 binary frame response body
// (docs §6.2/§6.3).
const ContentType = "application/vnd.replay.bars.v1"

// WriteFrame writes win as an RBR1 binary frame to w: a fresh 24-byte
// header (Count = win.Len()) followed by six raw byte-range writes copied
// straight from the mmap'd file — no per-bar allocation, no parsing.
// Callers needing X-Bars-Truncated (only meaningful for /bars, not
// /bars/at) must set it before calling WriteFrame, since headers can't
// change once Write has been called. Caching headers belong to the caller
// too: only the httpapi layer knows which dataset the window came from, and
// therefore what validator the response can honestly carry.
func WriteFrame(w http.ResponseWriter, f *BarFile, win Window) error {
	n := win.Len()
	header := make([]byte, headerSize)
	copy(header[0:4], magic)
	binary.LittleEndian.PutUint16(header[4:6], 1)
	binary.LittleEndian.PutUint16(header[6:8], priceAsTicksFlag)
	binary.LittleEndian.PutUint32(header[8:12], uint32(n))
	binary.LittleEndian.PutUint32(header[12:16], uint32(f.TickNum()))
	binary.LittleEndian.PutUint32(header[16:20], uint32(f.TickDen()))
	// bytes 20:24 (reserved) stay zero.

	hdr := w.Header()
	hdr.Set("Content-Type", ContentType)
	hdr.Set("X-Bars-Count", fmt.Sprintf("%d", n))
	if n > 0 {
		hdr.Set("X-Bars-First-Ts", fmt.Sprintf("%d", f.TsAt(win.From)))
		hdr.Set("X-Bars-Last-Ts", fmt.Sprintf("%d", f.TsAt(win.To-1)))
	}

	for _, chunk := range [][]byte{
		header,
		f.tsBytes(win), f.openBytes(win), f.highBytes(win),
		f.lowBytes(win), f.closeBytes(win), f.volBytes(win),
	} {
		if _, err := w.Write(chunk); err != nil {
			return fmt.Errorf("bars: write frame: %w", err)
		}
	}
	return nil
}

// jsonBar is one bar decoded back to human-readable float prices, for the
// `?fmt=json` debug path (docs §6.2: "giữ ?fmt=json cho debug bằng curl").
type jsonBar struct {
	Ts     int64   `json:"ts"`
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume uint32  `json:"volume"`
}

// WriteFrameJSON writes win as a JSON array with real prices (ticks
// converted via TickNum/TickDen) instead of the binary frame — for
// debugging with curl, never on the replay hot path.
func WriteFrameJSON(w http.ResponseWriter, f *BarFile, win Window) error {
	ratio := float64(f.TickNum()) / float64(f.TickDen())
	out := make([]jsonBar, 0, win.Len())
	for i := win.From; i < win.To; i++ {
		out = append(out, jsonBar{
			Ts:     f.TsAt(i),
			Open:   float64(f.OpenAt(i)) * ratio,
			High:   float64(f.HighAt(i)) * ratio,
			Low:    float64(f.LowAt(i)) * ratio,
			Close:  float64(f.CloseAt(i)) * ratio,
			Volume: f.VolumeAt(i),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(out); err != nil {
		return fmt.Errorf("bars: write frame json: %w", err)
	}
	return nil
}
