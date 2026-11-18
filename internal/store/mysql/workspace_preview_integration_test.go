package mysql

import (
	"bytes"
	"io"
	"strings"
	"testing"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func workspacePreviewIntegration(t *testing.T, f *agentIntegrationFixture, svc *a.CloudService, remote *workspaceToolProvider, computerID uint64, cwd string) {
	t.Helper()
	ctx := f.Context
	files := f.Agents.Files
	f.Agents.Files = nil // A direct stream must not require local file storage.
	defer func() { f.Agents.Files = files }()
	var noteKey string
	for key := range remote.files {
		if strings.HasSuffix(key, "/note.md") {
			noteKey = key
			break
		}
	}
	if noteKey == "" {
		t.Fatal("missing preview fixture")
	}
	largeKey := strings.TrimSuffix(noteKey, "note.md") + "large.bin"
	remote.files[largeKey] = bytes.Repeat([]byte("large preview"), 250000)
	defer delete(remote.files, largeKey)
	_, outsider := favoriteTestUser(t, f, "preview_outsider")
	counts := func() [4]int {
		t.Helper()
		var result [4]int
		for i, table := range []string{"cloud_computer_operation", "sandbox_operation", "sandbox_lease", "agent_resource_reference"} {
			if err := f.Store.db.GetContext(ctx, &result[i], "SELECT COUNT(*) FROM "+table); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	before := counts()
	listing, err := svc.ListWorkspaceEntries(ctx, f.AdminToken, computerID, a.WorkspaceEntryQuery{Path: strings.TrimPrefix(cwd, "/data/")})
	if err != nil {
		t.Fatal("list directory", err)
	}
	entries := listing.Data.([]a.WorkspaceEntry)
	if len(entries) == 0 || entries[0].EntryToken == "" || listing.Pagination.Total != len(entries) {
		t.Fatal("listing lost entries or mutation preconditions", entries, listing.Pagination)
	}
	if _, err := svc.ListWorkspaceEntries(ctx, outsider, computerID, a.WorkspaceEntryQuery{}); err == nil {
		t.Fatal("unauthorized directory listing")
	}
	if after := counts(); after != before {
		t.Fatal("directory listing created operation, lease or resource records", before, after)
	}
	for _, file := range []struct{ name, key string }{{"note.md", noteKey}, {"large.bin", largeKey}} {
		stats, downloads := remote.stats, remote.downloads
		_, content, err := svc.OpenWorkspaceFile(ctx, f.AdminToken, computerID, strings.TrimPrefix(cwd, "/data/")+"/"+file.name, "")
		if err != nil {
			t.Fatal("preview", err)
		}
		if remote.stats != stats || remote.downloads != downloads+1 {
			t.Fatal("preview must download once without stat", remote.stats-stats, remote.downloads-downloads)
		}
		if active := counts(); active != before {
			t.Fatal("stream registered records before reading", before, active)
		}
		body, err := io.ReadAll(content.Reader)
		if err != nil || !bytes.Equal(body, remote.files[file.key]) {
			t.Fatal("preview bytes", err)
		}
		if err = content.Reader.Close(); err != nil {
			t.Fatal(err)
		}
	}
	stats, downloads := remote.stats, remote.downloads
	if _, content, err := svc.OpenWorkspaceFile(ctx, f.AdminToken, computerID, "home/missing-preview.py", ""); err == nil || content != nil || remote.stats != stats || remote.downloads != downloads+1 {
		t.Fatal("missing preview", err)
	}
	downloads = remote.downloads
	for _, request := range []struct {
		token, name string
		id          uint64
	}{
		{"", "home/file.py", computerID},
		{outsider, "home/file.py", computerID},
		{f.AdminToken, "../outside", computerID},
		{f.AdminToken, "home/file.py", 0},
	} {
		if _, content, err := svc.OpenWorkspaceFile(ctx, request.token, request.id, request.name, ""); err == nil || content != nil || remote.downloads != downloads {
			t.Fatal("unauthorized or invalid preview reached the provider", err)
		}
	}
	if after := counts(); before != after {
		t.Fatal("preview created operation, lease or resource records", before, after)
	}
}
