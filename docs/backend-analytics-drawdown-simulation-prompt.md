# Prompt triển khai Backend cho Drawdown và Simulation

> Copy toàn bộ nội dung từ phần **Vai trò** trở xuống và gửi cho agent Backend. Prompt này mở rộng backend Performance Analytics hiện có; không triển khai lại phần đã hoàn thành.

## Vai trò

Bạn là senior Go backend engineer. Hãy triển khai Backend cho hai tab **Drawdown** và **Simulation** của Market Replay tại:

`/home/namvt/Desktop/dev-space/market-replay`

## Mục tiêu

Thay dữ liệu mock của Drawdown và Simulation bằng kết quả được tính từ closed trades thật của:

1. Replay Session Journal.
2. Evaluation Account.

Chỉ code Backend và API contract/type cần thiết. Không sửa layout, styling hoặc logic hiển thị Frontend.

## Bối cảnh bắt buộc phải đọc

Backend Performance đã tồn tại. Phải mở rộng kiến trúc hiện tại, không tạo analytics service song song:

- `internal/analytics/`
- `internal/analytics/types.go`
- `internal/httpapi/analytics.go`
- `internal/httpapi/analytics_marketdata.go`
- `internal/httpapi/analytics_test.go`
- `internal/model/trade.go`
- `internal/storage/`
- `web/src/components/analytics/AdvancedAnalyticsTabs.tsx`
- `web/src/components/analytics/AdvancedAnalyticsCharts.tsx`
- `docs/backend-analytics-implementation-prompt.md`

Các endpoint hiện có phải tiếp tục hoạt động:

- `GET /api/v1/analytics/sources`
- `GET /api/v1/analytics/performance`

`sourceType` chỉ nhận `session` hoặc `evaluation`. Luôn kiểm tra source ID có đúng type; type mismatch phải trả cùng dạng `404` như source không tồn tại để tránh lộ dữ liệu.

## Nguyên tắc chung

- Chỉ dùng closed trades của source được yêu cầu.
- Sắp xếp trade theo `ExitTs` tăng dần, dùng ID làm tie-breaker ổn định.
- Tiền được tính nội bộ bằng integer cents; chỉ đổi sang JSON dollar ở boundary.
- Không trả `NaN`, `Infinity` hoặc số bịa khi thiếu dữ liệu.
- Trả audit counts cho trade bị loại và market-data coverage.
- Response JSON phải typed, tên field ổn định và không format sẵn thành chuỗi tiền tệ.
- Các endpoint phụ thuộc journal hiện tại phải trả `Cache-Control: no-store`.
- Batch market-data lookup; cấm query từng trade theo kiểu N+1.
- Mọi simulation phải deterministic khi request có cùng input và `seed`.
- Áp giới hạn input trước khi cấp phát slice hoặc chạy simulation.
- Không giữ mutable simulation state trong memory giữa các request.

## API 1 — Drawdown report

Tạo endpoint:

`GET /api/v1/analytics/drawdown?sourceType=session&sourceId={id}`

Response đề xuất:

```json
{
  "source": {
    "id": "source-id",
    "type": "session",
    "title": "NQ replay journal",
    "status": "stopped",
    "initialBalance": 100000
  },
  "equityDrawdown": {
    "points": [
      {
        "tradeIndex": 0,
        "tradeId": null,
        "closedAt": null,
        "equity": 100000,
        "peakEquity": 100000,
        "drawdownAmount": 0,
        "drawdownPercent": 0
      },
      {
        "tradeIndex": 1,
        "tradeId": "trade-id",
        "closedAt": "2025-01-16T15:30:00Z",
        "equity": 99500,
        "peakEquity": 100000,
        "drawdownAmount": -500,
        "drawdownPercent": -0.5
      }
    ],
    "maxDrawdownAmount": -25749,
    "maxDrawdownPercent": -23,
    "averageDrawdownAmount": -12587,
    "averageDrawdownPercent": -11.13,
    "averageRecoveryDays": 13.9,
    "drawdownFrequency": 5,
    "completedEpisodes": 4,
    "openEpisode": true
  },
  "maximumAdverseExcursion": {
    "unit": "R",
    "histogram": [
      { "fromInclusive": 0, "toExclusive": 0.1, "label": "0.0", "count": 9 },
      { "fromInclusive": 0.1, "toExclusive": 0.2, "label": "0.1", "count": 4 },
      { "fromInclusive": 1.1, "toExclusive": null, "label": ">=1.1", "count": 2 }
    ],
    "winningTrades": {
      "averageMaeR": 0.39,
      "minMaeR": 0.01,
      "maxMaeR": 0.96,
      "includedTrades": 86,
      "excludedNoInitialRisk": 1,
      "missingMarketDataTrades": 0
    }
  }
}
```

