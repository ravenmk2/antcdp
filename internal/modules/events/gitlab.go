package events

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type EventType struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
}
type Group struct {
	Code  string      `json:"code"`
	Name  string      `json:"name"`
	Types []EventType `json:"types"`
}

func Catalog() []Group {
	return []Group{{Code: "gitlab", Name: "GitLab", Types: []EventType{
		{"gitlab.merge_request.created", "合并请求创建", "创建合并请求"},
		{"gitlab.merge_request.updated", "合并请求更新", "内容或源分支发生更新；不一定是代码变化"},
		{"gitlab.merge_request.reopened", "合并请求重新打开", "重新打开已关闭的合并请求"},
		{"gitlab.merge_request.closed", "合并请求关闭", "关闭但未合并"},
		{"gitlab.merge_request.merged", "合并请求已合并", "合并请求已经合并"},
		{"gitlab.push", "代码推送", "分支推送、创建或删除"},
		{"gitlab.tag.created", "标签创建", "创建 Git 标签"},
		{"gitlab.tag.deleted", "标签删除", "删除 Git 标签"},
		{"gitlab.repository_update", "仓库更新", "System Hook 仓库引用更新"},
		{"gitlab.pipeline.status_changed", "流水线状态变化", "GitLab 流水线状态通知"},
		{"gitlab.ci_job.status_changed", "CI 作业状态变化", "GitLab CI Job 状态通知，与平台 Job 无关"},
		{"gitlab.note.created", "评论创建", "提交、MR 等对象的新评论"},
		{"gitlab.note.updated", "评论更新", "已有评论的修改"},
	}}}
}

func KnownType(code string) bool {
	for _, group := range Catalog() {
		for _, t := range group.Types {
			if t.Code == code {
				return true
			}
		}
	}
	return false
}

func object(v any) map[string]any { m, _ := v.(map[string]any); return m }
func text(v any) string {
	switch value := v.(type) {
	case string:
		return value
	case json.Number:
		return value.String()
	default:
		return ""
	}
}
func first(values ...any) any {
	for _, v := range values {
		if v != nil && text(v) != "" {
			return v
		}
	}
	return nil
}
func id(values ...any) string { return text(first(values...)) }
func eventTime(values ...any) *time.Time {
	for _, value := range values {
		for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999999 -0700", "2006-01-02 15:04:05.999999999 MST"} {
			if parsed, err := time.Parse(layout, text(value)); err == nil {
				t := parsed.UTC().Truncate(time.Millisecond)
				return &t
			}
		}
	}
	return nil
}
func isZeroSHA(value string) bool { return value != "" && strings.Trim(value, "0") == "" }

