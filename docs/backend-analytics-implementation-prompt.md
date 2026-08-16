# Prompt triển khai Backend Analytics

> Copy toàn bộ nội dung từ phần **Vai trò** trở xuống và gửi cho agent Backend.

## Vai trò

Bạn là senior Go backend engineer. Hãy triển khai Backend Analytics cho project Market Replay tại:

`/home/namvt/Desktop/dev-space/market-replay`

## Mục tiêu

Thay toàn bộ dữ liệu mock của tab Analytics bằng dữ liệu được tính từ closed trades thật của:

1. Replay Session Journal.
2. Account Evaluation.

Chỉ code Backend và các contract/type cần thiết. Không sửa giao diện hoặc styling Frontend.

## Trước khi code

- Đọc toàn bộ route, model, store và migration hiện có.
- Tìm implementation liên quan đến sessions, evaluation accounts, trades và market data.
- Tuân thủ convention API hiện tại, không tự tạo kiến trúc song song.
- Đọc contract mock hiện tại tại:
  - `web/src/components/analytics/analytics-reports.ts`
  - `web/src/components/analytics/analytics-data.ts`
  - `web/src/components/analytics/AnalyticsScreen.tsx`
- Nếu cần thay đổi response type phía FE, chỉ ghi rõ contract cần thay đổi, không sửa UI.

## API 1: Danh sách nguồn Analytics

Tạo endpoint theo convention hiện tại, tương đương:

`GET /api/analytics/sources`

Response phải trả về cả session journal và evaluation account:

```json
{
  "items": [
    {
      "id": "session-id",
      "type": "session",
      "title": "NQ replay journal",
      "subtitle": "Jan 16–Apr 04, 2025 · 204 closed trades",
      "status": "stopped",
      "tradeCount": 204,
      "startedAt": "2025-01-16T00:00:00Z",
      "endedAt": "2025-04-04T00:00:00Z"
    },
    {
      "id": "evaluation-id",
      "type": "evaluation",
      "title": "50K evaluation account",
      "subtitle": "Apr 07–Aug 29, 2025 · 200 closed trades",
      "status": "paused",
      "tradeCount": 200,
      "startedAt": "2025-04-07T00:00:00Z",
      "endedAt": "2025-08-29T00:00:00Z"
    }
  ]
}
```

Hỗ trợ pagination nếu hệ thống hiện tại đã có convention cursor/limit.

## API 2: Báo cáo Performance

Endpoint tương đương:

`GET /api/analytics/performance?sourceType=session&sourceId={id}&breakevenThreshold=0&timezone=Asia%2FHo_Chi_Minh`

`sourceType` chỉ nhận:

- `session`
- `evaluation`

Validation:

- `sourceId` bắt buộc và phải tồn tại.
- `sourceType` chỉ nhận `session` hoặc `evaluation`.
- `breakevenThreshold` phải là số hợp lệ.
- `timezone` phải là IANA timezone hợp lệ.
- Không trả dữ liệu của source khác.
- Trả lỗi typed `400`, `404`, `500` theo convention hiện tại.

Response cần có cấu trúc typed và ổn định:

