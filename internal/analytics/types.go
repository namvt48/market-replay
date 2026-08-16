// Package analytics computes performance reports (win rate, expectancy,
// risk-reward, calendar/frequency breakdowns, ...) from a source's closed
// trades. It is pure Go: no HTTP, no SQL, no file I/O. The one external
// dependency — forward-looking market data for the "ideal R" metric — is
// taken as the MarketData interface, so BuildReport is fully testable with
// a fake and stays ignorant of bars.Registry's mmap/locking concerns.
package analytics

import (
	"time"

	"market-replay/internal/model"
)

// Request is one performance-report computation over a single source's
// closed trades.
type Request struct {
	// Trades need not be pre-sorted or pre-filtered; BuildReport re-derives
	// "closed, stably ordered" itself (rule 1). Every trade is assumed
	// already closed — the store only ever returns closed, cursor-revealed
	// trades (see storage.Store.ListTrades), so BuildReport does not
	// re-validate that here.
	Trades []model.Trade
	// Symbol is the source session's own — kept for callers that want to
	// label the report by its session, but no longer read by the Ideal RR
	// market-data lookup: computeIdealRR groups by each tradeStat's own
	// symbol instead, since model.Trade.Symbol is client-supplied per trade
	// and never validated against its session's own (a source's trades are
	// not guaranteed to share one — see internal/httpapi/sessions.go's
	// validateJournal). Timeframe IS still read — there is no per-trade
	// equivalent to group by.
	Symbol    string
	Timeframe string
	// InitialBalanceCents is the account's nominal starting size (see
	// model.Session.InitialBalanceCents and its resolution fallback for
	// pre-migration sessions, computed by the httpapi caller).
	InitialBalanceCents int64
	// BreakevenThresholdCents is the caller-supplied boundary (rule 3):
	// netPnl > threshold is a winner, netPnl < -threshold is a loser,
	// otherwise breakeven.
	BreakevenThresholdCents int64
	// Location drives every *display* grouping (by-hour, by-day, by-month,
	// calendar). Session-window classification (rule 12) deliberately does
	// NOT use this — see sessionwindows.go.
	Location *time.Location
	// MarketData resolves Ideal RR forward windows. Nil is valid: every
	// trade then reports as missing market data, never fabricated.
	MarketData MarketData
}

// Overview holds rules 1-4: total PnL/balance, win rate, and trade counts.
type Overview struct {
	TotalPnl        float64 `json:"totalPnl"`
	PnlPercent      float64 `json:"pnlPercent"`
	AccountBalance  float64 `json:"accountBalance"`
	WinRate         float64 `json:"winRate"`
	TotalTrades     int     `json:"totalTrades"`
	LongTrades      int     `json:"longTrades"`
	ShortTrades     int     `json:"shortTrades"`
	BreakevenTrades int     `json:"breakevenTrades"`
}

// EquityPoint is one point on the equity curve. Index 0 is always the
// synthetic "before any trade" point (TradeID/ClosedAt nil, CumulativePnl 0),
// so the curve always has len(trades)+1 points.
type EquityPoint struct {
	TradeIndex    int     `json:"tradeIndex"`
	TradeID       *string `json:"tradeId"`
	ClosedAt      *string `json:"closedAt"`
	CumulativePnl float64 `json:"cumulativePnl"`
	Balance       float64 `json:"balance"`
}

// RrPoint is one trade's realized or ideal R-multiple, for the risk-reward
// scatter series.
type RrPoint struct {
	TradeIndex int     `json:"tradeIndex"`
	TradeID    string  `json:"tradeId"`
	ClosedAt   *string `json:"closedAt"`
	Rr         float64 `json:"rr"`
}

// RrSeries feeds the risk-reward scatter chart: actual R per risk-valid
// trade, ideal R per trade with market-data coverage, and the subset of
// losers that could have been profitable/breakeven (rule 7), plotted at
// their ideal R.
type RrSeries struct {
	Actual []RrPoint `json:"actual"`
	Ideal  []RrPoint `json:"ideal"`
	Missed []RrPoint `json:"missed"`
}

