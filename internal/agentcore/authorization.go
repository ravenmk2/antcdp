package agentcore

// ResourceGrant is a concrete account permission captured at root admission.
// IDs and effective roles are retained; later membership changes do not rewrite
// the authority of an already admitted turn.
type ResourceGrant struct {
	Kind string `db:"kind" json:"kind"`
	ID   ID     `db:"id" json:"id"`
	Role string `db:"role" json:"role"`
}

type Authorization struct {
	AccountID      ID              `json:"account_id"`
	AccountType    string          `json:"account_type"`
	AccountVersion Version         `json:"account_version"`
	Grants         []ResourceGrant `json:"grants"`
}

func (a Authorization) Allows(kind string, id ID, role string) bool {
	for _, grant := range a.Grants {
		if grant.Kind == kind && grant.ID == id && (role == "" || role == "member" || grant.Role == role) {
			return true
		}
	}
	return false
}
