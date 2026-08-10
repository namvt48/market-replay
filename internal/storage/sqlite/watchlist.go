package sqlite

import (
	"context"
	"fmt"
)

func (s *Store) GetWatchlist(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT symbol FROM watchlist ORDER BY position ASC`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: get watchlist: %w", err)
	}
	defer rows.Close()

	out := make([]string, 0) // GET returns [], never null, even when empty
	for rows.Next() {
		var sym string
		if err := rows.Scan(&sym); err != nil {
			return nil, fmt.Errorf("sqlite: scan watchlist: %w", err)
		}
		out = append(out, sym)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlite: iterate watchlist: %w", err)
	}
	return out, nil
}

// SetWatchlist replaces the entire watchlist with symbols, in order.
// Docs §6.3 describes PUT as replace-whole-list, not an incremental
// upsert, so this clears and re-inserts inside one transaction.
func (s *Store) SetWatchlist(ctx context.Context, symbols []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlite: set watchlist: begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM watchlist`); err != nil {
		return fmt.Errorf("sqlite: set watchlist: clear: %w", err)
	}
	for i, sym := range symbols {
		if _, err := tx.ExecContext(ctx, `INSERT INTO watchlist (symbol, position) VALUES (?, ?)`, sym, i); err != nil {
			return fmt.Errorf("sqlite: set watchlist: insert %s: %w", sym, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlite: set watchlist: commit: %w", err)
	}
	return nil
}
