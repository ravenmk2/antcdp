package agents

import (
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func sourceImagePart(file *FileRow, hash []byte, origin string) modelcore.ImagePart {
	part := modelcore.ImagePart{MIME: file.MediaType, ContentSHA256: hexHash(hash), Origin: origin}
	var dimensions struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	}
	if json.Unmarshal(file.MediaProperties, &dimensions) == nil {
		part.Width, part.Height = dimensions.Width, dimensions.Height
	}
	if file.SizeBytes != nil {
		part.Bytes = int64(*file.SizeBytes)
	}
	return part
}
