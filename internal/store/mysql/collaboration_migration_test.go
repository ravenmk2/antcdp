package mysql

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/pressly/goose/v3"
	"github.com/ravenmk2/antcdp/internal/platform/config"
	"github.com/ravenmk2/antcdp/internal/store/migrations"
)

// Uses a distinct empty schema and preserves it for inspection. In particular,
// this tests the real goose 1 -> 2 upgrade, not importing the reference DDL.
func TestCollaborationMigrationUpgrade(t *testing.T) {
	dsn := os.Getenv("ANTCDP_TEST_UPGRADE_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set ANTCDP_TEST_UPGRADE_MYSQL_DSN to an empty antcdp_test_ schema")
	}
	cfg, err := driver.ParseDSN(dsn)
	if err != nil || cfg == nil || cfg.Net != "tcp" || !strings.HasPrefix(cfg.DBName, "antcdp_test_") {
		t.Fatal("upgrade test requires a dedicated TCP test schema")
	}
	host, port, err := splitTestAddress(cfg.Addr)
	if err != nil {
		t.Fatal(err)
	}
	backend, err := Open(config.Database{Host: host, Port: port, Name: cfg.DBName, Username: cfg.User, Password: cfg.Passwd, TLSMode: "disabled"}, true)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	s := backend.(*Store)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err = s.Check(ctx, true); err != nil {
		t.Fatal("requires empty schema", err)
	}
	p, err := goose.NewProvider(goose.DialectMySQL, s.db.DB, migrations.FS, goose.WithDisableGlobalRegistry(true), goose.WithLogger(discardGooseLogger{}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.UpTo(ctx, 1); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		"INSERT INTO `user` (id,username,display_name,role,status,created_at,updated_at) VALUES (41,'owner','原有管理员','admin','active',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),(42,'disabled','已禁用','user','disabled',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),(43,'deleted','已删除','user','disabled',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
		"UPDATE `user` SET deleted_at=UTC_TIMESTAMP(3) WHERE id=43",
	} {
		if _, err = s.db.ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	if err = s.SchemaReady(ctx); err == nil {
		t.Fatal("old schema must not pass current executable readiness")
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.SchemaReady(ctx); err != nil {
		t.Fatal(err)
	}
	var ids []uint64
	if err = s.db.SelectContext(ctx, &ids, "SELECT user_id FROM user_sidebar_preference ORDER BY user_id"); err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != 41 || ids[1] != 42 {
		t.Fatalf("wrong backfill: %v", ids)
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal("repeat migration", err)
	}
	var count int
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM user_sidebar_preference"); err != nil || count != 2 {
		t.Fatal("migration duplicated preferences", err)
	}
	insertProject := "INSERT INTO project(code,name,description,created_by_user_id,created_at,updated_at) VALUES (?,?,'',41,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"
	if _, err = s.db.ExecContext(ctx, insertProject, "AntCDP_Web", "Cafe"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.ExecContext(ctx, insertProject, "antcdp_web", "Another"); err == nil {
		t.Fatal("case-insensitive code uniqueness not enforced")
	}
	if _, err = s.db.ExecContext(ctx, insertProject, "Other", "CAFE"); err == nil {
		t.Fatal("case-insensitive name uniqueness not enforced")
	}
	if _, err = s.db.ExecContext(ctx, insertProject, "Accented", "Café"); err != nil {
		t.Fatal("accent-sensitive names", err)
	}
	var projectID uint64
	if err = s.db.GetContext(ctx, &projectID, "SELECT id FROM project WHERE code='antcdp_web'"); err != nil {
		t.Fatal(err)
	}
	var code string
	if err = s.db.GetContext(ctx, &code, "SELECT code FROM project WHERE id=?", projectID); err != nil || code != "AntCDP_Web" {
		t.Fatal("original case not preserved", err)
	}
	if _, err = s.db.ExecContext(ctx, "INSERT INTO user_project_shortcut(user_id,project_id,sort_order,created_at) VALUES (41,?,1,UTC_TIMESTAMP(3))", projectID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.ExecContext(ctx, "INSERT INTO user_project_shortcut(user_id,project_id,sort_order,created_at) VALUES (41,?,2,UTC_TIMESTAMP(3))", projectID); err == nil {
		t.Fatal("duplicate pin accepted")
	}
	if _, err = s.db.ExecContext(ctx, "UPDATE user_project_shortcut SET sort_order=0 WHERE user_id=41"); err == nil {
		t.Fatal("zero position accepted")
	}
	if _, err = s.db.ExecContext(ctx, "DELETE FROM user_sidebar_preference WHERE user_id=41"); err == nil {
		t.Fatal("preference FK failed")
	}
	if _, err = s.db.ExecContext(ctx, "UPDATE project SET icon_key='box',icon_file_id=1 WHERE id=?", projectID); err == nil {
		t.Fatal("invalid icon reference accepted")
	}
	if _, err = s.db.ExecContext(ctx, "UPDATE user_sidebar_preference SET project_version=0 WHERE user_id=41"); err == nil {
		t.Fatal("zero version accepted")
	}
	if _, err = s.db.ExecContext(ctx, "UPDATE user_sidebar_preference SET project_version=project_version+1 WHERE user_id=41 AND project_version=1"); err != nil {
		t.Fatal(err)
	}
	r, err := s.db.ExecContext(ctx, "UPDATE user_sidebar_preference SET project_version=project_version+1 WHERE user_id=41 AND project_version=1")
	if err != nil {
		t.Fatal(err)
	}
	n, err := r.RowsAffected()
	if err != nil || n != 0 {
		t.Fatal("stale preference version accepted", err)
	}
	var teamVersion uint64
	if err = s.db.GetContext(ctx, &teamVersion, "SELECT team_version FROM user_sidebar_preference WHERE user_id=41"); err != nil || teamVersion != 1 {
		t.Fatal("project change affected team version", err)
	}
}
