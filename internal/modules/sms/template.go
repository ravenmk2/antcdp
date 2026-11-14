package sms

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"text/template"
	"text/template/parse"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type Engine interface {
	Render(string, map[string]string) (string, error)
}
type EngineInfo struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Name    string `json:"name"`
	Default bool   `json:"default"`
}

type engineRegistration struct {
	Info   EngineInfo
	Engine Engine
}

// Add implementations here; rendering and the public catalog use the same registry.
var engines = map[string]engineRegistration{"go_template/1": {EngineInfo{"go_template", 1, "Go 模板", true}, goEngine{}}}

func EngineCatalog() []EngineInfo {
	out := make([]EngineInfo, 0, len(engines))
	for _, entry := range engines {
		out = append(out, entry.Info)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ID == out[j].ID {
			return out[i].Version < out[j].Version
		}
		return out[i].ID < out[j].ID
	})
	return out
}

var parameterName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)

func Render(t Template, input map[string]any) (Content, error) {
	if len(t.Parameters) > 50 {
		return Content{}, httpx.Invalid("parameter_schema", "too_many")
	}
	b, err := json.Marshal(input)
	if err != nil || len(b) > 16<<10 {
		return Content{}, httpx.Invalid("parameters", "too_large")
	}
	out := map[string]string{}
	for key := range input {
		if _, ok := t.Parameters[key]; !ok {
			return Content{}, httpx.Invalid("parameters."+key, "unknown_field")
		}
	}
	for key, p := range t.Parameters {
		if !parameterName.MatchString(key) || p.Type != "string" || len(p.Description) > 1000 {
			return Content{}, httpx.Invalid("parameter_schema", "invalid_definition")
		}
		v, ok := input[key]
		if !ok {
			if p.Required {
				return Content{}, httpx.Invalid("parameters."+key, "required")
			}
			v = ""
			if p.Default != nil {
				v = *p.Default
			}
		}
		s, ok := v.(string)
		if !ok || !utf8.ValidString(s) || len(s) > 4096 {
			return Content{}, httpx.Invalid("parameters."+key, "string_required")
		}
		out[key] = s
	}
	if t.Mode == "remote" {
		if t.ProfileID == 0 || t.SignName == "" || utf8.RuneCountInString(t.SignName) > 50 || !regexp.MustCompile(`^SMS_[A-Za-z0-9]{1,64}$`).MatchString(t.RemoteID) || len(t.Body) != 0 || t.EngineID != "" || t.EngineVersion != 0 {
			return Content{}, httpx.Invalid("template", "invalid_remote_template")
		}
		mapped := map[string]string{}
		if len(t.Mapping) > 50 {
			return Content{}, httpx.Invalid("provider_parameters", "too_many")
		}
		for target, source := range t.Mapping {
			if !parameterName.MatchString(target) {
				return Content{}, httpx.Invalid("provider_parameters", "invalid_target")
			}
			v, ok := out[source]
			if !ok {
				return Content{}, httpx.Invalid("provider_parameters", "unknown_source")
			}
			mapped[target] = v
		}
		return Content{SignName: t.SignName, RemoteID: t.RemoteID, Parameters: mapped}, nil
	}
	if t.Mode != "local" || t.ProfileID != 0 || t.SignName != "" || t.RemoteID != "" || len(t.Mapping) != 0 {
		return Content{}, httpx.Invalid("template", "invalid_local_template")
	}
	engine, ok := engines[fmt.Sprintf("%s/%d", t.EngineID, t.EngineVersion)]
	if !ok {
		return Content{}, httpx.Invalid("engine_id", "unsupported")
	}
	body, err := engine.Engine.Render(t.Body, out)
	if err != nil {
		return Content{}, httpx.Invalid("body_template", "invalid_template_or_parameters")
	}
	return Content{Body: body}, nil
}

type goEngine struct{}
type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 4096 {
		return 0, errors.New("output limit")
	}
	return b.Buffer.Write(p)
}
func (goEngine) Render(source string, data map[string]string) (string, error) {
	if len(source) > 16<<10 {
		return "", errors.New("source limit")
	}
	t, err := template.New("sms").Option("missingkey=error").Parse(source)
	if err != nil {
		return "", err
	}
	if len(t.Templates()) != 1 {
		return "", errors.New("definitions unavailable")
	}
	nodes := 0
	if err = inspect(t.Root, 0, &nodes); err != nil {
		return "", err
	}
	b := &limitedBuffer{}
	if err = t.Execute(b, data); err != nil {
		return "", err
	}
	return b.String(), nil
}
func inspect(n parse.Node, depth int, count *int) error {
	if n == nil {
		return nil
	}
	*count++
	if *count > 1000 || depth > 24 {
		return errors.New("complexity limit")
	}
	visit := func(v parse.Node) error { return inspect(v, depth+1, count) }
	switch x := n.(type) {
	case *parse.ListNode:
		if x != nil {
			for _, c := range x.Nodes {
				if err := visit(c); err != nil {
					return err
				}
			}
		}
	case *parse.ActionNode:
		return visit(x.Pipe)
	case *parse.PipeNode:
		for _, c := range x.Cmds {
			if err := visit(c); err != nil {
				return err
			}
		}
	case *parse.CommandNode:
		for _, c := range x.Args {
			if err := visit(c); err != nil {
				return err
			}
		}
	case *parse.IfNode:
		if err := visit(x.Pipe); err != nil {
			return err
		}
		if err := visit(x.List); err != nil {
			return err
		}
		return visit(x.ElseList)
	case *parse.WithNode:
		if err := visit(x.Pipe); err != nil {
			return err
		}
		if err := visit(x.List); err != nil {
			return err
		}
		return visit(x.ElseList)
	case *parse.IdentifierNode:
		switch x.Ident {
		case "eq", "ne", "lt", "le", "gt", "ge", "and", "or", "not", "len":
		default:
			return errors.New("function unavailable")
		}
	case *parse.RangeNode, *parse.TemplateNode:
		return errors.New("loops and template calls unavailable")
	}
	return nil
}
