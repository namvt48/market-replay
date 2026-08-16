package analytics

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrUnknownTimeZone is returned for a timezone name the runtime cannot
// resolve.
var ErrUnknownTimeZone = errors.New("analytics: unknown timezone")

// validTimeZoneName is a coarse pre-filter before touching time.LoadLocation,
// which resolves a name against tzdata — an unchecked name is user input
// reaching a lookup. Mirrors internal/econ/week.go's validTimeZoneName
// exactly; duplicated rather than imported since the two packages are
// otherwise unrelated and this is a dozen lines.
func validTimeZoneName(name string) bool {
	if len(name) > 64 || strings.HasPrefix(name, "/") || strings.Contains(name, "..") {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '/' || r == '_' || r == '-' || r == '+':
		default:
			return false
		}
	}
	return name != ""
}

// LoadLocation resolves an IANA timezone name, defaulting to UTC for an
// empty string. It never has its own cache — time.LoadLocation's
// zoneinfo parse is cheap and BuildReport calls this once per request.
func LoadLocation(name string) (*time.Location, error) {
	if name == "" {
		return time.UTC, nil
	}
	if !validTimeZoneName(name) {
		return nil, fmt.Errorf("%w: %q", ErrUnknownTimeZone, name)
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("%w: %q", ErrUnknownTimeZone, name)
	}
	return loc, nil
}
