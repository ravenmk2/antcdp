package mysql

import (
	"context"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type terminalTestProvider struct{ sandboxcore.Provider }
type terminalTestFactory struct{ provider terminalTestProvider }

func (f terminalTestFactory) Open(context.Context, sandboxcore.Connection) (sandboxcore.Provider, error) {
	return f.provider, nil
}
func (terminalTestProvider) CreateTerminal(context.Context, sandboxcore.ResourceRef, string) (string, error) {
	return cryptox.ID(), nil
}
func (terminalTestProvider) AttachTerminal(_ context.Context, _ sandboxcore.ResourceRef, id string) (sandboxcore.TerminalConnection, error) {
	return terminalTestAttachment{id: id}, nil
}
func (terminalTestProvider) EndTerminal(context.Context, sandboxcore.ResourceRef, string) error {
	return nil
}

type terminalTestAttachment struct {
	sandboxcore.TerminalConnection
	id string
}

// Exercise real role checks and row locks; the fake runtime returns its chosen
// handle so this test can distinguish a fresh, shared or resumed PTY.
func testCloudTerminals(t *testing.T, f *agentIntegrationFixture, svc *agents.CloudService, computer uint64) {
	prior := svc.Factory
	svc.Factory = terminalTestFactory{}
	defer func() { svc.Factory = prior }()
	createAccount := func(role string) string {
		t.Helper()
		const initial = "initial-terminal-test-password"
		const next = "updated-terminal-test-password"
		u, _, err := f.Identity.CreateUser(f.Context, f.AdminToken, identity.CreateRequest{Username: "terminal_" + role, DisplayName: "Terminal operator", Role: role, Password: initial}, identity.Metadata{})
		if err != nil {
			t.Fatal(err)
		}
		login, err := f.Identity.Login(f.Context, u.Username, initial, "", identity.Metadata{})
		if err != nil {
			t.Fatal(err)
		}
		if err = f.Identity.ChangePassword(f.Context, login.Token, initial, next, identity.Metadata{}); err != nil {
			t.Fatal(err)
		}
		login, err = f.Identity.Login(f.Context, u.Username, next, "", identity.Metadata{})
		if err != nil {
			t.Fatal(err)
		}
		return login.Token
	}
	second, ordinary := createAccount("admin"), createAccount("user")
	_, _, err := svc.OpenTerminal(f.Context, ordinary, computer)
	modelsExpectCode(t, err, "FORBIDDEN")
	type result struct {
		slot   *agents.CloudTerminal
		handle string
		err    error
	}
	open := func(token string) result {
		slot, conn, err := svc.OpenTerminal(f.Context, token, computer)
		if err != nil {
			return result{err: err}
		}
		return result{slot: slot, handle: conn.(terminalTestAttachment).id}
	}
	first := make(chan result, 1)
	go func() { first <- open(f.AdminToken) }()
	b := open(second)
	a := <-first
	if a.err != nil || b.err != nil || a.handle == b.handle {
		t.Fatal("independent terminal handles", a.err, b.err)
	}
	reopened := open(f.AdminToken)
	if reopened.err != nil || reopened.handle != a.handle {
		t.Fatal("administrator lost own session", reopened.err)
	}
	view, err := svc.GetComputer(f.Context, f.AdminToken, computer)
	if err != nil || view.Data.(agents.CloudView).TerminalSessions != 2 {
		t.Fatal("expected two retained terminals", err)
	}
	_, err = svc.MaintainComputer(f.Context, f.AdminToken, computer, view.Tag, cryptox.ID(), agents.CloudMaintenanceWrite{Action: "pause"})
	modelsExpectCode(t, err, "CLOUD_TERMINALS_ACTIVE")
	if err = a.slot.End(f.Context); err != nil {
		t.Fatal(err)
	}
	after := open(f.AdminToken)
	if after.err != nil || after.handle == a.handle {
		t.Fatal("ended terminal was reused", after.err)
	}
	for _, slot := range []*agents.CloudTerminal{b.slot, after.slot} {
		if err := slot.End(f.Context); err != nil {
			t.Fatal(err)
		}
	}
}
