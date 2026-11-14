//go:build linux

package workspacefs

import (
	"bufio"
	"context"
	"io"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

func (e *Engine) search(ctx context.Context, r *root, q Request) (any, error) {
	start, err := PublicPath(q.Path, true)
	if err != nil || len(q.Pattern) == 0 || len(q.Pattern) > 1024 {
		return nil, failure("WORKSPACE_SEARCH_INVALID")
	}
	limit := q.Limit
	if limit < 1 || limit > 200 {
		limit = 100
	}
	pattern := q.Pattern
	var expression *regexp.Regexp
	if q.Operation == "grep" {
		if q.Literal {
			pattern = regexp.QuoteMeta(pattern)
		}
		if q.CaseFold {
			pattern = "(?i)" + pattern
		}
		expression, err = regexp.Compile(pattern)
	} else {
		_, err = path.Match(pattern, "")
	}
	if err != nil {
		return nil, failure("WORKSPACE_SEARCH_INVALID")
	}
	paths := make([]string, 0)
	matches := make([]Match, 0)
	visited := 0
	truncated := false
	var walk func(string) error
	walk = func(name string) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if visited >= MaxWalkEntries || len(paths)+len(matches) >= limit {
			truncated = true
			return nil
		}
		visited++
		f, openErr := r.open(name, unix.O_RDONLY|unix.O_NONBLOCK, 0)
		if openErr != nil {
			// A symlink is deliberately not traversed, even inside /data.
			if openErr.Error() == "WORKSPACE_UNSAFE_PATH" || openErr.Error() == "WORKSPACE_PATH_NOT_FOUND" {
				return nil
			}
			return openErr
		}
		defer func() { _ = f.Close() }()
		st, statErr := statFile(f)
		if statErr != nil {
			return statErr
		}
		display := path.Join(q.Path, strings.TrimPrefix(strings.TrimPrefix(name, start), "/"))
		if q.Operation == "glob" {
			matched, _ := path.Match(pattern, strings.TrimPrefix(strings.TrimPrefix(name, start), "/"))
			if !strings.Contains(pattern, "/") {
				matched, _ = path.Match(pattern, path.Base(name))
			}
			if matched {
				paths = append(paths, display)
			}
		}
		if st.Mode&unix.S_IFMT == unix.S_IFDIR {
			names, readErr := f.Readdirnames(MaxWalkEntries + 1)
			if readErr != nil && readErr != io.EOF {
				return ioError(readErr)
			}
			if len(names) > MaxWalkEntries {
				truncated = true
				names = names[:MaxWalkEntries]
			}
			sort.Strings(names)
			for _, child := range names {
				if child == ".system" {
					continue
				}
				if err := walk(path.Join(name, child)); err != nil {
					return err
				}
				if visited >= MaxWalkEntries || len(paths)+len(matches) >= limit {
					truncated = true
					break
				}
			}
			return nil
		}
		if expression == nil || regular(st) != nil || st.Size > 2<<20 {
			return nil
		}
		return grepFile(ctx, f, expression, display, limit, &matches, &truncated)
	}
	if err = walk(start); err != nil {
		return nil, err
	}
	return map[string]any{"paths": paths, "matches": matches, "truncated": truncated, "visited_entries": visited}, nil
}

func grepFile(ctx context.Context, file *os.File, pattern *regexp.Regexp, name string, limit int, matches *[]Match, truncated *bool) error {
	scan := bufio.NewScanner(io.LimitReader(contextReader{ctx: ctx, r: file}, 2<<20))
	scan.Buffer(make([]byte, 4096), MaxReadBytes)
	line := 0
	for scan.Scan() {
		line++
		text := scan.Text()
		if !utf8.ValidString(text) || strings.ContainsRune(text, 0) {
			return nil
		}
		if pattern.MatchString(text) {
			if len(text) > 2048 {
				text = string([]rune(text)[:min(512, len([]rune(text)))])
			}
			*matches = append(*matches, Match{Path: name, Line: line, Text: text})
			if len(*matches) >= limit {
				*truncated = true
				return nil
			}
		}
	}
	if scan.Err() != nil {
		*truncated = true
	}
	return nil
}
