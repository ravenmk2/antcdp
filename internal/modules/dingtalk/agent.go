package dingtalk

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var ErrAuthenticationUnavailable = errors.New("robot authentication unavailable")

func ReadAuthentication(r Repository, id uint64, cipher func(string, string, bool) (string, error)) (Authentication, error) {
	sealed, err := r.Secret(id)
	if err != nil {
		return Authentication{}, err
	}
	plain, err := cipher(fmt.Sprintf("dingtalk/robot/%d/v1", id), sealed, false)
	var auth Authentication
	if err != nil || json.Unmarshal([]byte(plain), &auth) != nil || validateAuth(auth) != nil {
		return Authentication{}, ErrAuthenticationUnavailable
	}
	return auth, nil
}

func (s *Service) agentProject(ctx context.Context, auth agentcore.Authorization, work func(Repository, uint64) error) error {
	pid := uint64(auth.AgentScopeID)
	denied := httpx.E(403, "RESOURCE_ACCESS_DENIED", "运行账号没有此项目的访问权限")
	if auth.AgentScopeKind != "project" || pid == 0 || !auth.Allows("project", auth.AgentScopeID, "member") {
		return denied
	}
	store, err := s.Store()
	if err != nil {
		return err
	}
	return store.Transact(ctx, func(tx identity.Tx) error {
		uid := uint64(auth.AccountID)
		users, err := tx.LockUsers([]uint64{uid})
		if err != nil {
			return err
		}
		user := users[uid]
		if user == nil || user.DeletedAt != nil || user.Status != "active" || user.AuthVersion != uint64(auth.AccountVersion) {
			return denied
		}
		projects, ok := tx.(collaboration.Repository)
		if !ok {
			return httpx.E(503, "SERVICE_UNAVAILABLE", "项目服务暂不可用")
		}
		if err = projects.LockCollaboration(collaboration.Project, pid, 0); err != nil {
			return err
		}
		project, err := projects.Resource(collaboration.Project, pid, uid)
		if err != nil {
			return err
		}
		if project == nil || project.EndedAt != nil || (!project.IsMember && user.Role != "admin") {
			return denied
		}
		r, err := repository(tx)
		if err != nil {
			return err
		}
		return work(r, pid)
	})
}

type RobotSummary struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type AgentRobotPage struct {
	Items    []RobotSummary `json:"items"`
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
}

func (s *Service) AgentList(ctx context.Context, auth agentcore.Authorization, query string, page, size int) (out AgentRobotPage, err error) {
	err = s.agentProject(ctx, auth, func(r Repository, pid uint64) error {
		rows, total, err := r.List(Filter{ScopeKind: "project", ScopeID: pid, UsableOnly: true, Query: query, Page: page, PageSize: size})
		if err != nil {
			return err
		}
		out = AgentRobotPage{Items: make([]RobotSummary, 0, len(rows)), Total: total, Page: page, PageSize: size}
		for _, row := range rows {
			out.Items = append(out.Items, RobotSummary{Code: row.Code, Name: row.Name, Description: row.Description})
		}
		return nil
	})
	return out, err
}

func (s *Service) AgentSend(ctx context.Context, auth agentcore.Authorization, code string, input TestInput) (Diagnostic, error) {
	if err := ValidateMessage(input); err != nil {
		return Diagnostic{}, err
	}
	var credentials Authentication
	err := s.agentProject(ctx, auth, func(r Repository, pid uint64) error {
		robot, err := r.RobotByCode("project", pid, code)
		if err != nil {
			return err
		}
		if robot == nil {
			return missing()
		}
		if !robot.Enabled {
			return httpx.E(409, "RESOURCE_DISABLED", "机器人已停用")
		}
		if !robot.HasSecret {
			return ErrAuthenticationUnavailable
		}
		credentials, err = ReadAuthentication(r, robot.ID, s.Cipher)
		return err
	})
	if err != nil {
		return Diagnostic{}, err
	}
	if ctx.Err() != nil {
		return Diagnostic{Status: "failed_before_submit"}, nil
	}
	send := s.Send
	if send == nil {
		send = SendMessage
	}
	return send(ctx, credentials, input), nil
}
