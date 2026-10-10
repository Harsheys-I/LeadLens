import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from '@/lib/auth.tsx'
import { initTheme } from '@/lib/theme.ts'
import App from '@/App.tsx'
import '@/index.css'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
