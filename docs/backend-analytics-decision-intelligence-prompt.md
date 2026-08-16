# Prompt triển khai Backend cho Analytics Decision Intelligence

> Copy toàn bộ nội dung từ phần **Vai trò** trở xuống và gửi cho agent Backend. Đây là phần mở rộng của analytics backend hiện có, không phải một service mới.

## Vai trò

Bạn là senior Go backend engineer. Hãy triển khai Backend production-grade cho hai tab Analytics mới **Edge** và **Execution & Discipline** trong repo:

`/home/namvt/Desktop/dev-space/market-replay`

## Mục tiêu

Thay dữ liệu mock Decision Intelligence bằng kết quả tính từ closed trades thật của:

1. Replay Session Journal.
2. Evaluation Account.

Chỉ code Backend, test Backend và API contract/type cần thiết. Không sửa layout, style hoặc hành vi hiển thị Frontend.

## Bối cảnh bắt buộc phải đọc trước khi code

Mở rộng package `internal/analytics` và HTTP API hiện có; không tạo package/service song song:

- `internal/analytics/`
- `internal/httpapi/analytics.go`
- `internal/httpapi/analytics_drawdown.go`
- `internal/httpapi/analytics_marketdata.go`
- `internal/httpapi/server.go`
- `internal/model/trade.go`
- `internal/storage/`
- `web/src/fill-engine/edge-stat.ts`
- `web/src/fill-engine/bootstrap.ts`
- `web/src/fill-engine/decomposition.ts`
- `web/src/fill-engine/walk-forward.ts`
- `web/src/fill-engine/kelly.ts`
- `web/src/fill-engine/execution-quality.ts`
- `web/src/fill-engine/decision-quality.ts`
- `web/src/fill-engine/tilt.ts`
- `web/src/components/analytics/EdgeTab.tsx`
- `web/src/components/analytics/ExecutionDisciplineTab.tsx`

Các endpoint hiện có phải tiếp tục hoạt động, không đổi response contract:

- `GET /api/v1/analytics/sources`
- `GET /api/v1/analytics/performance`
- `GET /api/v1/analytics/drawdown`
- `POST /api/v1/analytics/simulations/stop-loss`
- `POST /api/v1/analytics/simulations/risk-reward`
- `POST /api/v1/analytics/simulations/monte-carlo`

`sourceType` chỉ nhận `session` hoặc `evaluation`. Phải dùng cùng source-resolution helper hiện có. Source ID sai type phải trả cùng dạng `404` như source không tồn tại để không lộ dữ liệu.

## Nguyên tắc dữ liệu

- Chỉ dùng closed trades thuộc source được yêu cầu.
- Sort ổn định theo `ExitTs`, sau đó `ID` làm tie-breaker.
- Tiền tính nội bộ bằng integer cents. Tick/price dùng integer ticks. Chỉ chuyển sang JSON number ở boundary.
- Không trả `NaN`, `Infinity`, chuỗi tiền đã format hoặc dữ liệu bịa.
- Trường không thể tính phải là `null` kèm audit count/reason rõ ràng; không âm thầm thay bằng `0` nếu `0` mang nghĩa hợp lệ.
- Không query market data từng trade. Phải dùng batch seam đang có trong `analytics_marketdata.go`.
- Không dùng mutable global state. Cùng source + config + seed phải cho cùng kết quả.
- Các endpoint journal-dependent trả `Cache-Control: no-store` theo convention hiện tại.
- Tôn trọng `context.Context`; các vòng bootstrap/re-walk dài phải kiểm tra cancellation định kỳ.
- Giới hạn request trước khi allocation hoặc tính toán tốn CPU.
- Response phải có `source`, `audit`, `calculationVersion` để FE và test có thể xác định dữ liệu/công thức.

## API 1 — Edge

Tạo endpoint:

```text
GET /api/v1/analytics/edge?sourceType=session&sourceId={id}&confidence=0.9&bootstrapIterations=10000&seed=20250816
```

