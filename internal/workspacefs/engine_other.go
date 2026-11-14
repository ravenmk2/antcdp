//go:build !linux

package workspacefs

import "context"

// The executable is deployed only in a verified Linux sandbox image. Refuse
// weaker path handling on development hosts instead of emulating its guarantees.
func (e *Engine) Handle(_ context.Context, _ Request) Response {
	return Result(nil, false, failure("WORKSPACE_SAFE_IO_UNSUPPORTED"))
}
