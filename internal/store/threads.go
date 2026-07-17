package store

import (
	"database/sql"
	"errors"
	"fmt"
)

// Thread is one line of development inside a project («нить»).
type Thread struct {
	ID            string
	ProjectKey    string
	Title         string
	Summary       string
	Color         string
	Status        string // active|done|dropped
	ParentPointID string // "" = корневая нить
	CreatedAt     string
	EndedAt       string // "" = не завершена
}

// ErrNotFound помечает отсутствие строки; веб-слой мапит его в 404.
var ErrNotFound = errors.New("not found")

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Store) CreateThread(t Thread) error {
	_, err := s.db.Exec(`
		INSERT INTO threads (id, project_key, title, summary, color, status, parent_point_id, ended_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.ProjectKey, t.Title, t.Summary, t.Color, t.Status,
		nullStr(t.ParentPointID), nullStr(t.EndedAt))
	if err != nil {
		return fmt.Errorf("create thread: %w", err)
	}
	return nil
}

func scanThread(row interface{ Scan(...any) error }) (*Thread, error) {
	var t Thread
	var parent, created, ended sql.NullString
	err := row.Scan(&t.ID, &t.ProjectKey, &t.Title, &t.Summary, &t.Color,
		&t.Status, &parent, &created, &ended)
	if err != nil {
		return nil, err
	}
	t.ParentPointID, t.CreatedAt, t.EndedAt = parent.String, created.String, ended.String
	return &t, nil
}

const threadCols = `id, project_key, title, summary, color, status, parent_point_id, created_at, ended_at`

func (s *Store) GetThread(id string) (*Thread, error) {
	t, err := scanThread(s.db.QueryRow(
		`SELECT `+threadCols+` FROM threads WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get thread: %w", err)
	}
	return t, nil
}

