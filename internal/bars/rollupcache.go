package bars

import (
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"os"
	"path/filepath"
	"strings"
)

// The .roll sidecar caches the rollups index() derives, so a restart reads
// ~4 MB of finished index per symbol instead of re-reading the whole .bin to
// rebuild something byte-identical. Rollups are a pure function of the .bin's
// bars, the companion .idx, the symbol's session timezone and the RTH window
// — every one of those is fingerprinted below, and any mismatch throws the
// file away and rebuilds rather than trusting it.
//
// It is a cache, never a source of truth: a missing, stale, truncated,
// corrupt or unreadable sidecar is a warning at worst. The one thing it must
// never do is let bars derived from data that no longer exists reach a
// response, which is what the fingerprint plus the CRC are for.
const (
	rollMagic   = "RROL"
	rollVersion = 1

	// rollHeaderFixed is every fixed-width header field; the session
	// timezone's bytes follow it.
	rollHeaderFixed = 76

	// rollEntrySize is one rollupBar on disk: from,to,open,high,low,close
	// as int32 then volume as uint64.
	rollEntrySize = 32
)

var rollCRCTable = crc32.MakeTable(crc32.Castagnoli)

// rollFingerprint identifies the exact inputs a cached index was derived
// from. Two of the fields overlap on purpose: tsHash proves the bar timeline
// is unchanged, and binMtime/binSize catch a re-ingest that kept every
// timestamp but corrected the prices underneath them — a stale-price bug
// tsHash alone cannot see.
type rollFingerprint struct {
	barCount       uint32
	tsHash         uint64
	binSize        int64
	binMtimeNanos  int64
	idxSize        int64
	idxMtimeNanos  int64
	sessionTz      string
	rthOpenMinute  uint16
	rthCloseMinute uint16
}

// newRollFingerprint stats the dataset's own files. A missing .idx is not an
// error: the sidecar then records "there was no .idx", and one appearing later
// invalidates the cache exactly as a changed one would.
func newRollFingerprint(binPath, idxPath string, barCount int, tsHash uint64, sessionTz string) (rollFingerprint, error) {
	fingerprint := rollFingerprint{
		barCount:       uint32(barCount),
		tsHash:         tsHash,
		sessionTz:      sessionTz,
		rthOpenMinute:  rthOpenMinute,
		rthCloseMinute: rthCloseMinute,
	}
	info, err := os.Stat(binPath)
	if err != nil {
		return rollFingerprint{}, fmt.Errorf("bars: stat %s for rollup cache: %w", binPath, err)
	}
	fingerprint.binSize = info.Size()
	fingerprint.binMtimeNanos = info.ModTime().UnixNano()
	if idxInfo, err := os.Stat(idxPath); err == nil {
		fingerprint.idxSize = idxInfo.Size()
		fingerprint.idxMtimeNanos = idxInfo.ModTime().UnixNano()
	}
	return fingerprint, nil
}

// rollupCachePath is the sidecar for a dataset's .bin.
func rollupCachePath(binPath string) string {
	return strings.TrimSuffix(binPath, ".bin") + ".roll"
}

// loadRollupCache returns the cached rollups for want, or nil with the reason
// it could not be used. A nil result with an empty reason means there simply
// is no sidecar yet — the ordinary first-run case, not worth a warning.
func loadRollupCache(path string, want rollFingerprint, barCount, sessions int) (*rollups, string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ""
		}
		return nil, fmt.Sprintf("could not read %s: %v", filepath.Base(path), err)
	}
	cached, reason := decodeRollupCache(raw, want)
	if reason != "" {
		return nil, fmt.Sprintf("%s: %s", filepath.Base(path), reason)
	}
	if reason := verifyCachedRollups(cached, barCount, sessions); reason != "" {
		return nil, fmt.Sprintf("%s: %s", filepath.Base(path), reason)
	}
	return cached, ""
}

