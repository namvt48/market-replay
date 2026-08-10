import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// The Go server (internal/httpapi) is the only backend the frontend ever
// talks to (docs #5) and the client always calls same-origin relative
// paths like `/api/v1/...`. In production that origin is the Go binary
// itself (web/embed.go serves web/dist). In `pnpm dev`, Vite serves the
// frontend on its own port, so without this proxy those relative fetches
// have nothing to reach — this is what actually wires FE and BE together
// for local development; run the Go server on :8080 alongside `pnpm dev`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'drawing-tools', test: /lightweight-charts-drawing/ },
            { name: 'chart-core', test: /node_modules\/lightweight-charts\// },
          ],
        },
      },
    },
  },
})
