import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LoginPage } from './components/LoginPage.tsx'

const page = window.location.pathname.replace(/\/+$/u, '') === '/login'
  ? <LoginPage />
  : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {page}
  </StrictMode>,
)
