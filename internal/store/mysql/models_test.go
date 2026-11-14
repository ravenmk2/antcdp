package mysql

import (
	"errors"
	"testing"

	driver "github.com/go-sql-driver/mysql"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func TestModelConstraintErrors(t *testing.T) {
	for _, tc := range []struct{ message, code, field string }{
		{"Duplicate entry 'private value' for key 'model_provider.uq_model_provider_name'", "NAME_CONFLICT", "name"},
		{"Duplicate entry 'private value' for key 'uq_model_provider_code'", "CODE_CONFLICT", "code"},
		{"Duplicate entry 'private value' for key 'model_definition.uq_model_definition_route'", "MODEL_ROUTE_CONFLICT", "model_id"},
		{"Duplicate entry 'uq_model_provider_code' for key 'model_provider.uq_model_provider_name'", "NAME_CONFLICT", "name"},
	} {
		var got *httpx.Error
		if !errors.As(modelsError(&driver.MySQLError{Number: 1062, Message: tc.message}), &got) || got.Code != tc.code || got.Status != 409 || len(got.Details) != 1 || got.Details[0].Field != tc.field {
			t.Fatalf("wrong conflict mapping: %+v", got)
		}
	}
	err := errors.New("another failure")
	if modelsError(err) != err {
		t.Fatal("nonconstraint error changed")
	}
}
