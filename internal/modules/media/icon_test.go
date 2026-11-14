package media

import (
	"context"
	"testing"
	"time"
)

func TestIconNamespaceIsolation(t *testing.T) {
	dir := t.TempDir()
	avatars, icons := New(dir), NewIcons(dir)
	ctx := context.Background()
	avatar, e := avatars.Write(ctx, samplePNG(t))
	if e != nil {
		t.Fatal(e)
	}
	avatars.Release(avatar.Key)
	icon, e := icons.Write(ctx, samplePNG(t))
	if e != nil {
		t.Fatal(e)
	}
	icons.Release(icon.Key)
	if ValidKey(icon.Key) || ValidIconKey(avatar.Key) {
		t.Fatal("cross namespace validation")
	}
	if _, e = avatars.Read(icon.Key); e == nil {
		t.Fatal("avatar store read icon")
	}
	if e = avatars.Remove(icon.Key); e == nil {
		t.Fatal("avatar cleaner removed icon")
	}
	if _, e = icons.Read(avatar.Key); e == nil {
		t.Fatal("icon store read avatar")
	}
	for store, key := range map[*Storage]string{avatars: avatar.Key, icons: icon.Key} {
		keys, e := store.Candidates(ctx, time.Now().Add(time.Hour))
		if e != nil || len(keys) != 1 || keys[0] != key {
			t.Fatalf("wrong cleanup candidates: %v %v", keys, e)
		}
	}
}
