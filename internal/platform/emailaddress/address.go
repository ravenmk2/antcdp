package emailaddress

import (
	"regexp"
	"strings"
)

const atom = `[A-Za-z0-9!#$%&'*+/=?^_\x60{|}~-]+`
const label = `[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?`

var addressPattern = regexp.MustCompile(`^` + atom + `(?:\.` + atom + `)*@` + label + `(?:\.` + label + `)*$`)

// Normalize accepts a bare ASCII mailbox, or an empty optional value.
func Normalize(value string) (string, bool) {
	value = strings.TrimSpace(value)
	local, _, _ := strings.Cut(value, "@")
	return value, value == "" || len(value) <= 254 && len(local) <= 64 && addressPattern.MatchString(value)
}