```json
{
  "source": {
    "id": "source-id",
    "type": "session",
    "title": "NQ replay journal",
    "subtitle": "Jan 16–Apr 04, 2025 · 204 closed trades",
    "status": "stopped",
    "initialBalance": 100000
  },
  "overview": {
    "totalPnl": 18642.5,
    "pnlPercent": 18.64,
    "accountBalance": 118642.5,
    "winRate": 42.16,
    "totalTrades": 204,
    "longTrades": 91,
    "shortTrades": 113,
    "breakevenTrades": 4
  },
  "equityCurve": [
    {
      "tradeIndex": 0,
      "tradeId": null,
      "closedAt": null,
      "cumulativePnl": 0,
      "balance": 100000
    },
    {
      "tradeIndex": 1,
      "tradeId": "trade-id",
      "closedAt": "2025-01-16T15:30:00Z",
      "cumulativePnl": 320.5,
      "balance": 100320.5
    }
  ],
  "riskReward": {
    "averageRr": 1.42,
    "maxRr": 8.91,
    "idealAverageRr": 4.86,
    "maxIdealRr": 21.42,
    "couldHaveProfitOrBreakeven": 29,
    "couldHaveMaxIdealRr": 9.83,
    "series": {
      "actual": [],
      "ideal": [],
      "missed": []
    }
  },
  "expectancy": {
    "value": 91.28,
    "averageWin": 464.55,
    "averageLoss": -275.4,
    "profitFactor": 1.46
  },
  "winners": {
    "total": 86,
    "bestWinPercent": 15.29,
    "averageWinPercent": 2.75,
    "averageDurationSeconds": 23580,
    "maxConsecutive": 5,
    "averageConsecutive": 1.35
  },
  "losers": {
    "total": 114,
    "worstLossPercent": -17.85,
    "averageLossPercent": -0.86,
    "averageDurationSeconds": 6300,
    "maxConsecutive": 16,
    "averageConsecutive": 3.34
  },
  "bySide": {
    "buy": {
      "trades": 91,
      "tradePercent": 44.61,
      "wins": 40,
      "winRate": 43.96
    },
    "sell": {
      "trades": 113,
      "tradePercent": 55.39,
      "wins": 46,
      "winRate": 40.71
    }
  },
  "bySession": [],
  "byTime": {
    "pnl": [],
    "rr": [],
    "profitPercent": [],
    "winRate": []
  },
  "byDay": [],
  "byMonth": [],
  "calendar": [],
  "frequency": {
    "byWeekday": [],
    "byWeek": [],
    "byMonth": []
  }
}
```

## Quy tắc tính toán

### 1. Closed trades

- Chỉ dùng trade đã đóng.
- Sắp xếp equity curve theo `closedAt` tăng dần.
- Nếu trùng `closedAt`, dùng ID hoặc sequence ổn định làm tie-breaker.
- Không dùng open position.
- Không double-count partial fills hoặc child execution; phải aggregate theo trade lifecycle hiện có.

### 2. Total PnL

- Tính tổng net realized PnL.
- Nếu hệ thống lưu fee/commission: `netPnl = grossPnl - commission - fees`.
- `accountBalance = initialBalance + cumulativeNetPnl`.
- `pnlPercent = totalPnl / initialBalance * 100`.

### 3. Trade result và breakeven threshold

- Winner: `netPnl > breakevenThreshold`.
- Loser: `netPnl < -breakevenThreshold`.
- Breakeven: nằm trong khoảng còn lại.
- Trả rõ quy tắc boundary trong test.

### 4. Win rate

- `winRate = wins / totalClosedTrades * 100`.
- Trường hợp không có trade trả `0`, không trả `NaN` hoặc `Infinity`.

### 5. Risk-Reward

- `actualR = netPnl / initialRiskAmount`.
- Trade không có `initialRiskAmount` hợp lệ không được làm hỏng báo cáo.
- Trả số trade bị loại khỏi RR calculation để có thể audit nếu cần.

### 6. Ideal RR

Ideal RR là lợi nhuận tối đa trade có thể đạt được nếu được giữ tối đa một tuần sau thời điểm mở.

- Long: lấy giá `high` lớn nhất trong cửa sổ bảy ngày.
- Short: lấy giá `low` nhỏ nhất trong cửa sổ bảy ngày.
- Chuyển favorable excursion sang tiền và chia cho `initialRiskAmount`.
- Không được look ahead quá `openedAt + 7 ngày`.
- Dùng market-data store hiện có.
- Batch query market data, không query một lần cho từng trade.
- Nếu thiếu market data, trả coverage/missing count thay vì tự bịa dữ liệu.

### 7. Could have profit/BE

Đếm trade thỏa cả hai điều kiện:

- Ideal RR hoặc MFE đạt trên `1.2R`.
- Kết quả cuối cùng là loss.

### 8. Expectancy

```text
expectancy =
  winRateDecimal * averageWinAmount
  + lossRateDecimal * averageLossAmount
```

`averageLossAmount` là số âm.

### 9. Profit factor

`profitFactor = grossProfit / abs(grossLoss)`

- Nếu `grossLoss = 0`, không trả `Infinity`.
- Dùng `null` kèm reason hoặc một quy ước typed được document rõ ràng.

### 10. Winners và losers

Tính:

- Tổng số trade.
- Best/worst result percentage.
- Average result percentage.
- Average holding duration.
- Maximum consecutive sequence.
- Average consecutive sequence.

Sequence phải dựa trên thứ tự đóng trade ổn định.

### 11. Performance by side

Tách long/buy và short/sell:

- Total trades.
- Tỷ lệ phần trăm.
- Wins.
- Win rate.