// RiskReward holds rules 5-7. ExcludedTrades and MissingMarketDataTrades are
// audit counts beyond the spec's example JSON, so a caller can tell "no
// data" apart from "computed to zero".
type RiskReward struct {
	AverageRr                  float64  `json:"averageRr"`
	MaxRr                      float64  `json:"maxRr"`
	IdealAverageRr             float64  `json:"idealAverageRr"`
	MaxIdealRr                 float64  `json:"maxIdealRr"`
	CouldHaveProfitOrBreakeven int      `json:"couldHaveProfitOrBreakeven"`
	CouldHaveMaxIdealRr        float64  `json:"couldHaveMaxIdealRr"`
	Series                     RrSeries `json:"series"`
	// ExcludedTrades is the count with no valid initial risk amount (rule
	// 5) — excluded from AverageRr/MaxRr and from Ideal RR alike.
	ExcludedTrades int `json:"excludedTrades"`
	// MissingMarketDataTrades is the count that WAS risk-valid but had no
	// bars covering their forward window (rule 6) — excluded from
	// IdealAverageRr/MaxIdealRr, never fabricated.
	MissingMarketDataTrades int `json:"missingMarketDataTrades"`
}

// Expectancy holds rules 8-9. ProfitFactor is nil (with a reason in
// ProfitFactorNote) instead of +Inf when there are no losing trades.
type Expectancy struct {
	Value            float64  `json:"value"`
	AverageWin       float64  `json:"averageWin"`
	AverageLoss      float64  `json:"averageLoss"`
	ProfitFactor     *float64 `json:"profitFactor"`
	ProfitFactorNote string   `json:"profitFactorNote,omitempty"`
}

// WinnersStats and LosersStats hold rule 10. Field names deliberately differ
// (BestWinPercent vs WorstLossPercent, ...) to match the spec's JSON keys —
// they are not interchangeable despite the parallel shape.
type WinnersStats struct {
	Total                  int     `json:"total"`
	BestWinPercent         float64 `json:"bestWinPercent"`
	AverageWinPercent      float64 `json:"averageWinPercent"`
	AverageDurationSeconds float64 `json:"averageDurationSeconds"`
	MaxConsecutive         int     `json:"maxConsecutive"`
	AverageConsecutive     float64 `json:"averageConsecutive"`
}

type LosersStats struct {
	Total                  int     `json:"total"`
	WorstLossPercent       float64 `json:"worstLossPercent"`
	AverageLossPercent     float64 `json:"averageLossPercent"`
	AverageDurationSeconds float64 `json:"averageDurationSeconds"`
	MaxConsecutive         int     `json:"maxConsecutive"`
	AverageConsecutive     float64 `json:"averageConsecutive"`
}

// SideStats is one side's row in BySide (rule 11).
type SideStats struct {
	Trades       int     `json:"trades"`
	TradePercent float64 `json:"tradePercent"`
	Wins         int     `json:"wins"`
	WinRate      float64 `json:"winRate"`
}

type BySide struct {
	Buy  SideStats `json:"buy"`
	Sell SideStats `json:"sell"`
}

// SessionStat is one market-session row (rule 12) — always emitted for all
// four named windows, even with zero trades, for a stable chart axis.
type SessionStat struct {
	Session     string  `json:"session"`
	TotalTrades int     `json:"totalTrades"`
	WinRate     float64 `json:"winRate"`
	AverageRr   float64 `json:"averageRr"`
	TotalPnl    float64 `json:"totalPnl"`
}

// HourStat is one hour-of-day row (rule 13). ByTime's four keys all point
// at the same 24-entry list — see bytime.go for why.
type HourStat struct {
	Hour          int     `json:"hour"`
	Profit        float64 `json:"profit"`
	Loss          float64 `json:"loss"`
	NetPnl        float64 `json:"netPnl"`
	AverageRr     float64 `json:"averageRr"`
	ProfitPercent float64 `json:"profitPercent"`
	WinRate       float64 `json:"winRate"`
	TotalTrades   int     `json:"totalTrades"`
}

