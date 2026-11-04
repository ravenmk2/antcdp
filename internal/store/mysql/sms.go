package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	e "github.com/ravenmk2/antcdp/internal/modules/sms"
)

type smsTx struct{ *identityTx }

func (t *identityTx) SMS() e.Repository { return &smsTx{t} }

type smsRow struct {
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

const smsColumns = "id,code,name,description,enabled,config,config_schema_version,row_version,created_at,updated_at"

func smsWhere(f e.Filter) (string, []any) {
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
func (t *smsTx) profile(row smsRow) (*e.Profile, error) {
	p := &e.Profile{}
	if row.SchemaVersion != 1 {
		return nil, errors.New("unsupported sms config schema")
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
	return p, nil
}
func (t *smsTx) Profiles(f e.Filter) ([]e.Profile, int, error) {
	where, args := smsWhere(f)
	var count int
	if err := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM sms_profile WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []smsRow{}
	args = append(args, f.PageSize, (f.Page-1)*f.PageSize)
	if err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+smsColumns+",secret_ciphertext IS NOT NULL AS has_secret FROM sms_profile WHERE "+where+" ORDER BY name,id LIMIT ? OFFSET ?", args...); err != nil {
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
func (t *smsTx) Profile(id uint64) (*e.Profile, error) {
	var row smsRow
	err := t.tx.GetContext(t.ctx, &row, "SELECT "+smsColumns+",secret_ciphertext IS NOT NULL AS has_secret FROM sms_profile WHERE id=? FOR UPDATE", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return t.profile(row)
}
func (t *smsTx) SaveProfile(p *e.Profile, create bool) error {
	copy := *p
	copy.Latest = nil
	copy.Version = ""
	b, err := json.Marshal(copy)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	if create {
		p.CreatedAt = now
		result, err := t.tx.ExecContext(t.ctx, "INSERT INTO sms_profile(code,name,description,enabled,config,config_schema_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)", p.Code, p.Name, p.Description, p.Enabled, b, p.RowVersion, now, now)
		if err != nil {
			return err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return err
		}
		p.ID = uint64(id)
	} else {
		if _, err = t.tx.ExecContext(t.ctx, "UPDATE sms_profile SET name=?,description=?,enabled=?,config=?,row_version=?,updated_at=? WHERE id=?", p.Name, p.Description, p.Enabled, b, p.RowVersion, now, p.ID); err != nil {
			return err
		}
	}
	p.UpdatedAt = now
	return nil
}
func (t *smsTx) DeleteProfile(id uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM sms_profile WHERE id=?", id)
	return err
}
func (t *smsTx) Secret(id uint64) (string, error) {
	var value string
	err := t.tx.GetContext(t.ctx, &value, "SELECT secret_ciphertext FROM sms_profile WHERE id=? AND secret_format_version=1 AND secret_key_version='v1'", id)
	return value, err
}
func (t *smsTx) SetSecret(id uint64, value string) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE sms_profile SET secret_ciphertext=?,secret_format_version=1,secret_key_version='v1' WHERE id=?", value, id)
	return err
}
func smsTemplate(row smsRow) (*e.Template, error) {
	v := &e.Template{}
	if row.SchemaVersion != 1 {
		return nil, errors.New("unsupported sms config schema")
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
	if v.LastSimulation != nil {
		v.LastSimulation.Outdated = v.LastSimulation.TemplateVersion != v.RowVersion
	}
	return v, nil
}
func (t *smsTx) Templates(f e.Filter) ([]e.Template, int, error) {
	where, args := smsWhere(f)
	var count int
	if err := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM sms_template WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []smsRow{}
	args = append(args, f.PageSize, (f.Page-1)*f.PageSize)
	if err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+smsColumns+" FROM sms_template WHERE "+where+" ORDER BY name,id LIMIT ? OFFSET ?", args...); err != nil {
		return nil, 0, err
	}
	out := []e.Template{}
	for _, row := range rows {
		v, err := smsTemplate(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *v)
	}
	return out, count, nil
}
func (t *smsTx) Template(id uint64) (*e.Template, error) {
	var row smsRow
	err := t.tx.GetContext(t.ctx, &row, "SELECT "+smsColumns+" FROM sms_template WHERE id=? FOR UPDATE", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return smsTemplate(row)
}
func (t *smsTx) SaveTemplate(v *e.Template, create bool) error {
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
		result, err := t.tx.ExecContext(t.ctx, "INSERT INTO sms_template(code,name,description,enabled,config,config_schema_version,row_version,created_at,updated_at,profile_id) VALUES(?,?,?,?,?,1,?,?,?,NULLIF(?,0))", v.Code, v.Name, v.Description, v.Enabled, b, v.RowVersion, now, now, v.ProfileID)
		if err != nil {
			return err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return err
		}
		v.ID = uint64(id)
	} else {
		if _, err = t.tx.ExecContext(t.ctx, "UPDATE sms_template SET name=?,description=?,enabled=?,config=?,row_version=?,updated_at=? WHERE id=?", v.Name, v.Description, v.Enabled, b, v.RowVersion, now, v.ID); err != nil {
			return err
		}
	}
	v.UpdatedAt = now
	return nil
}
func (t *smsTx) DeleteTemplate(id uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM sms_template WHERE id=?", id)
	return err
}
func (t *smsTx) InsertLog(l *e.SendLog) error {
	b, err := json.Marshal(l)
	if err != nil {
		return err
	}
	result, err := t.tx.ExecContext(t.ctx, "INSERT INTO sms_send_log(test_id,profile_id,template_id,actor_user_id,status,snapshot,started_at) VALUES(?,?,NULLIF(?,0),?,?,?,?)", l.TestID, l.ProfileID, l.TemplateID, l.ActorID, l.Status, b, l.StartedAt)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	l.ID = uint64(id)
	return err
}
func (t *smsTx) FinishLog(l *e.SendLog) error {
	b, err := json.Marshal(l)
	if err != nil {
		return err
	}
	_, err = t.tx.ExecContext(t.ctx, "UPDATE sms_send_log SET status=?,snapshot=?,finished_at=? WHERE test_id=? AND status='in_progress'", l.Status, b, l.FinishedAt, l.TestID)
	return err
}

type smsLogRow struct {
	ID              uint64     `db:"id"`
	Snapshot        []byte     `db:"snapshot"`
	Status          string     `db:"status"`
	FinishedAt      *time.Time `db:"finished_at"`
	ProfileVersion  uint64     `db:"profile_version"`
	TemplateVersion uint64     `db:"template_version"`
}

const smsLogSelect = "SELECT l.id,l.snapshot,l.status,l.finished_at,COALESCE(p.row_version,0) AS profile_version,COALESCE(t.row_version,0) AS template_version FROM sms_send_log l LEFT JOIN sms_profile p ON p.id=l.profile_id LEFT JOIN sms_template t ON t.id=l.template_id"

func smsLog(row smsLogRow) (e.SendLog, error) {
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
func (t *smsTx) Logs(f e.Filter) ([]e.SendLog, int, error) {
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
	if err := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM sms_send_log l WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []smsLogRow{}
	args = append(args, f.PageSize, (f.Page-1)*f.PageSize)
	if err := t.tx.SelectContext(t.ctx, &rows, smsLogSelect+" WHERE "+where+" ORDER BY l.started_at DESC,l.id DESC LIMIT ? OFFSET ?", args...); err != nil {
		return nil, 0, err
	}
	out := []e.SendLog{}
	for _, row := range rows {
		l, err := smsLog(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, l)
	}
	return out, count, nil
}
func (t *smsTx) Log(id uint64) (*e.SendLog, error) {
	var row smsLogRow
	err := t.tx.GetContext(t.ctx, &row, smsLogSelect+" WHERE l.id=? AND l.started_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY)", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	l, err := smsLog(row)
	return &l, err
}
func (t *smsTx) Busy(profile, template uint64) (bool, error) {
	var n int
	err := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM sms_send_log WHERE status='in_progress' AND ((?<>0 AND profile_id=?) OR (?<>0 AND template_id=?))", profile, profile, template, template)
	return n > 0, err
}
func (t *smsTx) Prune(now time.Time) error {
	if _, err := t.tx.ExecContext(t.ctx, "UPDATE sms_send_log SET status='unknown',finished_at=? WHERE status='in_progress' AND started_at<?", now, now.Add(-time.Minute)); err != nil {
		return err
	}
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM sms_send_log WHERE started_at<? AND status<>'in_progress' ORDER BY started_at,id LIMIT 1000", now.Add(-30*24*time.Hour))
	return err
}

func (t *smsTx) TemplateCount(id uint64) (int, error) {
	var count int
	err := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM sms_template WHERE profile_id=?", id)
	return count, err
}
func (t *smsTx) SaveSimulation(id uint64, v *e.Simulation) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = t.tx.ExecContext(t.ctx, "UPDATE sms_template SET config=JSON_SET(config,'$.last_simulation',CAST(? AS JSON)) WHERE id=?", string(b), id)
	return err
}
