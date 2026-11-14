package opensandbox

import (
	"context"
	"io"
	"path"
	"strings"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func validateFile(f sandboxcore.FileRequest) error {
	if !strings.HasPrefix(f.Path, "/run/antcdp-transfers/") || path.Clean(f.Path) != f.Path || len(f.Path) > 4096 || strings.ContainsRune(f.Path, 0) || f.MaxBytes <= 0 || f.MaxBytes > 1<<30 || (f.UID == nil) != (f.GID == nil) {
		return failure("SANDBOX_FILE_REQUEST_INVALID", false)
	}
	return nil
}

func (p *Provider) fileClient(ctx context.Context, ref sandboxcore.ResourceRef, f sandboxcore.FileRequest) (sdk.IdentityFilesystem, error) {
	client, err := p.execd(ctx, ref)
	if err != nil {
		return nil, err
	}
	if f.UID != nil {
		identity, err := client.FilesWithIdentity(*f.UID, *f.GID)
		if err != nil {
			return nil, failure("SANDBOX_FILE_IDENTITY_UNSUPPORTED", false)
		}
		return identity, nil
	}
	return client, nil
}

func (p *Provider) OpenFile(ctx context.Context, ref sandboxcore.ResourceRef, f sandboxcore.FileRequest) (io.ReadCloser, error) {
	if err := validateFile(f); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, p.connection.OperationTimeout)
	client, err := p.fileClient(ctx, ref, f)
	if err != nil {
		cancel()
		return nil, err
	}
	reader, err := client.DownloadFile(ctx, f.Path, "")
	if err != nil {
		cancel()
		return nil, remoteError(err, false)
	}
	return &limitedReadCloser{Reader: &boundedReader{source: reader, remaining: f.MaxBytes}, closer: reader, cancel: cancel}, nil
}

func (p *Provider) PutFile(ctx context.Context, ref sandboxcore.ResourceRef, f sandboxcore.FileRequest, source io.Reader) error {
	if err := validateFile(f); err != nil {
		return err
	}
	if source == nil {
		return failure("SANDBOX_FILE_REQUEST_INVALID", false)
	}
	ctx, cancel := context.WithTimeout(ctx, p.connection.OperationTimeout)
	defer cancel()
	client, err := p.fileClient(ctx, ref, f)
	if err != nil {
		return err
	}
	bounded := &boundedReader{source: source, remaining: f.MaxBytes}
	err = client.UploadFile(ctx, bounded, sdk.UploadFileOptions{FileName: "transfer", Metadata: sdk.FileMetadata{Path: f.Path, Mode: 600}})
	if err != nil {
		return remoteError(err, true)
	}
	if bounded.exceeded {
		return failure("SANDBOX_TRANSFER_TOO_LARGE", true)
	}
	return nil
}
