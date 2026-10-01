import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AdminApp } from './components/AdminApp'
import './nexum-visual-overrides.css'
import './nexum-os-polish.css'
import './nexum-os-layout-fix.css'
import './nexum-os-hardening.css'
import './nexum-premium-system.css'
import './nexum-os-experience.css'
import { AppErrorBoundary } from './components/AppErrorBoundary'

const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {isAdminRoute ? <AdminApp /> : <App />}
    </AppErrorBoundary>
  </StrictMode>,
)
