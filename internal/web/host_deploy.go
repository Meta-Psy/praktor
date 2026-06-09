package web

import (
	"context"
	"fmt"
)

const (
	defaultGitImage     = "alpine/git"
	defaultComposeImage = "docker:cli"
	dockerSockBind      = "/var/run/docker.sock:/var/run/docker.sock"
)

// oneShotSpec describes a single throwaway container run.
type oneShotSpec struct {
	Image string
	// Entrypoint overrides the image's ENTRYPOINT. Required here because the helper
	// images carry their own (alpine/git -> "git", docker:cli -> "docker"), so a bare
	// Cmd like ["sh","-c",...] would otherwise run as `git sh -c ...` and fail.
	Entrypoint []string
	Binds      []string
	Env        []string
	Cmd        []string
}

// oneShotRunner runs a container to completion and returns combined logs + exit code.
type oneShotRunner interface {
	Run(ctx context.Context, spec oneShotSpec) (logs string, exitCode int, err error)
}

// GnathologyDeployer rebuilds the gnathology bot on the host: pull latest main,
// then compose up --build. HostDir must be the repo ROOT as a git working copy
// (one-time [ALEX] setup) with .env and data/ gitignored; compose.yml lives in
// its deploy/ subdir and its build context (..) points back at the root for the
// Dockerfile + src.
type GnathologyDeployer struct {
	Runner      oneShotRunner
	HostDir     string // repo root, e.g. /opt/apps/gnathology-bot (git working copy)
	ComposeProj string // e.g. gnathology-bot (must match existing stack)
	Token       string // GitHub write PAT for the private pull
}

func (d *GnathologyDeployer) Deploy(ctx context.Context) error {
	// Bind the repo at the SAME path inside the one-shots as on the host. docker
	// compose runs in docker:cli and talks to the host daemon over the socket; the
	// relative bind mounts (./data) and build context (..) in deploy/compose.yml are
	// resolved against the compose-file's directory and sent to the daemon verbatim.
	// Only a same-path mount makes those resolve to real HOST paths — a /repo mount
	// would emit /repo/... which the host daemon can't find, silently mounting empty
	// dirs and losing the bot's data.
	bind := d.HostDir + ":" + d.HostDir
	composeFile := d.HostDir + "/deploy/compose.yml"

	// 1) git pull --ff-only. Token passed via env; the Basic header is built in-shell.
	//    GitHub's git-over-HTTPS endpoint speaks HTTP Basic (username ignored for a
	//    PAT, token as password) — NOT Bearer, which it rejects with a 401 and an
	//    interactive credential prompt. safe.directory because the one-shot runs as
	//    root while the working copy is owned by the deploy user.
	pullCmd := `git -c safe.directory="` + d.HostDir + `"` +
		` -c http.extraheader="AUTHORIZATION: basic $(printf 'x-access-token:%s' $GIT_TOKEN | base64 | tr -d '\n')"` +
		` -C "` + d.HostDir + `" pull --ff-only`
	logs, code, err := d.Runner.Run(ctx, oneShotSpec{
		Image:      defaultGitImage,
		Entrypoint: []string{"sh"}, // override alpine/git's "git" entrypoint
		Binds:      []string{bind},
		Env:        []string{"GIT_TOKEN=" + d.Token},
		Cmd:        []string{"-c", pullCmd},
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
		Image:      defaultComposeImage,
		Entrypoint: []string{"docker"}, // override docker:cli's "docker-entrypoint.sh"
		Binds:      []string{bind, dockerSockBind},
		Cmd:        []string{"compose", "-p", d.ComposeProj, "-f", composeFile, "up", "-d", "--build"},
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
