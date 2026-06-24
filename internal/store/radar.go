package store

import (
	"database/sql"
	"errors"
	"fmt"
)

// RadarItem is a discovered ecosystem repo persisted by the S5 radar.
type RadarItem struct {
	FullName    string
	Name        string
	Description string
	HTMLURL     string
	Stars       int
	Topic       string
	PushedAt    string
	FirstSeen   string
	LastUpdated string
}

// UpsertRadarItem inserts a discovered repo or refreshes a known one. first_seen
// is preserved on conflict (only set on first insert).
func (s *Store) UpsertRadarItem(item RadarItem) error {
	_, err := s.db.Exec(`
		INSERT INTO radar_items (full_name, name, description, html_url, stars, topic, pushed_at, first_seen, last_updated)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(full_name) DO UPDATE SET
			name = excluded.name,
			description = excluded.description,
			html_url = excluded.html_url,
			stars = excluded.stars,
			topic = excluded.topic,
			pushed_at = excluded.pushed_at,
			last_updated = excluded.last_updated`,
		item.FullName, item.Name, item.Description, item.HTMLURL, item.Stars,
		item.Topic, item.PushedAt, item.FirstSeen, item.LastUpdated)
	if err != nil {
		return fmt.Errorf("upsert radar item: %w", err)
	}
	return nil
}

// ListRadarItems returns all discovered repos, most-starred first.
func (s *Store) ListRadarItems() ([]RadarItem, error) {
	rows, err := s.db.Query(`
		SELECT full_name, name, COALESCE(description, ''), html_url, stars, topic,
		       COALESCE(pushed_at, ''), first_seen, last_updated
		FROM radar_items ORDER BY stars DESC, full_name ASC`)
	if err != nil {
		return nil, fmt.Errorf("list radar items: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []RadarItem
	for rows.Next() {
		var it RadarItem
		if err := rows.Scan(&it.FullName, &it.Name, &it.Description, &it.HTMLURL,
			&it.Stars, &it.Topic, &it.PushedAt, &it.FirstSeen, &it.LastUpdated); err != nil {
			return nil, fmt.Errorf("scan radar item: %w", err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// GetRadarMeta reads a radar_meta value; returns "" if the key is absent.
func (s *Store) GetRadarMeta(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM radar_meta WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get radar meta: %w", err)
	}
	return v, nil
}

// SetRadarMeta writes a radar_meta key/value (upsert).
func (s *Store) SetRadarMeta(key, value string) error {
	_, err := s.db.Exec(`
		INSERT INTO radar_meta (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	if err != nil {
		return fmt.Errorf("set radar meta: %w", err)
	}
	return nil
}
