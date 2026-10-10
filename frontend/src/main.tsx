import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { appBase } from '@/lib/app-base'
import { initTheme } from '@/lib/theme'
import App from '@/App'
import '@/index.css'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={appBase()}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
