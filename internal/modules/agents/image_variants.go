package agents

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/jpeg"
	"image/png"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	"golang.org/x/image/draw"
)

// Changing any encoding/resize rule requires a new version. Never choose a
// different quality for old images just because the conversation has grown.
const imageVariantVersion = "image-request-v1-png-2048-4m-2mb"
const imageVariantLimit = 2 << 20

type imageVariant struct {
	Part       modelcore.ImagePart `json:"part"`
	StorageKey string              `json:"storage_key"`
	Owned      bool                `json:"owned"`
}

func imageCacheKey(value string) []byte { h := sha256.Sum256([]byte(value)); return h[:] }
func variantKey(hash string) string {
	return hex.EncodeToString(imageCacheKey(imageVariantVersion + "\x00" + hash))
}

func requestImageVariant(data []byte, source modelcore.ImagePart) (modelcore.ImagePart, []byte, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || !validAttachmentImageSize(cfg.Width, cfg.Height) {
		return source, nil, integrity()
	}
	part := modelcore.ImagePart{MIME: source.MIME, SourceSHA256: source.ContentSHA256, Variant: variantKey(source.ContentSHA256), Width: cfg.Width, Height: cfg.Height}
	output := data
	if cfg.Width > 2048 || cfg.Height > 2048 || len(data) > imageVariantLimit {
		decoded, _, e := image.Decode(bytes.NewReader(data))
		if e != nil {
			return part, nil, integrity()
		}
		if source.MIME == "image/jpeg" {
			decoded = orientImage(decoded, jpegOrientation(data))
		}
		width, height := decoded.Bounds().Dx(), decoded.Bounds().Dy()
		if width > 2048 || height > 2048 {
			if width >= height {
				height = max(1, height*2048/width)
				width = 2048
			} else {
				width = max(1, width*2048/height)
				height = 2048
			}
		}
		for {
			scaled := image.NewNRGBA(image.Rect(0, 0, width, height))
			draw.CatmullRom.Scale(scaled, scaled.Bounds(), decoded, decoded.Bounds(), draw.Over, nil)
			var buffer bytes.Buffer
			// Lossless screenshots/text/alpha; retain JPEG encoding for photographs.
			if source.MIME == "image/jpeg" {
				part.MIME = "image/jpeg"
				err = jpeg.Encode(&buffer, scaled, &jpeg.Options{Quality: 90})
			} else {
				part.MIME = "image/png"
				err = png.Encode(&buffer, scaled)
			}
			if err != nil {
				return part, nil, err
			}
			output = buffer.Bytes()
			part.Width, part.Height = width, height
			if len(output) <= imageVariantLimit {
				break
			}
			if width <= 256 && height <= 256 {
				return part, nil, integrity()
			}
			width = max(1, width*3/4)
			height = max(1, height*3/4)
		}
	}
	hash := sha256.Sum256(output)
	part.ContentSHA256 = hex.EncodeToString(hash[:])
	part.Bytes = int64(len(output))
	return part, output, nil
}
