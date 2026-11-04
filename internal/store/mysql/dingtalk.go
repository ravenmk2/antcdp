package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	e "github.com/ravenmk2/antcdp/internal/modules/dingtalk"
)

type dingtalkTx struct{ *identityTx }

func (t *identityTx) DingTalk() e.Repository { return &dingtalkTx{t} }

type dingtalkRow struct {
	Latest        []byte    `db:"last_test"`
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

const dingtalkColumns = "id,code,name,description,enabled,config,config_schema_version,row_version,created_at,updated_at"

func dingtalkWhere(f e.Filter) (string, []any) {
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
func (t *dingtalkTx) decodeRobot(row dingtalkRow) (*e.Robot, error) {
	p := &e.Robot{}
	if row.SchemaVersion != 1 {
		return nil, errors.New("unsupported dingtalk config schema")
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
	if len(row.Latest) > 0 {
		if err := json.Unmarshal(row.Latest, &p.Latest); err != nil {
			return nil, err
		}
	}
	return p, nil
}
func (t *dingtalkTx) List(f e.Filter) ([]e.Robot, int, error) {
	where, args := dingtalkWhere(f)
	var count int
	if err := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM dingtalk_robot WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []dingtalkRow{}
	args = append(args, f.PageSize, (f.Page-1)*f.PageSize)
	if err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+dingtalkColumns+",last_test,secret_ciphertext IS NOT NULL AS has_secret FROM dingtalk_robot WHERE "+where+" ORDER BY name,id LIMIT ? OFFSET ?", args...); err != nil {
		return nil, 0, err
	}
	out := []e.Robot{}
	for _, row := range rows {
		p, err := t.decodeRobot(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *p)
	}
	return out, count, nil
}
func (t *dingtalkTx) Robot(id uint64) (*e.Robot, error) {
	var row dingtalkRow
	err := t.tx.GetContext(t.ctx, &row, "SELECT "+dingtalkColumns+",last_test,secret_ciphertext IS NOT NULL AS has_secret FROM dingtalk_robot WHERE id=? FOR UPDATE", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return t.decodeRobot(row)
}
func (t *dingtalkTx) Save(p *e.Robot, create bool) error {
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
		result, err := t.tx.ExecContext(t.ctx, "INSERT INTO dingtalk_robot(code,name,description,enabled,config,config_schema_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)", p.Code, p.Name, p.Description, p.Enabled, b, p.RowVersion, now, now)
		if err != nil {
			return err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return err
		}
		p.ID = uint64(id)
	} else {
		if _, err = t.tx.ExecContext(t.ctx, "UPDATE dingtalk_robot SET name=?,description=?,enabled=?,config=?,row_version=?,updated_at=? WHERE id=?", p.Name, p.Description, p.Enabled, b, p.RowVersion, now, p.ID); err != nil {
			return err
		}
	}
	p.UpdatedAt = now
	return nil
}
func (t *dingtalkTx) Delete(id uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM dingtalk_robot WHERE id=?", id)
	return err
}
func (t *dingtalkTx) Secret(id uint64) (string, error) {
	var value string
	err := t.tx.GetContext(t.ctx, &value, "SELECT secret_ciphertext FROM dingtalk_robot WHERE id=? AND secret_format_version=1 AND secret_key_version='v1'", id)
	return value, err
}
func (t *dingtalkTx) SetSecret(id uint64, value string) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE dingtalk_robot SET secret_ciphertext=?,secret_format_version=1,secret_key_version='v1' WHERE id=?", value, id)
	return err
}

func (t *dingtalkTx) SaveDiagnostic(id uint64, d *e.Diagnostic, start bool) error {
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	if start {
		_, err = t.tx.ExecContext(t.ctx, "UPDATE dingtalk_robot SET last_test=? WHERE id=?", b, id)
	} else {
		_, err = t.tx.ExecContext(t.ctx, "UPDATE dingtalk_robot SET last_test=? WHERE id=? AND JSON_UNQUOTE(JSON_EXTRACT(last_test,'$.test_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(last_test,'$.status'))='in_progress'", b, id, d.TestID)
	}
	return err
}
func (t *dingtalkTx) Recover(now time.Time) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE dingtalk_robot SET last_test=JSON_SET(last_test,'$.status','unknown','$.reason_code','interrupted','$.finished_at',?) WHERE JSON_UNQUOTE(JSON_EXTRACT(last_test,'$.status'))='in_progress' AND JSON_UNQUOTE(JSON_EXTRACT(last_test,'$.started_at'))<?", now.UTC().Format(time.RFC3339Nano), now.Add(-time.Minute).UTC().Format(time.RFC3339Nano))
	return err
}
