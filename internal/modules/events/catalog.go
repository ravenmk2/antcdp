package events

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/jsonvalue"
)

func containsTypes(groups []Group, codes []string) bool {
	published := make(map[string]bool)
	for _, g := range groups {
		for _, t := range g.Types {
			published[t.Code] = true
		}
	}
	for _, code := range codes {
		if !published[code] {
			return false
		}
	}
	return true
}

type schemaKey struct {
	code    string
	version uint32
}
type compiledSchema struct {
	definition json.RawMessage
	resolved   *jsonschema.Resolved
}

func (s *Service) schema(key schemaKey, raw json.RawMessage) (*jsonschema.Resolved, error) {
	if cached, ok := s.schemas.Load(key); ok {
		entry := cached.(compiledSchema)
		if bytes.Equal(entry.definition, raw) {
			return entry.resolved, nil
		}
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		return nil, integrity()
	}
	var schema jsonschema.Schema
	if json.Unmarshal(raw, &schema) != nil || (schema.Schema != "" && schema.Schema != "https://json-schema.org/draft/2020-12/schema") {
		return nil, integrity()
	}
	// With no external loader, resolution is confined to this definition.
	resolved, err := schema.Resolve(nil)
	if err != nil {
		return nil, integrity()
	}
	s.schemas.Store(key, compiledSchema{definition: raw, resolved: resolved})
	return resolved, nil
}

func (s *Service) validateRecord(r Repository, e *Record) error {
	if strings.TrimSpace(e.Type) != e.Type {
		return httpx.Invalid("type", "invalid")
	}
	version, err := r.TypeVersion(e.Type, e.SchemaVersion)
	if err != nil {
		return err
	}
	if version == nil {
		return integrity()
	}
	schema, err := s.schema(schemaKey{e.Type, e.SchemaVersion}, version.DataSchema)
	if err != nil {
		return err
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(e.Data))
	decoder.UseNumber()
	if !json.Valid(e.Data) || decoder.Decode(&value) != nil {
		return httpx.Invalid("data", "invalid_json")
	}
	value, err = jsonvalue.SchemaNumbers(value)
	if err != nil {
		return httpx.Invalid("data", "number_out_of_range")
	}
	if err = schema.Validate(value); err != nil {
		detail := jsonvalue.SchemaMismatch(schema.Schema(), value, err, "data")
		return httpx.Invalid(detail.FieldPath, detail.Constraint)
	}
	e.Group = version.EventGroup
	return nil
}
