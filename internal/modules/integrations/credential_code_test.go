package integrations

import "testing"

func TestCredentialCodeUUID(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		code, err := newCredentialCode()
		if err != nil || len(code) != 32 || code[12] != '4' || (code[16] != '8' && code[16] != '9' && code[16] != 'a' && code[16] != 'b') || !credentialCodePattern.MatchString(code) || seen[code] {
			t.Fatalf("invalid UUID %q: %v", code, err)
		}
		seen[code] = true
	}
}
