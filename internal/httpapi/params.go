package httpapi

import (
	"fmt"
	"net/url"
	"strconv"
)

// requiredParam returns query param name, or errBadRequest if absent.
func requiredParam(query url.Values, name string) (string, error) {
	v := query.Get(name)
	if v == "" {
		return "", fmt.Errorf("%w: %s is required", errBadRequest, name)
	}
	return v, nil
}

// parseInt64 parses query param name as an int64, returning def if the
// param is absent. Returns errBadRequest if present but unparseable.
func parseInt64(query url.Values, name string, def int64) (int64, error) {
	raw := query.Get(name)
	if raw == "" {
		return def, nil
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%w: %s=%q is not an integer", errBadRequest, name, raw)
	}
	return v, nil
}

// parseInt64Required is parseInt64 without a default — absent is an error.
func parseInt64Required(query url.Values, name string) (int64, error) {
	raw, err := requiredParam(query, name)
	if err != nil {
		return 0, err
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%w: %s=%q is not an integer", errBadRequest, name, raw)
	}
	return v, nil
}

// parseIntClamped parses query param name as an int, clamping the result
// to [lo,hi]. Absent -> def (assumed already within [lo,hi]).
func parseIntClamped(query url.Values, name string, def, lo, hi int) (int, error) {
	raw := query.Get(name)
	if raw == "" {
		return def, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%w: %s=%q is not an integer", errBadRequest, name, raw)
	}
	if v < lo {
		v = lo
	}
	if v > hi {
		v = hi
	}
	return v, nil
}
