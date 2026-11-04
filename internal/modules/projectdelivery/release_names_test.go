package projectdelivery

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestReleaseNameNormalization(t *testing.T) {
	for _, tc := range []struct {
		label, value, want string
		invalid            bool
	}{
		{label: "optional"},
		{label: "blank", value: " \t\n\u3000 "},
		{label: "trimmed", value: "\u3000 会员体系升级 \u3000", want: "会员体系升级"},
		{label: "Unicode limit", value: strings.Repeat("升", 120), want: strings.Repeat("升", 120)},
		{label: "emoji", value: "体验升级 🚀", want: "体验升级 🚀"},
		{label: "over limit", value: strings.Repeat("升", 121), invalid: true},
		{label: "newline", value: "第一行\n第二行", invalid: true},
		{label: "tab", value: "名字\t内容", invalid: true},
		{label: "control", value: "名字\x00内容", invalid: true},
		{label: "line separator", value: "名字\u2028内容", invalid: true},
		{label: "paragraph separator", value: "名字\u2029内容", invalid: true},
		{label: "invalid UTF-8", value: "\xff", invalid: true},
	} {
		t.Run(tc.label, func(t *testing.T) {
			got, err := normalizeReleaseName(tc.value)
			if (err != nil) != tc.invalid || got != tc.want {
				t.Fatalf("normalized name %q, error %v; want %q, invalid %t", got, err, tc.want, tc.invalid)
			}
		})
	}
}

func TestManifestZIPUsesFrozenReleaseNameAndLegacyVersion(t *testing.T) {
	for _, tc := range []struct {
		label, header, title string
	}{
		{"named snapshot", `{"name":"会员体系升级","version_label":"1.2.0","description_md":"冻结的说明"}`, "会员体系升级"},
		{"unnamed snapshot", `{"name":"","version_label":"1.2.0","description_md":"冻结的说明"}`, "1.2.0"},
		{"legacy snapshot", `{"version_label":"1.1.0","description_md":"冻结的说明"}`, "1.1.0"},
	} {
		t.Run(tc.label, func(t *testing.T) {
			download := ManifestDownload{Manifest: Manifest{Header: json.RawMessage(tc.header)}}
			var out bytes.Buffer
			if err := download.WriteZip(nil, &out); err != nil {
				t.Fatal(err)
			}
			archive, err := zip.NewReader(bytes.NewReader(out.Bytes()), int64(out.Len()))
			if err != nil {
				t.Fatal(err)
			}
			readme, err := archive.Open("README.md")
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = readme.Close() }()
			content, err := io.ReadAll(readme)
			if err != nil || string(content) != "# "+tc.title+"\n\n冻结的说明\n" {
				t.Fatalf("ZIP README does not use frozen display name: %q, %v", content, err)
			}
		})
	}
}
