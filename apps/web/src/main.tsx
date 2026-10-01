import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './nexum-visual-overrides.css'
import './nexum-os-polish.css'
import './nexum-os-layout-fix.css'
import './nexum-os-hardening.css'
import './nexum-premium-system.css'
import './nexum-os-experience.css'
import { AppErrorBoundary } from './components/AppErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
