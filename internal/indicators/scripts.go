package indicators

import _ "embed"

//go:embed scripts/gb69-cbmor.js
var gb69CbmorSource []byte

//go:embed scripts/day-separator.js
var daySeparatorSource []byte

//go:embed scripts/killzones.js
var killzonesSource []byte

//go:embed scripts/open-price-markers.js
var openPriceMarkersSource []byte

//go:embed scripts/fractals.js
var fractalsSource []byte

//go:embed scripts/ipda-ranges.js
var ipdaRangesSource []byte

// RegisterBuiltins registers every indicator that ships with this binary.
// Adding the next one is exactly this: drop a new scripts/*.js file, embed
// it, and add one more Register call here — no other code changes needed.
func RegisterBuiltins(e *Engine) error {
	if err := e.Register("gb69-cbmor", "GB69 / CB MOR Range & Levels", 1, gb69CbmorSource); err != nil {
		return err
	}
	if err := e.Register("day-separator", "Day Separator", 1, daySeparatorSource); err != nil {
		return err
	}
	if err := e.Register("killzones", "Killzones", 1, killzonesSource); err != nil {
		return err
	}
	if err := e.Register("open-price-markers", "Open Price Markers", 1, openPriceMarkersSource); err != nil {
		return err
	}
	if err := e.Register("fractals", "Fractals", 1, fractalsSource); err != nil {
		return err
	}
	return e.Register("ipda-ranges", "IPDA Ranges", 1, ipdaRangesSource)
}
