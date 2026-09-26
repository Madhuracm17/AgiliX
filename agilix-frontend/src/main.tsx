import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AuthGate from './auth/AuthGate.tsx'
import { installAuthFetch } from './auth/authFetch.ts'

// Adds the login token to every request sent to the AgiliX backend.
// Must run before the app renders so no request is sent without it.
installAuthFetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
)