package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type tempCandidate struct {
	ID      string    `json:"id"`
	Source  string    `json:"source"`
	Reason  string    `json:"reason"`
	Size    int64     `json:"size_bytes"`
	Changed time.Time `json:"changed_at"`
	Token   string    `json:"token"`
	key     string
}
type cleanupStore interface {
	StagedReleaseFiles() (map[string]string, error)
	DiscardStagedReleaseFile(string) error
}
type tempSource struct {
	list   func(identity.Tx, *os.Root) ([]tempCandidate, error)
	remove func(identity.Tx, *os.Root, tempCandidate) error
}

// The installation holds the instance lock; this lease covers all live file
// writers in it, including the gap between reservation and binding commits.
var releaseIO sync.Mutex
var activeUploads = map[string]bool{}

func leaseReleaseUpload(id string) func() {
	releaseIO.Lock()
	activeUploads[id] = true
	releaseIO.Unlock()
	return func() { releaseIO.Lock(); delete(activeUploads, id); releaseIO.Unlock() }
}

var uploadIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
var releaseKeyPattern = regexp.MustCompile(`^releases/[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*/(sql|objects|configs|attachments)/[1-9][0-9]*/[0-9a-f]{32}/payload$`)

func candidate(root *os.Root, id, reason, key string) (tempCandidate, error) {
	v := tempCandidate{ID: id, Source: "releases", Reason: reason, key: key}
	st, e := root.Lstat(key)
	if e != nil && !errors.Is(e, fs.ErrNotExist) {
		return v, e
	}
	if e == nil {
		if !st.Mode().IsRegular() {
			return v, httpx.E(409, "FILE_STATE_UNKNOWN", "临时文件类型异常")
		}
		v.Size = st.Size()
		v.Changed = st.ModTime().UTC()
	}
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	v.Token = hex.EncodeToString(h[:])
	return v, nil
}
func releaseCandidates(tx identity.Tx, root *os.Root) ([]tempCandidate, error) {
	store, ok := tx.(cleanupStore)
	if !ok {
		return nil, httpx.E(503, "FEATURE_UNAVAILABLE", "暂存文件维护不可用")
	}
	out := []tempCandidate{}
	// os.Root confines path traversal; only enumerate these registered private roots.
	entries, e := fs.ReadDir(root.FS(), "tmp/uploads/releases")
	if e != nil && !errors.Is(e, fs.ErrNotExist) {
		return nil, e
	}
	for _, entry := range entries {
		if activeUploads[entry.Name()] || !entry.IsDir() || !uploadIDPattern.MatchString(entry.Name()) {
			continue
		}
		dir := path.Join("tmp/uploads/releases", entry.Name())
		children, e := fs.ReadDir(root.FS(), dir)
		if e != nil {
			return nil, e
		}
		if len(children) > 1 || len(children) == 1 && (children[0].Name() != "payload.part" || !children[0].Type().IsRegular()) {
			continue
		}
		c, e := candidate(root, "upload-"+entry.Name(), "未绑定的上传", dir+"/payload.part")
		if e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	files, e := store.StagedReleaseFiles()
	if e != nil {
		return nil, e
	}
	for id, key := range files {
		if activeUploads[id] || !uploadIDPattern.MatchString(id) || !releaseKeyPattern.MatchString(key) {
			continue
		}
		c, e := candidate(root, "stage-"+id, "未完成绑定的原件", key)
		if e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	slices.SortFunc(out, func(a, b tempCandidate) int { return strings.Compare(a.ID, b.ID) })
	return out, nil
}
func removeReleaseCandidate(tx identity.Tx, root *os.Root, c tempCandidate) error {
	if e := root.Remove(c.key); e != nil && !errors.Is(e, fs.ErrNotExist) {
		return e
	}
	if id, ok := strings.CutPrefix(c.ID, "stage-"); ok {
		return tx.(cleanupStore).DiscardStagedReleaseFile(id)
	}
	if e := root.Remove(path.Dir(c.key)); e != nil && !errors.Is(e, fs.ErrNotExist) {
		return e
	}
	return nil
}
func registerTempMaintenance(api *gin.RouterGroup, o Options) {
	sources := map[string]tempSource{"releases": {releaseCandidates, removeReleaseCandidate}}
	for _, action := range []string{"preview", "clean"} {
		api.POST("/admin/maintenance/temp-files/"+action, func(c *gin.Context) {
			var w struct {
				Source string `json:"source"`
				Offset int    `json:"offset"`
				Items  []struct {
					ID    string `json:"id"`
					Token string `json:"token"`
				} `json:"items"`
			}
			if !collaborationBody(c, &w) {
				return
			}
			src, ok := sources[w.Source]
			if !ok || w.Offset < 0 || len(w.Items) > 100 {
				httpx.Write(c, httpx.Invalid("source", "invalid_request"))
				return
			}
			var out any
			a, e := o.Identity.BusinessAccess(c.Request.Context(), rawSession(c), nil, func(tx identity.Tx, a *identity.Auth) error {
				if a.User.Role != "admin" {
					return httpx.E(403, "FORBIDDEN", "需要系统管理员权限")
				}
				releaseIO.Lock()
				defer releaseIO.Unlock()
				root, e := os.OpenRoot(o.Runtime.DataDir)
				if e != nil {
					return e
				}
				defer func() { _ = root.Close() }()
				all, e := src.list(tx, root)
				if e != nil {
					return e
				}
				if action == "preview" {
					var size int64
					for _, v := range all {
						size += v.Size
					}
					start := min(w.Offset, len(all))
					out = map[string]any{"total": len(all), "size_bytes": size, "items": all[start:min(start+100, len(all))]}
					return nil
				}
				if len(w.Items) == 0 {
					return httpx.Invalid("items", "required")
				}
				byID := map[string]tempCandidate{}
				for _, v := range all {
					byID[v.ID] = v
				}
				counts := map[string]int{}
				results := []map[string]string{}
				for _, item := range w.Items {
					v, ok := byID[item.ID]
					state := "missing"
					if ok {
						state = "skipped"
						if item.Token == v.Token {
							if e := src.remove(tx, root, v); e != nil {
								state = "failed"
							} else {
								state = "removed"
								delete(byID, item.ID)
							}
						}
					}
					counts[state]++
					results = append(results, map[string]string{"id": item.ID, "status": state})
				}
				out = map[string]any{"counts": counts, "items": results}
				meta := metadata(c)
				id := a.User.ID
				label := fmt.Sprint(w.Source)
				b, _ := json.Marshal(counts)
				return tx.Audit(identity.Event{ActorID: &id, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &a.User.Username, Action: "maintenance.temp_files_cleaned", TargetType: "maintenance", TargetLabel: label, OccurredAt: time.Now().UTC(), RequestID: &meta.RequestID, IP: &meta.IP, Detail: b})
			})
			if collaborationFinish(c, o, a, e) {
				httpx.Data(c, 200, out)
			}
		})
	}
}
