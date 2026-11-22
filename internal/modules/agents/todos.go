package agents

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

type TodoItem struct {
	Content string `json:"content"`
	Status  string `json:"status"`
}

type TodoList struct {
	Todos       []TodoItem `json:"todos"`
	Explanation string     `json:"explanation,omitempty"`
}

func ParseTodos(args []byte) (TodoList, string, error) {
	var list TodoList
	if err := json.Unmarshal(args, &list); err != nil || list.Todos == nil || len(list.Todos) > 20 {
		return list, "", errors.New("invalid todo list")
	}
	seen := map[string]bool{}
	counts := map[string]int{"pending": 0, "in_progress": 0, "completed": 0}
	for i := range list.Todos {
		item := &list.Todos[i]
		item.Content = strings.TrimSpace(item.Content)
		_, ok := counts[item.Status]
		if !ok || item.Content == "" || utf8.RuneCountInString(item.Content) > 1000 || seen[item.Content] {
			return list, "", errors.New("invalid or duplicate todo item")
		}
		seen[item.Content] = true
		counts[item.Status]++
	}
	return list, fmt.Sprintf("Updated todos: %d pending, %d in progress, %d completed.", counts["pending"], counts["in_progress"], counts["completed"]), nil
}
