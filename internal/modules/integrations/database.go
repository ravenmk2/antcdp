package integrations

import (
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func isDatabase(kind string) bool { return kind == "mysql" || kind == "postgresql" }

func databaseAdapter(kind, name string) adapter {
	return adapter{name: name, method: kind + "_password", identity: databaseIdentity,
		decodeConfig: func(version uint64, raw json.RawMessage) (*HTTPConfig, error) {
			return decodeTypedConfig(kind, version, raw)
		},
		probe: func(ctx context.Context, cfg *HTTPConfig, username, secret string, started time.Time) Diagnostic {
			return probeDatabase(ctx, cfg, kind, username, secret, started)
		}, webhookMethods: []string{}}
}

func databaseIdentity(raw json.RawMessage) error {
	// Keep the established identity contract, including its control-character restrictions.
	return jenkinsIdentity(raw)
}

func validateLegacyDatabaseConfig(kind string, cfg *HTTPConfig) error {
	u, err := url.Parse(cfg.BaseURL)
	if err != nil || len(cfg.BaseURL) > 2048 || u.Scheme != kind || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" || strings.ContainsAny(cfg.BaseURL, "\\\r\n\x00") || strings.TrimSpace(cfg.BaseURL) != cfg.BaseURL {
		return httpx.Invalid("base_url", "database_url_required")
	}
	// Require a single explicit database; no DSN options, sockets or multiple hosts.
	database := strings.TrimPrefix(u.Path, "/")
	if database == "" || len(database) > 255 || strings.Contains(database, "/") || strings.ContainsFunc(database, unicode.IsControl) || strings.ContainsAny(u.Hostname(), ", %") || strings.HasSuffix(u.Host, ":") {
		return httpx.Invalid("base_url", "database_url_required")
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return httpx.Invalid("base_url", "invalid_port")
		}
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !allowedIP(ip) {
		return httpx.Invalid("base_url", "address_not_allowed")
	}
	if cfg.TLSMode != "verify-full" && cfg.TLSMode != "disable" {
		return httpx.Invalid("tls_mode", "invalid_format")
	}
	// Reuse CA validation without applying HTTP URL rules to a database URL.
	return ValidateConfig("https://database.example.com", cfg.CA)
}

func defaultDatabasePort(kind string) int {
	if kind == "mysql" {
		return 3306
	}
	return 5432
}

func applyDatabaseFields(kind string, cfg *HTTPConfig, host Field[string], port Field[int], database Field[string]) error {
	if !host.Set && !port.Set && !database.Set {
		return nil
	}
	if !isDatabase(kind) {
		return httpx.Invalid("config", "unsupported")
	}
	if port.Set && (port.Value < 1 || port.Value > 65535) {
		return httpx.Invalid("port", "invalid_format")
	}
	if host.Null || port.Null || database.Null {
		return httpx.Invalid("config", "invalid_format")
	}
	if host.Set {
		cfg.Host = host.Value
	}
	if port.Set {
		cfg.Port = port.Value
	}
	if database.Set {
		cfg.Database = database.Value
	}
	return nil
}

func validateDatabaseConfig(kind string, cfg *HTTPConfig) error {
	// Read existing URL records without changing their TLS choice. The next save writes structured fields.
	if cfg.BaseURL != "" {
		if cfg.Host != "" || cfg.Port != 0 || cfg.Database != "" {
			return httpx.Invalid("config", "mixed_database_fields")
		}
		if err := validateLegacyDatabaseConfig(kind, cfg); err != nil {
			return err
		}
		u, _ := url.Parse(cfg.BaseURL)
		cfg.Host, cfg.Database = u.Hostname(), strings.TrimPrefix(u.Path, "/")
		cfg.Port = defaultDatabasePort(kind)
		if u.Port() != "" {
			cfg.Port, _ = strconv.Atoi(u.Port())
		}
		cfg.BaseURL = ""
	}
	if cfg.Host == "" || len(cfg.Host) > 253 || strings.TrimSpace(cfg.Host) != cfg.Host || strings.ContainsAny(cfg.Host, "/\\@?#, %[]") || strings.ContainsFunc(cfg.Host, unicode.IsControl) {
		return httpx.Invalid("host", "invalid_format")
	}
	if ip, err := netip.ParseAddr(cfg.Host); err == nil {
		if !allowedIP(ip) {
			return httpx.Invalid("host", "address_not_allowed")
		}
	} else if strings.Contains(cfg.Host, ":") {
		return httpx.Invalid("host", "invalid_format")
	}
	if cfg.Port == 0 {
		cfg.Port = defaultDatabasePort(kind)
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return httpx.Invalid("port", "invalid_format")
	}
	if cfg.Database == "" || len(cfg.Database) > 255 || strings.ContainsAny(cfg.Database, "/\\") || strings.ContainsFunc(cfg.Database, unicode.IsControl) {
		return httpx.Invalid("database", "invalid_format")
	}
	if cfg.TLSMode != "disable" && cfg.TLSMode != "verify-full" {
		return httpx.Invalid("tls_mode", "invalid_format")
	}
	return ValidateConfig("https://database.example.com", cfg.CA)
}

func databaseEndpoint(_ string, cfg *HTTPConfig) (host, address, database string) {
	return cfg.Host, net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)), cfg.Database
}

func databaseTLS(cfg *HTTPConfig, host string) *tls.Config {
	if cfg.TLSMode == "disable" {
		return nil
	}
	tr := transport(cfg)
	t := tr.TLSClientConfig
	t.ServerName = host
	return t
}

