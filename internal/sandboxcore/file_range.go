package sandboxcore

import (
	"strconv"
	"strings"
)

// ValidFileRange permits one HTTP byte range, including suffix ranges.
func ValidFileRange(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > 128 || !strings.HasPrefix(value, "bytes=") {
		return false
	}
	start, end, ok := strings.Cut(strings.TrimPrefix(value, "bytes="), "-")
	if !ok {
		return false
	}
	parse := func(value string) (int64, bool) {
		if value == "" {
			return 0, false
		}
		for _, c := range value {
			if c < '0' || c > '9' {
				return 0, false
			}
		}
		n, err := strconv.ParseInt(value, 10, 64)
		return n, err == nil
	}
	if start == "" {
		n, valid := parse(end)
		return valid && n > 0
	}
	first, valid := parse(start)
	if !valid {
		return false
	}
	if end == "" {
		return true
	}
	last, valid := parse(end)
	return valid && last >= first
}
