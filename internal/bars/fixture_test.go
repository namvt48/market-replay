package bars

import "encoding/binary"

// buildFixture constructs a minimal valid RBR1 byte buffer from parallel
// column slices, for tests that need precise control over bar values
// without touching the real (129MB) data file.
func buildFixture(ts []uint32, open, high, low, close []int32, volume []uint32) []byte {
	n := len(ts)
	buf := make([]byte, headerSize+bytesPerBar*n)
	copy(buf[0:4], magic)
	binary.LittleEndian.PutUint16(buf[4:6], 1)
	binary.LittleEndian.PutUint16(buf[6:8], priceAsTicksFlag)
	binary.LittleEndian.PutUint32(buf[8:12], uint32(n))
	binary.LittleEndian.PutUint32(buf[12:16], 1) // tickNum
	binary.LittleEndian.PutUint32(buf[16:20], 4) // tickDen -> 1/4 = 0.25

	o := headerSize
	for _, v := range ts {
		binary.LittleEndian.PutUint32(buf[o:], v)
		o += 4
	}
	for _, v := range open {
		binary.LittleEndian.PutUint32(buf[o:], uint32(v))
		o += 4
	}
	for _, v := range high {
		binary.LittleEndian.PutUint32(buf[o:], uint32(v))
		o += 4
	}
	for _, v := range low {
		binary.LittleEndian.PutUint32(buf[o:], uint32(v))
		o += 4
	}
	for _, v := range close {
		binary.LittleEndian.PutUint32(buf[o:], uint32(v))
		o += 4
	}
	for _, v := range volume {
		binary.LittleEndian.PutUint32(buf[o:], v)
		o += 4
	}
	return buf
}

// simpleFixture builds n bars starting at startTs, step seconds apart,
// with trivial OHLCV values satisfying the OHLC invariant (low <= o,c <=
// high).
func simpleFixture(n int, startTs uint32, step uint32) []byte {
	ts := make([]uint32, n)
	open := make([]int32, n)
	high := make([]int32, n)
	low := make([]int32, n)
	closeCol := make([]int32, n)
	vol := make([]uint32, n)
	for i := 0; i < n; i++ {
		ts[i] = startTs + uint32(i)*step
		open[i] = int32(100 + i)
		closeCol[i] = int32(101 + i)
		low[i] = int32(99 + i)
		high[i] = int32(102 + i)
		vol[i] = uint32(10 + i)
	}
	return buildFixture(ts, open, high, low, closeCol, vol)
}
