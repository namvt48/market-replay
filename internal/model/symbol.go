package model

// SymbolMeta is the metadata for one tradable symbol, loaded verbatim from
// meta/symbols.json — the single source of truth for tick size, point
// value, and commission (never hardcoded elsewhere, per docs N5).
type SymbolMeta struct {
	Symbol               string           `json:"symbol"`
	Name                 string           `json:"name"`
	Kind                 string           `json:"kind"`
	TickSize             float64          `json:"tickSize"`
	PointValue           float64          `json:"pointValue"`
	Currency             string           `json:"currency"`
	PriceDecimals        int              `json:"priceDecimals"`
	SessionTz            string           `json:"sessionTz"`
	RollRule             string           `json:"rollRule"`
	CommissionPerSide    float64          `json:"commissionPerSide"`
	DefaultSlippageTicks int              `json:"defaultSlippageTicks"`
	Ranges               map[string]Range `json:"ranges"`
}

// Range is the [from,to] epoch-second bounds of available bars for one
// timeframe of a symbol.
type Range struct {
	From int64 `json:"from"`
	To   int64 `json:"to"`
}
