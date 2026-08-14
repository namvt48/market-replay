package model

import "encoding/json"

// DrawingTemplate is a named, reusable set of drawing appearance settings
// for one tool type (trend line, rectangle, fibonacci, etc.). Appearance is
// opaque to the server — owned and shaped by the drawing plugin, the same
// treatment Drawing.Payload gets.
type DrawingTemplate struct {
	ID         string          `json:"id"`
	ToolType   string          `json:"toolType"`
	Name       string          `json:"name"`
	Appearance json.RawMessage `json:"appearance"`
	CreatedAt  int64           `json:"createdAt"`
	UpdatedAt  int64           `json:"updatedAt"`
}