### Công thức equity drawdown

Với mỗi point của equity curve, bao gồm point 0 là initial balance:

```text
peakEquity[i]       = max(equity[0..i])
drawdownAmount[i]   = min(0, equity[i] - peakEquity[i])
drawdownPercent[i]  = drawdownAmount[i] / peakEquity[i] * 100
```

Quy tắc aggregate:

- `maxDrawdownAmount` là giá trị âm nhỏ nhất của toàn series.
- `maxDrawdownPercent` là giá trị âm nhỏ nhất của toàn series.
- `averageDrawdownAmount` và `averageDrawdownPercent` chỉ average các point có drawdown `< 0`; nếu không có trả `0`.
- Một drawdown episode bắt đầu ở point đầu tiên `< 0` sau một equity peak.
- Episode kết thúc tại point đầu tiên có equity `>=` peak đã mở episode.
- `drawdownFrequency` đếm số episode đã bắt đầu, gồm cả episode chưa recovery.
- `averageRecoveryDays` chỉ average các episode đã recovery, dùng timestamp thực giữa episode start và recovery point. Nếu chưa có episode hoàn tất, trả `0` kèm `completedEpisodes: 0`.
- Không làm tròn trong intermediate calculation; round nhất quán tại JSON boundary.

### Maximum Adverse Excursion trên winning trades

Chỉ tính cho winner theo net realized PnL và có initial risk hợp lệ.

Ưu tiên dữ liệu persisted:

- `Trade.MaeTicks` là adverse price excursion từ entry tới exit.
- `Trade.InitialStopTicks` và `Qty` xác định initial risk.
- Nếu persisted MAE không đủ tin cậy, dùng market-data batch trong cửa sổ `[EntryTs, ExitTs]`; không look ahead sau exit.

Quy đổi:

```text
maeR = abs(adverseMoveMoney) / initialRiskMoney
```

Histogram dùng bin width `0.1R`: `0.0`, `0.1`, ... `1.0`, và bucket cuối `>=1.1`. Boundary là `[fromInclusive, toExclusive)`. Trade đúng `1.1R` vào bucket cuối.

## API 2 — Stop Loss Simulator

Tạo endpoint:

`POST /api/v1/analytics/simulations/stop-loss`

Request:

```json
{
  "sourceType": "session",
  "sourceId": "source-id",
  "reductionsPercent": [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
}
```

Validation:

- 1–20 scenario/request.
- Mỗi reduction là số hữu hạn trong `[0, 95]`.
- Loại duplicate nhưng giữ thứ tự request đầu tiên.
- `0` là base model/current stop loss.

Response:

```json
{
  "source": { "id": "source-id", "type": "session", "tradeCount": 204 },
  "includedTrades": 203,
  "excludedTrades": {
    "noInitialStop": 1,
    "invalidRisk": 0,
    "missingMarketData": 0
  },
  "scenarios": [
    {
      "reductionPercent": 10,
      "winRate": 40.46,
      "stoppedOutTrades": 133,
      "averageWinR": 4.62,
      "expectancyR": 0.48,
      "totalR": 63.12,
      "profit": 33486.37,
      "profitFactor": 1.58,
      "averageDrawdownR": -5.55,
      "equityCurve": [
        { "tradeIndex": 0, "tradeId": null, "closedAt": null, "cumulativeR": 0, "balance": 100000 },
        { "tradeIndex": 1, "tradeId": "trade-id", "closedAt": "2025-01-16T15:30:00Z", "cumulativeR": 1.4, "balance": 100720 }
      ]
    }
  ],
  "bestScenario": {
    "reductionPercent": 10,
    "criterion": "profitFactorThenAverageDrawdown"
  }
}
```

### Stop Loss simulation rules