// Connection checks deliberately perform TCP reachability only, without a login or SQL.
// Credential verification uses native drivers and a constant read-only SELECT 1.
func probeDatabase(ctx context.Context, cfg *HTTPConfig, kind, username, secret string, started time.Time) (d Diagnostic) {
	diagnosticKind := "connection_check"
	if username != "" {
		diagnosticKind = "credential_verification"
	}
	d = newDiagnostic(diagnosticKind, started)
	d.Status = "failed"
	d.Summary = map[string]any{"reachability": "unreachable", "service": "unknown", "reason": "connection_failed"}
	if username != "" {
		d.Summary["authentication"] = "unknown"
		d.Summary["permissions"] = "unknown"
	}
	defer func() { d.FinishedAt = time.Now().UTC().Truncate(time.Millisecond) }()
	if validateTypedConfig(kind, cfg) != nil {
		return d
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	host, address, database := databaseEndpoint(kind, cfg)
	// The existing restricted dialer resolves, validates every address, and dials the
	// validated IP directly. Private networks remain supported without DNS rebinding.
	tr := transport(cfg)
	defer tr.CloseIdleConnections()
	var reachable atomic.Bool
	defer func() {
		if reachable.Load() {
			d.Summary["reachability"] = "reachable"
		}
	}()
	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		conn, err := tr.DialContext(ctx, network, addr)
		if err == nil {
			reachable.Store(true)
		}
		return conn, err
	}
	var err error
	if username == "" {
		var conn net.Conn
		conn, err = dial(ctx, "tcp", address)
		if err == nil {
			_ = conn.Close()
			d.Summary["transport"] = "tcp"
		}
	} else if kind == "mysql" {
		err = verifyMySQL(ctx, cfg, host, address, database, username, secret, dial)
	} else {
		err = verifyPostgreSQL(ctx, cfg, host, address, database, username, secret, dial)
	}
	if err != nil {
		d.Summary["reason"] = databaseReason(err)
		if d.Summary["reason"] == "authentication_failed" {
			d.Summary["authentication"] = "invalid"
		}
		return d
	}
	d.Status = "succeeded"
	delete(d.Summary, "reason")
	if username != "" {
		d.Summary["service"] = kind
		d.Summary["authentication"] = "valid"
		d.Summary["database_access"] = "allowed"
	}
	return d
}

type databaseDial func(context.Context, string, string) (net.Conn, error)

func verifyMySQL(ctx context.Context, cfg *HTTPConfig, host, address, database, username, secret string, dial databaseDial) error {
	c := mysql.NewConfig()
	c.User, c.Passwd, c.Net, c.Addr, c.DBName = username, secret, "tcp", address, database
	c.TLS = databaseTLS(cfg, host)
	c.DialFunc = dial
	c.Timeout, c.ReadTimeout, c.WriteTimeout = 5*time.Second, 5*time.Second, 5*time.Second
	c.MaxAllowedPacket = 1 << 20
	c.Logger = log.New(io.Discard, "", 0)
	connector, err := mysql.NewConnector(c)
	if err != nil {
		return err
	}
	db := sql.OpenDB(connector)
	defer func() { _ = db.Close() }()
	db.SetMaxOpenConns(1)
	var one int
	if err := db.QueryRowContext(ctx, "SELECT 1").Scan(&one); err != nil {
		return err
	}
	if one != 1 {
		return errors.New("invalid database response")
	}
	return nil
}

func verifyPostgreSQL(ctx context.Context, cfg *HTTPConfig, host, address, database, username, secret string, dial databaseDial) error {
	// Parse only a fixed seed to initialize driver internals. No user DSN or local
	// password/service files are accepted, and environment runtime options are cleared.
	if os.Getenv("PGSERVICE") != "" {
		return errors.New("PGSERVICE is not supported for integration verification")
	}
	c, err := pgconn.ParseConfig("host=database.example.com port=5432 user=probe password=placeholder dbname=probe sslmode=disable connect_timeout=10 target_session_attrs=any min_protocol_version=3.0 max_protocol_version=3.0 sslnegotiation=postgres require_auth=password,md5,scram-sha-256 channel_binding=prefer")
	if err != nil {
		return err
	}
	_, port, _ := net.SplitHostPort(address)
	n, _ := strconv.ParseUint(port, 10, 16)
	c.Host, c.Port, c.Database, c.User, c.Password = host, uint16(n), database, username, secret
	c.TLSConfig, c.Fallbacks = databaseTLS(cfg, host), nil
	c.RuntimeParams = map[string]string{}
	c.MaxProtocolMessageBodyLen = 1 << 20
	c.DialFunc = pgconn.DialFunc(dial)
	// Resolve only inside the restricted dialer, preserving the TLS server name.
	c.LookupFunc = func(_ context.Context, host string) ([]string, error) { return []string{host}, nil }
	conn, err := pgconn.ConnectConfig(ctx, c)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(ctx) }()
	results, err := conn.Exec(ctx, "SELECT 1").ReadAll()
	if err != nil {
		return err
	}
	if len(results) != 1 || len(results[0].Rows) != 1 || len(results[0].Rows[0]) != 1 || string(results[0].Rows[0][0]) != "1" {
		return errors.New("invalid database response")
	}
	return nil
}

func databaseReason(err error) string {
	var my *mysql.MySQLError
	var pg *pgconn.PgError
	if errors.As(err, &my) {
		switch my.Number {
		case 1045, 1698:
			return "authentication_failed"
		case 1044:
			return "access_denied"
		case 1049:
			return "database_not_found"
		}
	}
	if errors.As(err, &pg) {
		switch pg.Code {
		case "28P01", "28000":
			return "authentication_failed"
		case "42501":
			return "access_denied"
		case "3D000":
			return "database_not_found"
		}
	}
	return observabilityNetworkReason(err)
}
