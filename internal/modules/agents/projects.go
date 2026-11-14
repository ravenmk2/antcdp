package agents

import (
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) definitionResult(_ Repository, out *Result, v *Definition) error {
	out.Data = v
	out.Tag = s.tag("definition", v.ID, v.RowVersion)
	return nil
}

func (v *SessionRow) personalOwnerID() *uint64 {
	if v.ExecutionMode == "interactive" {
		return &v.ExecutorUserID
	}
	return nil
}

// Agent ownership controls entry. Project context is independently authorized
// against the execution account and never grants resources through agent scope.
func agentProjectCandidates(r Repository, _ *Definition, user *identity.User) ([]ProjectOption, error) {
	if user == nil {
		return nil, integrity()
	}
	return r.AvailableProjects(user.ID, user.Role == "admin")
}

type sessionProjectAccess struct{ AgentAvailable, ContextAvailable bool }

func checkSessionProjects(r Repository, v *Definition, user *identity.User, project *uint64) (sessionProjectAccess, error) {
	if user == nil {
		return sessionProjectAccess{}, integrity()
	}
	var allowed bool
	var err error
	if v.Mode == "service" && v.RobotUserID != nil && user.ID == *v.RobotUserID {
		allowed = user.AccountType == "robot"
	} else {
		allowed, err = r.CanUseAgent(v.ID, user.ID, user.Role == "admin")
	}
	if err != nil {
		return sessionProjectAccess{}, err
	}
	contextAllowed := true
	if project != nil {
		contextAllowed, err = r.CanReadActiveProject(*project, user.ID, user.Role == "admin")
	}
	return sessionProjectAccess{allowed, contextAllowed}, err
}

func setInitialProject(r Repository, v *SessionRow, agent *Definition, user *identity.User, field Field[string]) error {
	if field.Set && !field.Null {
		project, err := idValue(field.Value, "project_context_id")
		if err != nil {
			return err
		}
		v.ProjectContextID = &project
	}
	access, err := checkSessionProjects(r, agent, user, v.ProjectContextID)
	if err != nil {
		return err
	}
	if !access.AgentAvailable {
		return missing()
	}
	if !access.ContextAvailable {
		return httpx.E(403, "FORBIDDEN", "无法访问此项目")
	}
	return nil
}

func requireSessionProjects(r Repository, agent *Definition, user *identity.User, project *uint64) error {
	access, err := checkSessionProjects(r, agent, user, project)
	if err != nil {
		return err
	}
	if !access.AgentAvailable {
		return httpx.E(409, "AGENT_ACCESS_REVOKED", "当前已无此智能体的使用权限")
	}
	if !access.ContextAvailable {
		return httpx.E(409, "PROJECT_CONTEXT_UNAVAILABLE", "会话的项目上下文当前不可用")
	}
	return nil
}
