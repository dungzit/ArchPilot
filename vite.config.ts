import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

// Task 1.2 - dev only. The SPA on :5173 reaches FastAPI through this proxy, so
// the browser sees ONE origin, exactly like the production container (which
// serves the built SPA and /api together). That means no CORS, first-party
// cookies, and the archpilot_csrf cookie is readable by src/api/client.ts.
// Start the backend first:  cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
// Point elsewhere with:     ARCHPILOT_API_URL=http://127.0.0.1:9000 npm run dev
const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: process.env.ARCHPILOT_API_URL ?? 'http://127.0.0.1:8000',
    // Keep the browser's Host header; the backend does not route on it.
    changeOrigin: false,
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