### 12. Performance by session

Phân loại:

- Asia.
- London.
- New York.
- Out of session.

Không hardcode timezone ngầm. Nhận timezone từ request và định nghĩa session windows ở config hoặc một nơi tập trung có test.

Cho mỗi session trả:

- `winRate`
- `totalTrades`
- `averageRr`
- `totalPnl`

### 13. Performance by time

Group theo giờ mở trade trong timezone được chọn.

Mỗi giờ trả:

- `profit`: tổng PnL dương.
- `loss`: tổng PnL âm.
- `netPnl`.
- `averageRr`.
- `profitPercent` so với initial balance.
- `winRate`.
- `totalTrades`.

Giờ không có trade vẫn phải trả entry với giá trị `0` để chart có trục ổn định.

### 14. Performance by day

Group theo weekday và trả:

- `profit`
- `loss`
- `netPnl`
- `totalTrades`
- `wins`
- `winRate`

Trả đủ Monday–Sunday.

### 15. Performance by month

Group theo `YYYY-MM` và trả:

- `monthlyPnl`
- `monthlyGainPercent`
- `endingBalance`
- `totalTrades`

Không gộp các năm khác nhau chỉ bằng tên tháng.

### 16. Calendar

Group theo local date và trả:

- `date`
- `trades`
- `wins`
- `losses`
- `breakeven`
- `pnl`
- `pnlPercent`
- `endingBalance`

### 17. Trade frequency

- By weekday: average trades của từng weekday.
- By week: tổng trade theo ISO week, kèm `weekStart` và `weekEnd`.
- By month: tổng trade theo `YYYY-MM`.
- Trả `averageTradesPerDay`, `averageTradesPerWeek` và `averageTradesPerMonth`.

## Data và hiệu năng

- Dùng PostgreSQL/SQLite store abstraction hiện có.
- Không hardcode ID hoặc kết quả mock.
- Thiết kế query tránh N+1.
- Chỉ thêm index/migration khi cần, ví dụ:
  - source/session ID + `closed_at`.
  - evaluation account ID + `closed_at`.
  - symbol + timestamp cho Ideal RR lookup.
- Mọi query phải parameterized.
- Dùng `context.Context` và truyền cancellation xuống store.
- Không giữ transaction lâu trong lúc tính analytics.
- Không log toàn bộ trade payload.
- Wrap error với context, không nuốt lỗi.

## Kiến trúc mong muốn

Tách rõ:

- HTTP handler: parse và validate request.
- Analytics service: công thức nghiệp vụ.
- Repository/store: lấy trades, source metadata và market data.
- Response mapper: API DTO.

Ưu tiên pure functions cho các aggregate để dễ test.

## Testing bắt buộc

Viết test chứng minh:

- Session 200+ trades được aggregate đúng.
- Evaluation 200+ trades được aggregate đúng.
- Long/short count và total khớp nhau.
- Equity curve luôn có `totalTrades + 1` điểm.
- Trade được sort ổn định.
- Win/loss/breakeven threshold đúng boundary.
- Empty source không gây `NaN` hoặc `Infinity`.
- Profit factor khi không có loss.
- RR khi initial risk bằng `0` hoặc bị thiếu.
- Ideal RR cho cả long và short.
- Ideal RR không vượt cửa sổ bảy ngày.
- Could have profit/BE dùng threshold trên `1.2R`.
- Timezone thay đổi đúng hour/day grouping.
- Consecutive wins/losses.
- Calendar/month crossing year.
- Context cancellation.
- Handler validation và `404`.
- Query không có N+1 đáng kể.

Chạy:

```bash
gofmt -w <các-file-go-đã-thay-đổi>
go test ./...
go test -race ./...
```

Nếu không thể chạy race test trong môi trường hiện tại, phải ghi rõ lý do trong báo cáo bàn giao.

## Kết quả bàn giao

Khi hoàn thành, báo cáo:

1. Danh sách endpoint.
2. Request/response contract cuối cùng.
3. Công thức và các quyết định boundary.
4. Migration/index đã thêm.
5. Test đã chạy và kết quả.
6. Những field Frontend cần đổi để bỏ mock.
7. Các trường hợp thiếu market data khiến Ideal RR không tính được.

Không sửa Frontend, không tạo dữ liệu giả trong production và không đánh dấu hoàn thành nếu test chưa chạy.
