package web

import (
	"context"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls []oneShotSpec
	exit  []int    // exit code to return per call
	errs  []error  // error to return per call
	logs  []string // logs to return per call
}

func (f *fakeRunner) Run(_ context.Context, spec oneShotSpec) (string, int, error) {
	i := len(f.calls)
	f.calls = append(f.calls, spec)
	var code int
	var err error
	var log string
	if i < len(f.exit) {
		code = f.exit[i]
	}
	if i < len(f.errs) {
		err = f.errs[i]
	}
	if i < len(f.logs) {
		log = f.logs[i]
	}
	return log, code, err
}

func newDeployer(r oneShotRunner) *GnathologyDeployer {
	return &GnathologyDeployer{
		Runner:      r,
		HostDir:     "/opt/apps/gnathology-bot",
		ComposeProj: "gnathology-bot",
		Token:       "wtok",
	}
}

func TestDeploySuccess(t *testing.T) {
	r := &fakeRunner{exit: []int{0, 0}}
	if err := newDeployer(r).Deploy(context.Background()); err != nil {
		t.Fatalf("Deploy: %v", err)
	}
	if len(r.calls) != 2 {
		t.Fatalf("want 2 runs, got %d", len(r.calls))
	}
	pull := r.calls[0]
	if pull.Image != defaultGitImage {
		t.Errorf("pull image = %q", pull.Image)
	}
	if !contains(pull.Env, "GIT_TOKEN=wtok") {
		t.Errorf("pull env = %v", pull.Env)
	}
	if !contains(pull.Binds, "/opt/apps/gnathology-bot:/repo") {
		t.Errorf("pull binds = %v", pull.Binds)
	}
	if contains(pull.Binds, "/var/run/docker.sock:/var/run/docker.sock") {
		t.Errorf("pull must NOT mount docker socket")
	}
	comp := r.calls[1]
	if comp.Image != defaultComposeImage {
		t.Errorf("compose image = %q", comp.Image)
	}
	if !contains(comp.Binds, "/var/run/docker.sock:/var/run/docker.sock") {
		t.Errorf("compose must mount docker socket: %v", comp.Binds)
	}
	joined := strings.Join(comp.Cmd, " ")
	if !strings.Contains(joined, "-p gnathology-bot") {
		t.Errorf("compose must pin project: %q", joined)
	}
	if !strings.Contains(joined, "up -d --build") {
		t.Errorf("compose cmd = %q", joined)
	}
	// compose.yml lives in the repo's deploy/ subdir, not the git root.
	if !strings.Contains(joined, "-f /repo/deploy/compose.yml") {
		t.Errorf("compose must reference deploy-subdir file: %q", joined)
	}
}

func TestDeployPullFailsStopsBeforeCompose(t *testing.T) {
	r := &fakeRunner{exit: []int{1, 0}, logs: []string{"merge conflict", ""}}
	err := newDeployer(r).Deploy(context.Background())
	if err == nil || !strings.Contains(err.Error(), "merge conflict") {
		t.Fatalf("want pull error with log tail, got %v", err)
	}
	if len(r.calls) != 1 {
		t.Fatalf("compose must not run after failed pull, got %d calls", len(r.calls))
	}
}

func TestDeployComposeFails(t *testing.T) {
	r := &fakeRunner{exit: []int{0, 2}, logs: []string{"", "build error: no space left"}}
	err := newDeployer(r).Deploy(context.Background())
	if err == nil || !strings.Contains(err.Error(), "no space left") {
		t.Fatalf("want compose error with log tail, got %v", err)
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
