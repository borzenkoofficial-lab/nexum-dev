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
import { nexumRuntime } from './runtime'
import { installE2EHarness } from './runtime/E2EHarness.ts'

const runtimeBoot = nexumRuntime.start()
window.addEventListener("error", event => nexumRuntime.diagnostics.error("APPLICATION", event.message || "Browser runtime error", event.error))
window.addEventListener("unhandledrejection", event => nexumRuntime.diagnostics.error("APPLICATION", "Unhandled promise rejection", event.reason))
window.addEventListener("pagehide", () => nexumRuntime.shutdown())
window.addEventListener("beforeunload", () => nexumRuntime.save())

void runtimeBoot.then(() => {
  installE2EHarness()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>,
  )
}).catch(error => {
  nexumRuntime.diagnostics.error("RUNTIME", "Runtime boot failed", error)
  createRoot(document.getElementById('root')!).render(<AppErrorBoundary><App /></AppErrorBoundary>)
})
