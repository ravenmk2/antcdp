package projectdelivery

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
)

type configKey struct{ Value, Origin string }
type configTarget struct {
	Format, Mode, Origin string
	Keys                 map[string]configKey
}

func materialConflicts(root *os.Root, rows []Material) ([]string, error) {
	groups := map[[2]string]*configTarget{}
	issues := []string{}
	for _, m := range rows {
		if m.Kind != "config" {
			continue
		}
		k := [2]string{m.Repository, m.Target}
		origin := fmt.Sprintf("%s（材料 %d）", m.Filename, m.ID)
		g := groups[k]
		if g == nil {
			g = &configTarget{m.Format, m.Mode, origin, map[string]configKey{}}
			groups[k] = g
		} else if g.Format != m.Format || g.Mode == "full" || m.Mode == "full" {
			issues = append(issues, g.Origin+" 与 "+origin+" 对同一目标使用不兼容的格式或交付方式")
			continue
		}
		if m.Mode == "full" {
			continue
		}
		b, e := root.ReadFile(m.StorageKey)
		if e != nil {
			return nil, e
		}
		v, e := parseConfig(b, m.MaterialInfo)
		if e != nil {
			return nil, e
		}
		var visit func([]string, any) error
		visit = func(parts []string, v any) error {
			obj, isMap := v.(map[string]any)
			key := string(jsonData(parts))
			sig := "object"
			if !isMap {
				val, e := json.Marshal(v)
				if e != nil {
					return e
				}
				sig = fmt.Sprintf("%T:%s", v, val)
			}
			if prev, ok := g.Keys[key]; ok && prev.Value != sig {
				issues = append(issues, prev.Origin+" 与 "+origin+" 冲突于 "+strings.Join(parts, "."))
				return nil
			}
			g.Keys[key] = configKey{sig, origin}
			if isMap {
				for k, child := range obj {
					if e := visit(append(slices.Clone(parts), k), child); e != nil {
						return e
					}
				}
			}
			return nil
		}
		if e = visit(nil, v); e != nil {
			return nil, e
		}
	}
	slices.Sort(issues)
	return issues, nil
}
