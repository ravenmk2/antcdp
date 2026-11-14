package modelcore

// Conservative visual-token allowance, independent of base64/file-ID transport.
// This is a reservation, never reported as observed provider token usage.
func EstimateImageTokens(image ImagePart) uint64 {
	if image.Width < 1 || image.Height < 1 || image.Width > 4096 || image.Height > 4096 {
		return 8192
	}
	return max(1024, uint64((image.Width+27)/28)*uint64((image.Height+27)/28)+256)
}