// NormalizeGitLab is feature-based: old senders need neither version nor UUID headers.
func NormalizeGitLab(connection uint64, headers http.Header, body []byte, at time.Time) (*Record, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var payload map[string]any
	if err := decoder.Decode(&payload); err != nil || payload == nil {
		return nil, httpx.Invalid("payload", "expected_object")
	}
	hash := sha256.Sum256(body)
	e := &Record{SourceKind: "gitlab", SourceID: connection, SourceType: headers.Get("X-Gitlab-Event"), Group: "gitlab", SchemaVersion: 1, ReceivedAt: at.UTC().Truncate(time.Millisecond), Raw: append(json.RawMessage(nil), body...), PayloadHash: hex.EncodeToString(hash[:]), RoutingResult: "unmatched"}
	for _, header := range []string{"webhook-id", "Idempotency-Key"} {
		value := headers.Get(header)
		if value == "" {
			continue
		}
		if len(headers.Values(header)) != 1 || len(value) > 255 || strings.IndexFunc(value, func(r rune) bool { return r < 33 || r > 126 }) >= 0 {
			return nil, httpx.Invalid("delivery_id", "invalid_format")
		}
		key := strings.ToLower(header) + ":" + value
		e.MessageID = &key
		break
	}
	metadata := map[string]any{"headerType": e.SourceType}
	if uuid := headers.Get("X-Gitlab-Event-UUID"); uuid != "" && len(uuid) <= 255 {
		metadata["eventUuid"] = uuid
	}
	e.Metadata = safeJSON(metadata)
	attributes, project, user := object(payload["object_attributes"]), object(payload["project"]), object(payload["user"])
	e.RepositoryID = id(project["id"], payload["project_id"])
	kind := id(payload["object_kind"], payload["event_name"])
	if kind == "" {
		kind = map[string]string{"Push Hook": "push", "Tag Push Hook": "tag_push", "Merge Request Hook": "merge_request", "Pipeline Hook": "pipeline", "Job Hook": "build", "Note Hook": "note"}[e.SourceType]
	}
	action := text(attributes["action"])
	data := map[string]any{
		"repository": map[string]any{"id": e.RepositoryID, "name": project["name"], "path": first(project["path_with_namespace"], project["path"]), "url": project["web_url"], "defaultBranch": project["default_branch"]},
		"user":       map[string]any{"id": id(user["id"], payload["user_id"]), "username": first(user["username"], payload["user_username"]), "name": first(user["name"], payload["user_name"])},
	}
	e.OccurredAt = eventTime(attributes["updated_at"], attributes["created_at"], payload["event_created_at"], payload["created_at"])
	switch kind {
	case "merge_request":
		leaf := map[string]string{"open": "created", "update": "updated", "reopen": "reopened", "close": "closed", "merge": "merged"}[action]
		if leaf != "" {
			e.Type = "gitlab.merge_request." + leaf
		}
		e.RepositoryID = id(attributes["target_project_id"], object(attributes["target"])["id"], project["id"], payload["project_id"])
		e.SubjectKind, e.SubjectID = "merge_request", id(attributes["id"], attributes["iid"])
		data["mergeRequest"] = map[string]any{"id": id(attributes["id"]), "iid": id(attributes["iid"]), "title": attributes["title"], "description": attributes["description"], "url": attributes["url"], "sourceBranch": attributes["source_branch"], "targetBranch": attributes["target_branch"], "sourceProjectId": id(attributes["source_project_id"]), "targetProjectId": e.RepositoryID, "headSha": object(attributes["last_commit"])["id"], "state": attributes["state"], "draft": attributes["draft"], "workInProgress": attributes["work_in_progress"], "action": action, "changes": payload["changes"]}
	case "push", "tag_push":
		ref, before, after := text(payload["ref"]), text(payload["before"]), text(payload["after"])
		e.SubjectKind, e.SubjectID = "ref", ref
		if kind == "push" {
			e.Type = "gitlab.push"
		} else if isZeroSHA(after) {
			e.Type = "gitlab.tag.deleted"
		} else if isZeroSHA(before) {
			e.Type = "gitlab.tag.created"
		}
		data["push"] = map[string]any{"ref": ref, "before": before, "after": after, "commits": payload["commits"], "totalCommitsCount": payload["total_commits_count"]}
	case "repository_update":
		e.Type, e.SubjectKind, e.SubjectID = "gitlab.repository_update", "repository", e.RepositoryID
		data["repositoryUpdate"] = map[string]any{"changes": payload["changes"], "refs": payload["refs"]}
	case "pipeline":
		e.Type, e.SubjectKind, e.SubjectID = "gitlab.pipeline.status_changed", "pipeline", id(attributes["id"])
		data["pipeline"] = map[string]any{"id": e.SubjectID, "status": attributes["status"], "ref": attributes["ref"], "sha": attributes["sha"], "url": attributes["url"], "source": attributes["source"]}
	case "build":
		e.Type, e.SubjectKind, e.SubjectID = "gitlab.ci_job.status_changed", "ci_job", id(payload["build_id"])
		e.OccurredAt = eventTime(payload["build_finished_at"], payload["build_started_at"], payload["build_created_at"])
		data["ciJob"] = map[string]any{"id": e.SubjectID, "name": payload["build_name"], "status": payload["build_status"], "stage": payload["build_stage"], "ref": payload["ref"], "sha": payload["sha"], "pipelineId": id(payload["pipeline_id"], object(payload["commit"])["id"])}
	case "note":
		// Legacy Note Hook predates update notifications and omits action.
		switch action {
		case "", "create":
			e.Type = "gitlab.note.created"
		case "update":
			e.Type = "gitlab.note.updated"
		}
		e.SubjectKind, e.SubjectID = "note", id(attributes["id"])
		data["note"] = map[string]any{"id": e.SubjectID, "body": attributes["note"], "url": attributes["url"], "noteableType": attributes["noteable_type"], "noteableId": id(attributes["noteable_id"]), "action": action} //nolint:misspell // GitLab's wire spelling.
	}
	object(data["repository"])["id"] = e.RepositoryID
	if e.Type == "" {
		e.RoutingResult = "unsupported"
	}
	e.Data = safeJSON(data)
	return e, nil
}

func safeJSON(value any) json.RawMessage {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(fmt.Sprintf("event data cannot be encoded: %v", err))
	}
	return raw
}
