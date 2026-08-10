// Package web embeds the built frontend so the server ships as a single
// static binary (docs §4.2). dist/index.html is a placeholder today — the
// real frontend build overwrites this directory later with zero server
// code changes, since DistFS is already the fs.FS interface
// http.FileServerFS wants.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var raw embed.FS

// DistFS serves dist/ contents at the filesystem root (so dist/index.html
// is served as "/", not "/dist/").
var DistFS = mustSub(raw, "dist")

func mustSub(f embed.FS, dir string) fs.FS {
	sub, err := fs.Sub(f, dir)
	if err != nil {
		panic(err) // can only fail if "dist" itself is missing from the embed, a build-time bug
	}
	return sub
}
