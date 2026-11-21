package config

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	"github.com/pelletier/go-toml/v2"
)

type Server struct {
	Listen         string   `toml:"listen"`
	PublicURL      string   `toml:"public_url"`
	TrustedProxies []string `toml:"trusted_proxies"`
}
type Database struct {
	Host     string `toml:"host" json:"host"`
	Port     int    `toml:"port" json:"port"`
	Name     string `toml:"name" json:"name"`
	Username string `toml:"username" json:"username"`
	Password string `toml:"password" json:"password"`
	TLSMode  string `toml:"tls_mode" json:"tls_mode"`
	CAFile   string `toml:"ca_file" json:"-"`
}
type Sandbox struct {
	Type             string `toml:"type"`
	Endpoint         string `toml:"endpoint"`
	APIKey           string `toml:"api_key"`
	AccessMode       string `toml:"access_mode"`
	ConnectTimeout   int    `toml:"connect_timeout_seconds"`
	OperationTimeout int    `toml:"operation_timeout_seconds"`
}

func (s Sandbox) TargetFingerprint() string {
	digest := sha256.Sum256([]byte(s.Type + "\x00" + s.Endpoint))
	return hex.EncodeToString(digest[:])
}

type Runtime struct {
	DataDir  string   `toml:"-"`
	Server   Server   `toml:"server"`
	Database Database `toml:"database"`
	Sandbox  *Sandbox `toml:"sandbox"`
	Install  struct {
		Password *string `toml:"password"`
	} `toml:"install"`
}
type Overrides struct{ ConfigDir, DataDir, Listen, PublicURL string }

func ResolveDataDir(value string) (string, error) {
	if value == "" {
		value = os.Getenv("ANTCDP_DATA_DIR")
	}
	if value == "" {
		value = "data"
	}
	path, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	if filepath.Dir(path) == path {
		return "", errors.New("data directory cannot be a filesystem root")
	}
	return filepath.Clean(path), nil
}

