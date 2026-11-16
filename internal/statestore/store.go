// Package statestore defines scoped key-value storage for backend callers.
package statestore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalidArgument = errors.New("invalid state storage argument")
	ErrStoreExists     = errors.New("state store already exists")
	ErrStoreNotFound   = errors.New("state store not found")
	ErrKeyNotFound     = errors.New("state key not found")
	ErrConflict        = errors.New("state write condition failed")
)

const MaxValueBytes = 1 << 20

type StoreID uint64

// ETag is an opaque token that changes on every successful write.
type ETag string

type StoreInfo struct {
	ID          StoreID
	Namespace   string
	Name        string
	DisplayName string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type StorePageRequest struct {
	AfterName string
	Limit     int // Zero uses the default of 50. The maximum is 100.
}

type StorePage struct {
	Items         []StoreInfo
	NextAfterName string // Empty on the last page.
}

type Entry struct {
	Value []byte
	ETag  ETag
}

type PutOptions struct {
	IfAbsent bool
	IfMatch  ETag // A nonempty token requires an existing entry with that token.
}

type DeleteOptions struct {
	IfMatch ETag // A nonempty token requires an existing entry with that token.
}

// Backend manages stores in namespaces supplied by the resource owner. The caller
// is responsible for authorizing access to the namespace.
type Backend interface {
	CreateStore(ctx context.Context, namespace, name, displayName string) (StoreInfo, error)
	// OpenStore resolves a store, creating it with name as its display name if missing.
	OpenStore(ctx context.Context, namespace, name string) (StoreInfo, KV, error)
	ListStores(ctx context.Context, namespace string, page StorePageRequest) (StorePage, error)
	SetDisplayName(ctx context.Context, id StoreID, displayName string) error
	DeleteStore(ctx context.Context, id StoreID) error
	// DeleteNamespace synchronously removes the stores and their entries. The
	// caller must stop new operations and drain in-flight work for the resource.
	DeleteNamespace(ctx context.Context, namespace string) error
}

// KV is bound to one store ID. Deleting that store invalidates the handle.
type KV interface {
	Get(ctx context.Context, key string) (Entry, error)
	// Put creates or overwrites an entry. IfAbsent and IfMatch are mutually exclusive.
	Put(ctx context.Context, key string, value []byte, opts PutOptions) (ETag, error)
	// Delete succeeds on a missing key when no condition is supplied.
	Delete(ctx context.Context, key string, opts DeleteOptions) error
}

func ValidateNamespace(namespace string) error {
	kind, id, ok := strings.Cut(namespace, ":")
	if !ok || len(kind) == 0 || len(kind) > 32 || id == "" || !utf8.ValidString(namespace) || utf8.RuneCountInString(namespace) > 255 {
		return fmt.Errorf("%w: namespace must be a kind:id string of at most 255 characters", ErrInvalidArgument)
	}
	for _, c := range kind {
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '_' {
			return fmt.Errorf("%w: namespace kind must use lowercase ASCII letters, digits, or underscores", ErrInvalidArgument)
		}
	}
	return nil
}

func ValidateStoreName(name string) error {
	if len(name) == 0 || len(name) > 64 || !utf8.ValidString(name) {
		return fmt.Errorf("%w: store name must be 1 to 64 UTF-8 bytes", ErrInvalidArgument)
	}
	return nil
}

func ValidateDisplayName(displayName string) error {
	if displayName == "" || !utf8.ValidString(displayName) || utf8.RuneCountInString(displayName) > 128 {
		return fmt.Errorf("%w: display name must be 1 to 128 UTF-8 characters", ErrInvalidArgument)
	}
	return nil
}

func ValidateKey(key string) error {
	if len(key) == 0 || len(key) > 255 || !utf8.ValidString(key) {
		return fmt.Errorf("%w: state key must be 1 to 255 UTF-8 bytes", ErrInvalidArgument)
	}
	return nil
}
