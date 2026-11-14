package agents

import (
	"bytes"
	"errors"
	"image"
	"image/png"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func TestFilePublicationPathsStayInsideCurrentSession(t *testing.T) {
	got, e := fileCWDPath("/data/sessions/42", "reports/result.txt")
	if e != nil || got != "sessions/42/reports/result.txt" {
		t.Fatal(got, e)
	}
	for _, name := range []string{"/data/storage/a", "../other/a", "a/../b", "a\\b", "agents/../../x", "a\x00b"} {
		if _, e = fileCWDPath("/data/sessions/42", name); e == nil {
			t.Fatalf("unsafe import path accepted %q", name)
		}
	}
	if _, e = fileCWDPath("/host/tmp", "a"); e == nil {
		t.Fatal("host CWD accepted")
	}
}

func TestToolImageRejectsInvalidFormatDimensionsAndSizeBeforePersistence(t *testing.T) {
	store, e := NewByteStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	svc := CloudService{Host: &Service{Files: store}}
	var oversized bytes.Buffer
	if e = png.Encode(&oversized, image.NewNRGBA(image.Rect(0, 0, 4097, 1))); e != nil {
		t.Fatal(e)
	}
	for _, test := range []struct {
		name string
		data []byte
		size uint64
	}{
		{"text", []byte("not a picture"), 0},
		{"dimensions", oversized.Bytes(), 0},
		{"size", oversized.Bytes(), modelcore.MaxImageBytes + 1},
		{"corrupt", []byte("\x89PNG\r\n\x1a\ncorrupt"), 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			key := NewStorageKey()
			facts, err := store.Write(t.Context(), key, bytes.NewReader(test.data), 1<<20)
			if err != nil {
				t.Fatal(err)
			}
			if test.size != 0 {
				facts.Size = test.size
			}
			err = svc.stagePresentedFile(t.Context(), fileTransferClaim{Intent: fileTransferIntent{Image: &ReadImageRequest{Path: "image.png"}}}, FileOperationItemRow{}, key, facts)
			var failure *httpx.Error
			if !errors.As(err, &failure) || failure.Code != "IMAGE_INVALID" {
				t.Fatal("invalid image reached persistence", err)
			}
		})
	}
}
func TestPresentValidationDoesNotTruncateOrDuplicateFiles(t *testing.T) {
	if e := validatePresent(PresentRequest{Files: []PresentFile{{Path: "report.md", Description: "测试结果"}}}); e != nil {
		t.Fatal(e)
	}
	for _, w := range []PresentRequest{{}, {Files: make([]PresentFile, 21)}, {Files: []PresentFile{{Path: "a"}, {Path: "a"}}}, {Files: []PresentFile{{Path: "../a"}}}, {Files: []PresentFile{{Path: "a", Description: strings.Repeat("字", 2001)}}}} {
		if e := validatePresent(w); e == nil {
			t.Fatal("invalid present request accepted")
		}
	}
}
