import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/roboto'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import { loadDuringHydration } from './bootstrap-loader'
import { hydrateDrawingTemplates } from './replay/drawing-templates'
import { hydratePreferences } from './store/preference-sync'

// Workspace settings (chart appearance, layouts, timeframe preferences,
// drawing favourites, drawing templates) live on the server and are
// mirrored into localStorage. Their stores read that value the moment
// their module is imported, so the pull has to finish before the app
// module is loaded — hence the await plus a dynamic import rather than a
// static one at the top. Both hydrate functions never reject and are
// time-bounded: an unreachable backend delays the workspace, it does not
// stop it.
const { default: App } = await loadDuringHydration(
  () => Promise.all([hydratePreferences(), hydrateDrawingTemplates()]).then(() => undefined),
  () => import('./App.tsx'),
)

// App is preloaded in parallel with preference hydration. Rehydrate the
// review store once the remote preference has landed so seeded journals and
// tags are visible on the very first analytics/review render.
const { useReviewStore } = await import('./store/review-store')
await useReviewStore.persist.rehydrate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
