package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// audit emits a Telegram line for a control-plane action; ok=false prefixes ❌.
func (s *Server) audit(ctx context.Context, ok bool, detail string) {
	if s.tg == nil {
		return
	}
	mark := "✅"
	if !ok {
		mark = "❌"
	}
	s.tg.Notify(ctx, fmt.Sprintf("%s MC: %s", mark, detail))
}

func (s *Server) handleApprove(w http.ResponseWriter, r *http.Request) {
	def, ok := s.projects[r.PathValue("key")]
	if !ok {
		jsonError(w, "unknown project", http.StatusNotFound)
		return
	}
	var body struct {
		Tier  string `json:"tier"`
		Issue int    `json:"issue"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.Tier != "trivial" && body.Tier != "all" {
		jsonError(w, `tier must be "trivial" or "all"`, http.StatusBadRequest)
		return
	}
	if body.Issue <= 0 {
		jsonError(w, "issue must be a positive number", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	detail := fmt.Sprintf("approve %s on %s#%d", body.Tier, def.Repo, body.Issue)
	err := s.ghWrite.AddComment(ctx, def.Repo, body.Issue, "/approve "+body.Tier)
	if err != nil {
		s.audit(ctx, false, detail+": "+err.Error())
		jsonError(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.audit(ctx, true, detail)
	jsonResponse(w, map[string]string{"status": "ok"})
}

func (s *Server) handleMerge(w http.ResponseWriter, r *http.Request) {
	def, ok := s.projects[r.PathValue("key")]
	if !ok {
		jsonError(w, "unknown project", http.StatusNotFound)
		return
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n <= 0 {
		jsonError(w, "invalid pr number", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	detail := fmt.Sprintf("merge %s#%d", def.Repo, n)
	if err := s.ghWrite.MergePR(ctx, def.Repo, n, "squash"); err != nil {
		s.audit(ctx, false, detail+": "+err.Error())
		jsonError(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.audit(ctx, true, detail)
	jsonResponse(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDeploy(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	def, ok := s.projects[key]
	if !ok {
		jsonError(w, "unknown project", http.StatusNotFound)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Minute)
	defer cancel()

	switch {
	case def.DeployWorkflow != "":
		detail := fmt.Sprintf("deploy %s (dispatch %s)", key, def.DeployWorkflow)
		if err := s.ghWrite.DispatchWorkflow(ctx, def.Repo, def.DeployWorkflow, "main"); err != nil {
			s.audit(ctx, false, detail+": "+err.Error())
			jsonError(w, err.Error(), http.StatusBadGateway)
			return
		}
		s.audit(ctx, true, detail)
		jsonResponse(w, map[string]string{"status": "ok"})

	case def.DeployHostDir != "":
		if s.oneShot == nil {
			jsonError(w, "host deploy unavailable (no docker)", http.StatusServiceUnavailable)
			return
		}
		detail := fmt.Sprintf("deploy %s (host rebuild)", key)
		dep := &GnathologyDeployer{
			Runner:      s.oneShot,
			HostDir:     def.DeployHostDir,
			ComposeProj: def.DeployComposeProject,
			Token:       s.writeToken(),
		}
		if err := dep.Deploy(ctx); err != nil {
			s.audit(ctx, false, detail+": "+err.Error())
			jsonError(w, err.Error(), http.StatusBadGateway)
			return
		}
		s.audit(ctx, true, detail)
		jsonResponse(w, map[string]string{"status": "ok"})

	default:
		jsonError(w, "no deploy mechanism configured for project", http.StatusBadRequest)
	}
}

// writeToken exposes the write PAT to the host deployer (private pull).
func (s *Server) writeToken() string {
	if c, ok := s.ghWrite.(*WriteGitHubClient); ok {
		return c.Token
	}
	return ""
}
