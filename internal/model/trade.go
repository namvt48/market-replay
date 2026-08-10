package model

// Trade is one closed paper-trade, appended to a session's journal.
// Fields match docs §7.4 (entry/exit/MFE/MAE/R-multiple) — the fill engine
// (client-side TS, deterministic, out of backend scope) computes these;
// the server only persists and lists them, append-only.
type Trade struct {
	ID              string   `json:"id"`
	SessionID       string   `json:"sessionId"`
	Symbol          string   `json:"symbol"`
	Side            string   `json:"side"` // "long" | "short"
	Qty             int64    `json:"qty"`
	EntryTs         int64    `json:"entryTs"`
	EntryPriceTicks int64    `json:"entryPriceTicks"`
	ExitTs          int64    `json:"exitTs"`
	ExitPriceTicks  int64    `json:"exitPriceTicks"`
	RealizedCents   int64    `json:"realizedCents"`
	FeesCents       int64    `json:"feesCents"`
	MfeTicks        int64    `json:"mfeTicks"`
	MaeTicks        int64    `json:"maeTicks"`
	RMultiple       *float64 `json:"rMultiple"` // nil when not computable (e.g. no stop distance)
	CreatedAt       int64    `json:"createdAt"`
}
