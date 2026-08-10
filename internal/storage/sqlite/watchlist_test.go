package sqlite

import (
	"context"
	"reflect"
	"testing"
)

func TestWatchlist_EmptyByDefault(t *testing.T) {
	s := openTestStore(t)
	got, err := s.GetWatchlist(context.Background())
	if err != nil {
		t.Fatalf("GetWatchlist: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("GetWatchlist = %#v, want empty non-nil slice", got)
	}
}

func TestWatchlist_SetThenGetPreservesOrder(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	want := []string{"NQ", "ES", "YM", "QQQ"}
	if err := s.SetWatchlist(ctx, want); err != nil {
		t.Fatalf("SetWatchlist: %v", err)
	}
	got, err := s.GetWatchlist(ctx)
	if err != nil {
		t.Fatalf("GetWatchlist: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("GetWatchlist = %v, want %v", got, want)
	}
}

func TestWatchlist_SetReplacesWholeList(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	if err := s.SetWatchlist(ctx, []string{"NQ", "ES"}); err != nil {
		t.Fatalf("SetWatchlist: %v", err)
	}
	if err := s.SetWatchlist(ctx, []string{"VIX"}); err != nil {
		t.Fatalf("SetWatchlist: %v", err)
	}
	got, err := s.GetWatchlist(ctx)
	if err != nil {
		t.Fatalf("GetWatchlist: %v", err)
	}
	if !reflect.DeepEqual(got, []string{"VIX"}) {
		t.Fatalf("GetWatchlist = %v, want [VIX] (replace, not merge)", got)
	}
}
