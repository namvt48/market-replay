# Prompt triển khai Backend cho Trade Review và Tag Analytics

> Copy toàn bộ nội dung từ phần **Vai trò** trở xuống và gửi cho agent Backend. Frontend đã hoàn thiện luồng và hiện chỉ lưu metadata người dùng ở local storage; nhiệm vụ này thay lớp local đó bằng persistence/API thật, không viết lại UI.

## Vai trò

Bạn là senior Go backend engineer. Hãy triển khai Backend production-grade cho tính năng **Trade Review** và **Analytics by Tag** trong repo:

`/home/namvt/Desktop/dev-space/market-replay`

## Mục tiêu

Persist và phục vụ dữ liệu người dùng tạo khi hậu kiểm từng closed trade của hai nguồn:

1. Replay Session (`sourceType=session`).
2. Evaluation Account (`sourceType=evaluation`).

Dữ liệu gồm Markdown note, chart screenshots, tag groups, tags, assignment mỗi group cho mỗi trade, và aggregate Analytics theo tag. Không tạo hay seed mock data. Không thay đổi ledger trade, công thức fill engine, hoặc layout Frontend.

## Bối cảnh bắt buộc đọc trước khi code

- `internal/httpapi/server.go`
- `internal/httpapi/sessions.go`
- `internal/httpapi/analytics.go`
- `internal/httpapi/analytics_edge.go`
- `internal/model/session.go`
- `internal/storage/sqlite/schema.go`
- `internal/storage/sqlite/sessions.go`
- `web/src/review/types.ts`
- `web/src/store/review-store.ts`
- `web/src/review/use-review-trades.ts`
- `web/src/components/review/ReviewPanel.tsx`
- `web/src/components/review/ReviewMetadata.tsx`
- `web/src/components/analytics/TagAnalyticsTab.tsx`
- `web/src/api/analytics.ts`

Reuse source-resolution và ownership rules của Analytics hiện có. `sourceType` chỉ nhận `session` hoặc `evaluation`. Source ID sai type phải trả cùng dạng `404` như source không tồn tại. Closed trade phải thực sự thuộc source trước khi được đọc hoặc ghi review.

## Nguyên tắc bắt buộc

- Trade ledger là immutable đối với feature này. Review metadata nằm ở bảng riêng.
- Markdown được lưu dạng plain UTF-8; không render HTML ở backend và không chấp nhận HTML đã render.
- Tiền vẫn dùng integer cents; timestamp epoch seconds/milliseconds phải được đặt tên rõ, không trộn đơn vị.
- Không trả `NaN`/`Infinity`; average R không tính được phải là `null`.
- Không dùng mutable global state. Không lưu ảnh base64 trong SQLite.
- Mọi write phải transactional, fail loud, wrap error với context, và support `context.Context` cancellation.
- Tất cả list có stable ordering và bounded pagination; validate trước allocation.
- Endpoint metadata thay đổi thường xuyên trả `Cache-Control: no-store`.
- Giới hạn payload, MIME và kích thước ảnh; không tin filename/client MIME.
- Response error theo convention JSON hiện có; không trả stack trace hoặc filesystem path.
- Thêm migration tương thích database đang có; không drop/rename destructive bảng cũ.

## Data model / migration

Thiết kế migration SQLite tối thiểu như sau (có thể đổi tên theo convention repo nhưng giữ semantic):

### `trade_reviews`

- `id TEXT PRIMARY KEY`
- `source_type TEXT NOT NULL CHECK (source_type IN ('session','evaluation'))`
- `source_id TEXT NOT NULL`
- `trade_id TEXT NOT NULL`
- `markdown TEXT NOT NULL DEFAULT ''`
- `revision INTEGER NOT NULL DEFAULT 1`
- `created_at INTEGER NOT NULL` — epoch milliseconds
- `updated_at INTEGER NOT NULL` — epoch milliseconds
- `UNIQUE(source_type, source_id, trade_id)`

