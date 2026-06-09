package web

import (
	"context"
	"fmt"
)

const (
	defaultGitImage     = "alpine/git"
	defaultComposeImage = "docker:cli"
	composeFile         = "/repo/compose.yml"
	dockerSockBind      = "/var/run/docker.sock:/var/run/docker.sock"
)

// oneShotSpec describes a single throwaway container run.
type oneShotSpec struct {
	Image string
	Binds []string
	Env   []string
	Cmd   []string
}

// oneShotRunner runs a container to completion and returns combined logs + exit code.
type oneShotRunner interface {
	Run(ctx context.Context, spec oneShotSpec) (logs string, exitCode int, err error)
}

// GnathologyDeployer rebuilds the gnathology bot on the host: pull latest main,
// then compose up --build. The deploy dir must already be a git working copy
// (one-time [ALEX] setup) with .env and data/ gitignored.
type GnathologyDeployer struct {
	Runner      oneShotRunner
	HostDir     string // e.g. /opt/apps/gnathology-bot/deploy
	ComposeProj string // e.g. gnathology-bot (must match existing stack)
	Token       string // GitHub write PAT for the private pull
}

func (d *GnathologyDeployer) Deploy(ctx context.Context) error {
	repoBind := d.HostDir + ":/repo"

	// 1) git pull --ff-only (token via env, never in argv).
	logs, code, err := d.Runner.Run(ctx, oneShotSpec{
		Image: defaultGitImage,
		Binds: []string{repoBind},
		Env:   []string{"GIT_TOKEN=" + d.Token},
		Cmd: []string{"sh", "-c",
			`git -c http.extraheader="AUTHORIZATION: bearer $GIT_TOKEN" -C /repo pull --ff-only`},
	})
	if err != nil {
		return fmt.Errorf("git pull: %w", err)
	}
	if code != 0 {
		return fmt.Errorf("git pull failed (exit %d): %s", code, tail(logs))
	}

	// 2) compose up -d --build, project pinned so it replaces the existing stack
	//    (not creating a second one under the bind-mount basename).
	logs, code, err = d.Runner.Run(ctx, oneShotSpec{
		Image: defaultComposeImage,
		Binds: []string{repoBind, dockerSockBind},
		Cmd:   []string{"docker", "compose", "-p", d.ComposeProj, "-f", composeFile, "up", "-d", "--build"},
	})
	if err != nil {
		return fmt.Errorf("compose up: %w", err)
	}
	if code != 0 {
		return fmt.Errorf("compose up failed (exit %d): %s", code, tail(logs))
	}
	return nil
}

// tail returns the last ~600 bytes of s, for surfacing failure logs without flooding TG/UI.
func tail(s string) string {
	const max = 600
	if len(s) <= max {
		return s
	}
	return "…" + s[len(s)-max:]
}
