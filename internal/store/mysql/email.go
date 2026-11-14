package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	e "github.com/ravenmk2/antcdp/internal/modules/email"
)

type emailTx struct{ *identityTx }

func (t *identityTx) Email() e.Repository { return &emailTx{t} }

type emailRow struct {
	ID            uint64    `db:"id"`
	Code          string    `db:"code"`
	Name          string    `db:"name"`
	Description   string    `db:"description"`
	Enabled       bool      `db:"enabled"`
	Config        []byte    `db:"config"`
	Version       uint64    `db:"row_version"`
	SchemaVersion uint64    `db:"config_schema_version"`
	CreatedAt     time.Time `db:"created_at"`
	UpdatedAt     time.Time `db:"updated_at"`
	HasSecret     bool      `db:"has_secret"`
}

const emailColumns = "id,code,name,description,enabled,config,config_schema_version,row_version,created_at,updated_at"

func emailWhere(f e.Filter) (string, []any) {
	where := "1=1"
	args := []any{}
	if f.Query != "" {
		where += " AND (LOCATE(?,name)>0 OR LOCATE(?,code)>0)"
		args = append(args, f.Query, f.Query)
	}
	if f.Status == "enabled" || f.Status == "disabled" {
		where += " AND enabled=?"
		args = append(args, f.Status == "enabled")
	}
	return where, args
}
func (t *emailTx) profile(row emailRow) (*e.Profile, error) {
	p := &e.Profile{}
	if row.SchemaVersion != 1 {
		return nil, errors.New("unsupported email config schema")
	}
	if err := json.Unmarshal(row.Config, p); err != nil {
		return nil, err
	}
	p.ID = row.ID
	p.Code = row.Code
	p.Name = row.Name
	p.Description = row.Description
	p.Enabled = row.Enabled
	p.RowVersion = row.Version
	p.CreatedAt = row.CreatedAt
	p.UpdatedAt = row.UpdatedAt
	p.HasSecret = row.HasSecret
	p.Version = ""
	p.Latest = nil
	rows := []struct {
		ID      string `db:"id"`
		Name    string `db:"name"`
		Default bool   `db:"is_default"`
	}{}
	if err := t.tx.SelectContext(t.ctx, &rows, "SELECT id,name,is_default FROM email_sender_name WHERE profile_id=? ORDER BY id", p.ID); err != nil {
		return nil, err
	}
	p.SenderNames = []e.SenderName{}
	for _, n := range rows {
		p.SenderNames = append(p.SenderNames, e.SenderName{ID: n.ID, Name: n.Name, Default: n.Default})
	}
	return p, nil
}
func (t *emailTx) Profiles(f e.Filter) ([]e.Profile, int, error) {
	where, args := emailWhere(f)
	var count int
	if err := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM email_profile WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []emailRow{}
	args = append(args, f.PageSize, (f.Page-1)*f.PageSize)
	if err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+emailColumns+",secret_ciphertext IS NOT NULL AS has_secret FROM email_profile WHERE "+where+" ORDER BY name,id LIMIT ? OFFSET ?", args...); err != nil {
		return nil, 0, err
	}
	out := []e.Profile{}
	for _, row := range rows {
		p, err := t.profile(row)
		if err != nil {
			return nil, 0, err
		}
		logs, _, err := t.Logs(e.Filter{Page: 1, PageSize: 1, ProfileID: p.ID})
		if err != nil {
			return nil, 0, err
		}
		if len(logs) > 0 {
			p.Latest = &logs[0]
		}
		out = append(out, *p)
	}
	return out, count, nil
}
func (t *emailTx) Profile(id uint64) (*e.Profile, error) {
	var row emailRow
	err := t.tx.GetContext(t.ctx, &row, "SELECT "+emailColumns+",secret_ciphertext IS NOT NULL AS has_secret FROM email_profile WHERE id=? FOR UPDATE", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return t.profile(row)
}
func (t *emailTx) SaveProfile(p *e.Profile, create bool) error {
	copy := *p
	copy.SenderNames = nil
	copy.Latest = nil
	copy.Version = ""
	b, err := json.Marshal(copy)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	if create {
		p.CreatedAt = now
		result, err := t.tx.ExecContext(t.ctx, "INSERT INTO email_profile(code,name,description,enabled,config,config_schema_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)", p.Code, p.Name, p.Description, p.Enabled, b, p.RowVersion, now, now)
		if err != nil {
			return err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return err
		}
		p.ID = uint64(id)
	} else {
		if _, err = t.tx.ExecContext(t.ctx, "UPDATE email_profile SET name=?,description=?,enabled=?,config=?,row_version=?,updated_at=? WHERE id=?", p.Name, p.Description, p.Enabled, b, p.RowVersion, now, p.ID); err != nil {
			return err
		}
	}
	p.UpdatedAt = now
	if _, err = t.tx.ExecContext(t.ctx, "DELETE FROM email_sender_name WHERE profile_id=?", p.ID); err != nil {
		return err
	}
	for _, n := range p.SenderNames {
		if _, err = t.tx.ExecContext(t.ctx, "INSERT INTO email_sender_name(id,profile_id,name,is_default) VALUES(?,?,?,?)", n.ID, p.ID, n.Name, n.Default); err != nil {
			return err
		}
	}
	return nil
}
func (t *emailTx) DeleteProfile(id uint64) error {
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM email_sender_name WHERE profile_id=?", id); err != nil {
		return err
	}
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM email_profile WHERE id=?", id)
	return err
}
func (t *emailTx) Secret(id uint64) (string, error) {
	var value string
	err := t.tx.GetContext(t.ctx, &value, "SELECT secret_ciphertext FROM email_profile WHERE id=? AND secret_format_version=1 AND secret_key_version='v1'", id)
	return value, err
}
func (t *emailTx) SetSecret(id uint64, value string) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE email_profile SET secret_ciphertext=?,secret_format_version=1,secret_key_version='v1' WHERE id=?", value, id)
	return err
}
func emailTemplate(row emailRow) (*e.Template, error) {
	v := &e.Template{}
	if row.SchemaVersion != 1 {
		return nil, errors.New("unsupported email config schema")
	}
	if err := json.Unmarshal(row.Config, v); err != nil {
		return nil, err
	}
	v.ID = row.ID
	v.Code = row.Code
	v.Name = row.Name
	v.Description = row.Description
	v.Enabled = row.Enabled
	v.RowVersion = row.Version
	v.CreatedAt = row.CreatedAt
	v.UpdatedAt = row.UpdatedAt
	v.Version = ""
	v.Latest = nil
	return v, nil
}
func (t *emailTx) Templates(f e.Filter) ([]e.Template, int, error) {
	where, args := emailWhere(f)
	var count int
	if err := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM email_template WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []emailRow{}
	args = append(args, f.PageSize, (f.Page-1)*f.PageSize)
	if err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+emailColumns+" FROM email_template WHERE "+where+" ORDER BY name,id LIMIT ? OFFSET ?", args...); err != nil {
		return nil, 0, err
	}
	out := []e.Template{}
	for _, row := range rows {
		v, err := emailTemplate(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *v)
	}
	return out, count, nil
}
func (t *emailTx) Template(id uint64) (*e.Template, error) {
	var row emailRow
	err := t.tx.GetContext(t.ctx, &row, "SELECT "+emailColumns+" FROM email_template WHERE id=? FOR UPDATE", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return emailTemplate(row)
}
func (t *emailTx) SaveTemplate(v *e.Template, create bool) error {
	copy := *v
	copy.Latest = nil
	copy.Version = ""
	b, err := json.Marshal(copy)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	if create {
		v.CreatedAt = now
		result, err := t.tx.ExecContext(t.ctx, "INSERT INTO email_template(code,name,description,enabled,config,config_schema_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)", v.Code, v.Name, v.Description, v.Enabled, b, v.RowVersion, now, now)
		if err != nil {
			return err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return err
		}
		v.ID = uint64(id)
	} else {
		if _, err = t.tx.ExecContext(t.ctx, "UPDATE email_template SET name=?,description=?,enabled=?,config=?,row_version=?,updated_at=? WHERE id=?", v.Name, v.Description, v.Enabled, b, v.RowVersion, now, v.ID); err != nil {
			return err
		}
	}
	v.UpdatedAt = now
	return nil
}
func (t *emailTx) DeleteTemplate(id uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM email_template WHERE id=?", id)
	return err
}
func (t *emailTx) InsertLog(l *e.SendLog) error {
	b, err := json.Marshal(l)
	if err != nil {
		return err
	}
	result, err := t.tx.ExecContext(t.ctx, "INSERT INTO email_send_log(test_id,profile_id,template_id,actor_user_id,status,snapshot,started_at) VALUES(?,?,NULLIF(?,0),?,?,?,?)", l.TestID, l.ProfileID, l.TemplateID, l.ActorID, l.Status, b, l.StartedAt)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	l.ID = uint64(id)
	return err
}
func (t *emailTx) FinishLog(l *e.SendLog) error {
	b, err := json.Marshal(l)
	if err != nil {
		return err
	}
	_, err = t.tx.ExecContext(t.ctx, "UPDATE email_send_log SET status=?,snapshot=?,finished_at=? WHERE test_id=? AND status='in_progress'", l.Status, b, l.FinishedAt, l.TestID)
	return err
}

type emailLogRow struct {
	ID              uint64     `db:"id"`
	Snapshot        []byte     `db:"snapshot"`
	Status          string     `db:"status"`
	FinishedAt      *time.Time `db:"finished_at"`
	ProfileVersion  uint64     `db:"profile_version"`
	TemplateVersion uint64     `db:"template_version"`
}

const emailLogSelect = "SELECT l.id,l.snapshot,l.status,l.finished_at,COALESCE(p.row_version,0) AS profile_version,COALESCE(t.row_version,0) AS template_version FROM email_send_log l LEFT JOIN email_profile p ON p.id=l.profile_id LEFT JOIN email_template t ON t.id=l.template_id"

func emailLog(row emailLogRow) (e.SendLog, error) {
	var l e.SendLog
	err := json.Unmarshal(row.Snapshot, &l)
	l.ID = row.ID
	l.Status = row.Status
	l.FinishedAt = row.FinishedAt
	l.Outdated = row.ProfileVersion != l.ProfileVersion || (l.TemplateID != 0 && row.TemplateVersion != l.TemplateVersion)
	if l.Status == "unknown" && l.Reason == "pending" {
		l.Reason = "interrupted"
		l.Stage = "recovery"
	}
	return l, err
}
func (t *emailTx) Logs(f e.Filter) ([]e.SendLog, int, error) {
	where := "l.started_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY)"
	args := []any{}
	for _, x := range []struct {
		col string
		id  uint64
	}{{"profile_id", f.ProfileID}, {"template_id", f.TemplateID}, {"actor_user_id", f.ActorID}} {
		if x.id != 0 {
			where += " AND l." + x.col + "=?"
			args = append(args, x.id)
		}
	}
	if f.Status != "" {
		where += " AND l.status=?"
		args = append(args, f.Status)
	}
	if f.From != nil {
		where += " AND l.started_at>=?"
		args = append(args, *f.From)
	}
	if f.To != nil {
		where += " AND l.started_at<?"
		args = append(args, *f.To)
	}
	if f.Query != "" {
		where += " AND (LOCATE(?,l.test_id)>0 OR LOCATE(?,JSON_UNQUOTE(JSON_EXTRACT(l.snapshot,'$.profile_name')))>0)"
		args = append(args, f.Query, f.Query)
	}
	var count int
	if err := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM email_send_log l WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []emailLogRow{}
	args = append(args, f.PageSize, (f.Page-1)*f.PageSize)
	if err := t.tx.SelectContext(t.ctx, &rows, emailLogSelect+" WHERE "+where+" ORDER BY l.started_at DESC,l.id DESC LIMIT ? OFFSET ?", args...); err != nil {
		return nil, 0, err
	}
	out := []e.SendLog{}
	for _, row := range rows {
		l, err := emailLog(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, l)
	}
	return out, count, nil
}
func (t *emailTx) Log(id uint64) (*e.SendLog, error) {
	var row emailLogRow
	err := t.tx.GetContext(t.ctx, &row, emailLogSelect+" WHERE l.id=? AND l.started_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY)", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	l, err := emailLog(row)
	return &l, err
}
func (t *emailTx) Busy(profile, template uint64) (bool, error) {
	var n int
	err := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM email_send_log WHERE status='in_progress' AND ((?<>0 AND profile_id=?) OR (?<>0 AND template_id=?))", profile, profile, template, template)
	return n > 0, err
}
func (t *emailTx) Prune(now time.Time) error {
	if _, err := t.tx.ExecContext(t.ctx, "UPDATE email_send_log SET status='unknown',finished_at=? WHERE status='in_progress' AND started_at<?", now, now.Add(-time.Minute)); err != nil {
		return err
	}
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM email_send_log WHERE started_at<? AND status<>'in_progress' ORDER BY started_at,id LIMIT 1000", now.Add(-30*24*time.Hour))
	return err
}
