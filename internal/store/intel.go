package store

import (
	"database/sql"
	"errors"
	"fmt"
)

// IntelSnapshot is one periodic collection result for a configured S6 source.
type IntelSnapshot struct {
	ID         int64
	SourceKey  string
	Project    string
	CapturedAt int64  // unix epoch seconds
	Payload    string // agent JSON: {summary, metrics, items}
	ChangeNote string // agent-written diff vs the previous snapshot
	OK         bool
	Error      string
}

// InsertIntelSnapshot appends one snapshot row (history is append-only).
func (s *Store) InsertIntelSnapshot(snap IntelSnapshot) error {
	ok := 0
	if snap.OK {
		ok = 1
	}
	_, err := s.db.Exec(`
		INSERT INTO intel_snapshots (source_key, project, captured_at, payload, change_note, ok, error)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		snap.SourceKey, snap.Project, snap.CapturedAt, snap.Payload, snap.ChangeNote, ok, snap.Error)
	if err != nil {
		return fmt.Errorf("insert intel snapshot: %w", err)
	}
	return nil
}

// LatestSnapshot returns the newest snapshot for a source key, or nil if none.
func (s *Store) LatestSnapshot(sourceKey string) (*IntelSnapshot, error) {
	var snap IntelSnapshot
	var ok int
	err := s.db.QueryRow(`
		SELECT id, source_key, project, captured_at, payload, change_note, ok, error
		FROM intel_snapshots WHERE source_key = ?
		ORDER BY captured_at DESC, id DESC LIMIT 1`, sourceKey).
		Scan(&snap.ID, &snap.SourceKey, &snap.Project, &snap.CapturedAt,
			&snap.Payload, &snap.ChangeNote, &ok, &snap.Error)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("latest snapshot: %w", err)
	}
	snap.OK = ok == 1
	return &snap, nil
}

// ListIntelSnapshots returns all snapshots, newest first.
func (s *Store) ListIntelSnapshots() ([]IntelSnapshot, error) {
	rows, err := s.db.Query(`
		SELECT id, source_key, project, captured_at, payload, change_note, ok, error
		FROM intel_snapshots ORDER BY captured_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list intel snapshots: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []IntelSnapshot
	for rows.Next() {
		var snap IntelSnapshot
		var ok int
		if err := rows.Scan(&snap.ID, &snap.SourceKey, &snap.Project, &snap.CapturedAt,
			&snap.Payload, &snap.ChangeNote, &ok, &snap.Error); err != nil {
			return nil, fmt.Errorf("scan intel snapshot: %w", err)
		}
		snap.OK = ok == 1
		out = append(out, snap)
	}
	return out, rows.Err()
}