Index: `(source_type, source_id, updated_at DESC, trade_id)`.

### `review_screenshots`

- `id TEXT PRIMARY KEY`
- `review_id TEXT NOT NULL REFERENCES trade_reviews(id) ON DELETE CASCADE`
- `object_key TEXT NOT NULL UNIQUE`
- `mime_type TEXT NOT NULL`
- `byte_size INTEGER NOT NULL`
- `width INTEGER NOT NULL`
- `height INTEGER NOT NULL`
- `captured_at INTEGER NOT NULL` — epoch milliseconds
- `cursor_ts INTEGER` — epoch seconds, nullable
- `created_at INTEGER NOT NULL`

Index: `(review_id, captured_at, id)`.

### `review_tag_groups`

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `position INTEGER NOT NULL`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

Tên group trim, dài `1..80`. Position không âm. V1 single-user nên taxonomy là workspace-global.

### `review_tags`

- `id TEXT PRIMARY KEY`
- `group_id TEXT NOT NULL REFERENCES review_tag_groups(id) ON DELETE CASCADE`
- `name TEXT NOT NULL`
- `color TEXT NOT NULL CHECK (color IN ('green','blue','orange','red','purple','cyan','grey'))`
- `position INTEGER NOT NULL`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`
- `UNIQUE(group_id, name COLLATE NOCASE)`

### `review_trade_tags`

- `source_type TEXT NOT NULL`
- `source_id TEXT NOT NULL`
- `trade_id TEXT NOT NULL`
- `group_id TEXT NOT NULL REFERENCES review_tag_groups(id) ON DELETE CASCADE`
- `tag_id TEXT NOT NULL REFERENCES review_tags(id) ON DELETE CASCADE`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`
- `PRIMARY KEY(source_type, source_id, trade_id, group_id)`

Ràng buộc application-level trong cùng transaction: `tag_id` phải thuộc `group_id`; trade phải thuộc source; mỗi trade chỉ có tối đa một tag trong một group. Index thêm `(source_type, source_id, tag_id)` phục vụ Analytics.

## API contract

Prefix dùng `/api/v1/review`.

### 1. Bootstrap Review workspace

```text
GET /api/v1/review?sourceType=session&sourceId={id}
```

Response:

```json
{
  "source": { "id": "...", "type": "session", "title": "NQ · 1m", "tradeCount": 163 },
  "tagGroups": [
    {
      "id": "group-id",
      "name": "Confidence",
      "position": 0,
      "tags": [
        { "id": "tag-id", "name": "High Confidence", "color": "green", "position": 0 }
      ]
    }
  ],
  "reviews": [
    {
      "tradeId": "trade-id",
      "markdown": "## Trade thesis",
      "revision": 3,
      "updatedAt": 1786896000000,
      "screenshots": [
        { "id": "shot-id", "url": "/api/v1/review/screenshots/shot-id", "mimeType": "image/jpeg", "width": 1280, "height": 720, "capturedAt": 1786896000000, "cursorTs": 1737007200 }
      ],
      "tagAssignments": { "group-id": "tag-id" }
    }
  ]
}
```

Chỉ trả review có nội dung/ảnh/tag; không materialize row rỗng cho mọi trade. Ordering `updatedAt DESC, tradeId ASC`. Với source lớn, hỗ trợ `limit` mặc định 500, max 2000 và cursor opaque; response thêm `nextCursor` nullable.

### 2. Upsert Markdown note

```text
PUT /api/v1/review/{sourceType}/{sourceId}/trades/{tradeId}
If-Match: "3"
Content-Type: application/json

{ "markdown": "## Trade thesis\n..." }
```

Validation: tối đa 100,000 UTF-8 bytes. `If-Match` optional khi tạo, bắt buộc khi row đã tồn tại. Update atomically increment revision. Conflict trả `409` cùng current revision/document để FE merge hoặc reload; không last-write-wins âm thầm.

