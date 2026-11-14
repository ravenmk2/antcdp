package install

import (
	"context"
	"testing"
)

func TestModelCredentialsAreBoundToInstallationResourceAndModule(t *testing.T) {
	s := newService(t, runtime(t), &fakeDB{})
	const purpose = "models/provider/17/authentication"
	if _, err := s.ModelSecret(purpose, "test-secret", true); err == nil {
		t.Fatal("uninstalled instance encrypted a credential")
	}
	if _, err := s.Install(context.Background(), validRequest()); err != nil {
		t.Fatal(err)
	}
	ciphertext, err := s.ModelSecret(purpose, "test-secret", true)
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := s.ModelSecret(purpose, ciphertext, false)
	if err != nil || plaintext != "test-secret" {
		t.Fatal("credential round trip failed")
	}
	if _, err := s.ModelSecret("models/provider/18/authentication", ciphertext, false); err == nil {
		t.Fatal("credential could be moved to another provider")
	}
	if _, err := s.ModelSecret("email/profile/17", ciphertext, false); err == nil {
		t.Fatal("model credential accepted an unrelated purpose")
	}
	if _, err := s.IntegrationSecret(purpose, ciphertext, false); err == nil {
		t.Fatal("another module decrypted model material")
	}
	other := newService(t, runtime(t), &fakeDB{})
	if _, err := other.Install(context.Background(), validRequest()); err != nil {
		t.Fatal(err)
	}
	if _, err := other.ModelSecret(purpose, ciphertext, false); err == nil {
		t.Fatal("another installation decrypted model material")
	}
	if s.ModelETag("provider:17:1") == s.IntegrationETag("provider:17:1") {
		t.Fatal("model editing versions share another module's namespace")
	}
}
