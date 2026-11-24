package mysql

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/platform/config"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// Uses a dedicated empty schema; leaves it intact for inspection.
func TestInitialMigration(t *testing.T) {
	dsn := os.Getenv("ANTCDP_TEST_SCHEMA_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set ANTCDP_TEST_SCHEMA_MYSQL_DSN to an empty antcdp_test_ schema")
	}
	cfg, err := driver.ParseDSN(dsn)
	if err != nil || cfg == nil || cfg.Net != "tcp" || !strings.HasPrefix(cfg.DBName, "antcdp_test_") {
		t.Fatal("schema test requires a dedicated TCP test schema")
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
	p, err := s.migrationProvider()
	if err != nil {
		t.Fatal(err)
	}
	sources := p.ListSources()
	const baselineMigrations = 16
	if len(sources) < baselineMigrations {
		t.Fatal("missing baseline migrations", len(sources))
	}
	for i, source := range sources[:baselineMigrations] {
		if source.Version != int64(i+1) {
			t.Fatal("unexpected baseline version order", i, source)
		}
	}
	target := sources[len(sources)-1].Version
	if !t.Run("version_one_transition", func(t *testing.T) {
		if _, err := p.UpTo(ctx, 1); err != nil {
			t.Fatal("applying the platform migration", err)
		}
		if err := s.SchemaReady(ctx); err == nil {
			t.Fatal("platform-only schema was marked ready")
		}
		// A project table with only version 1 recorded identifies a pre-split layout.
		if _, err := s.db.ExecContext(ctx, "CREATE TABLE `project` (`id` BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB"); err != nil {
			t.Fatal(err)
		}
		if err := s.SchemaReady(ctx); !errors.Is(err, errVersionOneLayout) {
			t.Fatal("legacy V1 layout was not identified during startup", err)
		}
		if err := s.Migrate(ctx); !errors.Is(err, errVersionOneLayout) {
			t.Fatal("legacy V1 layout was not rejected before migration", err)
		}
		var version int64
		if err := s.db.GetContext(ctx, &version, "SELECT MAX(version_id) FROM goose_db_version WHERE is_applied=1"); err != nil || version != 1 {
			t.Fatal("rejected migration changed version history", version, err)
		}
		var pendingTables int
		if err := s.db.GetContext(ctx, &pendingTables, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('state_store','state_entry')"); err != nil || pendingTables != 0 {
			t.Fatal("rejected migration executed later DDL", pendingTables, err)
		}
		if _, err := s.db.ExecContext(ctx, "DROP TABLE `project`"); err != nil {
			t.Fatal(err)
		}
	}) {
		return
	}
	if !t.Run("pre_event_transition", func(t *testing.T) {
		if _, err := p.UpTo(ctx, 10); err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.ExecContext(ctx, "CREATE TABLE `agent` (`id` BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB"); err != nil {
			t.Fatal(err)
		}
		if err := s.Migrate(ctx); !errors.Is(err, errPreEventsLayout) {
			t.Fatal("old baseline was not rejected before reordered migrations", err)
		}
		var version int64
		if err := s.db.GetContext(ctx, &version, "SELECT MAX(version_id) FROM goose_db_version WHERE is_applied=1"); err != nil || version != 10 {
			t.Fatal("rejection changed migration history", version, err)
		}
		var count int
		if err := s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='event_record'"); err != nil || count != 0 {
			t.Fatal("rejection executed event DDL", count, err)
		}
		if _, err := s.db.ExecContext(ctx, "DROP TABLE `agent`"); err != nil {
			t.Fatal(err)
		}
	}) {
		return
	}
	if _, err = p.UpTo(ctx, baselineMigrations); err != nil {
		t.Fatal("applying the baseline before the chat type migration", err)
	}
	for _, query := range []string{
		`INSERT INTO agent (code,name,agent_type,executor_kind,use_policy,robot_user_id,scope_kind,system_prompt,runtime_policy,created_by_user_id,created_at,updated_at)
		  VALUES ('chat','Chat','interactive','chat_user','scope',NULL,'platform','',JSON_OBJECT(),1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		         ('service','Service','service','robot','scope',2,'platform','',JSON_OBJECT(),1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		`INSERT INTO agent_session (agent_id,agent_type,executor_kind,chat_user_id,session_kind,run_as_user_id,title,selected_model_binding_id,selected_thinking_option_key,created_by_actor_kind,created_by_actor_id,created_at,updated_at,last_activity_at)
		  SELECT id,agent_type,executor_kind,IF(agent_type='interactive',1,NULL),'root',COALESCE(robot_user_id,1),name,1,'fixed','user','1',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM agent`,
		`INSERT INTO agent_file (purpose,content_domain,storage_key,writer_token,state,integrity_state,media_type,created_at,updated_at)
		  VALUES ('user_attachment','interactive','test-file','test-writer','bound','verified','text/plain',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		`INSERT INTO agent_operation (command_receipt_id,kind,subject_kind,content_domain,status,config_snapshot,actor_user_id,created_at,deadline_at,updated_at)
		  VALUES (1,'session_compaction','session','interactive','completed',JSON_OBJECT(),1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		`INSERT INTO agent_command_receipt (actor_kind,actor_id,scope_kind,scope_id,command_kind,idempotency_key,request_hash,status,result,created_at)
		  VALUES ('user','1','session','1','session.configure','configuration',UNHEX(REPEAT('ab',32)),'completed','{"data":{"agent_type":"interactive","title":"interactive"}}',UTC_TIMESTAMP(3)),
		         ('user','1','sessions','','session.create','create',UNHEX(REPEAT('cd',32)),'completed','{"data":{"configuration":{"agent_type":"interactive"}}}',UTC_TIMESTAMP(3))`,
	} {
		if _, err = s.db.ExecContext(ctx, query); err != nil {
			t.Fatal("seeding legacy chat data", err)
		}
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		"SELECT GROUP_CONCAT(agent_type ORDER BY id) FROM agent",
		"SELECT GROUP_CONCAT(agent_type ORDER BY id) FROM agent_session",
		"SELECT content_domain FROM agent_file",
		"SELECT content_domain FROM agent_operation",
		"SELECT CONCAT(result->>'$.data.agent_type', ',', result->>'$.data.title', ',', HEX(request_hash)) FROM agent_command_receipt WHERE idempotency_key='configuration'",
		"SELECT result->>'$.data.configuration.agent_type' FROM agent_command_receipt WHERE idempotency_key='create'",
	} {
		var got string
		if err = s.db.GetContext(ctx, &got, query); err != nil {
			t.Fatal("reading migrated chat data", err)
		}
		want := "chat"
		switch {
		case strings.Contains(query, "GROUP_CONCAT"):
			want = "chat,service"
		case strings.Contains(query, "request_hash"):
			want = "chat,interactive," + strings.Repeat("AB", 32)
		}
		if got != want {
			t.Fatalf("%s: got %q, want %q", query, got, want)
		}
	}
	var noGreeting int
	if err = s.db.GetContext(ctx, &noGreeting, "SELECT COUNT(*) FROM agent WHERE greeting=''"); err != nil || noGreeting != 2 {
		t.Fatal("expected an empty greeting for definitions created without one", noGreeting, err)
	}
	expectedVersions := make([]int64, len(sources))
	for i, source := range sources {
		expectedVersions[i] = source.Version
	}
	const selectVersions = "SELECT version_id FROM goose_db_version WHERE is_applied=1 AND version_id>0 ORDER BY id"
	var versions []int64
	if err = s.db.SelectContext(ctx, &versions, selectVersions); err != nil || !slices.Equal(versions, expectedVersions) {
		t.Fatal("unexpected baseline migration history", versions, err)
	}
	var tables int
	if err = s.db.GetContext(ctx, &tables, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"); err != nil || tables != 106 {
		t.Fatal("expected baseline tables and goose history", tables, err)
	}
	t.Run("state store", func(t *testing.T) { stateStoreIntegration(t, ctx, s) })
	if _, err = s.db.ExecContext(ctx, "ALTER TABLE service_connection_grant DROP INDEX idx_service_connection_grant_subject"); err != nil {
		t.Fatal(err)
	}
	if err = s.SchemaReady(ctx); !errors.Is(err, install.ErrIncompleteSchema) {
		t.Fatal("missing connection grant lookup index was accepted", err)
	}
	if _, err = s.db.ExecContext(ctx, "ALTER TABLE service_connection_grant ADD KEY idx_service_connection_grant_subject (subject_kind,subject_id,enabled,connection_id)"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.ExecContext(ctx, "ALTER TABLE `state_store` DROP INDEX `uq_state_store_namespace_name`"); err != nil {
		t.Fatal(err)
	}
	if err = s.SchemaReady(ctx); !errors.Is(err, install.ErrIncompleteSchema) {
		t.Fatal("missing state store uniqueness was accepted", err)
	}
	if _, err = s.db.ExecContext(ctx, "ALTER TABLE `state_store` ADD UNIQUE KEY `uq_state_store_namespace_name` (`namespace`,`name`)"); err != nil {
		t.Fatal(err)
	}
	var constraints int
	if err = s.db.GetContext(ctx, &constraints, "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_TYPE IN ('FOREIGN KEY','CHECK')"); err != nil || constraints != 0 {
		t.Fatal("unexpected physical constraints", err)
	}
	if _, err = s.db.ExecContext(ctx, "INSERT INTO user_sidebar_preference(user_id,updated_at) VALUES (41,UTC_TIMESTAMP(3))"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM web_access_setting WHERE id=1 AND JSON_LENGTH(search_routes)=0 AND search_max_results=5 AND JSON_LENGTH(fetch_routes)=0 AND fetch_max_bytes=2097152 AND fetch_timeout_seconds=20 AND fetch_max_redirects=3 AND JSON_LENGTH(fetch_allowed_internal_hosts)=0 AND row_version=1 AND updated_by_user_id IS NULL"); err != nil || count != 1 {
		t.Fatal("missing initial web access settings", count, err)
	}
	if _, err = s.db.ExecContext(ctx, "UPDATE web_access_setting SET search_max_results=7,row_version=2 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal("repeated migration", err)
	}
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM web_access_setting WHERE id=1 AND search_max_results=7 AND row_version=2"); err != nil || count != 1 {
		t.Fatal("repeated migration changed web access settings", count, err)
	}
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM user_sidebar_preference"); err != nil || count != 1 {
		t.Fatal("repeated migration changed data", err)
	}
	if err = s.db.SelectContext(ctx, &versions, selectVersions); err != nil || !slices.Equal(versions, expectedVersions) {
		t.Fatal("repeated migration changed history", versions, err)
	}
	t.Run("user email", func(t *testing.T) { verifyUserEmailSchema(t, ctx, s) })
	const setVersion = "UPDATE goose_db_version SET version_id=? WHERE version_id=?"
	if _, err = s.db.ExecContext(ctx, setVersion, target+1, target); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err == nil {
		t.Fatal("newer database accepted")
	}
	if err = s.SchemaReady(ctx); err == nil {
		t.Fatal("wrong version accepted")
	}
	var version int64
	if err = s.db.GetContext(ctx, &version, "SELECT MAX(version_id) FROM goose_db_version WHERE is_applied=1"); err != nil || version != target+1 {
		t.Fatal("rejected migration changed version", version, err)
	}
	if _, err = s.db.ExecContext(ctx, setVersion, target, target+1); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.ExecContext(ctx, "UPDATE web_access_setting SET id=2 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if err = s.SchemaReady(ctx); err == nil {
		t.Fatal("missing required seed accepted")
	}
	if err = s.Migrate(ctx); err == nil {
		t.Fatal("missing required seed silently repaired")
	}
	if _, err = s.db.ExecContext(ctx, "UPDATE web_access_setting SET id=1 WHERE id=2"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.ExecContext(ctx, "ALTER TABLE project_repository_label DROP COLUMN color"); err != nil {
		t.Fatal(err)
	}
	if err = s.SchemaReady(ctx); err == nil {
		t.Fatal("incomplete baseline accepted")
	}
	if err = s.Migrate(ctx); err == nil {
		t.Fatal("incomplete baseline silently repaired")
	}
	if _, err = s.db.ExecContext(ctx, "ALTER TABLE project_repository_label ADD COLUMN color CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER name"); err != nil {
		t.Fatal(err)
	}
	if err = s.SchemaReady(ctx); err != nil {
		t.Fatal(err)
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

func verifyUserEmailSchema(t *testing.T, ctx context.Context, s *Store) {
	t.Helper()
	if _, err := s.db.ExecContext(ctx, "ALTER TABLE `user` DROP INDEX uq_user_verified_email"); err != nil {
		t.Fatal(err)
	}
	if err := s.SchemaReady(ctx); !errors.Is(err, install.ErrIncompleteSchema) {
		t.Fatal("missing verified email index accepted", err)
	}
	if _, err := s.db.ExecContext(ctx, "ALTER TABLE `user` ADD UNIQUE KEY uq_user_verified_email (verified_email)"); err != nil {
		t.Fatal(err)
	}

	const insertUser = "INSERT INTO `user` (account_type,username,display_name,email,created_at,updated_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"
	var users []uint64
	for _, account := range []struct{ kind, email string }{{"human", "Same@example.test"}, {"robot", "same@example.test"}} {
		result, err := s.db.ExecContext(ctx, insertUser, account.kind, account.kind+"-email-fixture", account.kind, account.email)
		if err != nil {
			t.Fatal("unverified duplicate was rejected", err)
		}
		id, err := result.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		users = append(users, uint64(id))
	}
	start, results := make(chan struct{}), make(chan error, len(users))
	for _, id := range users {
		go func() {
			<-start
			results <- s.Transact(ctx, func(tx identity.Tx) error {
				locked, err := tx.LockUsers([]uint64{id})
				if err != nil {
					return err
				}
				u := locked[id]
				u.EmailVerifiedAt = new(time.Now().UTC())
				return tx.SaveUser(u)
			})
		}()
	}
	close(start)
	conflicts := 0
	for range users {
		if err := <-results; err != nil {
			var apiErr *httpx.Error
			if !errors.As(err, &apiErr) || apiErr.Status != 409 || apiErr.Code != "EMAIL_ALREADY_VERIFIED" {
				t.Fatal("unexpected verification error", err)
			}
			conflicts++
		}
	}
	if conflicts != 1 {
		t.Fatal("expected only one verification to succeed", conflicts)
	}
}