func Load(o Overrides) (Runtime, error) {
	var r Runtime
	dir, err := ResolveDataDir(o.DataDir)
	if err != nil {
		return r, err
	}
	r.DataDir = dir
	conf := o.ConfigDir
	if conf == "" {
		conf = os.Getenv("ANTCDP_CONFIG_DIR")
	}
	if conf == "" {
		conf = "conf"
	}
	conf, err = filepath.Abs(conf)
	if err != nil {
		return r, err
	}
	if filepath.Clean(conf) == dir {
		return r, errors.New("configuration and data directories must be separate")
	}
	path := filepath.Join(conf, "config.toml")
	f, err := os.Open(path)
	if err != nil {
		return r, err
	}
	defer func() { _ = f.Close() }()
	b, err := io.ReadAll(io.LimitReader(f, 65537))
	if err != nil {
		return r, err
	}
	if len(b) > 65536 {
		return r, errors.New("config.toml exceeds size limit")
	}
	r.Server = Server{Listen: "0.0.0.0:8080", PublicURL: "http://localhost:8080"}
	if err = toml.NewDecoder(bytes.NewReader(b)).DisallowUnknownFields().Decode(&r); err != nil {
		var unknown *toml.StrictMissingError
		if errors.As(err, &unknown) && len(unknown.Errors) > 0 {
			return r, fmt.Errorf("%s: unknown field %s", path, strings.Join(unknown.Errors[0].Key(), "."))
		}
		var syntax *toml.DecodeError
		if errors.As(err, &syntax) {
			line, column := syntax.Position()
			return r, fmt.Errorf("%s:%d:%d: invalid TOML", path, line, column)
		}
		return r, fmt.Errorf("%s: invalid configuration value", path)
	}
	if v, ok := os.LookupEnv("ANTCDP_LISTEN"); ok {
		r.Server.Listen = v
	}
	if v, ok := os.LookupEnv("ANTCDP_PUBLIC_URL"); ok {
		r.Server.PublicURL = v
	}
	if v, ok := os.LookupEnv("ANTCDP_TRUSTED_PROXIES"); ok {
		r.Server.TrustedProxies = nil
		if v != "" {
			for _, prefix := range strings.Split(v, ",") {
				r.Server.TrustedProxies = append(r.Server.TrustedProxies, strings.TrimSpace(prefix))
			}
		}
	}
	if o.Listen != "" {
		r.Server.Listen = o.Listen
	}
	if o.PublicURL != "" {
		r.Server.PublicURL = o.PublicURL
	}
	if v, ok := os.LookupEnv("ANTCDP_DATABASE_CA_FILE"); ok {
		r.Database.CAFile = v
	}
	if r.Database.CAFile != "" && !filepath.IsAbs(r.Database.CAFile) {
		r.Database.CAFile = filepath.Join(conf, r.Database.CAFile)
	}
	if err = ValidateServer(r.Server); err != nil {
		return r, err
	}
	if err = r.Database.Validate(); err != nil {
		return r, err
	}
	if r.Install.Password != nil && !ValidInstallPassword(*r.Install.Password) {
		return r, errors.New("invalid install.password")
	}
	if r.Sandbox != nil {
		err = r.Sandbox.validate()
	}
	return r, err
}
func ValidInstallPassword(p string) bool {
	return len(p) > 0 && len(p) <= 4096 && !strings.ContainsAny(p, "\r\n\x00")
}
func (s *Sandbox) validate() error {
	if s.Type != "opensandbox" {
		return errors.New("sandbox.type must be opensandbox")
	}
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(s.Endpoint), "/"))
	if len(s.Endpoint) > 2048 || err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.ContainsAny(s.Endpoint, "\\\r\n\x00") {
		return errors.New("invalid sandbox.endpoint")
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return errors.New("invalid sandbox.endpoint port")
		}
		port = strconv.Itoa(n)
	}
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	u.Host = host
	s.Endpoint = u.String()
	if strings.TrimSpace(s.APIKey) == "" || strings.IndexFunc(s.APIKey, unicode.IsControl) >= 0 {
		return errors.New("sandbox.api_key is required")
	}
	if s.AccessMode == "" {
		s.AccessMode = "direct"
	}
	if s.AccessMode != "direct" && s.AccessMode != "server_proxy" {
		return errors.New("invalid sandbox.access_mode")
	}
	if s.ConnectTimeout == 0 {
		s.ConnectTimeout = 10
	}
	if s.OperationTimeout == 0 {
		s.OperationTimeout = 300
	}
	if s.ConnectTimeout < 1 || s.ConnectTimeout > 30 || s.OperationTimeout < 10 || s.OperationTimeout > 600 {
		return errors.New("invalid sandbox timeout")
	}
	return nil
}

func ValidateServer(s Server) error {
	if _, _, err := net.SplitHostPort(s.Listen); err != nil {
		return errors.New("invalid listen address")
	}
	u, err := url.Parse(s.PublicURL)
	if err != nil || u.Host == "" || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || (u.Path != "" && u.Path != "/") {
		return errors.New("public URL must be an absolute HTTP(S) origin")
	}
	for _, p := range s.TrustedProxies {
		if _, err := netip.ParsePrefix(p); err != nil {
			if _, err := netip.ParseAddr(p); err != nil {
				return errors.New("invalid trusted proxy address")
			}
		}
	}
	return nil
}
func (r Runtime) SecureCookies() bool { return strings.HasPrefix(r.Server.PublicURL, "https://") }
func (r Runtime) Origin() string      { return strings.TrimSuffix(r.Server.PublicURL, "/") }
func (d Database) Validate() error {
	if d.Host == "" || len(d.Host) > 253 || d.Port < 1 || d.Port > 65535 || d.Name == "" || len(d.Name) > 64 || d.Username == "" || len(d.Username) > 64 || len(d.Password) > 4096 {
		return errors.New("invalid database connection fields")
	}
	if strings.ContainsAny(d.Host, "/\\\x00") || strings.ContainsRune(d.Name, 0) {
		return errors.New("invalid database host or name")
	}
	if d.TLSMode != "disabled" && d.TLSMode != "verify_identity" {
		return fmt.Errorf("unsupported database TLS mode")
	}
	return nil
}
