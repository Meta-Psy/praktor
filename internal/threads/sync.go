package threads

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/mtzanidakis/praktor/internal/store"
)

const metaLastSync = "last_sync_success"

// PRLister — читающая поверхность GitHub (web.GitHubClient в проде).
type PRLister interface {
	ListPRs(ctx context.Context, repo string) ([]PR, error)
}

// Stats — итог одного прохода синка.
type Stats struct {
	Added   int      `json:"added"`
	Updated int      `json:"updated"`
	Errors  []string `json:"errors,omitempty"` // "repo: err" по упавшим репо
}

// Status — состояние синка для UI-бейджа «синк устарел».
type Status struct {
	LastSuccess string `json:"last_success,omitempty"` // RFC3339; "" = ещё не было
	LastError   string `json:"last_error,omitempty"`
}

// Syncer периодически подтягивает PR всех проектных репо в точки нитей.
type Syncer struct {
	lister   PRLister
	store    *store.Store
	projects map[string]string // project_key → owner/name
	interval time.Duration
	publish  func() // уведомление thread_updated после изменений; nil = без событий
	now      func() time.Time

	mu        sync.Mutex
	lastError string
}

// NewSyncer собирает Syncer. interval <= 0 → 10 минут.
func NewSyncer(l PRLister, st *store.Store, projects map[string]string, interval time.Duration, publish func()) *Syncer {
	if interval <= 0 {
		interval = 10 * time.Minute
	}
	return &Syncer{lister: l, store: st, projects: projects, interval: interval, publish: publish}
}

func (s *Syncer) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

// Run тикает каждые interval до отмены ctx; первый проход — сразу.
func (s *Syncer) Run(ctx context.Context) {
	if _, err := s.SyncOnce(ctx); err != nil {
		slog.Error("threads sync failed", "error", err)
	}
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := s.SyncOnce(ctx); err != nil {
				slog.Error("threads sync failed", "error", err)
			}
		}
	}
}

// SyncOnce обходит все репо. Ошибка — только если упали все; частичные
// сбои копятся в Stats.Errors (деградация как в F.2), timestamp успеха
// обновляется только при чистом проходе.
func (s *Syncer) SyncOnce(ctx context.Context) (Stats, error) {
	var st Stats
	for key, repo := range s.projects {
		prs, err := s.lister.ListPRs(ctx, repo)
		if err != nil {
			st.Errors = append(st.Errors, fmt.Sprintf("%s: %v", repo, err))
			continue
		}
		added, updated, err := s.syncRepo(key, repo, prs)
		st.Added += added
		st.Updated += updated
		if err != nil {
			st.Errors = append(st.Errors, fmt.Sprintf("%s: %v", repo, err))
		}
	}

	s.mu.Lock()
	s.lastError = strings.Join(st.Errors, "; ")
	s.mu.Unlock()

	if len(s.projects) > 0 && len(st.Errors) == len(s.projects) {
		return st, fmt.Errorf("threads sync: all repos failed: %s", strings.Join(st.Errors, "; "))
	}
	if len(st.Errors) == 0 {
		stamp := s.clock().UTC().Format(time.RFC3339)
		if err := s.store.SetThreadsMeta(metaLastSync, stamp); err != nil {
			slog.Warn("threads sync: save meta failed", "error", err)
		}
	}
	if st.Added+st.Updated > 0 && s.publish != nil {
		s.publish()
	}
	return st, nil
}

// syncRepo сверяет PR одного репо с точками: существующая точка — освежить
// pr_state/event_date; новая — создать предложение (confirmed=0) с нитью от
// эвристики или без (входящие).
func (s *Syncer) syncRepo(projectKey, repo string, prs []PR) (added, updated int, err error) {
	projectThreads, err := s.store.ListProjectThreads(projectKey)
	if err != nil {
		return 0, 0, err
	}
	for _, pr := range prs {
		existing, err := s.store.GetPointByPR(repo, pr.Number)
		if err != nil {
			return added, updated, err
		}
		if existing != nil {
			state, date := pr.PRState(), pr.EventDate()
			if existing.PRState == state && existing.EventDate == date {
				continue
			}
			if err := s.store.UpdatePointPRState(existing.ID, state, date); err != nil {
				return added, updated, err
			}
			updated++
			continue
		}
		p := store.ThreadPoint{
			ID:        uuid.New().String(),
			ThreadID:  MatchThread(projectThreads, pr.HeadRef, pr.Title),
			Kind:      "pr",
			Title:     pr.Title,
			Repo:      repo,
			PRNumber:  pr.Number,
			PRUrl:     pr.URL,
			PRState:   pr.PRState(),
			EventDate: pr.EventDate(),
			Confirmed: false,
		}
		if err := s.store.CreatePoint(p); err != nil {
			return added, updated, err
		}
		added++
	}
	return added, updated, nil
}

// Status возвращает состояние синка для бейджа в UI.
func (s *Syncer) Status() Status {
	last, _ := s.store.GetThreadsMeta(metaLastSync)
	s.mu.Lock()
	defer s.mu.Unlock()
	return Status{LastSuccess: last, LastError: s.lastError}
}
