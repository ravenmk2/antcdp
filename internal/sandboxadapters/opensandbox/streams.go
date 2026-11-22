package opensandbox

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// Providers are short-lived. Streams belong to the application factory.
type commandStreams struct {
	dir     string
	ctx     context.Context
	cancel  context.CancelFunc
	mu      sync.Mutex
	writers sync.WaitGroup
	active  map[string]bool
}

func newCommandStreams(dir string) *commandStreams {
	ctx, cancel := context.WithCancel(context.Background())
	return &commandStreams{dir: dir, ctx: ctx, cancel: cancel, active: make(map[string]bool)}
}
func (s *commandStreams) close() {
	s.mu.Lock()
	s.cancel()
	s.mu.Unlock()
	s.writers.Wait()
}
func (s *commandStreams) path(h sandboxcore.ExecutionHandle) string {
	resource, _ := json.Marshal(h.Resource)
	return filepath.Join(s.dir, fmt.Sprintf("%x", sha256.Sum256(resource)), fmt.Sprintf("%x.log", sha256.Sum256([]byte(h.ID))))
}
func (s *commandStreams) setActive(path string, on bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if on {
		s.active[path] = true
	} else {
		delete(s.active, path)
	}
}
func (s *commandStreams) isActive(path string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.active[path]
}

func (p *Provider) startCommand(ctx context.Context, ref sandboxcore.ResourceRef, spec sandboxcore.ExecSpec, cb sandboxcore.ExecCallbacks) (sandboxcore.ExecResult, error) {
	type launch struct {
		result sandboxcore.ExecResult
		err    error
	}
	if err := ctx.Err(); err != nil {
		return sandboxcore.ExecResult{}, err
	}
	s := p.streams
	if s == nil || cb.Started == nil {
		return sandboxcore.ExecResult{}, failure("SANDBOX_HANDLE_CALLBACK_REQUIRED", false)
	}
	s.mu.Lock()
	if s.ctx.Err() != nil {
		s.mu.Unlock()
		return sandboxcore.ExecResult{}, failure("SANDBOX_UNAVAILABLE", false)
	}
	s.writers.Add(1)
	s.mu.Unlock()
	ready := make(chan launch, 1)
	// Until init is committed the dispatch permit owns cancellation. Afterwards
	// the factory owns the stream until the command finishes or it shuts down.
	run, cancel := context.WithCancel(s.ctx)
	stop := context.AfterFunc(ctx, cancel)
	go func() {
		defer s.writers.Done()
		defer cancel()
		defer stop()
		var log *outputJournal
		var path string
		started := false
		result, err := p.streamCommand(run, ref, spec, sandboxcore.ExecCallbacks{
			Started: func(c context.Context, h sandboxcore.ExecutionHandle) error {
				if err := cb.Started(c, h); err != nil {
					return err
				}
				path = s.path(h)
				var err error
				log, err = openJournal(path)
				if err != nil {
					return err
				}
				s.setActive(path, true)
				stop()
				started = true
				ready <- launch{result: sandboxcore.ExecResult{Handle: &h, Running: true}}
				return nil
			},
			Output: func(_ context.Context, out sandboxcore.Output) error { return log.appendOutput(out) },
		})
		if log != nil {
			log.finish(err != nil)
			s.setActive(path, false)
		}
		if !started {
			ready <- launch{result, err}
			return
		}
		if cb.Finished != nil {
			cb.Finished(run, result, err)
		}
	}()
	v := <-ready
	return v.result, v.err
}
