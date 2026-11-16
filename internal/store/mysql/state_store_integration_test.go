package mysql

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/ravenmk2/antcdp/internal/statestore"
)

func stateStoreIntegration(t *testing.T, ctx context.Context, db *Store) {
	backend := db.StateStore()
	t.Run("human-readable binary strings", func(t *testing.T) {
		for _, name := range []string{"部署", "Deploy", "deploy", "deploy ", "é", "e\u0301"} {
			_, kv := createStateTestStore(t, ctx, backend, "test:string-collation", name)
			for _, key := range []string{"部署", "Key", "key", "key ", "é", "e\u0301"} {
				if _, err := kv.Put(ctx, key, []byte(key), statestore.PutOptions{IfAbsent: true}); err != nil {
					t.Fatal(name, key, err)
				}
			}
			for _, key := range []string{"部署", "Key", "key", "key ", "é", "e\u0301"} {
				entry, err := kv.Get(ctx, key)
				if err != nil || string(entry.Value) != key {
					t.Fatal(name, key, entry, err)
				}
			}
		}
		if err := backend.DeleteNamespace(ctx, "test:string-collation"); err != nil {
			t.Fatal(err)
		}
	})
	const namespace = "job:部署:Deploy"
	const neighbor = "job:部署:deploy"
	first, kv := createStateTestStore(t, ctx, backend, namespace, "a")
	second, secondKV := createStateTestStore(t, ctx, backend, namespace, "b")
	other, otherKV := createStateTestStore(t, ctx, backend, neighbor, "a")
	if _, err := backend.CreateStore(ctx, namespace, "a", "Duplicate"); !errors.Is(err, statestore.ErrStoreExists) {
		t.Fatal("expected namespace-local name conflict", err)
	}
	t.Run("open creates on demand", func(t *testing.T) { stateOpenIntegration(t, ctx, backend) })
	page, err := backend.ListStores(ctx, namespace, statestore.StorePageRequest{Limit: 1})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != first.ID || page.NextAfterName != "a" {
		t.Fatal("unexpected first store page", page, err)
	}
	page, err = backend.ListStores(ctx, namespace, statestore.StorePageRequest{Limit: 1, AfterName: page.NextAfterName})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != second.ID || page.NextAfterName != "" {
		t.Fatal("unexpected last store page", page, err)
	}
	if err := backend.SetDisplayName(ctx, first.ID, "检查点"); err != nil {
		t.Fatal(err)
	}
	updated, _, err := backend.OpenStore(ctx, namespace, "a")
	if err != nil || updated.ID != first.ID || updated.DisplayName != "检查点" {
		t.Fatal("display name update changed store identity or failed", updated, err)
	}

	stateEntryIntegration(t, ctx, kv)
	if _, err := secondKV.Put(ctx, "other", []byte("same namespace"), statestore.PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := otherKV.Put(ctx, "cursor", []byte("other namespace"), statestore.PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := backend.DeleteStore(ctx, second.ID); err != nil {
		t.Fatal(err)
	}
	assertStateStoreDeleted(t, ctx, db, second.ID, secondKV)
	third, thirdKV := createStateTestStore(t, ctx, backend, namespace, "c")
	if _, err := thirdKV.Put(ctx, "other", []byte("also removed"), statestore.PutOptions{}); err != nil {
		t.Fatal(err)
	}

	// Race a write on an existing handle with cleanup. Either ordering must
	// leave zero entries for the deleted store after both operations return.
	start := make(chan struct{})
	write := make(chan error, 1)
	go func() {
		<-start
		_, err := kv.Put(ctx, "racing-write", []byte("value"), statestore.PutOptions{})
		write <- err
	}()
	close(start)
	cleanupErr := backend.DeleteNamespace(ctx, namespace)
	writeErr := <-write
	if cleanupErr != nil || (writeErr != nil && !errors.Is(writeErr, statestore.ErrStoreNotFound)) {
		t.Fatal("invalid result for concurrent put and namespace deletion", cleanupErr, writeErr)
	}
	if err := backend.DeleteNamespace(ctx, namespace); err != nil {
		t.Fatal("namespace cleanup could not be repeated", err)
	}
	assertStateStoreDeleted(t, ctx, db, first.ID, kv)
	assertStateStoreDeleted(t, ctx, db, third.ID, thirdKV)
	replacement, replacementKV, err := backend.OpenStore(ctx, namespace, "a")
	if err != nil || replacement.ID == first.ID {
		t.Fatal("reopening the deleted store did not create a new store ID", err)
	}
	if _, err := kv.Put(ctx, "cursor", []byte("stale"), statestore.PutOptions{}); !errors.Is(err, statestore.ErrStoreNotFound) {
		t.Fatal("old handle could write after store recreation", err)
	}
	if _, err := replacementKV.Get(ctx, "cursor"); !errors.Is(err, statestore.ErrKeyNotFound) {
		t.Fatal("new store inherited old entries", err)
	}
	if entry, err := otherKV.Get(ctx, "cursor"); err != nil || string(entry.Value) != "other namespace" {
		t.Fatal("cleanup affected a different namespace", entry, err)
	}
	if err := backend.DeleteStore(ctx, other.ID); err != nil {
		t.Fatal(err)
	}
	if err := backend.DeleteStore(ctx, replacement.ID); err != nil {
		t.Fatal(err)
	}
}

func stateOpenIntegration(t *testing.T, ctx context.Context, backend statestore.Backend) {
	const namespace, name = "job:open-on-demand", "checkpoint"
	type result struct {
		info statestore.StoreInfo
		kv   statestore.KV
		err  error
	}
	start := make(chan struct{})
	done := make(chan result, 2)
	for range 2 {
		go func() {
			<-start
			info, kv, err := backend.OpenStore(ctx, namespace, name)
			done <- result{info, kv, err}
		}()
	}
	close(start)
	first, second := <-done, <-done
	if first.err != nil || second.err != nil || first.info.ID == 0 || first.info != second.info || first.info.DisplayName != name {
		t.Fatal("first opens did not share a store with the default name", first, second)
	}
	if _, err := first.kv.Put(ctx, "cursor", []byte("next"), statestore.PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if entry, err := second.kv.Get(ctx, "cursor"); err != nil || string(entry.Value) != "next" {
		t.Fatal("second open did not see state written through the first open", entry, err)
	}
	if err := backend.SetDisplayName(ctx, first.info.ID, "Job checkpoint"); err != nil {
		t.Fatal(err)
	}
	if info, _, err := backend.OpenStore(ctx, namespace, name); err != nil || info.ID != first.info.ID || info.DisplayName != "Job checkpoint" {
		t.Fatal("reopening changed store metadata", info, err)
	}
	if err := backend.DeleteNamespace(ctx, namespace); err != nil {
		t.Fatal(err)
	}
}

func createStateTestStore(t *testing.T, ctx context.Context, backend statestore.Backend, namespace, name string) (statestore.StoreInfo, statestore.KV) {
	t.Helper()
	created, err := backend.CreateStore(ctx, namespace, name, "State")
	if err != nil {
		t.Fatal(err)
	}
	opened, kv, err := backend.OpenStore(ctx, namespace, name)
	if err != nil || opened != created {
		t.Fatal("created store did not round-trip", opened, created, err)
	}
	return opened, kv
}

func stateEntryIntegration(t *testing.T, ctx context.Context, kv statestore.KV) {
	t.Helper()
	const key = "cursor"
	if _, err := kv.Get(ctx, key); !errors.Is(err, statestore.ErrKeyNotFound) {
		t.Fatal("missing key was not distinguished", err)
	}
	binary := []byte{0, 0xff, 0x80, 0x0a}
	first, err := kv.Put(ctx, key, binary, statestore.PutOptions{})
	if err != nil || first == "" {
		t.Fatal("could not write binary value", err)
	}
	if entry, err := kv.Get(ctx, key); err != nil || !bytes.Equal(entry.Value, binary) || entry.ETag != first {
		t.Fatal("binary state did not round-trip", entry, err)
	}
	if _, err := kv.Put(ctx, key+" ", nil, statestore.PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if entry, err := kv.Get(ctx, key+" "); err != nil || len(entry.Value) != 0 || entry.ETag == "" {
		t.Fatal("empty value or exact key comparison failed", entry, err)
	}
	second, err := kv.Put(ctx, key, []byte("overwrite"), statestore.PutOptions{})
	if err != nil || second == first || second == "" {
		t.Fatal("upsert did not issue a new version", second, err)
	}
	if _, err := kv.Put(ctx, key, bytes.Repeat([]byte{1}, statestore.MaxValueBytes+1), statestore.PutOptions{}); !errors.Is(err, statestore.ErrInvalidArgument) {
		t.Fatal("accepted value over the configured limit", err)
	}

	const raceKey = "conditional"
	created := raceStateWrites(t, ctx, kv, raceKey, statestore.PutOptions{IfAbsent: true})
	updated := raceStateWrites(t, ctx, kv, raceKey, statestore.PutOptions{IfMatch: created})
	if updated == created {
		t.Fatal("successful conditional update reused the old version")
	}
	if err := kv.Delete(ctx, raceKey, statestore.DeleteOptions{IfMatch: created}); !errors.Is(err, statestore.ErrConflict) {
		t.Fatal("stale ETag authorized delete", err)
	}
	if err := kv.Delete(ctx, raceKey, statestore.DeleteOptions{IfMatch: updated}); err != nil {
		t.Fatal(err)
	}
	if _, err := kv.Put(ctx, raceKey, []byte("recreated"), statestore.PutOptions{IfAbsent: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := kv.Put(ctx, raceKey, nil, statestore.PutOptions{IfMatch: updated}); !errors.Is(err, statestore.ErrConflict) {
		t.Fatal("old ETag authorized overwrite of recreated key", err)
	}
	for range 2 {
		if err := kv.Delete(ctx, raceKey, statestore.DeleteOptions{}); err != nil {
			t.Fatal("unconditional delete is not idempotent", err)
		}
	}
}

func raceStateWrites(t *testing.T, ctx context.Context, kv statestore.KV, key string, options statestore.PutOptions) statestore.ETag {
	t.Helper()
	type result struct {
		tag   statestore.ETag
		value string
		err   error
	}
	start := make(chan struct{})
	done := make(chan result, 2)
	for _, value := range []string{"left", "right"} {
		go func() {
			<-start
			tag, err := kv.Put(ctx, key, []byte(value), options)
			done <- result{tag: tag, value: value, err: err}
		}()
	}
	close(start)
	left, right := <-done, <-done
	if right.err == nil {
		left, right = right, left
	}
	if left.err != nil || left.tag == "" || !errors.Is(right.err, statestore.ErrConflict) {
		t.Fatal("expected one successful conditional write and one conflict", left, right)
	}
	if entry, err := kv.Get(ctx, key); err != nil || entry.ETag != left.tag || string(entry.Value) != left.value {
		t.Fatal("conditional write winner did not persist", entry, err)
	}
	return left.tag
}

func assertStateStoreDeleted(t *testing.T, ctx context.Context, db *Store, id statestore.StoreID, kv statestore.KV) {
	t.Helper()
	if _, err := kv.Get(ctx, "cursor"); !errors.Is(err, statestore.ErrStoreNotFound) {
		t.Fatal("deleted store handle remained readable", err)
	}
	var count int
	if err := db.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM `state_entry` WHERE `store_id`=?", id); err != nil || count != 0 {
		t.Fatal("deleted store retained entries", id, count, err)
	}
}
