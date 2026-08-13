package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleListIndicators(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/indicators", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") == "" {
		t.Error("missing Cache-Control header")
	}
	var got []struct {
		ID     string `json:"id"`
		Inputs []struct {
			Key string `json:"key"`
		} `json:"inputs"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	wantIDs := []string{"day-separator", "fractals", "gb69-cbmor", "ipda-ranges", "killzones", "open-price-markers"}
	if len(got) != len(wantIDs) {
		t.Fatalf("indicators list = %+v, want exactly %v", got, wantIDs)
	}
	for i, want := range wantIDs {
		if got[i].ID != want {
			t.Fatalf("indicators list[%d] = %q, want %q (list is sorted by id)", i, got[i].ID, want)
		}
		if len(got[i].Inputs) == 0 {
			t.Fatalf("%s: want a non-empty input schema", want)
		}
	}
}

func testRunURL(symbol, script string, at int64, extra string) string {
	return fmt.Sprintf("/api/v1/indicators/run?symbol=%s&script=%s&at=%d&before=%d&to=%d%s",
		symbol, script, at, testFixtureN, at, extra)
}

func TestHandleRunIndicator_Success(t *testing.T) {
	s := newTestServer(t)
	at := int64(testFixtureStart) + int64(testFixtureN-1)*60
	req := httptest.NewRequest(http.MethodPost, testRunURL("NQ", "gb69-cbmor", at, ""), nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Draws []any `json:"draws"`
		Plots []any `json:"plots"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v, body = %s", err, rec.Body.String())
	}
}

func TestHandleRunIndicator_AppliesInputOverrideBody(t *testing.T) {
	s := newTestServer(t)
	at := int64(testFixtureStart) + int64(testFixtureN-1)*60
	body := strings.NewReader(`{"inputs":{"show_range_box":false}}`)
	req := httptest.NewRequest(http.MethodPost, testRunURL("NQ", "gb69-cbmor", at, ""), body)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestHandleRunIndicator_MissingRequiredParams(t *testing.T) {
	s := newTestServer(t)
	at := int64(testFixtureStart)

	cases := []string{
		fmt.Sprintf("/api/v1/indicators/run?script=gb69-cbmor&at=%d", at), // missing symbol
		"/api/v1/indicators/run?symbol=NQ&at=100",                         // missing script
		"/api/v1/indicators/run?symbol=NQ&script=gb69-cbmor",              // missing at
	}
	for _, target := range cases {
		req := httptest.NewRequest(http.MethodPost, target, nil)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", target, rec.Code)
		}
	}
}

func TestHandleRunIndicator_UnknownScript(t *testing.T) {
	s := newTestServer(t)
	at := int64(testFixtureStart) + int64(testFixtureN-1)*60
	req := httptest.NewRequest(http.MethodPost, testRunURL("NQ", "does-not-exist", at, ""), nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s, want 404", rec.Code, rec.Body.String())
	}
}

func TestHandleRunIndicator_UnknownSymbol(t *testing.T) {
	s := newTestServer(t)
	at := int64(testFixtureStart) + int64(testFixtureN-1)*60
	req := httptest.NewRequest(http.MethodPost, testRunURL("ZZ", "gb69-cbmor", at, ""), nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s, want 404", rec.Code, rec.Body.String())
	}
}

func TestHandleRunIndicator_InvalidJSONBody(t *testing.T) {
	s := newTestServer(t)
	at := int64(testFixtureStart) + int64(testFixtureN-1)*60
	req := httptest.NewRequest(http.MethodPost, testRunURL("NQ", "gb69-cbmor", at, ""), strings.NewReader(`{not json`))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s, want 400", rec.Code, rec.Body.String())
	}
}

func TestHandleRunIndicator_InvalidOverrideValue(t *testing.T) {
	s := newTestServer(t)
	at := int64(testFixtureStart) + int64(testFixtureN-1)*60
	body := strings.NewReader(`{"inputs":{"i_calc_type":"Not A Real Option"}}`)
	req := httptest.NewRequest(http.MethodPost, testRunURL("NQ", "gb69-cbmor", at, ""), body)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s, want 400", rec.Code, rec.Body.String())
	}
}