Response `200/201`:

```json
{ "tradeId": "trade-id", "markdown": "...", "revision": 4, "updatedAt": 1786896000000 }
```

Nếu markdown rỗng và không còn screenshot/tag thì có thể xóa row rỗng trong transaction.

### 3. Screenshot chart

Frontend tự capture chart tại current replay cursor. Backend chỉ validate, persist và trả metadata.

```text
POST /api/v1/review/{sourceType}/{sourceId}/trades/{tradeId}/screenshots
Content-Type: multipart/form-data

file=<binary JPEG|PNG>
capturedAt=<epoch ms>
cursorTs=<epoch seconds, optional>
```

Rules:

- Max 5 MiB/file, max 6 screenshot/trade.
- Chỉ JPEG/PNG bằng magic-byte sniffing; reject SVG/GIF/WebP/HTML trong v1.
- Decode dimensions, max 2560×1440, min 160×90.
- Generate server-owned random object key; không dùng filename làm path.
- Persist file dưới data directory cấu hình riêng, dùng atomic temp-write + rename, permission phù hợp.
- Nếu DB insert fail thì cleanup file; nếu file write fail thì không insert DB.
- `GET /api/v1/review/screenshots/{id}` stream với correct `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff`, private/no-store cache policy và ownership check.
- `DELETE /api/v1/review/screenshots/{id}` transactionally remove metadata; file cleanup idempotent và có test orphan handling.

### 4. Tag group CRUD

```text
GET    /api/v1/review/tag-groups
POST   /api/v1/review/tag-groups                  { "name": "Confidence", "position": 0 }
PATCH  /api/v1/review/tag-groups/{groupId}        { "name": "Conviction", "position": 1 }
DELETE /api/v1/review/tag-groups/{groupId}
```

Delete group cascade tags và assignments trong transaction. Response delete `204`.

### 5. Tag CRUD

```text
POST   /api/v1/review/tag-groups/{groupId}/tags   { "name": "High Confidence", "color": "green", "position": 0 }
PATCH  /api/v1/review/tags/{tagId}                { "name": "A+", "color": "blue", "position": 1 }
DELETE /api/v1/review/tags/{tagId}
```

Reject duplicate name case-insensitive trong cùng group bằng `409`. Không cho move tag qua group bằng PATCH v1.

### 6. Assign/clear tag cho trade

```text
PUT    /api/v1/review/{sourceType}/{sourceId}/trades/{tradeId}/tag-groups/{groupId}
       { "tagId": "tag-id" }

DELETE /api/v1/review/{sourceType}/{sourceId}/trades/{tradeId}/tag-groups/{groupId}
```

PUT là idempotent upsert, verify tag thuộc group và trade thuộc source. Response assignment hiện tại; DELETE trả `204` kể cả assignment đã không còn.

## Analytics by Tag

Tạo endpoint:

```text
GET /api/v1/analytics/tags?sourceType=session&sourceId={id}
```

Chỉ aggregate closed trades thật thuộc source và assignment còn hợp lệ. Một trade có thể xuất hiện ở nhiều rows nếu được gắn tag ở nhiều groups; `taggedTrades` là unique trade count, `totalAssignments` là tổng assignment.

Response:

```json
{
  "source": { "id": "...", "type": "session", "title": "NQ · 1m", "tradeCount": 163 },
  "summary": {
    "taggedTrades": 42,
    "totalAssignments": 71,
    "representedTags": 8,
    "profitableTags": 5,
    "bestTagId": "tag-id"
  },
  "rows": [
    {
      "groupId": "group-id",
      "groupName": "Confidence",
      "tagId": "tag-id",
      "tagName": "High Confidence",
      "color": "green",
      "trades": 18,
      "wins": 11,
      "losses": 7,
      "breakeven": 0,
      "winRate": 61.1111,
      "netPnlCents": 329022,
      "averageR": 0.84,
      "eligibleRTrades": 17
    }
  ]
}
```

