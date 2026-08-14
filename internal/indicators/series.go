package indicators

import (
	"sort"

	"market-replay/internal/bars"
)

// barSeries is the read surface the DSL needs. A run may read directly from
// the mmap'd 1m file or from display-timeframe bars aggregated from that file.
type barSeries interface {
	Count() int
	TsAt(index int) int64
	OpenAt(index int) int32
	HighAt(index int) int32
	LowAt(index int) int32
	CloseAt(index int) int32
	VolumeAt(index int) float64
	IndexAtOrBefore(timestamp int64) int
	SeekWindow(at int64, before, after int) bars.Window
}

type fileSeries struct {
	file *bars.BarFile
}

func (s fileSeries) Count() int                 { return s.file.Count() }
func (s fileSeries) TsAt(index int) int64       { return s.file.TsAt(index) }
func (s fileSeries) OpenAt(index int) int32     { return s.file.OpenAt(index) }
func (s fileSeries) HighAt(index int) int32     { return s.file.HighAt(index) }
func (s fileSeries) LowAt(index int) int32      { return s.file.LowAt(index) }
func (s fileSeries) CloseAt(index int) int32    { return s.file.CloseAt(index) }
func (s fileSeries) VolumeAt(index int) float64 { return float64(s.file.VolumeAt(index)) }
func (s fileSeries) IndexAtOrBefore(timestamp int64) int {
	return s.file.IndexAtOrBefore(timestamp)
}
func (s fileSeries) SeekWindow(at int64, before, after int) bars.Window {
	return s.file.SeekWindow(at, before, after)
}

type chartSeries struct {
	items []bars.ChartBar
}

func (s chartSeries) Count() int              { return len(s.items) }
func (s chartSeries) TsAt(index int) int64    { return s.items[index].Time }
func (s chartSeries) OpenAt(index int) int32  { return s.items[index].OpenTicks }
func (s chartSeries) HighAt(index int) int32  { return s.items[index].HighTicks }
func (s chartSeries) LowAt(index int) int32   { return s.items[index].LowTicks }
func (s chartSeries) CloseAt(index int) int32 { return s.items[index].CloseTicks }
func (s chartSeries) VolumeAt(index int) float64 {
	return float64(s.items[index].Volume)
}
func (s chartSeries) IndexAtOrBefore(timestamp int64) int {
	return sort.Search(len(s.items), func(index int) bool { return s.items[index].Time > timestamp }) - 1
}
func (s chartSeries) SeekWindow(at int64, before, after int) bars.Window {
	index := s.IndexAtOrBefore(at)
	from := index - before + 1
	if from < 0 {
		from = 0
	}
	to := index + 1 + after
	if to > len(s.items) {
		to = len(s.items)
	}
	if to < from {
		to = from
	}
	return bars.Window{From: from, To: to}
}