type ByTime struct {
	Pnl           []HourStat `json:"pnl"`
	Rr            []HourStat `json:"rr"`
	ProfitPercent []HourStat `json:"profitPercent"`
	WinRate       []HourStat `json:"winRate"`
}

// DayStat is one weekday row (rule 14) — always Monday..Sunday.
type DayStat struct {
	Day         string  `json:"day"`
	Profit      float64 `json:"profit"`
	Loss        float64 `json:"loss"`
	NetPnl      float64 `json:"netPnl"`
	TotalTrades int     `json:"totalTrades"`
	Wins        int     `json:"wins"`
	WinRate     float64 `json:"winRate"`
}

// MonthStat is one calendar-month row (rule 15) — sparse, only months with
// at least one trade.
type MonthStat struct {
	Month              string  `json:"month"` // "YYYY-MM"
	MonthlyPnl         float64 `json:"monthlyPnl"`
	MonthlyGainPercent float64 `json:"monthlyGainPercent"`
	EndingBalance      float64 `json:"endingBalance"`
	TotalTrades        int     `json:"totalTrades"`
}

// CalendarDay is one calendar-day row (rule 16) — sparse, only days with at
// least one trade.
type CalendarDay struct {
	Date          string  `json:"date"` // "YYYY-MM-DD"
	Trades        int     `json:"trades"`
	Wins          int     `json:"wins"`
	Losses        int     `json:"losses"`
	Breakeven     int     `json:"breakeven"`
	Pnl           float64 `json:"pnl"`
	PnlPercent    float64 `json:"pnlPercent"`
	EndingBalance float64 `json:"endingBalance"`
}

// Frequency holds rule 17.
type WeekdayFrequency struct {
	Day           string  `json:"day"`
	AverageTrades float64 `json:"averageTrades"`
}

type WeekFrequency struct {
	WeekStart   string `json:"weekStart"` // "YYYY-MM-DD"
	WeekEnd     string `json:"weekEnd"`   // "YYYY-MM-DD"
	TotalTrades int    `json:"totalTrades"`
}

type MonthFrequency struct {
	Month       string `json:"month"` // "YYYY-MM"
	TotalTrades int    `json:"totalTrades"`
}

type Frequency struct {
	ByWeekday             []WeekdayFrequency `json:"byWeekday"`
	ByWeek                []WeekFrequency    `json:"byWeek"`
	ByMonth               []MonthFrequency   `json:"byMonth"`
	AverageTradesPerDay   float64            `json:"averageTradesPerDay"`
	AverageTradesPerWeek  float64            `json:"averageTradesPerWeek"`
	AverageTradesPerMonth float64            `json:"averageTradesPerMonth"`
}

// Report is the full computed result. It deliberately excludes the
// "source" envelope field (id/type/title/subtitle/status/initialBalance) —
// that's built separately by format.go's SourceIdentity/SourceSummary from
// the model.Session the httpapi layer already has, so BuildReport itself
// needs no knowledge of session identity or status.
type Report struct {
	Overview    Overview      `json:"overview"`
	EquityCurve []EquityPoint `json:"equityCurve"`
	RiskReward  RiskReward    `json:"riskReward"`
	Expectancy  Expectancy    `json:"expectancy"`
	Winners     WinnersStats  `json:"winners"`
	Losers      LosersStats   `json:"losers"`
	BySide      BySide        `json:"bySide"`
	BySession   []SessionStat `json:"bySession"`
	ByTime      ByTime        `json:"byTime"`
	ByDay       []DayStat     `json:"byDay"`
	ByMonth     []MonthStat   `json:"byMonth"`
	Calendar    []CalendarDay `json:"calendar"`
	Frequency   Frequency     `json:"frequency"`
}
