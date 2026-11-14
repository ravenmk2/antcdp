package agentcore

import "github.com/ravenmk2/antcdp/internal/modelcore"

// Occurrence identities, never a global hash blacklist: reading the same image
// again creates a fresh visible occurrence. Original events remain untouched.
func ProjectImages(message modelcore.Message, seq Seq, targets []ImageOffload) (modelcore.Message, error) {
	removed := map[int]bool{}
	for _, t := range targets {
		if t.Seq == seq {
			if t.Index < 0 || t.Index >= len(message.Images) || message.Images[t.Index].ContentSHA256 != t.SHA256 || removed[t.Index] {
				return message, reject("IMAGE_OFFLOAD_INVALID")
			}
			removed[t.Index] = true
		}
	}
	if len(removed) == 0 {
		return message, nil
	}
	if message.Role != "user" && message.Role != "tool" {
		return message, reject("IMAGE_OFFLOAD_INVALID")
	}
	original := message.Images
	message.Images = nil
	for i, p := range original {
		if removed[i] {
			message.Content += "\n[Earlier image omitted from model input to stay within the image budget; SHA256: " + p.ContentSHA256 + ". Use read_image with the original file path if available to inspect it again.]"
		} else {
			message.Images = append(message.Images, p)
		}
	}
	return message, nil
}