func (s *Store) ListThreads() ([]Thread, error) {
	rows, err := s.db.Query(`SELECT ` + threadCols + ` FROM threads ORDER BY project_key, created_at`)
	if err != nil {
		return nil, fmt.Errorf("list threads: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []Thread
	for rows.Next() {
		t, err := scanThread(rows)
		if err != nil {
			return nil, fmt.Errorf("scan thread: %w", err)
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// UpdateThread persists title, summary, color, status and ended_at.
// ProjectKey and ParentPointID are fixed at creation and ignored here.
func (s *Store) UpdateThread(t Thread) error {
	_, err := s.db.Exec(`
		UPDATE threads SET title = ?, summary = ?, color = ?, status = ?, ended_at = ?
		WHERE id = ?`,
		t.Title, t.Summary, t.Color, t.Status, nullStr(t.EndedAt), t.ID)
	if err != nil {
		return fmt.Errorf("update thread: %w", err)
	}
	return nil
}

func (s *Store) DeleteThread(id string) error {
	_, err := s.db.Exec(`DELETE FROM threads WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete thread: %w", err)
	}
	return nil
}

// ThreadPoint is one station on a thread: a PR (точка реализации) or a
// planned future PR. ThreadID == "" means an unassigned suggestion (inbox).
type ThreadPoint struct {
	ID        string
	ThreadID  string
	Kind      string // pr|planned
	Title     string
	Summary   string
	Repo      string // owner/name; "" для planned
	PRNumber  int64  // 0 = нет
	PRUrl     string
	PRState   string // merged|open|closed|""
	EventDate string
	Position  int64
	Confirmed bool
	CreatedAt string
}

func nullInt(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}

const pointCols = `id, thread_id, kind, title, summary, repo, pr_number, pr_url, pr_state, event_date, position, confirmed, created_at`

func (s *Store) CreatePoint(p ThreadPoint) error {
	confirmed := 0
	if p.Confirmed {
		confirmed = 1
	}
	_, err := s.db.Exec(`
		INSERT INTO thread_points (id, thread_id, kind, title, summary, repo, pr_number, pr_url, pr_state, event_date, position, confirmed)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, nullStr(p.ThreadID), p.Kind, p.Title, p.Summary, nullStr(p.Repo),
		nullInt(p.PRNumber), nullStr(p.PRUrl), nullStr(p.PRState), nullStr(p.EventDate),
		p.Position, confirmed)
	if err != nil {
		return fmt.Errorf("create point: %w", err)
	}
	return nil
}

func scanPoint(row interface{ Scan(...any) error }) (*ThreadPoint, error) {
	var p ThreadPoint
	var threadID, repo, prURL, prState, eventDate, created sql.NullString
	var prNumber sql.NullInt64
	var confirmed int
	err := row.Scan(&p.ID, &threadID, &p.Kind, &p.Title, &p.Summary, &repo,
		&prNumber, &prURL, &prState, &eventDate, &p.Position, &confirmed, &created)
	if err != nil {
		return nil, err
	}
	p.ThreadID, p.Repo, p.PRUrl, p.PRState = threadID.String, repo.String, prURL.String, prState.String
	p.EventDate, p.CreatedAt = eventDate.String, created.String
	p.PRNumber = prNumber.Int64
	p.Confirmed = confirmed == 1
	return &p, nil
}

func (s *Store) listPointsWhere(where string, args ...any) ([]ThreadPoint, error) {
	rows, err := s.db.Query(`SELECT `+pointCols+` FROM thread_points `+where, args...)
	if err != nil {
		return nil, fmt.Errorf("list points: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []ThreadPoint
	for rows.Next() {
		p, err := scanPoint(rows)
		if err != nil {
			return nil, fmt.Errorf("scan point: %w", err)
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (s *Store) ListPoints() ([]ThreadPoint, error) {
	return s.listPointsWhere(`ORDER BY thread_id, position, created_at`)
}

func (s *Store) ListInboxPoints() ([]ThreadPoint, error) {
	return s.listPointsWhere(`WHERE confirmed = 0 ORDER BY created_at`)
}

func (s *Store) GetPoint(id string) (*ThreadPoint, error) {
	p, err := scanPoint(s.db.QueryRow(`SELECT `+pointCols+` FROM thread_points WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get point: %w", err)
	}
	return p, nil
}

// UpdatePoint persists title, summary, position and event_date. PR fields,
// kind, thread_id and confirmed are lifecycle-owned by CreatePoint,
// ConfirmPoint and MaterializePoint and ignored here.
func (s *Store) UpdatePoint(p ThreadPoint) error {
	_, err := s.db.Exec(`
		UPDATE thread_points SET title = ?, summary = ?, position = ?, event_date = ?
		WHERE id = ?`,
		p.Title, p.Summary, p.Position, nullStr(p.EventDate), p.ID)
	if err != nil {
		return fmt.Errorf("update point: %w", err)
	}
	return nil
}

func (s *Store) DeletePoint(id string) error {
	_, err := s.db.Exec(`DELETE FROM thread_points WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete point: %w", err)
	}
	return nil
}

// ConfirmPoint assigns an inbox suggestion to a thread.
func (s *Store) ConfirmPoint(id, threadID string) error {
	res, err := s.db.Exec(`UPDATE thread_points SET thread_id = ?, confirmed = 1 WHERE id = ?`,
		threadID, id)
	if err != nil {
		return fmt.Errorf("confirm point: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("confirm point %s: %w", id, ErrNotFound)
	}
	return nil
}

// MaterializePoint merges a suggested PR point into an existing planned point:
// the planned point inherits the PR fields and becomes kind=pr, the suggestion
// row is removed. Position/title/summary of the planned point are preserved.
func (s *Store) MaterializePoint(prPointID, plannedPointID, threadID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Сначала снести pr-строку, чтобы не споткнуться об UNIQUE(repo, pr_number).
	var repo, prURL, prState, eventDate sql.NullString
	var prNumber sql.NullInt64
	err = tx.QueryRow(`SELECT repo, pr_number, pr_url, pr_state, event_date FROM thread_points WHERE id = ?`,
		prPointID).Scan(&repo, &prNumber, &prURL, &prState, &eventDate)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("materialize: pr point %s: %w", prPointID, ErrNotFound)
	}
	if err != nil {
		return fmt.Errorf("materialize read pr: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM thread_points WHERE id = ?`, prPointID); err != nil {
		return fmt.Errorf("materialize delete pr: %w", err)
	}
	res, err := tx.Exec(`
		UPDATE thread_points SET kind = 'pr', repo = ?, pr_number = ?, pr_url = ?,
			pr_state = ?, event_date = ?, thread_id = ?, confirmed = 1
		WHERE id = ? AND kind = 'planned' AND thread_id = ?`,
		repo, prNumber, prURL, prState, eventDate, threadID, plannedPointID, threadID)
	if err != nil {
		return fmt.Errorf("materialize update planned: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("materialize: planned point %s in thread %s: %w", plannedPointID, threadID, ErrNotFound)
	}
	return tx.Commit()
}

// Idea is a cross-project connection between threads («сквозная идея»).
type Idea struct {
	ID        string
	Title     string
	Summary   string
	Status    string // active|done|dropped
	CreatedAt string
	ThreadIDs []string
}

func (s *Store) CreateIdea(i Idea) error {
	_, err := s.db.Exec(`INSERT INTO ideas (id, title, summary, status) VALUES (?, ?, ?, ?)`,
		i.ID, i.Title, i.Summary, i.Status)
	if err != nil {
		return fmt.Errorf("create idea: %w", err)
	}
	return nil
}

func (s *Store) UpdateIdea(i Idea) error {
	_, err := s.db.Exec(`UPDATE ideas SET title = ?, summary = ?, status = ? WHERE id = ?`,
		i.Title, i.Summary, i.Status, i.ID)
	if err != nil {
		return fmt.Errorf("update idea: %w", err)
	}
	return nil
}

func (s *Store) DeleteIdea(id string) error {
	_, err := s.db.Exec(`DELETE FROM ideas WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete idea: %w", err)
	}
	return nil
}

// GetIdea returns one idea with its linked thread IDs, or nil if absent.
func (s *Store) GetIdea(id string) (*Idea, error) {
	var i Idea
	var created sql.NullString
	err := s.db.QueryRow(`SELECT id, title, summary, status, created_at FROM ideas WHERE id = ?`, id).
		Scan(&i.ID, &i.Title, &i.Summary, &i.Status, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get idea: %w", err)
	}
	i.CreatedAt = created.String
	i.ThreadIDs = []string{}
	rows, err := s.db.Query(`SELECT thread_id FROM idea_threads WHERE idea_id = ? ORDER BY rowid`, id)
	if err != nil {
		return nil, fmt.Errorf("get idea links: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var tid string
		if err := rows.Scan(&tid); err != nil {
			return nil, fmt.Errorf("scan idea link: %w", err)
		}
		i.ThreadIDs = append(i.ThreadIDs, tid)
	}
	return &i, rows.Err()
}

func (s *Store) SetIdeaThreads(ideaID string, threadIDs []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM idea_threads WHERE idea_id = ?`, ideaID); err != nil {
		return fmt.Errorf("clear idea threads: %w", err)
	}
	for _, tid := range threadIDs {
		if _, err := tx.Exec(`INSERT INTO idea_threads (idea_id, thread_id) VALUES (?, ?)`,
			ideaID, tid); err != nil {
			return fmt.Errorf("link idea thread: %w", err)
		}
	}
	return tx.Commit()
}

func (s *Store) ListIdeas() ([]Idea, error) {
	rows, err := s.db.Query(`SELECT id, title, summary, status, created_at FROM ideas ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list ideas: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []Idea
	// Индексы, не указатели: append может реаллоцировать слайс.
	idx := map[string]int{}
	for rows.Next() {
		var i Idea
		var created sql.NullString
		if err := rows.Scan(&i.ID, &i.Title, &i.Summary, &i.Status, &created); err != nil {
			return nil, fmt.Errorf("scan idea: %w", err)
		}
		i.CreatedAt = created.String
		i.ThreadIDs = []string{}
		out = append(out, i)
		idx[i.ID] = len(out) - 1
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	links, err := s.db.Query(`SELECT idea_id, thread_id FROM idea_threads ORDER BY rowid`)
	if err != nil {
		return nil, fmt.Errorf("list idea links: %w", err)
	}
	defer func() { _ = links.Close() }()
	for links.Next() {
		var ideaID, threadID string
		if err := links.Scan(&ideaID, &threadID); err != nil {
			return nil, fmt.Errorf("scan idea link: %w", err)
		}
		if n, ok := idx[ideaID]; ok {
			out[n].ThreadIDs = append(out[n].ThreadIDs, threadID)
		}
	}
	return out, links.Err()
}

// ThreadNote is a fixed decision attached to a thread.
type ThreadNote struct {
	ID        string
	ThreadID  string
	Body      string
	Source    string // manual|chat
	CreatedAt string
}

func (s *Store) CreateNote(n ThreadNote) error {
	_, err := s.db.Exec(`INSERT INTO thread_notes (id, thread_id, body, source) VALUES (?, ?, ?, ?)`,
		n.ID, n.ThreadID, n.Body, n.Source)
	if err != nil {
		return fmt.Errorf("create note: %w", err)
	}
	return nil
}

func (s *Store) ListNotes(threadID string) ([]ThreadNote, error) {
	rows, err := s.db.Query(`SELECT id, thread_id, body, source, created_at
		FROM thread_notes WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC`, threadID)
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []ThreadNote
	for rows.Next() {
		var n ThreadNote
		var created sql.NullString
		if err := rows.Scan(&n.ID, &n.ThreadID, &n.Body, &n.Source, &created); err != nil {
			return nil, fmt.Errorf("scan note: %w", err)
		}
		n.CreatedAt = created.String
		out = append(out, n)
	}
	return out, rows.Err()
}
