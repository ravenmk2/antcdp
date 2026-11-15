package opensandbox

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func validateFile(f sandboxcore.FileRequest) error {
	if !validFilePath(f.Path) || f.MaxBytes <= 0 || f.MaxBytes > 1<<30 || f.Offset < 0 || f.Length < 0 || f.Length > f.MaxBytes || f.Offset > 1<<50 || (f.UID == nil) != (f.GID == nil) {
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
	byteRange := ""
	if f.Offset > 0 || f.Length > 0 {
		byteRange = fmt.Sprintf("bytes=%d-", f.Offset)
		if f.Length > 0 {
			byteRange += fmt.Sprint(f.Offset + f.Length - 1)
		}
	}
	reader, err := client.DownloadFile(ctx, f.Path, byteRange)
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
	mode := f.Mode
	if mode == 0 {
		mode = 644
	}
	err = client.UploadFile(ctx, bounded, sdk.UploadFileOptions{FileName: path.Base(f.Path), Metadata: sdk.FileMetadata{Path: f.Path, Mode: mode}})
	if err != nil {
		return remoteError(err, true)
	}
	if bounded.exceeded {
		return failure("SANDBOX_TRANSFER_TOO_LARGE", true)
	}
	return nil
}

func validFilePath(name string) bool {
	return strings.HasPrefix(name, "/") && path.Clean(name) == name && len(name) <= 4096 && !strings.ContainsRune(name, 0)
}

var _ sandboxcore.Filesystem = (*Provider)(nil)

func fileInfo(v sdk.FileInfo) sandboxcore.FileInfo {
	kind := v.Type
	return sandboxcore.FileInfo{Path: v.Path, Kind: kind, Size: v.Size, ModifiedAt: v.ModifiedAt, Mode: v.Mode}
}

func (p *Provider) nativeFiles(ctx context.Context, ref sandboxcore.ResourceRef, name string) (sdk.IdentityFilesystem, error) {
	if !validFilePath(name) {
		return nil, failure("SANDBOX_FILE_REQUEST_INVALID", false)
	}
	return p.execd(ctx, ref)
}

func (p *Provider) StatFile(ctx context.Context, ref sandboxcore.ResourceRef, name string) (sandboxcore.FileInfo, error) {
	c, err := p.nativeFiles(ctx, ref, name)
	if err != nil {
		return sandboxcore.FileInfo{}, err
	}
	values, err := c.GetFileInfo(ctx, name)
	if err != nil {
		return sandboxcore.FileInfo{}, remoteError(err, false)
	}
	v, ok := values[name]
	if !ok {
		return sandboxcore.FileInfo{}, failure("SANDBOX_FILE_NOT_FOUND", false)
	}
	if v.Path == "" {
		v.Path = name
	}
	if v.Path != name || v.Size < 0 {
		return sandboxcore.FileInfo{}, failure("SANDBOX_RESPONSE_INVALID", false)
	}
	return fileInfo(v), nil
}

func (p *Provider) ListFiles(ctx context.Context, ref sandboxcore.ResourceRef, name string) ([]sandboxcore.FileInfo, error) {
	c, err := p.nativeFiles(ctx, ref, name)
	if err != nil {
		return nil, err
	}
	values, err := c.ListDirectory(ctx, name)
	if err != nil {
		return nil, remoteError(err, false)
	}
	return fileInfos(values), nil
}

func fileInfos(values []sdk.FileInfo) []sandboxcore.FileInfo {
	result := make([]sandboxcore.FileInfo, len(values))
	for i, v := range values {
		result[i] = fileInfo(v)
	}
	return result
}

func (p *Provider) SearchFiles(ctx context.Context, ref sandboxcore.ResourceRef, name, pattern string) ([]sandboxcore.FileInfo, error) {
	c, err := p.nativeFiles(ctx, ref, name)
	if err != nil {
		return nil, err
	}
	values, err := c.SearchFiles(ctx, name, pattern)
	if err != nil {
		return nil, remoteError(err, false)
	}
	return fileInfos(values), nil
}
func (p *Provider) MakeDirectory(ctx context.Context, ref sandboxcore.ResourceRef, name string, mode int) error {
	c, err := p.nativeFiles(ctx, ref, name)
	if err != nil {
		return err
	}
	return remoteError(c.CreateDirectory(ctx, name, mode), true)
}
func (p *Provider) RemoveFile(ctx context.Context, ref sandboxcore.ResourceRef, name string, directory bool) error {
	c, err := p.nativeFiles(ctx, ref, name)
	if err != nil {
		return err
	}
	if directory {
		return remoteError(c.DeleteDirectory(ctx, name), true)
	}
	return remoteError(c.DeleteFiles(ctx, []string{name}), true)
}
func (p *Provider) MoveFile(ctx context.Context, ref sandboxcore.ResourceRef, from, to string) error {
	c, err := p.nativeFiles(ctx, ref, from)
	if err != nil {
		return err
	}
	if !validFilePath(to) {
		return failure("SANDBOX_FILE_REQUEST_INVALID", false)
	}
	return remoteError(c.MoveFiles(ctx, sdk.MoveRequest{{Src: from, Dest: to}}), true)
}
func (p *Provider) SetFilePermissions(ctx context.Context, ref sandboxcore.ResourceRef, name string, mode int) error {
	c, err := p.nativeFiles(ctx, ref, name)
	if err != nil {
		return err
	}
	return remoteError(c.SetPermissions(ctx, sdk.PermissionsRequest{name: {Mode: mode}}), true)
}
func (p *Provider) ReplaceFile(ctx context.Context, ref sandboxcore.ResourceRef, name, old, replacement string) (int, error) {
	c, err := p.nativeFiles(ctx, ref, name)
	if err != nil {
		return 0, err
	}
	values, err := c.ReplaceInFilesDetailed(ctx, sdk.ReplaceRequest{name: {Old: old, New: replacement}})
	if err != nil {
		return 0, remoteError(err, true)
	}
	v, ok := values[name]
	if !ok {
		return 0, failure("SANDBOX_RESPONSE_INVALID", true)
	}
	return v.ReplacedCount, nil
}
