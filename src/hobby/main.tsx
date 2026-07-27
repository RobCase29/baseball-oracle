import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HobbyRouter } from './HobbyRouter'
import './hobby.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HobbyRouter />
  </StrictMode>,
)
