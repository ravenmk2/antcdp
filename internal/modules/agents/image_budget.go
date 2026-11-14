package agents

import (
	"encoding/hex"
	"sort"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

// Bound the entire request, including tool images. Conservative variant sizes
// let us omit old occurrences BEFORE disk reads and provider uploads.
func budgetImages(st StateRepository, session *SessionRow, rootSession uint64, runID *uint64, manifest *agentcore.SurfaceManifest, facts map[agentcore.Seq]agentcore.HistoryFact) error {
	type occurrence struct {
		target agentcore.ImageOffload
		size   uint64
	}
	var images []occurrence
	sizes := map[string]uint64{}
	for _, entry := range manifest.Entries {
		for _, seq := range entry.Sequences {
			f := facts[seq]
			if f.Message == nil {
				continue
			}
			removed := map[int]bool{}
			for _, t := range manifest.ImageOffloads {
				if t.Seq == seq {
					removed[t.Index] = true
				}
			}
			for i, p := range f.Message.Images {
				if removed[i] {
					continue
				}
				size, ok := sizes[p.ContentSHA256]
				if !ok {
					hash, e := hex.DecodeString(p.ContentSHA256)
					if e != nil {
						return integrity()
					}
					file, e := st.FileByHash(rootSession, hash)
					if e != nil {
						return e
					}
					if file == nil || file.SizeBytes == nil {
						return integrity()
					}
					size = min(*file.SizeBytes, uint64(imageVariantLimit))
					metadata := sourceImagePart(file, hash, "")
					if metadata.Width > 2048 || metadata.Height > 2048 {
						size = imageVariantLimit
					}
					sizes[p.ContentSHA256] = size
				}
				images = append(images, occurrence{agentcore.ImageOffload{Seq: seq, Index: i, SHA256: p.ContentSHA256}, size})
			}
		}
	}
	sort.SliceStable(images, func(i, j int) bool { return images[i].target.Seq < images[j].target.Seq })
	var bytes uint64
	for _, p := range images {
		bytes += p.size
	}
	count := len(images)
	var targets []agentcore.ImageOffload
	for _, p := range images {
		if bytes <= 20<<20 && count <= 24 {
			break
		}
		targets = append(targets, p.target)
		bytes -= p.size
		count--
	}
	if len(targets) == 0 {
		return nil
	}
	now := time.Now().UTC()
	if _, e := appendEvent(st, session, runID, "image/offload", "", map[string]any{"count": len(targets)}, &StoredEvent{ImageOffloads: targets}, now); e != nil {
		return e
	}
	manifest.ImageOffloads = append(manifest.ImageOffloads, targets...)
	manifest.Revision = agentcore.Version(session.SurfaceRevision)
	return st.SaveSession(session)
}
