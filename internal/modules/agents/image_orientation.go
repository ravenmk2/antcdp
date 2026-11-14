package agents

import (
	"bytes"
	"encoding/binary"
	"image"
)

// JPEG decoders return sensor orientation. Baking EXIF orientation into resized
// pixels prevents phone photographs from rotating when metadata is stripped.
func jpegOrientation(data []byte) int {
	if len(data) < 2 || data[0] != 255 || data[1] != 216 {
		return 1
	}
	for pos := 2; pos+4 <= len(data); {
		if data[pos] != 255 {
			return 1
		}
		marker := data[pos+1]
		if marker == 218 || marker == 217 {
			return 1
		}
		if marker == 255 {
			pos++
			continue
		}
		length := int(binary.BigEndian.Uint16(data[pos+2 : pos+4]))
		if length < 2 || pos+2+length > len(data) {
			return 1
		}
		segment := data[pos+4 : pos+2+length]
		pos += length + 2
		if marker != 225 || !bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
			continue
		}
		tiff := segment[6:]
		if len(tiff) < 8 {
			return 1
		}
		var order binary.ByteOrder
		switch string(tiff[:2]) {
		case "II":
			order = binary.LittleEndian
		case "MM":
			order = binary.BigEndian
		default:
			return 1
		}
		if order.Uint16(tiff[2:4]) != 42 {
			return 1
		}
		offset := uint64(order.Uint32(tiff[4:8]))
		if offset+2 > uint64(len(tiff)) {
			return 1
		}
		count := uint64(order.Uint16(tiff[offset : offset+2]))
		offset += 2
		for i := uint64(0); i < count && offset+12 <= uint64(len(tiff)); i++ {
			entry := tiff[offset : offset+12]
			offset += 12
			if order.Uint16(entry[:2]) == 0x112 && order.Uint16(entry[2:4]) == 3 && order.Uint32(entry[4:8]) == 1 {
				value := int(order.Uint16(entry[8:10]))
				if value >= 1 && value <= 8 {
					return value
				}
				return 1
			}
		}
	}
	return 1
}

func orientImage(source image.Image, orientation int) image.Image {
	if orientation <= 1 || orientation > 8 {
		return source
	}
	bounds := source.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	width, height := w, h
	if orientation >= 5 {
		width, height = h, w
	}
	target := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dx, dy := x, y
			switch orientation {
			case 2:
				dx = w - 1 - x
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dy = h - 1 - y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			target.Set(dx, dy, source.At(bounds.Min.X+x, bounds.Min.Y+y))
		}
	}
	return target
}
