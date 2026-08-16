// Package config loads runtime configuration for the market-replay server.
// The single source is config.yaml at the repo root (path overridable via
// $CONFIG_FILE) — server address/paths and the HTTP layer's tunable limits
// all live there, one file to edit instead of scattered env vars and
// hardcoded consts. HTTP_ADDR/DATA_DIR/DB_PATH still override their
// config.yaml counterpart on top, unchanged from before this file existed,
// so docker-compose.yml and deploy/replay.service keep working as-is.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Limits mirrors config.yaml's limits: section. A zero field means "not
// set" — each consuming package (httpapi.ApplyLimits, indicators.ApplyLimits,
// econ.ApplyLimits) keeps its own hardcoded default in that case, so a
// config.yaml overriding one value never zeroes out the rest.
type Limits struct {
	GzipMinBytes                  int `yaml:"gzip_min_bytes"`
	PreferencePayloadBytes        int `yaml:"preference_payload_bytes"`
	IndicatorRunPayloadBytes      int `yaml:"indicator_run_payload_bytes"`
	DrawingTemplatePayloadBytes   int `yaml:"drawing_template_payload_bytes"`
	WorkspaceSnapshotPayloadBytes int `yaml:"workspace_snapshot_payload_bytes"`
	SimulationPayloadBytes        int `yaml:"simulation_payload_bytes"`
	EconLineBytes                 int `yaml:"econ_line_bytes"`
	MaxJournalTrades              int `yaml:"max_journal_trades"`
	IndicatorCacheSize            int `yaml:"indicator_cache_size"`
	IndicatorRunTimeoutSeconds    int `yaml:"indicator_run_timeout_seconds"`
}

// Config is validated once at startup so a missing/invalid setting fails
// fast before the server binds a port or opens the data directory.
type Config struct {
	HTTPAddr string
	DataDir  string
	DBPath   string
	Limits   Limits
}

// fileSchema is config.yaml's on-disk shape — only the sections the Go
// binary itself reads. pipeline: exists in the same file but is read by
// pipeline/*.py directly, never by this package.
type fileSchema struct {
	Server struct {
		HTTPAddr string `yaml:"http_addr"`
		DataDir  string `yaml:"data_dir"`
		DBPath   string `yaml:"db_path"`
	} `yaml:"server"`
	Limits Limits `yaml:"limits"`
}

// Load reads config.yaml (path overridable via $CONFIG_FILE), then applies
// HTTP_ADDR/DATA_DIR/DB_PATH env var overrides on top. A missing file is not
// an error — every field then falls back to the hardcoded default below,
// reproducing this package's pre-config.yaml behavior exactly.
func Load() (Config, error) {
	path := getenv("CONFIG_FILE", "config.yaml")
	var fc fileSchema
	switch data, err := os.ReadFile(path); {
	case err == nil:
		if err := yaml.Unmarshal(data, &fc); err != nil {
			return Config{}, fmt.Errorf("config: parse %s: %w", path, err)
		}
	case errors.Is(err, os.ErrNotExist):
		// No config.yaml — every field below uses its hardcoded default.
	default:
		return Config{}, fmt.Errorf("config: read %s: %w", path, err)
	}

	dataDir := firstNonEmpty(os.Getenv("DATA_DIR"), fc.Server.DataDir, "data")
	return Config{
		HTTPAddr: firstNonEmpty(os.Getenv("HTTP_ADDR"), fc.Server.HTTPAddr, ":8080"),
		DataDir:  dataDir,
		DBPath:   firstNonEmpty(os.Getenv("DB_PATH"), fc.Server.DBPath, filepath.Join(dataDir, "app.db")),
		Limits:   fc.Limits,
	}, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// firstNonEmpty returns the first non-empty value: env var, then
// config.yaml, then the built-in default.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
