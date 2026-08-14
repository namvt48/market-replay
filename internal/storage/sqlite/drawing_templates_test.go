package sqlite

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"market-replay/internal/model"
	"market-replay/internal/storage"
)

func TestDrawingTemplates_RoundTripAndUpdateInPlace(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	tpl := model.DrawingTemplate{
		ID: "t1", ToolType: "trend-line", Name: "My Line",
		Appearance: json.RawMessage(`{"strokeColor":"#ff0000"}`),
		CreatedAt:  1000, UpdatedAt: 1000,
	}
	if err := s.UpsertDrawingTemplate(ctx, tpl); err != nil {
		t.Fatalf("UpsertDrawingTemplate: %v", err)
	}

	got, err := s.ListDrawingTemplates(ctx)
	if err != nil {
		t.Fatalf("ListDrawingTemplates: %v", err)
	}
	if len(got) != 1 || got[0].ID != "t1" || string(got[0].Appearance) != `{"strokeColor":"#ff0000"}` {
		t.Fatalf("got = %+v, unexpected", got)
	}

	// Same id, different fields: must update in place, not duplicate.
	tpl.Name = "Renamed"
	tpl.Appearance = json.RawMessage(`{"strokeColor":"#00ff00"}`)
	tpl.UpdatedAt = 2000
	if err := s.UpsertDrawingTemplate(ctx, tpl); err != nil {
		t.Fatalf("update upsert: %v", err)
	}

	got, err = s.ListDrawingTemplates(ctx)
	if err != nil {
		t.Fatalf("ListDrawingTemplates: %v", err)
	}
	if len(got) != 1 || got[0].Name != "Renamed" || got[0].UpdatedAt != 2000 {
		t.Fatalf("got = %+v, want a single updated row (upsert, not duplicate)", got)
	}
}

func TestDrawingTemplates_DuplicateNamePerToolRejected(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	first := model.DrawingTemplate{
		ID: "t1", ToolType: "trend-line", Name: "Same Name",
		Appearance: json.RawMessage(`{}`), CreatedAt: 1000, UpdatedAt: 1000,
	}
	if err := s.UpsertDrawingTemplate(ctx, first); err != nil {
		t.Fatalf("first upsert: %v", err)
	}

	// Different id, same (toolType, name) — must be rejected, not silently
	// overwrite or duplicate.
	second := model.DrawingTemplate{
		ID: "t2", ToolType: "trend-line", Name: "Same Name",
		Appearance: json.RawMessage(`{}`), CreatedAt: 2000, UpdatedAt: 2000,
	}
	err := s.UpsertDrawingTemplate(ctx, second)
	if !errors.Is(err, storage.ErrDrawingTemplateNameTaken) {
		t.Fatalf("err = %v, want ErrDrawingTemplateNameTaken", err)
	}

	// Same name, different tool type: allowed, no collision.
	third := model.DrawingTemplate{
		ID: "t3", ToolType: "rectangle", Name: "Same Name",
		Appearance: json.RawMessage(`{}`), CreatedAt: 3000, UpdatedAt: 3000,
	}
	if err := s.UpsertDrawingTemplate(ctx, third); err != nil {
		t.Fatalf("different tool type upsert: %v", err)
	}

	got, err := s.ListDrawingTemplates(ctx)
	if err != nil {
		t.Fatalf("ListDrawingTemplates: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got = %+v, want 2 templates (t2 rejected, t1 and t3 present)", got)
	}
}

