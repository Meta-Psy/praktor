package web

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/moby/moby/api/pkg/stdcopy"
	dockercontainer "github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

// dockerOneShot is the production oneShotRunner: create → start → wait → logs → remove.
type dockerOneShot struct {
	docker *client.Client
}

func newDockerOneShot() (*dockerOneShot, error) {
	c, err := client.New(client.FromEnv)
	if err != nil {
		return nil, fmt.Errorf("docker client: %w", err)
	}
	return &dockerOneShot{docker: c}, nil
}

func (d *dockerOneShot) Run(ctx context.Context, spec oneShotSpec) (string, int, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	// ContainerCreate does not auto-pull; pull the helper image if it is absent
	// locally (otherwise the first deploy on a clean/pruned host fails opaquely).
	if err := d.ensureImage(ctx, spec.Image); err != nil {
		return "", 0, err
	}

	name := fmt.Sprintf("praktor-deploy-%d", time.Now().UnixNano())
	resp, err := d.docker.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config: &dockercontainer.Config{
			Image: spec.Image,
			Cmd:   spec.Cmd,
			Env:   spec.Env,
		},
		HostConfig: &dockercontainer.HostConfig{Binds: spec.Binds},
		Name:       name,
	})
	if err != nil {
		return "", 0, fmt.Errorf("create %s: %w", spec.Image, err)
	}
	defer func() {
		_, _ = d.docker.ContainerRemove(context.Background(), resp.ID, client.ContainerRemoveOptions{Force: true})
	}()

	if _, err := d.docker.ContainerStart(ctx, resp.ID, client.ContainerStartOptions{}); err != nil {
		return "", 0, fmt.Errorf("start: %w", err)
	}

	waitResult := d.docker.ContainerWait(ctx, resp.ID, client.ContainerWaitOptions{})
	var exit int
	select {
	case err := <-waitResult.Error:
		if err != nil {
			return "", 0, fmt.Errorf("wait: %w", err)
		}
	case res := <-waitResult.Result:
		if res.Error != nil && res.Error.Message != "" {
			return "", 0, fmt.Errorf("wait: %s", res.Error.Message)
		}
		exit = int(res.StatusCode)
	}

	logs := ""
	if rc, err := d.docker.ContainerLogs(ctx, resp.ID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true}); err == nil {
		var buf writeBuf
		_, _ = stdcopy.StdCopy(&buf, &buf, rc)
		_ = rc.Close()
		logs = buf.String()
	}
	return logs, exit, nil
}

// ensureImage pulls ref if it is not already present locally.
func (d *dockerOneShot) ensureImage(ctx context.Context, ref string) error {
	if _, err := d.docker.ImageInspect(ctx, ref); err == nil {
		return nil // already present
	}
	resp, err := d.docker.ImagePull(ctx, ref, client.ImagePullOptions{})
	if err != nil {
		return fmt.Errorf("pull %s: %w", ref, err)
	}
	defer func() { _ = resp.Close() }()
	_, _ = io.Copy(io.Discard, resp) // drain so the pull completes before create
	return nil
}

// writeBuf is a tiny io.Writer accumulator (avoids importing bytes just for this).
type writeBuf struct{ b []byte }

func (w *writeBuf) Write(p []byte) (int, error) { w.b = append(w.b, p...); return len(p), nil }
func (w *writeBuf) String() string              { return string(w.b) }

var _ io.Writer = (*writeBuf)(nil)
