package sandboxcore

import "context"

// TerminalProvider is optional. Closing an attachment releases only its connection.
// EndTerminal explicitly destroys the remote PTY. An attachment replays retained
// output before reporting Ready and accepts one concurrent reader and one writer.
type TerminalProvider interface {
	CreateTerminal(context.Context, ResourceRef, string) (string, error)
	AttachTerminal(context.Context, ResourceRef, string) (TerminalConnection, error)
	EndTerminal(context.Context, ResourceRef, string) error
}

type TerminalEvent struct {
	Output []byte
	Ready  bool
	Exited bool
}

type TerminalConnection interface {
	Read() (TerminalEvent, error)
	Input([]byte) error
	Resize(cols, rows int) error
	Close() error
}