Validation:

- `confidence`: hữu hạn, trong `[0.80, 0.99]`, mặc định `0.90`.
- `bootstrapIterations`: integer trong `[1000, 50000]`, mặc định `10000`.
- `seed`: integer 64-bit tùy chọn; có default cố định, không dùng current time.
- Chỉ trade có `RMultiple != nil` và finite mới vào edge statistics.

Response đề xuất:

```json
{
  "source": {
    "id": "source-id",
    "type": "session",
    "title": "NQ replay journal",
    "tradeCount": 204
  },
  "calculationVersion": "decision-intelligence-v1",
  "audit": {
    "totalTrades": 204,
    "eligibleRTrades": 203,
    "excludedNoRMultiple": 1,
    "eligibleExcursionTrades": 202,
    "excludedNoInitialRisk": 2,
    "marketDataCoverageTrades": 202
  },
  "edge": {
    "sampleSize": 203,
    "expectancyR": 0.248,
    "winRate": 42.6,
    "averageWinR": 1.73,
    "averageLossR": 0.88,
    "averageRR": 1.97,
    "breakevenRate": 33.67,
    "tStatistic": 2.70,
    "pValue": 0.007,
    "verdict": "edge"
  },
  "bootstrap": {
    "confidence": 0.9,
    "iterations": 10000,
    "seed": 20250816,
    "expectancyR": { "lower": 0.104, "median": 0.249, "upper": 0.401 },
    "maxDrawdownR": { "lower": -18.2, "median": -11.4, "upper": -7.3 },
    "sharpe": { "lower": 0.8, "median": 1.3, "upper": 1.9 }
  },
  "decomposition": {
    "payoffAsymmetry": 1.97,
    "averageMfeR": 1.45,
    "averageMaeR": 0.62,
    "averageRealizedR": 0.248,
    "captureRatio": 0.171,
    "timingFlag": "exit-leak",
    "topN": 5,
    "topNConcentrationPercent": 7.4,
    "concentrationFlag": "diversified"
  },
  "walkForward": {
    "split": 0.8,
    "inSample": { "trades": 162, "expectancyR": 0.236 },
    "outOfSample": { "trades": 41, "expectancyR": 0.296 },
    "expectancyDeltaR": 0.060,
    "retentionRatio": 1.251,
    "windows": [
      { "label": "W1", "startTs": 1737007200, "endTs": 1738500000, "trades": 41, "expectancyR": 0.21 }
    ],
    "parameterSensitivity": {
      "method": "ohlc-rewalk",
      "shape": "plateau",
      "rangeR": 0.12,
      "points": [
        { "stopDeltaPercent": -20, "targetDeltaPercent": -20, "expectancyR": 0.20 }
      ]
    }
  },
  "sizing": {
    "method": "fractional-kelly",
    "fullKelly": 0.136,
    "fraction": 0.25,
    "fractionalKelly": 0.034,
    "suggestedRiskPerTrade": 0.02,
    "maxRiskCap": 0.02,
    "capped": true
  }
}
```

`sizing` phải là `null` nếu verdict không phải `edge`.

### Công thức và guardrail Edge

Với chuỗi R hợp lệ:

```text
E[R] = mean(R)
avgRR = averageWinR / abs(averageLossR)
breakevenRate = 1 / (1 + avgRR)
t = mean(R) * sqrt(n) / sampleStdDev(R)
pValue = two-sided Student t probability với df = n - 1
```

Verdict theo đúng thứ tự:

1. `n < 50` → `insufficient`.
2. `pValue >= 0.05` → `no-evidence`.
3. `winRate <= breakevenRate` → `zero-edge`.
4. Còn lại → `edge`.

Edge cases:

- Sample standard deviation bằng 0 và mean dương: `tStatistic` không được serialize thành Infinity. Trả `tStatistic: null`, `pValue: 0`, kèm audit warning `zeroVarianceSample`.
- Không có loss: `averageRR` và breakeven phải nullable thay vì chia 0; verdict không tự động unlock sizing.
- Percent trong response dùng thang `0..100`; ratio/Kelly dùng thang `0..1`. Ghi rõ quy ước trong Go doc và tests.

### Bootstrap

- Resample trade R có hoàn lại, cùng sample length.
- Mỗi resample tính expectancy, peak-to-trough max drawdown trên cumulative R và sample Sharpe.
- CI percentile hai phía theo `confidence` request.
- PRNG seed-able, độc lập request; test phải chứng minh cùng seed cho response byte-stable ở phần result.
- Kiểm tra context cancellation ít nhất mỗi 100 iterations.

### Decomposition

- `mfeR = MfeTicks / abs(EntryPriceTicks - InitialStopTicks)`.
- `maeR = MaeTicks / abs(EntryPriceTicks - InitialStopTicks)`.
- Exclude initial risk `<= 0`; báo audit count.
- `captureRatio = max(0, averageRealizedR) / averageMfeR`.
- Timing flag dùng ngưỡng đúng với FE v1 hoặc tập trung constant có unit test:
  - `exit-leak`: average MFE lớn hơn đáng kể realized.
  - `entry-good`: MAE thấp và expectancy dương.
  - `entry-risk`: MAE cao.
  - còn lại `balanced`.
- Concentration chỉ dùng gross positive R: tổng top N winner R / tổng winner R.

### Walk-forward và sensitivity

- Split chronological 80/20, không random shuffle.
- Rolling windows không overlap hoặc mô tả rõ policy; không để future data lọt vào prior window.
- Sensitivity production phải dùng OHLC batch re-walk cho grid stop/target delta `[-20,-10,-5,0,5,10,20]` phần trăm.
- Nếu chưa thể re-walk đúng vì market data thiếu, trả `parameterSensitivity: null` và audit coverage; tuyệt đối không port proxy/noise phase-one từ FE thành số production.
- Nếu trong một bar chạm cả stop và target mà không biết intrabar path, dùng policy bảo thủ `stop-first` và trả metadata `intrabarPolicy`.

### Kelly

```text
b = averageWinR / abs(averageLossR)
p = winRate (0..1)
q = 1 - p
fullKelly = max(0, (p*b - q) / b)
fractionalKelly = fullKelly * fraction
suggestedRiskPerTrade = min(fractionalKelly, maxRiskCap)
```

- v1 dùng fraction `0.25`, cap `0.02`.
- Chỉ trả sizing khi verdict `edge`, mọi input hữu hạn, có cả wins/losses và OOS expectancy không âm.

## API 2 — Execution & Discipline

Tạo endpoint:

```text
GET /api/v1/analytics/execution-discipline?sourceType=session&sourceId={id}
```

Response đề xuất:

```json
{
  "source": { "id": "source-id", "type": "session", "title": "NQ replay journal", "tradeCount": 204 },
  "calculationVersion": "decision-intelligence-v1",
  "audit": {
    "totalTrades": 204,
    "eligibleExecutionTrades": 202,
    "excludedNoInitialRisk": 2,
    "protectionTelemetryTrades": 204,
    "costModelSource": "symbol-config",
    "marketDataCoverageTrades": 202
  },
  "execution": {
    "averageMfePercentile": 25.6,
    "averageCaptureRatio": -0.678,
    "grossExpectancyR": 0.248,
    "averageCostR": 0.068,
    "netExpectancyR": 0.180,
    "netWinRate": 39.2,
    "edgeAfterCosts": true,
    "costModel": {
      "tickValueCents": 500,
      "spreadTicks": 0.25,
      "slippageTicks": 0.35,
      "feesIncluded": true
    },
    "mfeHistogram": [
      { "fromInclusiveR": 0, "toExclusiveR": 0.4, "count": 24 }
    ],
    "exitReasonBreakdown": {
      "manual": 41,
      "stopLoss": 96,
      "takeProfit": 67
    }
  },
  "decision": {
    "matrix": { "goodWin": 75, "goodLoss": 106, "badWin": 12, "badLoss": 11 },
    "planAdherenceScore": 95.9,
    "ruleFollowingDividendR": 0.012,
    "ruleFollowingDividendCents": 625,
    "tradeClassifications": [
      { "tradeId": "trade-id", "classification": "goodLoss", "adherenceScore": 100, "tamperedStop": false, "tamperedTarget": false }
    ]
  },
  "psychology": {
    "profile": "size-chaser",
    "tiltScore": 17.6,
    "slTamperingScore": 23.5,
    "sizingConsistency": 64.7,
    "antiStreakScore": 74.2,
    "postLossSizeEscalations": 3,
    "rapidReentriesAfterLoss": 5
  }
}
```