func decodeRollupCache(raw []byte, want rollFingerprint) (*rollups, string) {
	if len(raw) < rollHeaderFixed {
		return nil, fmt.Sprintf("shorter than a %d-byte header", rollHeaderFixed)
	}
	if string(raw[0:4]) != rollMagic {
		return nil, fmt.Sprintf("bad magic %q", raw[0:4])
	}
	if version := binary.LittleEndian.Uint16(raw[4:6]); version != rollVersion {
		return nil, fmt.Sprintf("version %d, this build writes %d", version, rollVersion)
	}
	got := rollFingerprint{
		barCount:       binary.LittleEndian.Uint32(raw[8:12]),
		tsHash:         binary.LittleEndian.Uint64(raw[12:20]),
		binSize:        int64(binary.LittleEndian.Uint64(raw[20:28])),
		binMtimeNanos:  int64(binary.LittleEndian.Uint64(raw[28:36])),
		idxSize:        int64(binary.LittleEndian.Uint64(raw[36:44])),
		idxMtimeNanos:  int64(binary.LittleEndian.Uint64(raw[44:52])),
		rthOpenMinute:  binary.LittleEndian.Uint16(raw[52:54]),
		rthCloseMinute: binary.LittleEndian.Uint16(raw[54:56]),
	}
	counts := [4]int{
		int(binary.LittleEndian.Uint32(raw[56:60])),
		int(binary.LittleEndian.Uint32(raw[60:64])),
		int(binary.LittleEndian.Uint32(raw[64:68])),
		int(binary.LittleEndian.Uint32(raw[68:72])),
	}
	checksum := binary.LittleEndian.Uint32(raw[72:76])
	tzLen := int(binary.LittleEndian.Uint16(raw[6:8]))
	if len(raw) < rollHeaderFixed+tzLen {
		return nil, "truncated session timezone"
	}
	got.sessionTz = string(raw[rollHeaderFixed : rollHeaderFixed+tzLen])

	total := 0
	for _, count := range counts {
		if count < 0 {
			return nil, "negative entry count"
		}
		total += count
	}
	body := raw[rollHeaderFixed+tzLen:]
	if len(body) != total*rollEntrySize {
		return nil, fmt.Sprintf("body is %d bytes, header describes %d entries (%d bytes)", len(body), total, total*rollEntrySize)
	}
	if actual := crc32.Checksum(body, rollCRCTable); actual != checksum {
		return nil, fmt.Sprintf("crc mismatch: body hashes to %08x, header says %08x", actual, checksum)
	}
	if got != want {
		return nil, describeFingerprintMismatch(got, want)
	}

	cached := &rollups{}
	slices := [...]*[]rollupBar{&cached.hourly, &cached.rthHourly, &cached.rthDaily, &cached.daily}
	offset := 0
	for i, count := range counts {
		entries := make([]rollupBar, count)
		for j := 0; j < count; j++ {
			at := body[offset+j*rollEntrySize:]
			entries[j] = rollupBar{
				from:   int32(binary.LittleEndian.Uint32(at[0:4])),
				to:     int32(binary.LittleEndian.Uint32(at[4:8])),
				open:   int32(binary.LittleEndian.Uint32(at[8:12])),
				high:   int32(binary.LittleEndian.Uint32(at[12:16])),
				low:    int32(binary.LittleEndian.Uint32(at[16:20])),
				close:  int32(binary.LittleEndian.Uint32(at[20:24])),
				volume: binary.LittleEndian.Uint64(at[24:32]),
			}
		}
		*slices[i] = entries
		offset += count * rollEntrySize
	}
	return cached, ""
}

// describeFingerprintMismatch names the input that changed, so an operator
// sees "the .bin was rewritten" rather than an opaque cache miss.
func describeFingerprintMismatch(got, want rollFingerprint) string {
	switch {
	case got.barCount != want.barCount:
		return fmt.Sprintf("built for %d bars, the file holds %d", got.barCount, want.barCount)
	case got.binSize != want.binSize || got.binMtimeNanos != want.binMtimeNanos:
		return "the .bin has been rewritten since it was built"
	case got.tsHash != want.tsHash:
		return "the bar timeline no longer hashes the same"
	case got.idxSize != want.idxSize || got.idxMtimeNanos != want.idxMtimeNanos:
		return "the companion .idx has changed since it was built"
	case got.sessionTz != want.sessionTz:
		return fmt.Sprintf("built for session timezone %q, symbols.json now says %q", got.sessionTz, want.sessionTz)
	default:
		return fmt.Sprintf("built for an RTH window of %d..%d, this build uses %d..%d",
			got.rthOpenMinute, got.rthCloseMinute, want.rthOpenMinute, want.rthCloseMinute)
	}
}

// verifyCachedRollups re-establishes, from the sidecar's own bytes, every
// structural invariant the aggregator assumes of an index it did not build:
// ranges in-bounds, ascending and non-overlapping (the binary searches in
// aggregateIndexedRollupChartWindow), the hourly index partitioning the file
// exactly (foldRange), and one daily entry per session (rollupFor's contract
// with the calendar).
func verifyCachedRollups(cached *rollups, barCount, sessions int) string {
	for _, index := range []struct {
		name    string
		entries []rollupBar
	}{
		{"hourly", cached.hourly},
		{"rthHourly", cached.rthHourly},
		{"rthDaily", cached.rthDaily},
		{"daily", cached.daily},
	} {
		previousTo := int32(0)
		for i, entry := range index.entries {
			if entry.from < 0 || entry.to <= entry.from || int(entry.to) > barCount {
				return fmt.Sprintf("%s entry %d covers bars [%d,%d) of a %d-bar file", index.name, i, entry.from, entry.to, barCount)
			}
			if entry.from < previousTo {
				return fmt.Sprintf("%s entry %d starts at bar %d, inside the previous entry ending at %d", index.name, i, entry.from, previousTo)
			}
			previousTo = entry.to
		}
	}
	if len(cached.hourly) > 0 {
		if cached.hourly[0].from != 0 || int(cached.hourly[len(cached.hourly)-1].to) != barCount {
			return fmt.Sprintf("hourly index covers bars [%d,%d), not the whole %d-bar file",
				cached.hourly[0].from, cached.hourly[len(cached.hourly)-1].to, barCount)
		}
		for i := 1; i < len(cached.hourly); i++ {
			if cached.hourly[i-1].to != cached.hourly[i].from {
				return fmt.Sprintf("hourly index has a gap between entries %d and %d", i-1, i)
			}
		}
	}
	if len(cached.daily) > 0 && len(cached.daily) != sessions {
		return fmt.Sprintf("holds %d daily entries for a %d-session calendar", len(cached.daily), sessions)
	}
	return ""
}

