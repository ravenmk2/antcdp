package sandboxcore

import "testing"

func TestSingleFileRanges(t *testing.T) {
	for _, value := range []string{"", "bytes=0-", "bytes=2-4", "bytes=-10"} {
		if !ValidFileRange(value) {
			t.Fatal("valid range rejected", value)
		}
	}
	for _, value := range []string{"bytes=-", "bytes=-0", "bytes=3-2", "bytes=+1-2", "bytes=0-1,3-4", "bytes=0-\r\n", "bytes=9999999999999999999999-", "items=0-1"} {
		if ValidFileRange(value) {
			t.Fatal("invalid range accepted", value)
		}
	}
}
