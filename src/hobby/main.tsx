import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HobbyApp } from './HobbyApp'
import './hobby.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HobbyApp />
  </StrictMode>,
)