Rules:

- Sort rows: `trades DESC`, `netPnlCents DESC`, `groupId ASC`, `tagId ASC`.
- Win/loss/breakeven dùng `realizedCents > 0`, `< 0`, `== 0`.
- `winRate = wins / trades * 100`.
- `averageR` chỉ từ finite non-null `RMultiple`; không có eligible trade thì `null`.
- `netPnlCents` integer; FE tự format currency.
- Empty hợp lệ trả summary zero và `rows: []`, không trả 404.
- Endpoint `no-store`; không cache aggregate qua write tag/review.

## Storage và lifecycle

- Khi xóa Replay Session, cascade/xóa toàn bộ `trade_reviews`, screenshots metadata/files và `review_trade_tags` của source đó.
- Khi xóa Evaluation Account, làm tương tự theo evaluation source ID.
- Nếu replay rewind làm trade biến mất khỏi ledger, review metadata không được xuất hiện trong bootstrap/analytics. Chọn một policy rõ và test: soft-orphan giữ tối đa 30 ngày rồi cleanup, hoặc delete ngay cùng ledger replacement. Ưu tiên soft-orphan để tránh mất note do rewind tạm thời, nhưng tuyệt đối không aggregate orphan.
- Tag taxonomy không bị xóa theo source.
- Startup phải tạo screenshot directory nếu thiếu và fail rõ nếu path không writable.

## FE handoff contract

Sau khi API hoàn tất, ghi rõ cho FE:

1. Endpoint và exact JSON schema đã implement.
2. Quy ước revision/`If-Match` và response `409`.
3. Upload multipart screenshot và URL phục vụ ảnh.
4. Pagination/cursor của bootstrap review.
5. Field nullable, giới hạn note/image/tag.
6. Migration từ local storage key `market-replay:trade-review:v1`: FE có thể upload dữ liệu local một lần rồi xóa key chỉ sau khi server xác nhận; Backend không tự đọc browser storage.

## Tests bắt buộc

### Storage

- Migration từ database cũ.
- CRUD review note và revision increment.
- Unique `(sourceType, sourceId, tradeId)`.
- Tag group/tag cascade và one-tag-per-group invariant.
- Stable ordering/pagination.
- Source delete cleanup và orphan policy.

### HTTP/API

- Happy path cho cả `session` và `evaluation`.
- Invalid source type, wrong-type source ID, missing source/trade.
- Note too large, invalid JSON, stale `If-Match` conflict.
- Screenshot: valid JPEG/PNG, spoofed MIME, oversize bytes/dimensions, traversal filename, seventh image, cleanup on DB/file failure.
- Duplicate tag name, tag/group mismatch, idempotent assign/delete.
- Context cancellation và method/content-type errors.

### Analytics

- Correct unique tagged trades vs total assignments.
- Win/loss/breakeven, cents sum, nullable average R, stable sort.
- Deleted tag/group and orphan trade không lọt aggregate.
- Empty source returns zero/empty response.
- Session/evaluation source isolation.

Chạy tối thiểu:

```bash
go test ./...
go test -race ./...
```

Nếu repo có `golangci-lint`, chạy thêm `golangci-lint run`.

## Definition of Done

- Migration additive, rollback-safe theo khả năng SQLite hiện tại.
- API không có mock/hardcoded analytics data.
- Source/trade ownership được verify ở mọi read/write.
- Markdown, screenshot, tag CRUD và tag analytics đều persistent qua restart.
- Screenshot storage chống traversal/spoof/oversize và không để orphan do partial failure.
- Optimistic concurrency ngăn mất note do hai editor ghi đè nhau.
- Test đầy đủ và `go test ./...`, `go test -race ./...` pass.
- Handoff FE nêu exact contract và migration khỏi local storage.
