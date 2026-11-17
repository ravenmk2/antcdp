// Package resourcecode owns the immutable program-readable resource name grammar.
package resourcecode

import "regexp"

var Pattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

func Valid(value string) bool { return Pattern.MatchString(value) }
