package web

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/mtzanidakis/praktor/internal/config"
	"github.com/mtzanidakis/praktor/internal/container"
)

const auditLabel = "audit-report"

// ghReader is the read-only GitHub surface the aggregator needs (mockable in tests).
type ghReader interface {
	OpenPRs(ctx context.Context, repo string) ([]PRInfo, error)
	AuditIssues(ctx context.Context, repo, label string) ([]IssueInfo, error)
	LatestCI(ctx context.Context, repo string) (CIStatus, error)
}

// DeployStatus is the result of probing a project's deploy/health URL.
type DeployStatus struct {
	OK        bool   `json:"ok"`
	Code      int    `json:"code"`
	LatencyMS int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

// AgentLive is one agent's liveness within a project.
type AgentLive struct {
	ID      string `json:"id"`
	Running bool   `json:"running"`
}

// ProjectStatus is the aggregated, UI-facing status of one project.
type ProjectStatus struct {
	Name        string       `json:"name"`
	Repo        string       `json:"repo"`
	PRs         []PRInfo     `json:"prs"`
	PRError     string       `json:"pr_error,omitempty"`
	AuditIssues []IssueInfo  `json:"audit_issues"`
	AuditError  string       `json:"audit_error,omitempty"`
	CI          ciResult     `json:"ci"`
	Deploy      DeployStatus `json:"deploy"`
	Agents      []AgentLive  `json:"agents"`
	DeployRun   deployRun    `json:"deploy_run"`
}

// overlayDeployRuns returns a copy of data with each project's live deploy_run
// stamped from the store. The input slice (which may be the shared cache) is not
// mutated, so the live deploy status bypasses the roll-up's 30s TTL.
func overlayDeployRuns(data []ProjectStatus, d *deployStore) []ProjectStatus {
	out := make([]ProjectStatus, len(data))
	copy(out, data)
	for i := range out {
		out[i].DeployRun = d.snapshot(out[i].Name)
	}
	return out
}

// ciResult is CIStatus plus an error slot for partial degradation.
type ciResult struct {
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	URL        string `json:"url"`
	Error      string `json:"error,omitempty"`
}

// Aggregator builds ProjectStatus from GitHub + a deploy probe + orchestrator liveness.
type Aggregator struct {
	gh   ghReader
	http *http.Client
}

// BuildProjectStatus assembles one project's status. Never panics; failing
// sources surface as *_error fields rather than dropping the project.
func (a *Aggregator) BuildProjectStatus(ctx context.Context, name string, def config.ProjectDefinition, running []container.ContainerInfo) ProjectStatus {
	st := ProjectStatus{Name: name, Repo: def.Repo}

	if prs, err := a.gh.OpenPRs(ctx, def.Repo); err != nil {
		st.PRError = err.Error()
	} else {
		st.PRs = prs
	}
	if issues, err := a.gh.AuditIssues(ctx, def.Repo, auditLabel); err != nil {
		st.AuditError = err.Error()
	} else {
		st.AuditIssues = issues
	}
	if ci, err := a.gh.LatestCI(ctx, def.Repo); err != nil {
		st.CI = ciResult{Error: err.Error()}
	} else {
		st.CI = ciResult{Status: ci.Status, Conclusion: ci.Conclusion, URL: ci.URL}
	}

	st.Deploy = a.probeDeploy(ctx, def)
	st.Agents = liveness(def.Agents, running)
	return st
}

func (a *Aggregator) probeDeploy(ctx context.Context, def config.ProjectDefinition) DeployStatus {
	target := def.DeployURL
	if target == "" {
		target = def.Health
	}
	if target == "" {
		return DeployStatus{Error: "no deploy_url or health configured"}
	}
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return DeployStatus{Error: err.Error()}
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return DeployStatus{Error: err.Error(), LatencyMS: time.Since(start).Milliseconds()}
	}
	defer resp.Body.Close()
	return DeployStatus{
		OK:        resp.StatusCode == http.StatusOK,
		Code:      resp.StatusCode,
		LatencyMS: time.Since(start).Milliseconds(),
	}
}

// liveness maps configured agent ids to whether a running container exists.
func liveness(agents []string, running []container.ContainerInfo) []AgentLive {
	up := make(map[string]bool, len(running))
	for _, c := range running {
		up[c.AgentID] = true
	}
	out := make([]AgentLive, 0, len(agents))
	for _, id := range agents {
		out = append(out, AgentLive{ID: id, Running: up[id]})
	}
	return out
}

// projectsCache memoizes the aggregated roll-up for ttl to respect GitHub rate limits.
type projectsCache struct {
	ttl  time.Duration
	now  func() time.Time
	mu   sync.Mutex
	at   time.Time
	data []ProjectStatus
}

func (c *projectsCache) get(build func() []ProjectStatus) []ProjectStatus {
	nowFn := time.Now
	if c.now != nil {
		nowFn = c.now
	}

	c.mu.Lock()
	if c.data != nil && nowFn().Sub(c.at) < c.ttl {
		data := c.data
		c.mu.Unlock()
		return data
	}
	c.mu.Unlock()

	data := build() // network I/O happens outside the lock

	c.mu.Lock()
	c.data = data
	c.at = nowFn()
	c.mu.Unlock()
	return data
}

// handleProjects is the GET /api/projects handler.
func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	if s.aggregator == nil {
		jsonError(w, "projects roll-up not configured", http.StatusServiceUnavailable)
		return
	}
	data := s.projCache.get(func() []ProjectStatus {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		running, _ := s.orch.ListRunning(ctx)
		out := make([]ProjectStatus, 0, len(s.projects))
		for name, def := range s.projects {
			out = append(out, s.aggregator.BuildProjectStatus(ctx, name, def, running))
		}
		return out
	})
	jsonResponse(w, overlayDeployRuns(data, s.deploys))
}
