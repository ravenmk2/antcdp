package webaccess

import (
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

// RuntimeAvailability is a non-secret catalog view inside the caller's current
// authorized transaction. It does not grant permission to invoke retrieval.
func (s *Service) RuntimeAvailability(tx identity.Tx, operation runtime.Operation) (OperationState, error) {
	r, err := repository(tx)
	if err != nil {
		return OperationState{}, err
	}
	row, err := r.Settings()
	if err != nil {
		return OperationState{}, err
	}
	v, err := s.settings(row)
	if err != nil {
		return OperationState{}, err
	}
	if operation == runtime.Search {
		return s.operationState(r, v.Search.Routes, "search")
	}
	if operation == runtime.Fetch {
		return s.operationState(r, v.Fetch.Routes, "fetch")
	}
	return OperationState{}, integrity()
}
