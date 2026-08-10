import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/roboto'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import { hydratePreferences } from './store/preference-sync'

// Workspace settings (chart appearance, layouts, timeframe preferences,
// drawing favourites/templates) live on the server and are mirrored into
// localStorage. Their stores read that value the moment their module is
// imported, so the pull has to finish before the app module is loaded —
// hence the await plus a dynamic import rather than a static one at the
// top. hydratePreferences never rejects and is time-bounded: an
// unreachable backend delays the workspace, it does not stop it.
await hydratePreferences()
const { default: App } = await import('./App.tsx')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
