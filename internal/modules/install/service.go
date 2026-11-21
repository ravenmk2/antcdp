package install

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gofrs/flock"
	"github.com/ravenmk2/antcdp/internal/platform/config"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/filestore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/password"
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,29}$`)
var ErrFounderPasswordRequired = errors.New("a new founder password is required to complete initialization")

type backendMarker struct {
	Generation        uint64 `json:"generation"`
	TargetFingerprint string `json:"target_fingerprint"`
}
type marker struct {
	SandboxBackend *backendMarker `json:"sandbox_backend,omitempty"`
	Version        int            `json:"version"`
	InstallationID string         `json:"installation_id"`
	CompletedAt    time.Time      `json:"completed_at"`
}
type checkpoint struct {
	DatabaseTarget string `json:"database_target"`
	Version        int    `json:"version"`
	InstallationID string `json:"installation_id"`
	Stage          string `json:"stage"`
	Site           Site   `json:"site"`
	Username       string `json:"username"`
	DisplayName    string `json:"display_name"`
}
type Service struct {
	installationID    string
	sandboxGeneration uint64
	sandboxBlocked    bool
	mu                sync.RWMutex
	runtime           config.Runtime
	state             State
	backend           Backend
	connect           Connector
	key               []byte
	csrfKey           []byte
	instanceLock      *flock.Flock
	lastProbe         time.Time
}

func New(ctx context.Context, r config.Runtime, connect Connector) (*Service, error) {
	if err := filestore.EnsurePrivateDir(r.DataDir); err != nil {
		return nil, err
	}
	if err := filestore.EnsurePrivateDir(filepath.Join(r.DataDir, "locks")); err != nil {
		return nil, err
	}
	l := flock.New(filepath.Join(r.DataDir, "locks", "instance.lock"))
	ok, err := l.TryLock()
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errors.New("another process owns the data directory")
	}
	s := &Service{runtime: r, connect: connect, state: RecoveryRequired, csrfKey: cryptox.Random(32), instanceLock: l}
	if err := s.load(ctx); err != nil {
		_ = l.Close()
		return nil, err
	}
	return s, nil
}

func (s *Service) path(p string) string {
	return filepath.Join(s.runtime.DataDir, filepath.FromSlash(p))
}
func exists(path string) bool { _, err := os.Lstat(path); return err == nil }

func (s *Service) load(ctx context.Context) error {
	full := exists(s.path("master.key")) && exists(s.path("installation.json"))
	if exists(s.path("install.lock")) && !full {
		s.state = RecoveryRequired
		return nil
	}
	if full {
		key, err := filestore.ReadPrivate(s.path("master.key"), 32)
		if err != nil || len(key) != 32 {
			s.state = RecoveryRequired
			return nil
		}
		var m marker
		if err := readJSON(s.path("installation.json"), &m); err != nil || m.Version != 1 || len(m.InstallationID) != 32 {
			s.state = RecoveryRequired
			return nil
		}
		s.key = key
		s.csrfKey = cryptox.Derive(key, "csrf")
		b, err := s.connect(s.runtime.Database, false)
		if err != nil {
			s.state = Unavailable
			return nil
		}
		if err = b.Check(ctx, false); err != nil {
			_ = b.Close()
			s.state = Unavailable
			return nil
		}
		if err = b.SchemaReady(ctx); err != nil {
			_ = b.Close()
			s.state = Unavailable
			if errors.Is(err, ErrIncompleteSchema) {
				s.state = RecoveryRequired
			}
			return nil
		}
		i, err := b.Instance(ctx)
		if err != nil {
			_ = b.Close()
			s.state = Unavailable
			return nil
		}
		if i == nil || i.InstallationID != m.InstallationID || subtle.ConstantTimeCompare(i.KeyFingerprint, cryptox.Fingerprint(key)) != 1 {
			_ = b.Close()
			s.state = RecoveryRequired
			return nil
		}
		if err = s.sealInstallation(m.InstallationID); err != nil {
			_ = b.Close()
			s.state = RecoveryRequired
			return nil
		}
		if err = s.bindSandbox(ctx, b, &m); err != nil {
			_ = b.Close()
			return err
		}
		if s.backend != nil {
			_ = s.backend.Close()
		}
		s.installationID = m.InstallationID
		s.cleanupPassword()
		s.backend = b
		s.state = Ready
		return nil
	}
	clean, err := s.freshData()
	if err != nil {
		return err
	}
	if !clean {
		s.state = RecoveryRequired
		return nil
	}
	b, err := s.connect(s.runtime.Database, false)
	if err != nil {
		s.state = Unavailable
		return nil
	}
	defer func() { _ = b.Close() }()
	if err = b.Check(ctx, true); err != nil {
		s.state = Unavailable
		var problem *httpx.Error
		reason := "DATABASE_CHECK_FAILED"
		if errors.As(err, &problem) {
			reason = problem.Code
			if reason == "DATABASE_NOT_EMPTY" {
				s.state = RecoveryRequired
			}
		}
		slog.Warn("installation database preflight failed", "reason", reason)
		return nil
	}
	if _, err = s.installPassword(); errors.Is(err, os.ErrNotExist) {
		var value string
		if s.runtime.Install.Password != nil {
			value = *s.runtime.Install.Password
		} else {
			value = cryptox.Token()
		}
		err = filestore.CreatePrivate(s.path("install-password"), []byte(value+"\n"))
	}
	if err != nil {
		return fmt.Errorf("prepare install-password: %w", err)
	}
	slog.Info("installation password available", "path", s.path("install-password"))
	s.state = SetupRequired
	return nil
}

func (s *Service) freshData() (bool, error) {
	for _, name := range []string{"install.lock", "master.key", "installation.json"} {
		if exists(s.path(name)) {
			return false, nil
		}
	}
	clean := true
	err := filepath.WalkDir(s.runtime.DataDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == s.runtime.DataDir {
			return nil
		}
		rel, _ := filepath.Rel(s.runtime.DataDir, path)
		if rel == "locks" && d.IsDir() {
			return filepath.SkipDir
		}
		if rel == "install-password" && d.Type().IsRegular() {
			return nil
		}
		if !d.IsDir() {
			clean = false
			return fs.SkipAll
		}
		return nil
	})
	return clean, err
}

func (s *Service) sealInstallation(id string) error {
	data, err := filestore.ReadPrivate(s.path("install.lock"), 128)
	if errors.Is(err, os.ErrNotExist) {
		return filestore.CreatePrivate(s.path("install.lock"), []byte(id+"\n"))
	}
	if err != nil || strings.TrimSpace(string(data)) != id {
		return errors.New("installation lock does not match configuration")
	}
	return nil
}

// Called with mu held. Local state is checked again before each setup operation.
func (s *Service) checkSetup() error {
	if s.state != SetupRequired {
		code := "ALREADY_INSTALLED"
		if s.state == Initializing {
			code = "INSTALL_IN_PROGRESS"
		}
		return httpx.E(409, code, "当前状态不允许安装")
	}
	clean, err := s.freshData()
	if err != nil || !clean {
		s.state = RecoveryRequired
		return httpx.E(409, "INSTALLATION_STATE_CHANGED", "检测到已有安装配置，请刷新页面并检查系统状态")
	}
	return nil
}

func (s *Service) Status(ctx context.Context) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == SetupRequired {
		_ = s.checkSetup()
	}
	if (s.state == Unavailable || s.state == Ready) && time.Since(s.lastProbe) > 5*time.Second {
		s.lastProbe = time.Now()
		// The probe changes shared installation state. A caller disconnecting must
		// not classify an otherwise healthy database as unavailable for everyone.
		probeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if s.state == Ready {
			if err := s.backend.Check(probeCtx, false); err != nil {
				s.state = Unavailable
			}
		} else {
			_ = s.load(probeCtx)
		}
	}
	return Status{s.state, s.runtime.Origin()}
}
func (s *Service) Backend() Backend { s.mu.RLock(); defer s.mu.RUnlock(); return s.backend }
func (s *Service) CSRFKey() []byte {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]byte(nil), s.csrfKey...)
}
func (s *Service) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.backend != nil {
		_ = s.backend.Close()
	}
	return s.instanceLock.Close()
}

func (s *Service) installPassword() (string, error) {
	b, err := filestore.ReadPrivate(s.path("install-password"), 4098)
	if err != nil {
		return "", err
	}
	value := strings.TrimSuffix(strings.TrimSuffix(string(b), "\n"), "\r")
	if !config.ValidInstallPassword(value) {
		return "", errors.New("invalid install-password file")
	}
	return value, nil
}
func (s *Service) cleanupPassword() {
	if err := os.Remove(s.path("install-password")); err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.Warn("could not remove install-password file")
	}
}
func (s *Service) databaseTarget() string {
	d := s.runtime.Database
	return hex.EncodeToString(cryptox.Digest(fmt.Sprintf("%s:%d/%s", d.Host, d.Port, d.Name)))
}
func Validate(r *Request) error {
	r.Site.Name = strings.TrimSpace(r.Site.Name)
	r.Founder.DisplayName = strings.TrimSpace(r.Founder.DisplayName)
	if utf8.RuneCountInString(r.Site.Name) > 40 {
		return httpx.Invalid("site.site_name", "invalid_length")
	}
	if _, err := time.LoadLocation(r.Site.Timezone); err != nil || r.Site.Timezone == "" {
		return httpx.Invalid("site.timezone", "invalid_timezone")
	}
	if !usernamePattern.MatchString(r.Founder.Username) {
		return httpx.Invalid("founder.username", "invalid_format")
	}
	if n := utf8.RuneCountInString(r.Founder.DisplayName); n < 1 || n > 30 {
		return httpx.Invalid("founder.display_name", "invalid_length")
	}
	if err := password.Validate(r.Founder.Password); err != nil {
		return httpx.Invalid("founder.password", err.Error())
	}
	return nil
}

func (s *Service) Install(ctx context.Context, r Request) (string, error) {
	if err := Validate(&r); err != nil {
		return "", err
	}
	s.mu.Lock()
	if stateErr := s.checkSetup(); stateErr != nil {
		s.mu.Unlock()
		return "", stateErr
	}
	expected, err := s.installPassword()
	if err != nil {
		s.state = RecoveryRequired
		s.mu.Unlock()
		return "", errors.New("installation password file unavailable")
	}
	if !hmac.Equal(cryptox.Digest(expected), cryptox.Digest(r.InstallPassword)) {
		s.mu.Unlock()
		return "", httpx.E(403, "INSTALL_PASSWORD_INVALID", "安装口令错误")
	}
	s.state = Initializing
	s.mu.Unlock()
	durable := false
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.state == Initializing {
			if durable {
				s.state = RecoveryRequired
			} else {
				s.state = SetupRequired
			}
		}
	}()
	b, err := s.connect(s.runtime.Database, true)
	if err != nil {
		return "", httpx.E(422, "DATABASE_CHECK_FAILED", "数据库配置无效")
	}
	defer func() { _ = b.Close() }()
	unlock, err := b.Lock(ctx)
	if err != nil {
		return "", err
	}
	defer unlock()
	if err = b.Check(ctx, true); err != nil {
		return "", err
	}
	if clean, checkErr := s.freshData(); checkErr != nil || !clean {
		s.mu.Lock()
		s.state = RecoveryRequired
		s.mu.Unlock()
		return "", httpx.E(409, "INSTALLATION_STATE_CHANGED", "检测到已有安装配置，请检查系统状态")
	}
	hash, err := password.Hash(r.Founder.Password)
	if err != nil {
		return "", err
	}
	id := cryptox.ID()
	key := cryptox.Random(32)
	if err = filestore.EnsurePrivateDir(s.path(".install")); err != nil {
		return "", err
	}
	j := checkpoint{s.databaseTarget(), 1, id, "prepared", r.Site, r.Founder.Username, r.Founder.DisplayName}
	durable = true
	if err = writeJSON(s.path(".install/staging.json"), j); err != nil {
		return "", err
	}
	if err = filestore.CreatePrivate(s.path("master.key"), key); err != nil {
		return "", err
	}
	if err = b.Migrate(ctx); err != nil {
		return "", httpx.E(500, "INSTALLATION_INTERRUPTED", "初始化中断，请由部署维护者检查恢复")
	}
	j.Stage = "migrated"
	if err = writeJSON(s.path(".install/staging.json"), j); err != nil {
		return "", err
	}
	if err = b.Seed(ctx, Seed{id, cryptox.Fingerprint(key), r.Site, r.Founder.Username, r.Founder.DisplayName, hash, time.Now().UTC()}); err != nil {
		return "", err
	}
	if err = s.finish(ctx, id, key); err != nil {
		return "", err
	}
	return id, nil
}

func (s *Service) finish(ctx context.Context, id string, key []byte) error {
	b, err := s.connect(s.runtime.Database, false)
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		if !keep {
			_ = b.Close()
		}
	}()
	if err = b.Check(ctx, false); err != nil {
		return err
	}
	if err = b.SchemaReady(ctx); err != nil {
		return err
	}
	instance, err := b.Instance(ctx)
	if err != nil || instance == nil || instance.InstallationID != id || subtle.ConstantTimeCompare(instance.KeyFingerprint, cryptox.Fingerprint(key)) != 1 {
		return errors.New("runtime database identity does not match installation")
	}

	m := marker{Version: 1, InstallationID: id, CompletedAt: time.Now().UTC()}
	if err := writeJSON(s.path("installation.json"), m); err != nil {
		return err
	}
	if err := s.sealInstallation(id); err != nil {
		return err
	}
	s.mu.Lock()
	if err = s.bindSandbox(ctx, b, &m); err != nil {
		s.mu.Unlock()
		return err
	}
	s.installationID = id
	keep = true
	s.backend = b
	s.key = key
	s.csrfKey = cryptox.Derive(key, "csrf")
	s.state = Ready
	s.mu.Unlock()
	s.cleanupPassword()
	_ = os.Remove(s.path(".install/staging.json"))
	return nil
}

// Recover resumes only an empty schema or a fully migrated installation owned by
// the same key/id. Partial DDL is never replayed speculatively.
func (s *Service) Recover(ctx context.Context, newPassword string) error {
	s.mu.RLock()
	state := s.state
	s.mu.RUnlock()
	if state != RecoveryRequired {
		return errors.New("instance does not require recovery")
	}
	var j checkpoint
	if err := readJSON(s.path(".install/staging.json"), &j); err != nil || j.Version != 1 {
		return errors.New("no valid installation checkpoint")
	}
	if j.DatabaseTarget != s.databaseTarget() {
		return errors.New("database target differs from installation checkpoint")
	}
	key, err := filestore.ReadPrivate(s.path("master.key"), 32)
	if err != nil || len(key) != 32 {
		return errors.New("original master key is required")
	}
	b, err := s.connect(s.runtime.Database, true)
	if err != nil {
		return err
	}
	defer func() { _ = b.Close() }()
	unlock, err := b.Lock(ctx)
	if err != nil {
		return err
	}
	defer unlock()
	if err = b.Check(ctx, false); err != nil {
		return err
	}
	if err = b.SchemaReady(ctx); err != nil {
		if !errors.Is(err, ErrIncompleteSchema) || b.Check(ctx, true) != nil {
			return errors.New("migration is incomplete; inspect the schema before recovery")
		}
		if err = b.Migrate(ctx); err != nil {
			return errors.New("migration interrupted; inspect the schema before recovery")
		}
		if err = b.SchemaReady(ctx); err != nil {
			return err
		}
		j.Stage = "migrated"
		if err = writeJSON(s.path(".install/staging.json"), j); err != nil {
			return err
		}
	}
	i, err := b.Instance(ctx)
	if err != nil {
		return err
	}
	if i == nil {
		hash, err := password.Hash(newPassword)
		if err != nil {
			return ErrFounderPasswordRequired
		}
		if err = b.Seed(ctx, Seed{j.InstallationID, cryptox.Fingerprint(key), j.Site, j.Username, j.DisplayName, hash, time.Now().UTC()}); err != nil {
			return err
		}
	} else if i.InstallationID != j.InstallationID || subtle.ConstantTimeCompare(i.KeyFingerprint, cryptox.Fingerprint(key)) != 1 {
		return errors.New("database belongs to a different installation")
	}
	if err = s.finish(ctx, j.InstallationID, key); err != nil {
		return err
	}
	return nil
}
func readJSON(path string, v any) error {
	b, err := filestore.ReadPrivate(path, 65536)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return filestore.AtomicWrite(path, append(b, '\n'))
}

func (s *Service) Migrate(ctx context.Context, username, secret string) error {
	if !exists(s.path("installation.json")) {
		return errors.New("incomplete installations must use setup recover")
	}
	var m marker
	if err := readJSON(s.path("installation.json"), &m); err != nil || m.Version != 1 || len(m.InstallationID) != 32 {
		return errors.New("local installation identity does not match configuration")
	}
	key, err := filestore.ReadPrivate(s.path("master.key"), 32)
	if err != nil {
		return err
	}
	d := s.runtime.Database
	if username != "" || secret != "" {
		if username == "" || secret == "" {
			return errors.New("both migration username and password are required")
		}
		d.Username = username
		d.Password = secret
	}

	b, err := s.connect(d, true)
	if err != nil {
		return err
	}
	defer func() { _ = b.Close() }()
	unlock, err := b.Lock(ctx)
	if err != nil {
		return err
	}
	defer unlock()
	i, err := b.Instance(ctx)
	if err != nil || i == nil || i.InstallationID != m.InstallationID || subtle.ConstantTimeCompare(i.KeyFingerprint, cryptox.Fingerprint(key)) != 1 {
		return errors.New("database identity does not match installation")
	}
	if err = b.Migrate(ctx); err != nil {
		return err
	}
	return b.SchemaReady(ctx)
}

// IntegrationSecret keeps the installation key inside the installation service.
func (s *Service) IntegrationSecret(purpose, value string, seal bool) (string, error) {
	return s.resourceSecret("integrations", purpose, value, seal)
}

// RemoteHostSecret uses an independent derived key for new material. Legacy SSH
// ciphertext can only be opened with its original purpose and derivation.
func (s *Service) RemoteHostSecret(purpose, value string, seal bool) (string, error) {
	namespace := "remote-hosts"
	if strings.HasPrefix(purpose, "service-integrations/ssh/credential/") {
		if seal {
			return "", errors.New("legacy SSH encryption is read-only")
		}
		namespace = "integrations"
	} else if !strings.HasPrefix(purpose, "remote-hosts/ssh/credential/") {
		return "", errors.New("invalid remote host purpose")
	}
	return s.resourceSecret(namespace, purpose, value, seal)
}
func (s *Service) resourceSecret(namespace, purpose, value string, seal bool) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state != Ready || len(s.key) != 32 {
		return "", errors.New("installation is not ready")
	}
	key := cryptox.Derive(s.key, namespace)
	if seal {
		return cryptox.Encrypt(key, s.installationID, purpose, value)
	}
	return cryptox.Decrypt(key, s.installationID, purpose, value)
}

// IntegrationETag derives opaque scoped versions without exposing cross-owner counters.
func (s *Service) IntegrationETag(value string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mac := hmac.New(sha256.New, cryptox.Derive(s.key, "service-integrations-etags"))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

// RemoteHostETag isolates host edit versions from service-integration versions.
func (s *Service) RemoteHostETag(value string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mac := hmac.New(sha256.New, cryptox.Derive(s.key, "remote-host-etags"))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

// EmailSecret isolates this module's encrypted authentication material.
func (s *Service) EmailSecret(purpose, value string, seal bool) (string, error) {
	if !strings.HasPrefix(purpose, "email/") {
		return "", errors.New("invalid secret purpose")
	}
	return s.resourceSecret("email", purpose, value, seal)
}
func (s *Service) EmailETag(value string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mac := hmac.New(sha256.New, cryptox.Derive(s.key, "email-etags"))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

// SMSSecret isolates this module's encrypted authentication material.
func (s *Service) SMSSecret(purpose, value string, seal bool) (string, error) {
	if !strings.HasPrefix(purpose, "sms/") {
		return "", errors.New("invalid secret purpose")
	}
	return s.resourceSecret("sms", purpose, value, seal)
}
func (s *Service) SMSETag(value string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mac := hmac.New(sha256.New, cryptox.Derive(s.key, "sms-etags"))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

// DingTalkSecret isolates this module's encrypted authentication material.
func (s *Service) DingTalkSecret(purpose, value string, seal bool) (string, error) {
	if !strings.HasPrefix(purpose, "dingtalk/") {
		return "", errors.New("invalid secret purpose")
	}
	return s.resourceSecret("dingtalk", purpose, value, seal)
}
func (s *Service) DingTalkETag(value string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mac := hmac.New(sha256.New, cryptox.Derive(s.key, "dingtalk-etags"))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}