### Execution quality

- Initial risk ticks = absolute distance từ entry tới initial stop; phải dương.
- `mfeR = max(0, MfeTicks / initialRiskTicks)`.
- Trade exit percentile: percentile của realized R trong phân phối MFE R của cùng source. Document chính xác tie policy (`<=`).
- `captureRatio = realizedR / mfeR`; `mfeR == 0` trả 0 cho trade đó. Giữ dấu âm để lệnh thua thể hiện lost opportunity; UI sẽ format/tô màu.
- Cost R mỗi trade gồm persisted `FeesCents` + configured spread/slippage quy ra cents, chia initial risk cents.
- Không hard-code tick value theo symbol trong handler. Dùng symbol/trading config hiện có hoặc typed resolver; symbol chưa có config phải vào audit và bị exclude khỏi cost result.
- `netExpectancyR = grossExpectancyR - averageCostR`.
- `edgeAfterCosts = netExpectancyR > 0`.
- Histogram MFE dùng fixed bin width `0.4R`, bucket cuối `>=4.0R` để contract ổn định.
- Exit reason chỉ nhận enum `manual|stopLoss|takeProfit`. Unknown reason phải có bucket/audit riêng, không âm thầm gộp nếu dữ liệu production có giá trị lạ.

### Decision quality

Mỗi trade được chấm độc lập với outcome:

- Stop “moved away from plan”:
  - long: adjustment stop thấp hơn initial stop;
  - short: adjustment stop cao hơn initial stop.
- Target “moved toward entry”:
  - long: adjustment TP thấp hơn initial TP;
  - short: adjustment TP cao hơn initial TP.
- Adherence score `0..100`, penalty constants đặt tên và unit-test; không rải magic number.
- `followedPlan` chỉ true khi score đạt threshold và không nới stop.
- Matrix:
  - followed plan + win → `goodWin`;
  - followed plan + non-win → `goodLoss`;
  - broke plan + win → `badWin`;
  - broke plan + non-win → `badLoss`.
- Breakeven phải có policy rõ: v1 xếp theo non-win nhưng báo riêng trong audit.
- `tradeClassifications` giữ stable order để FE có thể drill down sau này.

`ruleFollowingDividend` production không được chỉ giả định mọi bad loss thành `-1R` nếu initial stop chưa chắc đã chạm. Hãy batch re-walk OHLC từ entry đến actual exit:

- so actual result với outcome nếu giữ nguyên initial SL/TP;
- dùng `stop-first` khi cùng bar chạm cả hai;
- exclude và audit trade thiếu market data;
- nếu coverage không đủ ngưỡng đã thống nhất, trả dividend `null` kèm coverage thay vì số ước lượng giả.

### Tilt và behavior profile

Sort theo entry time khi phân tích behavior:

- losing streak dựa trên net `RealizedCents < 0`.
- Post-loss size escalation: sau ít nhất 2 losses liên tiếp, qty lớn hơn 125% rolling mean của tối đa 8 trade trước.
- Rapid re-entry: entry kế tiếp trong vòng 15 phút sau exit của loss.
- SL tampering dùng protection adjustment nới stop khỏi plan.
- Sizing consistency từ coefficient of variation của qty, map về score `0..100`.
- Anti-streak score thưởng giữ size và chờ quá 15 phút sau streak; clamp `0..100`.
- Profile enum: `composed|size-chaser|revenge-risk|plan-drifter`.
- Đây là behavioral telemetry, không phải chẩn đoán tâm lý. Không thêm copy mang tính y khoa trong API.

## Kiến trúc Go mong đợi

- Thêm các file nhỏ, tập trung trách nhiệm trong `internal/analytics`, ví dụ:
  - `edge.go`
  - `student_t.go`
  - `bootstrap.go`
  - `walkforward.go`
  - `execution_quality.go`
  - `decision_quality.go`
  - `tilt.go`
  - các `*_test.go` tương ứng.
- Handler HTTP chỉ parse/validate, resolve source, gọi analytics package và write response.
- Reuse source resolver, typed errors, JSON writer và market-data adapter hiện có.
- Không đưa công thức thống kê vào `internal/httpapi`.
- Không thêm dependency lớn chỉ để tính Student t nếu có thể triển khai và test numerical helper nhỏ bằng stdlib. Nếu thêm dependency, giải thích trade-off và pin version.
- Constants về threshold phải có tên, unit và Go doc.

## Error contract

Giữ error envelope hiện có. Tối thiểu:

- `400`: sourceType/config/seed/confidence/iteration không hợp lệ.
- `404`: source không tồn tại hoặc source type mismatch.
- `409` hoặc typed `422` theo convention repo: source chưa có closed trade đủ điều kiện để tính report.
- `499` nội bộ/context canceled không được biến thành `500` noisy nếu response chưa ghi.
- Không leak storage error, path, SQL hoặc internal IDs ra client.

## Tests bắt buộc

### Unit tests

- E[R], payoff, breakeven, sample stddev.
- Student t p-value đối chiếu các known reference values và hai phía.
- Verdict đủ cả 4 state; n=0, n=49, n=50; zero variance; no wins/no losses.
- Bootstrap deterministic, CI ordering, cancellation và iteration bounds.
- Max drawdown bootstrap dùng đúng peak-to-trough.
- Decomposition MFE/MAE normalization, timing flags, top-N concentration.
- Walk-forward chronological split, no future leakage, empty OOS edge case.
- OHLC sensitivity long/short, stop-first ambiguity, missing coverage.
- Kelly nullable guardrails, fractional bounds, cap.
- Cost conversion cents/ticks/R, unknown symbol config, edge survives/consumed.
- Decision matrix đủ 4 ô, long/short stop tampering, target tampering, breakeven.
- Rule-following re-walk và market-data coverage.
- Tilt: streak reset, size escalation, rapid re-entry boundary đúng 15 phút, zero qty variance, stable sorting.

### HTTP tests

- Happy path cho cả `session` và `evaluation`.
- Missing/invalid query params.
- Source type mismatch trả 404.
- Không eligible trade.
- Response không chứa NaN/Infinity.
- Seed giống nhau trả cùng bootstrap result.
- Iteration/confidence bounds bị reject trước allocation.
- `Cache-Control: no-store`.
- Context cancellation/timeout không làm goroutine leak.

## Definition of Done

1. Hai endpoint mới chạy với journal/evaluation thật, không dùng mock.
2. Không regression endpoint analytics cũ.
3. Không N+1 market-data/storage query.
4. Công thức, units, nullability và audit counts khớp contract.
5. `go test ./...` pass.
6. `go test -race ./...` pass cho package thay đổi.
7. `gofmt` sạch; `go vet ./...` pass.
8. Cuối task báo rõ file đã sửa, endpoint mới, assumptions, coverage limitation và phần FE cần nối API; không tự sửa FE.
