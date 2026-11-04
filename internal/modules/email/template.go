package email

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	html "html/template"
	"regexp"
	"sort"
	"strings"
	text "text/template"
	"text/template/parse"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type Engine interface {
	Render(Template, map[string]any) (Content, error)
}
type EngineInfo struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Name    string `json:"name"`
	Default bool   `json:"default"`
}

// Registration is application code, not a user-defined plugin or executable script.
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
	engine, ok := engines[fmt.Sprintf("%s/%d", t.EngineID, t.EngineVersion)]
	if !ok {
		return Content{}, httpx.Invalid("engine_id", "unsupported")
	}
	count := 0
	if err := schema(t.Parameters, 0, &count); err != nil {
		return Content{}, err
	}
	b, err := json.Marshal(input)
	if err != nil || len(b) > 64<<10 {
		return Content{}, httpx.Invalid("parameters", "too_large")
	}
	normalized, err := object(t.Parameters, input, 0)
	if err != nil {
		return Content{}, err
	}
	return engine.Engine.Render(t, normalized)
}
func schema(fields map[string]Parameter, depth int, count *int) error {
	if depth > 4 {
		return httpx.Invalid("parameter_schema", "too_deep")
	}
	for name, p := range fields {
		*count++
		if *count > 100 || !parameterName.MatchString(name) || len(p.Description) > 1000 {
			return httpx.Invalid("parameter_schema", "invalid_field")
		}
		switch p.Type {
		case "string", "number", "boolean":
		case "object":
			if err := schema(p.Properties, depth+1, count); err != nil {
				return err
			}
		case "array":
			if p.Items == nil {
				return httpx.Invalid("parameter_schema", "missing_items")
			}
			if err := schema(map[string]Parameter{"item": *p.Items}, depth+1, count); err != nil {
				return err
			}
		default:
			return httpx.Invalid("parameter_schema", "invalid_type")
		}
		if p.Default != nil {
			if _, err := value(p, p.Default, depth); err != nil {
				return httpx.Invalid("parameter_schema", "invalid_default")
			}
		}
	}
	return nil
}
func object(fields map[string]Parameter, input map[string]any, depth int) (map[string]any, error) {
	out := map[string]any{}
	for k := range input {
		if _, ok := fields[k]; !ok {
			return nil, httpx.Invalid("parameters."+k, "unknown_field")
		}
	}
	for k, p := range fields {
		v, ok := input[k]
		if !ok {
			if p.Required {
				return nil, httpx.Invalid("parameters."+k, "required")
			}
			v = p.Default
			if v == nil {
				switch p.Type {
				case "string":
					v = ""
				case "number":
					v = float64(0)
				case "boolean":
					v = false
				case "object":
					v = map[string]any{}
				case "array":
					v = []any{}
				}
			}
		}
		normalized, err := value(p, v, depth)
		if err != nil {
			return nil, httpx.Invalid("parameters."+k, "invalid_type_or_limit")
		}
		out[k] = normalized
	}
	return out, nil
}
func value(p Parameter, v any, depth int) (any, error) {
	if depth > 5 {
		return nil, errors.New("depth limit")
	}
	switch p.Type {
	case "string":
		if s, ok := v.(string); ok && utf8.ValidString(s) && len(s) <= 64<<10 {
			return s, nil
		}
	case "number":
		if n, ok := v.(float64); ok {
			return n, nil
		}
	case "boolean":
		if b, ok := v.(bool); ok {
			return b, nil
		}
	case "object":
		if o, ok := v.(map[string]any); ok {
			return object(p.Properties, o, depth+1)
		}
	case "array":
		if a, ok := v.([]any); ok && len(a) <= 100 && p.Items != nil {
			out := make([]any, len(a))
			for i, x := range a {
				n, err := value(*p.Items, x, depth+1)
				if err != nil {
					return nil, err
				}
				out[i] = n
			}
			return out, nil
		}
	}
	return nil, errors.New("invalid value")
}

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 512<<10 {
		return 0, errors.New("output limit")
	}
	return b.Buffer.Write(p)
}

type goEngine struct{}

func (goEngine) Render(t Template, data map[string]any) (Content, error) {
	if t.BodyFormat != "text" && t.BodyFormat != "html" {
		return Content{}, httpx.Invalid("body_format", "unsupported")
	}
	subject, err := renderSource(t.Subject, data, false)
	if err != nil {
		return Content{}, httpx.Invalid("subject_template", "invalid_template_or_parameters")
	}
	if strings.ContainsAny(subject, "\r\n") || utf8.RuneCountInString(subject) > 200 || strings.TrimSpace(subject) == "" {
		return Content{}, httpx.Invalid("subject_template", "invalid_subject")
	}
	body, err := renderSource(t.Body, data, t.BodyFormat == "html")
	if err != nil {
		return Content{}, httpx.Invalid("body_template", "invalid_template_or_parameters")
	}
	alternate, err := renderSource(t.TextBody, data, false)
	if err != nil {
		return Content{}, httpx.Invalid("text_body_template", "invalid_template_or_parameters")
	}
	return Content{subject, t.BodyFormat, body, alternate}, nil
}
func renderSource(source string, data map[string]any, isHTML bool) (string, error) {
	if len(source) > 128<<10 {
		return "", errors.New("source limit")
	}
	t, err := text.New("body").Option("missingkey=error").Parse(source)
	if err != nil {
		return "", err
	}
	if len(t.Templates()) != 1 {
		return "", errors.New("definitions unavailable")
	}
	budget := 0
	if err = inspectNode(t.Root, 1, 0, &budget); err != nil {
		return "", err
	}
	execute := t.Execute
	if isHTML {
		h, e := html.New("body").Option("missingkey=error").Parse(source)
		if e != nil {
			return "", e
		}
		execute = h.Execute
	}
	out := &limitedBuffer{}
	if err = execute(out, data); err != nil {
		return "", err
	}
	return out.String(), nil
}
func inspectNode(n parse.Node, multiplier, depth int, budget *int) error {
	if n == nil {
		return nil
	}
	*budget += multiplier
	if depth > 32 || *budget > 50000 || multiplier > 10000 {
		return errors.New("template complexity limit")
	}
	visit := func(v parse.Node) error { return inspectNode(v, multiplier, depth+1, budget) }
	switch x := n.(type) {
	case *parse.ListNode:
		if x != nil {
			for _, v := range x.Nodes {
				if err := visit(v); err != nil {
					return err
				}
			}
		}
	case *parse.ActionNode:
		return visit(x.Pipe)
	case *parse.PipeNode:
		for _, v := range x.Cmds {
			if err := visit(v); err != nil {
				return err
			}
		}
	case *parse.CommandNode:
		for _, v := range x.Args {
			if err := visit(v); err != nil {
				return err
			}
		}
	case *parse.RangeNode:
		if err := visit(x.Pipe); err != nil {
			return err
		}
		if err := inspectNode(x.List, multiplier*100, depth+1, budget); err != nil {
			return err
		}
		return visit(x.ElseList)
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
	case *parse.TemplateNode:
		return errors.New("template calls unavailable")
	}
	return nil
}
