// Package config loads runtime configuration from environment variables
// only — no dotenv-parsing dependency in the binary itself, matching
// gex-dashboard's convention. For local dev, source .env into the shell or
// use a process manager's EnvironmentFile mechanism.
package config

import (
	"os"
	"path/filepath"
)

// Config is validated once at startup so a missing/invalid setting fails
// fast before the server binds a port or opens the data directory.
type Config struct {
	HTTPAddr string
	DataDir  string
	DBPath   string
}

// Load reads configuration from the environment, applying defaults.
func Load() (Config, error) {
	dataDir := getenv("DATA_DIR", "data")
	return Config{
		HTTPAddr: getenv("HTTP_ADDR", ":8080"),
		DataDir:  dataDir,
		DBPath:   getenv("DB_PATH", filepath.Join(dataDir, "app.db")),
	}, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
