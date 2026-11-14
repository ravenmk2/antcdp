package integrations

import "testing"

func TestRepositoryLabelValidation(t *testing.T) {
	field := func(v string) Field[string] { return Field[string]{Set: true, Value: v} }
	valid := RepositoryLabelWrite{Code: field("backend"), Name: field(" 后端 "), Color: field("#abcdef")}
	label, e := normalizeRepositoryLabel(valid, RepositoryLabel{}, true)
	if e != nil || label.Name != "后端" || label.Color != "#ABCDEF" {
		t.Fatal(label, e)
	}
	for _, code := range []string{"", "Backend", "1backend", "../backend", "后端"} {
		w := valid
		w.Code = field(code)
		if _, e := normalizeRepositoryLabel(w, RepositoryLabel{}, true); e == nil {
			t.Fatal("accepted code", code)
		}
	}
	for _, color := range []string{"red", "#FFF", "#12345678", "url(x)"} {
		w := valid
		w.Color = field(color)
		if _, e := normalizeRepositoryLabel(w, RepositoryLabel{}, true); e == nil {
			t.Fatal("accepted color", color)
		}
	}
	if _, e := normalizeRepositoryLabel(RepositoryLabelWrite{Code: field("backend")}, label, false); e == nil {
		t.Fatal("mutable code")
	}
	if _, e := normalizeRepositoryLabel(RepositoryLabelWrite{Name: field(" \n ")}, label, false); e == nil {
		t.Fatal("blank name")
	}
}