// storeRollupCache writes the sidecar atomically: a temp file in the same
// directory, fsynced, then renamed over any previous one. A reader therefore
// only ever sees a complete file, even if the process dies mid-write.
//
// Returns why it could not be written, if it could not. Never fatal — a
// read-only data directory (a Compose volume mounted ro) must keep serving,
// just without the faster restart.
func storeRollupCache(path string, fingerprint rollFingerprint, source *rollups) string {
	payload := encodeRollupCache(fingerprint, source)
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp")
	if err != nil {
		return fmt.Sprintf("could not create a temp file in %s: %v", dir, err)
	}
	tempPath := temp.Name()
	if _, err := temp.Write(payload); err != nil {
		temp.Close()
		os.Remove(tempPath)
		return fmt.Sprintf("could not write %s: %v", filepath.Base(tempPath), err)
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		os.Remove(tempPath)
		return fmt.Sprintf("could not fsync %s: %v", filepath.Base(tempPath), err)
	}
	if err := temp.Close(); err != nil {
		os.Remove(tempPath)
		return fmt.Sprintf("could not close %s: %v", filepath.Base(tempPath), err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		os.Remove(tempPath)
		return fmt.Sprintf("could not rename into %s: %v", filepath.Base(path), err)
	}
	return ""
}

func encodeRollupCache(fingerprint rollFingerprint, source *rollups) []byte {
	indexes := [4][]rollupBar{source.hourly, source.rthHourly, source.rthDaily, source.daily}
	total := 0
	for _, entries := range indexes {
		total += len(entries)
	}
	tz := []byte(fingerprint.sessionTz)
	out := make([]byte, rollHeaderFixed+len(tz)+total*rollEntrySize)

	body := out[rollHeaderFixed+len(tz):]
	offset := 0
	for _, entries := range indexes {
		for _, entry := range entries {
			at := body[offset:]
			binary.LittleEndian.PutUint32(at[0:4], uint32(entry.from))
			binary.LittleEndian.PutUint32(at[4:8], uint32(entry.to))
			binary.LittleEndian.PutUint32(at[8:12], uint32(entry.open))
			binary.LittleEndian.PutUint32(at[12:16], uint32(entry.high))
			binary.LittleEndian.PutUint32(at[16:20], uint32(entry.low))
			binary.LittleEndian.PutUint32(at[20:24], uint32(entry.close))
			binary.LittleEndian.PutUint64(at[24:32], entry.volume)
			offset += rollEntrySize
		}
	}

	copy(out[0:4], rollMagic)
	binary.LittleEndian.PutUint16(out[4:6], rollVersion)
	binary.LittleEndian.PutUint16(out[6:8], uint16(len(tz)))
	binary.LittleEndian.PutUint32(out[8:12], fingerprint.barCount)
	binary.LittleEndian.PutUint64(out[12:20], fingerprint.tsHash)
	binary.LittleEndian.PutUint64(out[20:28], uint64(fingerprint.binSize))
	binary.LittleEndian.PutUint64(out[28:36], uint64(fingerprint.binMtimeNanos))
	binary.LittleEndian.PutUint64(out[36:44], uint64(fingerprint.idxSize))
	binary.LittleEndian.PutUint64(out[44:52], uint64(fingerprint.idxMtimeNanos))
	binary.LittleEndian.PutUint16(out[52:54], fingerprint.rthOpenMinute)
	binary.LittleEndian.PutUint16(out[54:56], fingerprint.rthCloseMinute)
	for i, entries := range indexes {
		binary.LittleEndian.PutUint32(out[56+4*i:60+4*i], uint32(len(entries)))
	}
	binary.LittleEndian.PutUint32(out[72:76], crc32.Checksum(body, rollCRCTable))
	copy(out[rollHeaderFixed:], tz)
	return out
}