- Chỉ gồm trade có `InitialStopTicks`, initial risk dương và market data đủ từ entry tới exit.
- Với reduction `p`: `simulatedStopDistance = originalStopDistance * (1 - p/100)`.
- Direction long: stop ở `entry - simulatedStopDistance`.
- Direction short: stop ở `entry + simulatedStopDistance`.
- Scenario `0%` phải giữ actual persisted outcome làm base model; không được resimulate thành kết quả khác chỉ do OHLC ambiguity.
- Với scenario `>0`, nếu simulated stop bị chạm trước exit, close ở simulated stop và tính fee/slippage theo policy hiện có. Nếu không bị chạm, giữ actual exit/outcome.
- Nếu một bar có thể chạm nhiều mức nhưng không có dữ liệu intrabar, dùng policy bảo thủ `stop-first` và trả `intrabarPolicy: "stop-first"` trong response metadata.
- `stoppedOutTrades` chỉ đếm trade mà simulated stop làm thay đổi exit.
- Equity curve phải theo thứ tự closed trade ổn định.
- `averageDrawdownR` dùng peak-to-trough drawdown trên cumulative-R curve; quy ước số âm giống Drawdown tab.
- `bestScenario`: maximize profit factor; nếu bằng nhau, chọn average drawdown gần 0 hơn; nếu vẫn bằng, chọn reduction thấp hơn.

## API 3 — RR Simulator

Tạo endpoint:

`POST /api/v1/analytics/simulations/risk-reward`

Request:

```json
{
  "sourceType": "session",
  "sourceId": "source-id",
  "targetsR": [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
  "includeCurrentModel": true
}
```

Validation:

- 1–20 target/request.
- Mỗi target là số hữu hạn trong `[0.1, 50]`.
- Loại duplicate, giữ thứ tự đầu tiên.

Response:

```json
{
  "source": { "id": "source-id", "type": "session", "tradeCount": 204 },
  "includedTrades": 203,
  "excludedTrades": {
    "noInitialStop": 1,
    "invalidRisk": 0,
    "missingMarketData": 0
  },
  "scenarios": [
    {
      "id": "current",
      "targetR": null,
      "label": "Current RR",
      "winRate": 42.16,
      "profit": 18642.5,
      "profitFactor": 1.46,
      "averageDrawdownPercent": 4.7,
      "equityCurve": []
    },
    {
      "id": "target-1.0",
      "targetR": 1,
      "label": "1.0R",
      "winRate": 61,
      "profit": 36000,
      "profitFactor": 1.57,
      "averageDrawdownPercent": 2.2,
      "equityCurve": []
    }
  ],
  "bestScenario": { "id": "target-1.0", "criterion": "profitFactor" },
  "metadata": { "intrabarPolicy": "stop-first" }
}
```

### RR simulation rules

- Chỉ gồm trade có initial stop/risk hợp lệ và đủ market data từ entry tới actual exit.
- Profit target long: `entry + targetR * initialStopDistance`.
- Profit target short: `entry - targetR * initialStopDistance`.
- Giữ original initial stop.
- Nếu target chạm trước stop, exit ở target.
- Nếu stop chạm trước target, exit ở stop.
- Nếu cả hai có thể chạm trong cùng OHLC bar và không có lower-timeframe path, dùng `stop-first`.
- Nếu không chạm target hoặc stop trước actual exit, giữ actual exit price.
- `current` scenario dùng actual persisted outcomes.
- Tính net profit sau fees/slippage theo policy hiện có.
- Average drawdown percent lấy từ balance equity curve của scenario, trả độ lớn dương nếu FE muốn hiển thị như ảnh; ghi rõ convention trong type comment và test. Không trộn quy ước này với `drawdownAmount` âm của Drawdown API.

## API 4 — Monte Carlo Simulator

Tạo endpoint:

`POST /api/v1/analytics/simulations/monte-carlo`

Request:

```json
{
  "sourceType": "session",
  "sourceId": "source-id",
  "simulationCount": 10,
  "tradesPerSimulation": 10,
  "startBalance": 118642.5,
  "averageGain": 684.75,
  "averageLoss": 354.12,
  "winRatePercent": 42.16,
  "seed": 20250816
}
```

Validation và limits:

- `simulationCount`: 1–1000.
- `tradesPerSimulation`: 1–5000.
- Tổng simulated trades/request không quá 250,000; nếu vượt trả typed `400` hoặc `422` theo convention hiện tại.
- `startBalance > 0`.
- `averageGain >= 0`, `averageLoss >= 0`.
- `winRatePercent` trong `[0, 100]`.
- `seed` bắt buộc hoặc server phải trả seed thực tế đã dùng.

Mô hình ban đầu phải khớp form FE:

- Mỗi simulated trade lấy Bernoulli theo `winRatePercent`.
- Winner cộng `averageGain`; loser trừ `averageLoss`.
- Không tự thêm random volatility vào gain/loss nếu contract chưa có distribution parameters.
- Dùng PRNG cục bộ theo request; cùng input và seed phải cho response byte-stable sau khi encode ổn định.

Response:

```json
{
  "seed": 20250816,
  "inputs": {
    "simulationCount": 10,
    "tradesPerSimulation": 10,
    "startBalance": 118642.5,
    "averageGain": 684.75,
    "averageLoss": 354.12,
    "winRatePercent": 42.16
  },
  "paths": [
    {
      "simulationIndex": 1,
      "balances": [118642.5, 119327.25, 118973.13]
    }
  ],
  "summary": {
    "averageEndingBalance": 121978.48,
    "maxEndingBalance": 134996.76,
    "minEndingBalance": 111085.02,
    "averageProfitFactor": 1.9,
    "maxConsecutiveWins": 3,
    "maxConsecutiveLosses": 6,
    "totalWins": 25,
    "totalLosses": 75
  }
}
```

Quy tắc summary:

- Balance array luôn có `tradesPerSimulation + 1` point; point đầu là start balance.
- Average/max/min balance dùng ending balance của mỗi path.
- Profit factor dùng tổng gross simulated gains chia tổng gross simulated losses của toàn request. Nếu gross loss bằng 0, trả `null` và note typed, không trả Infinity.
- Consecutive wins/losses được tính trong từng path, sau đó lấy max toàn bộ paths; streak không nối qua hai simulation.
- `totalWins + totalLosses = simulationCount * tradesPerSimulation`.

## HTTP và error contract

- Đăng ký route trong `internal/httpapi/server.go` theo prefix `/api/v1/analytics` hiện tại.
- JSON body không hợp lệ, field ngoài range hoặc non-finite: typed client error.
- Source không tồn tại/type mismatch: `404` theo convention hiện tại.
- Market data thiếu không được biến thành `500`; trả partial result và audit counts khi vẫn tính được, hoặc typed `422` nếu scenario hoàn toàn không có trade hợp lệ.
- Context cancellation phải dừng computation sớm.
- Response phải có `Content-Type: application/json` và `Cache-Control: no-store`.

## Kiến trúc mong muốn

- Pure calculation nằm trong `internal/analytics`, không phụ thuộc HTTP/SQL/file I/O.
- HTTP layer chỉ parse/validate, load source/trades, gọi analytics package và serialize.
- Mở rộng `MarketData` hoặc thêm interface nhỏ cho batch path lookup; không để analytics package đọc trực tiếp bars registry.
- Accept interfaces, return structs; error được wrap với context.
- Tránh copy logic equity curve, outcome classification, risk amount và profit factor đã có.
- Nếu cần cache, chỉ cache dữ liệu market bars bất biến; không cache report theo journal đang thay đổi nếu không có source version key.

## Tests bắt buộc

### Unit tests `internal/analytics`

- Drawdown không có trade, chỉ winner, chuỗi loss, nhiều episode, episode chưa recovery.
- Point đúng peak phải có drawdown 0.
- Recovery duration dùng timestamp thực và không tính episode mở vào average.
- MAE bin boundary: `0`, `0.0999`, `0.1`, `1.0999`, `1.1`.
- Winning MAE loại trade thiếu risk và báo đúng audit count.
- Stop Loss 0% khớp actual outcome.
- Stop Loss tightened chạm/không chạm stop; long và short.
- RR target hit trước stop, stop hit trước target, neither hit, same-bar ambiguity.
- Scenario ordering deterministic và duplicate input được xử lý đúng.
- Monte Carlo cùng seed cho cùng kết quả; seed khác cho path khác.
- Monte Carlo win rate 0%, 100%, profit factor zero-loss case, streak không nối paths.
- Không có test nào cho phép `NaN` hoặc `Infinity` lọt vào JSON.

### HTTP tests

- Success cho session và evaluation.
- Missing/invalid sourceType, sourceId và body.
- Source type mismatch trả 404.
- Input limit bị chặn trước computation.
- Missing market data trả audit counts/typed 422 đúng contract.
- `Cache-Control: no-store`.
- Store chỉ `ListTrades` một lần mỗi request.

### Verification

Chạy ít nhất:

```bash
gofmt -w <các-file-Go-đã-sửa>
go test ./internal/analytics ./internal/httpapi
go test ./...
go vet ./...
```

## Definition of Done

- Bốn API trả dữ liệu thật cho cả session và evaluation.
- FE có thể thay mock bằng API mà không phải suy diễn lại công thức backend.
- Kết quả deterministic, có audit counts và không có future-data leakage ngoài đúng cửa sổ simulation.
- Không có N+1 market-data lookup.
- Unit/HTTP/full Go tests pass.
- Cuối task, báo rõ file đã sửa, endpoint đã thêm, formula/policy đã chọn, test đã chạy và mọi assumption còn lại cho FE.