func TestDrawingTemplates_Delete(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if err := s.UpsertDrawingTemplate(ctx, model.DrawingTemplate{
		ID: "t1", ToolType: "trend-line", Name: "My Line",
		Appearance: json.RawMessage(`{}`), CreatedAt: 1000, UpdatedAt: 1000,
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	if err := s.DeleteDrawingTemplate(ctx, "t1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	// Deleting an id that was never stored is a no-op, not an error.
	if err := s.DeleteDrawingTemplate(ctx, "never-stored"); err != nil {
		t.Fatalf("delete unknown: %v", err)
	}

	got, err := s.ListDrawingTemplates(ctx)
	if err != nil {
		t.Fatalf("ListDrawingTemplates: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got = %+v, want empty after delete", got)
	}
}

func TestMigrateDrawingTemplatesFromPreferences(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	legacy := `[
		{"id":"legacy-1","toolType":"trend-line","name":"Old Line","appearance":{"strokeColor":"#111111"},"createdAt":500,"updatedAt":600},
		{"id":"legacy-2","toolType":"rectangle","name":"Old Box","appearance":{"strokeColor":"#222222"},"createdAt":700,"updatedAt":800}
	]`
	if err := s.SetPreference(ctx, legacyDrawingTemplatesKey, json.RawMessage(legacy)); err != nil {
		t.Fatalf("seed legacy preference: %v", err)
	}

	if err := s.migrateDrawingTemplatesFromPreferences(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	got, err := s.ListDrawingTemplates(ctx)
	if err != nil {
		t.Fatalf("ListDrawingTemplates: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got = %+v, want 2 migrated templates", got)
	}

	prefs, err := s.ListPreferences(ctx)
	if err != nil {
		t.Fatalf("ListPreferences: %v", err)
	}
	if _, ok := prefs[legacyDrawingTemplatesKey]; ok {
		t.Errorf("legacy preferences row still present after migration: %v", prefs)
	}

	// Second run must be a no-op: no legacy row left, nothing to migrate,
	// and it must not wipe out or duplicate what's already in the table.
	if err := s.migrateDrawingTemplatesFromPreferences(ctx); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	got, err = s.ListDrawingTemplates(ctx)
	if err != nil {
		t.Fatalf("ListDrawingTemplates after second migrate: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got = %+v, want still 2 templates after idempotent second run", got)
	}
}

func TestMigrateDrawingTemplatesFromPreferences_NoLegacyRowIsNoOp(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if err := s.migrateDrawingTemplatesFromPreferences(ctx); err != nil {
		t.Fatalf("migrate with nothing to migrate: %v", err)
	}
	got, err := s.ListDrawingTemplates(ctx)
	if err != nil {
		t.Fatalf("ListDrawingTemplates: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got = %+v, want empty", got)
	}
}

// Sanity: Init() itself must already run schema creation + migration
// (it's wired into Store.Init, not just callable standalone) — openTestStore
// calls Init, so a legacy row present before Init should already show up
// migrated the moment the store opens on a pre-existing DB file.
func TestInit_MigratesDrawingTemplatesOnStartup(t *testing.T) {
	path := t.TempDir() + "/app.db"
	first, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := first.Init(context.Background()); err != nil {
		t.Fatalf("Init: %v", err)
	}
	legacy := `[{"id":"legacy-1","toolType":"trend-line","name":"Old Line","appearance":{},"createdAt":1,"updatedAt":2}]`
	if err := first.SetPreference(context.Background(), legacyDrawingTemplatesKey, json.RawMessage(legacy)); err != nil {
		t.Fatalf("seed legacy preference: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Reopen: this is what a real server restart looks like after upgrade.
	second, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() { second.Close() })
	if err := second.Init(context.Background()); err != nil {
		t.Fatalf("reopen Init: %v", err)
	}

	got, err := second.ListDrawingTemplates(context.Background())
	if err != nil {
		t.Fatalf("ListDrawingTemplates: %v", err)
	}
	if len(got) != 1 || got[0].ID != "legacy-1" {
		t.Fatalf("got = %+v, want the legacy template migrated on startup", got)
	}
}

func TestInit_MigratesLegacyDrawingTemplatesTable(t *testing.T) {
	path := t.TempDir() + "/app.db"
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })

	// Older databases used (tool, name, payload) as the primary key and had
	// no stable id or timestamps. CREATE TABLE IF NOT EXISTS cannot upgrade
	// that shape, and creating the new tool_type index against it must not
	// make startup fail.
	if _, err := s.db.Exec(`
		CREATE TABLE drawing_templates (
			tool TEXT NOT NULL,
			name TEXT NOT NULL,
			payload TEXT NOT NULL,
			PRIMARY KEY (tool, name)
		);
		INSERT INTO drawing_templates (tool, name, payload)
		VALUES ('trend-line', 'Legacy Line', '{"strokeColor":"#112233"}');
	`); err != nil {
		t.Fatalf("seed legacy drawing_templates: %v", err)
	}

	if err := s.Init(context.Background()); err != nil {
		t.Fatalf("Init legacy database: %v", err)
	}

	got, err := s.ListDrawingTemplates(context.Background())
	if err != nil {
		t.Fatalf("ListDrawingTemplates: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got = %+v, want one migrated template", got)
	}
	if got[0].ID == "" || got[0].ToolType != "trend-line" || got[0].Name != "Legacy Line" {
		t.Fatalf("got = %+v, want migrated identity and metadata", got[0])
	}
	if string(got[0].Appearance) != `{"strokeColor":"#112233"}` {
		t.Fatalf("appearance = %s, want legacy payload preserved", got[0].Appearance)
	}
}
