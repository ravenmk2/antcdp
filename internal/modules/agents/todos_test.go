package agents

import (
	"strings"
	"testing"
)

func TestTodoSnapshotValidation(t *testing.T) {
	list, receipt, err := ParseTodos([]byte(`{"todos":[{"content":" B ","status":"in_progress"},{"content":"A","status":"in_progress"}]}`))
	if err != nil || list.Todos[0].Content != "B" || list.Todos[1].Content != "A" || !strings.Contains(receipt, "2 in progress") {
		t.Fatal(list, receipt, err)
	}
	if list, _, err = ParseTodos([]byte(`{"todos":[]}`)); err != nil || list.Todos == nil {
		t.Fatal("clear", err)
	}
	for _, invalid := range []string{`{}`, `{"todos":null}`, `{"todos":[{"content":" ","status":"pending"}]}`, `{"todos":[{"content":"A","status":"pending"},{"content":" A","status":"completed"}]}`} {
		if _, _, err = ParseTodos([]byte(invalid)); err == nil {
			t.Fatal("accepted", invalid)
		}
	}
}
